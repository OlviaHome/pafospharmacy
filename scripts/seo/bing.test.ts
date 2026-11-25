import { readFileSync } from "node:fs";
import { join } from "node:path";

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import { BING_API, BING_TOKEN_URL, bingDate, createBingClient, readBingCredentials, type BingClient } from "./bing";
import { classifyFeed, classifyUrlInfo, runBingStats, trafficWindows, type BingSiteConfig } from "./bing-stats";
import { buildReport, exitCode } from "./core";
import { buildNotification, publicLogLine } from "./notify";

const site = JSON.parse(readFileSync(join(process.cwd(), "seo/site.json"), "utf8")) as BingSiteConfig;
const SECRET = "client-secret-value-123";
const REFRESH = "refresh-token-value-456";
const ACCESS = "access-token-value-789";
const credentials = { clientId: "client-id", clientSecret: SECRET, refreshToken: REFRESH };
const now = new Date("2026-11-25T08:00:00Z");
const ms = (iso: string) => `/Date(${Date.parse(iso)})/`;

function schemaValidator(file: string) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(JSON.parse(readFileSync(join(process.cwd(), "seo/contracts", file), "utf8")));
}

function fakeHttp(answers: Record<string, { status?: number; body: unknown }>, calls: Array<{ url: string; method?: string; body?: string; auth?: string }>) {
  return async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, method: init?.method, body: init?.body?.toString(), auth: headers.authorization });
    const key = url === BING_TOKEN_URL ? "token" : new URL(url).pathname.split("/").pop() ?? "";
    const answer = answers[key] ?? { status: 404, body: { ErrorCode: 1, Message: "unknown method" } };
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  };
}

const okAnswers = {
  token: { body: { access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600, scope: "Read" } },
  GetUserSites: { body: { d: [{ Url: "https://healthguide.cy/", IsVerified: true }] } },
  GetRankAndTrafficStats: { body: { d: [
    { Date: ms("2026-11-20T00:00:00Z"), Clicks: 3, Impressions: 40 },
    { Date: ms("2026-11-10T00:00:00Z"), Clicks: 1, Impressions: 10 },
    { Date: ms("2026-10-15T00:00:00Z"), Clicks: 2, Impressions: 5 },
  ] } },
  GetQueryStats: { body: { d: [{ Query: "secret business query", Clicks: 1, Impressions: 9 }] } },
  GetCrawlStats: { body: { d: [
    { Date: ms("2026-11-22T00:00:00Z"), CrawledPages: 30, InIndex: 12, Code4xx: 0, Code5xx: 0, BlockedByRobotsTxt: 0 },
    { Date: ms("2026-11-23T00:00:00Z"), CrawledPages: 35, InIndex: 14, Code4xx: 1, Code5xx: 0, BlockedByRobotsTxt: 0 },
  ] } },
  GetFeeds: { body: { d: [{ Url: "https://healthguide.cy/sitemap.xml", Status: "Success", UrlCount: 60, Submitted: ms("2026-11-25T00:00:00Z") }] } },
  GetCrawlIssues: { body: { d: [] } },
  GetUrlInfo: { body: { d: { HttpStatus: 200, LastCrawledDate: ms("2026-11-22T00:00:00Z"), DiscoveryDate: ms("2026-11-20T00:00:00Z") } } },
};

describe("Bing credentials and auth", () => {
  it("names missing variables without values", () => {
    const result = readBingCredentials({ BING_CLIENT_ID: "x", BING_CLIENT_SECRET: "" });
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe("Bing credentials not set: BING_CLIENT_SECRET, BING_REFRESH_TOKEN");
  });

  it("refreshes the token by form POST and then calls only read GET methods with a bearer token", async () => {
    const calls: Array<{ url: string; method?: string; body?: string; auth?: string }> = [];
    const client = await createBingClient(credentials, "https://healthguide.cy/", fakeHttp(okAnswers, calls));
    expect(calls[0]).toMatchObject({ url: BING_TOKEN_URL, method: "POST" });
    const form = new URLSearchParams(calls[0].body);
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe(REFRESH);
    expect(client.refreshTokenRotated).toBe(false);

    await client.userSites();
    await client.crawlStats();
    await client.urlInfo("https://healthguide.cy/en");
    for (const call of calls.slice(1)) {
      expect(call.method).toBe("GET");
      expect(call.url.startsWith(`${BING_API}/Get`)).toBe(true);
      expect(call.auth).toBe(`Bearer ${ACCESS}`);
      expect(call.url).not.toContain(ACCESS);
      expect(call.url).not.toMatch(/apikey/i);
    }
  });

  it("reports Bing errors without echoing any credential", async () => {
    const calls: Array<{ url: string }> = [];
    const bad = { token: { status: 400, body: { error: "invalid_grant", error_description: "token expired" } } };
    const error = await createBingClient(credentials, "https://healthguide.cy/", fakeHttp(bad, calls)).catch((e: Error) => e);
    expect(String(error)).toContain("oauth.token: HTTP 400 invalid_grant: token expired");
    for (const value of [SECRET, REFRESH, ACCESS]) expect(String(error)).not.toContain(value);

    const apiFail = { ...okAnswers, GetUserSites: { status: 400, body: { ErrorCode: 14, Message: "InvalidToken" } } };
    const client = await createBingClient(credentials, "https://healthguide.cy/", fakeHttp(apiFail, []));
    const apiError = await client.userSites().catch((e: Error) => e);
    expect(String(apiError)).toBe("Error: GetUserSites: HTTP 400 ErrorCode=14 InvalidToken");
  });

  it("notices a rotated refresh token", async () => {
    const rotated = { ...okAnswers, token: { body: { access_token: ACCESS, refresh_token: "another" } } };
    const client = await createBingClient(credentials, "https://healthguide.cy/", fakeHttp(rotated, []));
    expect(client.refreshTokenRotated).toBe(true);
    const { findings } = await runBingStats(site, client, now);
    expect(findings.find((f) => f.id === "bing.auth.rotation")?.verdict).toBe("WARN");
  });
});

describe("Bing helpers", () => {
  it("parses Bing JSON dates", () => {
    expect(bingDate("/Date(1732406400000)/")?.toISOString()).toBe("2024-11-24T00:00:00.000Z");
    expect(bingDate("/Date(1732406400000-0800)/")?.toISOString()).toBe("2024-11-24T00:00:00.000Z");
    expect(bingDate(undefined)).toBeUndefined();
  });

  it("sums the last 28 days and the 28 before", () => {
    const w = trafficWindows(okAnswers.GetRankAndTrafficStats.body.d, now);
    expect(w.current).toEqual({ clicks: 4, impressions: 50 });
    expect(w.previous).toEqual({ clicks: 2, impressions: 5 });
  });

  it("classifies sitemap feeds", () => {
    const sitemap = "https://healthguide.cy/sitemap.xml";
    expect(classifyFeed(undefined, sitemap)).toMatchObject({ verdict: "WARN", owner_decision: true });
    expect(classifyFeed({ Url: sitemap, Status: "Processing" }, sitemap).verdict).toBe("WARN");
    expect(classifyFeed({ Url: sitemap, Status: "Success" }, sitemap).verdict).toBe("PASS");
    expect(classifyFeed({ Url: sitemap, Status: "Error" }, sitemap).verdict).toBe("FAIL");
  });

  it("classifies key-page crawl info", () => {
    const url = "https://healthguide.cy/en";
    expect(classifyUrlInfo(url, { HttpStatus: 200, LastCrawledDate: ms("2026-11-22T00:00:00Z") }).verdict).toBe("PASS");
    expect(classifyUrlInfo(url, { HttpStatus: 0, LastCrawledDate: "/Date(-62135596800000)/" }).verdict).toBe("WARN");
    expect(classifyUrlInfo(url, { HttpStatus: 404, LastCrawledDate: ms("2026-11-22T00:00:00Z") }).verdict).toBe("FAIL");
  });
});

describe("bing-stats job", () => {
  it("confirms each API, keeps query text out of the report and validates against the contract", async () => {
    const client = await createBingClient(credentials, "https://healthguide.cy/", fakeHttp(okAnswers, []));
    const result = await runBingStats(site, client, now);
    const apis = result.findings.filter((f) => f.check === "bing-api");
    expect(apis.map((f) => f.id)).toEqual(["bing.api.user-sites", "bing.api.traffic", "bing.api.query-stats", "bing.api.crawl-stats", "bing.api.feeds", "bing.api.crawl-issues", "bing.api.url-info"]);
    expect(apis.every((f) => f.verdict === "PASS")).toBe(true);
    expect(result.findings.find((f) => f.id === "bing.site.verified")?.verdict).toBe("PASS");
    expect(result.findings.find((f) => f.id === "bing.sitemap.status")?.verdict).toBe("PASS");
    expect(result.findings.find((f) => f.id === "bing.crawl.latest")).toMatchObject({ verdict: "WARN", evidence: expect.stringContaining("date=2026-11-23") });
    expect(result.metrics).toMatchObject({ bing_clicks_28d: 4, bing_impressions_28d: 50, bing_in_index_latest: 14, bing_sitemap_urls: 60, bing_key_pages_checked: site.key_paths.length });
    expect(result.data?.queries[0].Query).toBe("secret business query");

    const report = buildReport({ site, job: "bing-stats", trigger: "manual", started: now, finished: now, findings: result.findings, coverage: result.coverage, metrics: result.metrics, artifacts: [{ name: "bing-data", path: "x.json", schema: "oa.seo.bing-data/v1", private: true }] });
    const validate = schemaValidator("run-report.v1.schema.json");
    expect(validate(report), JSON.stringify(validate.errors)).toBe(true);
    const notification = buildNotification(report, site.name);
    const everything = JSON.stringify(report) + JSON.stringify(notification);
    expect(everything).not.toContain("secret business query");
    for (const value of [SECRET, REFRESH, ACCESS]) expect(everything).not.toContain(value);

    const line = publicLogLine(report);
    expect(line).toContain("apis: user-sites=PASS traffic=PASS query-stats=PASS crawl-stats=PASS feeds=PASS crawl-issues=PASS url-info=PASS");
    expect(line).not.toContain("healthguide.cy/en");
  });

  it("treats an empty new site as WARN, not FAIL", async () => {
    const empty = { ...okAnswers, GetRankAndTrafficStats: { body: { d: [] } }, GetQueryStats: { body: { d: [] } }, GetCrawlStats: { body: { d: [] } }, GetFeeds: { body: { d: [{ Url: "https://healthguide.cy/sitemap.xml", Status: "Processing" }] } }, GetUrlInfo: { body: { d: {} } } };
    const client = await createBingClient(credentials, "https://healthguide.cy/", fakeHttp(empty, []));
    const result = await runBingStats(site, client, now);
    const report = buildReport({ site, job: "bing-stats", trigger: "manual", started: now, finished: now, ...result });
    expect(report.status).toBe("warn");
    expect(exitCode(report)).toBe(0);
  });

  it("blocks (exit 3) when one API fails or credentials are missing", async () => {
    const failing = { ...okAnswers, GetCrawlStats: { status: 400, body: { ErrorCode: 14, Message: "InvalidToken" } } };
    const client: BingClient = await createBingClient(credentials, "https://healthguide.cy/", fakeHttp(failing, []));
    const result = await runBingStats(site, client, now);
    expect(result.findings.find((f) => f.id === "bing.api.crawl-stats")?.verdict).toBe("BLOCKER");
    const report = buildReport({ site, job: "bing-stats", trigger: "manual", started: now, finished: now, ...result });
    expect(report.status).toBe("blocked");
    expect(exitCode(report)).toBe(3);
    expect(publicLogLine(report)).toContain("crawl-stats=BLOCKER");

    const missing = await runBingStats(site, new Error("Bing credentials not set: BING_REFRESH_TOKEN"), now);
    const blocked = buildReport({ site, job: "bing-stats", trigger: "manual", started: now, finished: now, ...missing });
    expect(blocked.status).toBe("blocked");
    expect(blocked.findings[0].fix).toContain("Do not switch to an API key");
  });

  it("site.json with a bing block still matches the site-config contract", () => {
    const validate = schemaValidator("site-config.v1.schema.json");
    expect(validate(site), JSON.stringify(validate.errors)).toBe(true);
  });
});
