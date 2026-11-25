import { createVerify, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import { buildReport, exitCode, type SiteConfig } from "./core";
import { createGscClient, GSC_SCOPE, gscClientWithToken, parseServiceAccount, signedAssertion, type GscClient } from "./gsc";
import { buildNotification, publicErrorLine, publicLogLine } from "./notify";
import { classifyInspection, periods, runStatsIndexing } from "./stats";

const site = JSON.parse(readFileSync(join(process.cwd(), "seo/site.json"), "utf8")) as SiteConfig;
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const key = {
  client_email: "seo-reader@test.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
};
const decode = (part: string) => JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());

describe("service account auth", () => {
  it("signs a read-only JWT that verifies with the public key", () => {
    const jwt = signedAssertion(key, 1_800_000_000);
    const [header, claims, signature] = jwt.split(".");
    expect(decode(header)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(decode(claims)).toMatchObject({ iss: key.client_email, scope: GSC_SCOPE, aud: "https://oauth2.googleapis.com/token", exp: 1_800_003_600 });
    expect(GSC_SCOPE).toBe("https://www.googleapis.com/auth/webmasters.readonly");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${header}.${claims}`);
    expect(verifier.verify(publicKey, Buffer.from(signature.replace(/-/g, "+").replace(/_/g, "/"), "base64"))).toBe(true);
  });

  it("rejects a missing or wrong secret without echoing it", () => {
    expect(() => parseServiceAccount(undefined)).toThrow("GSC_SERVICE_ACCOUNT_JSON is not set");
    expect(() => parseServiceAccount('{"type":"authorized_user"}')).toThrow("is not a service account key");
  });

  it("calls only read endpoints and never leaks the token or key in errors", async () => {
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    const http = async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method, body: String(init.body ?? "") });
      if (url.includes("oauth2")) return new Response(JSON.stringify({ access_token: "ya29.SECRET" }));
      if (url.includes("sitemaps")) return new Response(JSON.stringify({ error: { message: "User does not have sufficient permission" } }), { status: 403 });
      return new Response(JSON.stringify({ rows: [{ keys: [], clicks: 1, impressions: 10, ctr: 0.1, position: 7 }] }));
    };
    const client = await createGscClient(key, "sc-domain:healthguide.cy", http);
    await client.searchAnalytics({ startDate: "2026-10-01", endDate: "2026-10-28" });
    const error = await client.sitemaps().catch((e: Error) => e);
    expect(String(error)).toContain("HTTP 403 User does not have sufficient permission");
    expect(String(error)).not.toContain("ya29.SECRET");
    expect(String(error)).not.toContain("PRIVATE KEY");
    expect(calls[0].body).toContain("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer");
    expect(calls[1].url).toBe("https://searchconsole.googleapis.com/webmasters/v3/sites/sc-domain%3Ahealthguide.cy/searchAnalytics/query");
    expect(calls[2]).toMatchObject({ method: "GET" });
  });
});

describe("keyless token", () => {
  it("uses a token minted by Workload Identity Federation without any key", async () => {
    const seen: string[] = [];
    const client = gscClientWithToken("ya29.short-lived\n", "https://healthguide.cy/", async (url, init) => {
      seen.push(`${url} ${(init.headers as Record<string, string>).authorization}`);
      return new Response(JSON.stringify({ sitemap: [] }));
    });
    await client.sitemaps();
    expect(seen).toEqual(["https://searchconsole.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fhealthguide.cy%2F/sitemaps Bearer ya29.short-lived"]);
    expect(() => gscClientWithToken("  ", "sc-domain:healthguide.cy")).toThrow("GSC_ACCESS_TOKEN is empty");
  });
});

describe("periods", () => {
  it("uses 28 complete days ending 3 days ago and the 28 before", () => {
    expect(periods(new Date("2026-11-30T06:15:00Z"))).toEqual({
      current: { start: "2026-10-31", end: "2026-11-27" },
      previous: { start: "2026-10-03", end: "2026-10-30" },
    });
  });
});

describe("classifyInspection", () => {
  const url = "https://healthguide.cy/ru/paphos";
  it("passes an indexed page", () => {
    expect(classifyInspection(url, { verdict: "PASS", coverageState: "Submitted and indexed", pageFetchState: "SUCCESSFUL" })).toMatchObject({ verdict: "PASS" });
  });
  it("warns, not fails, on a page Google has not indexed yet", () => {
    expect(classifyInspection(url, { verdict: "NEUTRAL", coverageState: "Discovered - currently not indexed" })).toMatchObject({ verdict: "WARN", severity: "medium" });
    expect(classifyInspection(url, { verdict: "NEUTRAL", coverageState: "URL is unknown to Google" })).toMatchObject({ verdict: "WARN" });
  });
  it("fails when Google picks another canonical", () => {
    expect(classifyInspection(url, {
      verdict: "NEUTRAL", coverageState: "Duplicate, Google chose different canonical than user",
      googleCanonical: "https://healthguide.cy/en/paphos", userCanonical: url,
    })).toMatchObject({ verdict: "FAIL", severity: "high" });
  });
  it("fails critically on a noindex or robots block", () => {
    expect(classifyInspection(url, { indexingState: "BLOCKED_BY_META_TAG" })).toMatchObject({ verdict: "FAIL", severity: "critical" });
    expect(classifyInspection(url, { robotsTxtState: "DISALLOWED" })).toMatchObject({ verdict: "FAIL", severity: "critical" });
  });
});

describe("runStatsIndexing", () => {
  const urls = ["https://healthguide.cy/ru/paphos", "https://healthguide.cy/en/paphos", "https://healthguide.cy/el/paphos"];
  const fake: GscClient = {
    async searchAnalytics(body) {
      const dims = (body.dimensions as string[] | undefined) ?? [];
      if (dims[0] === "query") {
        return [
          { keys: ["duty pharmacy paphos"], clicks: 4, impressions: 120, ctr: 0.033, position: 8.44 },
          { keys: ["private client query"], clicks: 1, impressions: 3, ctr: 0.3, position: 2 },
        ];
      }
      if (dims[0] === "page") return [{ keys: [urls[0]], clicks: 5, impressions: 123, ctr: 0.04, position: 9 }];
      return body.startDate === "2026-10-31"
        ? [{ keys: [], clicks: 5, impressions: 123, ctr: 0.0407, position: 9.04 }]
        : [{ keys: [], clicks: 1, impressions: 40, ctr: 0.025, position: 14 }];
    },
    async inspect(url) {
      if (url.includes("/el/")) throw new Error("urlInspection.index.inspect: HTTP 429 Quota exceeded");
      return url.includes("/ru/")
        ? { verdict: "PASS", coverageState: "Submitted and indexed", pageFetchState: "SUCCESSFUL" }
        : { verdict: "NEUTRAL", coverageState: "Discovered - currently not indexed" };
    },
    async sitemaps() {
      return [{ path: "https://healthguide.cy/sitemap.xml", lastDownloaded: "2026-11-29T10:00:00Z", errors: "0", warnings: "0" }];
    },
  };

  it("collects metrics, keeps query text out of findings and notifications, and reports inspection failures", async () => {
    const now = new Date("2026-11-30T06:15:00Z");
    const result = await runStatsIndexing(site, fake, urls, now);
    expect(result.metrics).toMatchObject({
      gsc_clicks_28d: 5, gsc_impressions_28d: 123, gsc_clicks_prev_28d: 1,
      indexed_pages: 1, indexed_pages_ru: 1, inspected_pages: 2, target_queries_seen: 1,
    });
    expect(result.data?.targets.find((t) => t.query === "duty pharmacy paphos")).toMatchObject({ found: true, position: 8.4 });
    expect(result.findings.find((f) => f.id === "index:/el/paphos")).toMatchObject({ verdict: "BLOCKER" });

    const report = buildReport({ site, job: "stats-indexing", trigger: "schedule", started: now, finished: now, ...result,
      artifacts: [{ name: "gsc-data", path: "x.gsc-data.json", schema: "oa.seo.gsc-data/v1", private: true }] });
    expect(report.status).toBe("blocked");
    expect(exitCode(report)).toBe(3);
    const notification = buildNotification(report, site.name);
    const everythingShared = JSON.stringify(report.findings) + notification.text;
    expect(everythingShared).not.toContain("private client query");
    expect(everythingShared).not.toContain("duty pharmacy paphos");

    const ajv = new Ajv2020({ strict: false });
    addFormats(ajv);
    const validate = ajv.compile(JSON.parse(readFileSync(join(process.cwd(), "seo/contracts/run-report.v1.schema.json"), "utf8")));
    expect(validate(report), JSON.stringify(validate.errors)).toBe(true);
  });

  it("confirms each API separately and keeps Google's error text out of the public log", async () => {
    const leaky = "HTTP 400 Invalid filter 'private client query' (token ya29.LEAK)";
    const broken: GscClient = { ...fake, async searchAnalytics() { throw new Error(`searchAnalytics.query: ${leaky}`); } };
    const now = new Date("2026-11-30T06:15:00Z");
    const result = await runStatsIndexing(site, broken, urls, now);
    const report = buildReport({ site, job: "stats-indexing", trigger: "manual", started: now, finished: now, ...result });
    expect(report.status).toBe("blocked");
    expect(report.findings.find((f) => f.id === "gsc.api.search-analytics")).toMatchObject({ verdict: "BLOCKER" });
    expect(report.findings.find((f) => f.id === "gsc.api.url-inspection")).toMatchObject({ verdict: "PASS", evidence: expect.stringContaining("2 of 3 answered") });
    expect(report.findings.find((f) => f.id === "gsc.api.sitemaps")).toMatchObject({ verdict: "PASS" });

    const line = publicLogLine(report);
    expect(line).toBe("healthguide-cy.stats-indexing.20261130T061500Z: blocked (PASS 4, WARN 1, FAIL 0, BLOCKER 2, checked 2/3) apis: search-analytics=BLOCKER url-inspection=PASS sitemaps=PASS");
    for (const secret of ["private client query", "ya29", "Invalid filter", "healthguide.cy/", "duty pharmacy"]) expect(line).not.toContain(secret);
    expect(publicErrorLine(new TypeError(leaky))).toBe("SEO agent stopped with TypeError; details are withheld from public logs.");
  });

  it("is blocked, never ok, without Search Console access", async () => {
    const result = await runStatsIndexing(site, new Error("GSC_SERVICE_ACCOUNT_JSON is not set"), urls, new Date());
    const report = buildReport({ site, job: "stats-indexing", trigger: "schedule", started: new Date(), finished: new Date(), ...result });
    expect(report.status).toBe("blocked");
    expect(report.findings[0]).toMatchObject({ id: "gsc.access", verdict: "BLOCKER", evidence: "GSC_SERVICE_ACCOUNT_JSON is not set" });
  });
});
