import { readFileSync } from "node:fs";
import { join } from "node:path";

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import { blockedPaths, checkPage, runCriticalCheck, runRedirectCheck } from "./checks";
import { buildReport, extractPage, parseSitemap, type FetchResult, type Fetcher, type SiteConfig } from "./core";
import { BASELINE_SCHEMA, compareToBaseline } from "./drift";
import { buildNotification } from "./notify";

const fixture = (name: string) => readFileSync(join(__dirname, "__fixtures__", name), "utf8");
const site = JSON.parse(readFileSync(join(process.cwd(), "seo/site.json"), "utf8")) as SiteConfig;
const page = (url: string, body: string, status = 200, extra: Partial<FetchResult> = {}): FetchResult => ({
  url,
  status,
  headers: {},
  body,
  bytes: Buffer.byteLength(body),
  ...extra,
});

/** Production pages for every locale/path, built from the real /ru/paphos head. */
function productionLike(url: string): string {
  const path = new URL(url).pathname;
  const [, locale = "en", ...rest] = path.split("/");
  const suffix = rest.length ? `/${rest.join("/")}` : "";
  return fixture("ru-paphos.html")
    .replace(/https:\/\/healthguide\.cy\/(en|el|ru|ar)\/paphos/g, (_, l) => `https://healthguide.cy/${l}${suffix}`)
    .replace('lang="ru"', `lang="${locale}"`)
    .replace('href="https://healthguide.cy/ru/paphos"', `href="https://healthguide.cy/${locale}${suffix}"`)
    .replace(/<link rel="canonical" href="[^"]+"\/>/, `<link rel="canonical" href="${url}"/>`);
}

function fakeFetcher(overrides: Record<string, FetchResult> = {}): Fetcher {
  return async (url) => {
    if (overrides[url]) return overrides[url];
    if (url.endsWith("/robots.txt")) return page(url, fixture("robots.txt"));
    if (url.endsWith("/sitemap.xml")) return page(url, fixture("sitemap.xml"));
    return page(url, productionLike(url));
  };
}

const smallSite: SiteConfig = { ...site, sitemap_min_urls: 2 };

describe("extractPage on production HTML", () => {
  it("reads title, canonical, hreflang, lang and h1 from /ru/paphos", () => {
    const snapshot = extractPage(page("https://healthguide.cy/ru/paphos", fixture("ru-paphos.html")));
    expect(snapshot.title).toBe("Дежурные аптеки Пафоса сегодня | HealthGuide.cy");
    expect(snapshot.canonical).toBe("https://healthguide.cy/ru/paphos");
    expect(snapshot.lang).toBe("ru");
    expect(Object.keys(snapshot.hreflang).sort()).toEqual(["ar", "el", "en", "ru", "x-default"]);
    expect(snapshot.hreflang["x-default"]).toBe("https://healthguide.cy/en/paphos");
    expect(snapshot.h1).toBe("Дежурные и открытые аптеки в Пафосе");
    expect(snapshot.jsonld_types).toEqual([]);
  });

  it("decodes entities in titles", () => {
    expect(extractPage(page("https://healthguide.cy/", fixture("root.html"))).title).toBe(
      "Pharmacies in Cyprus: On Duty Today & Open Now | HealthGuide.cy",
    );
  });

  it("collects JSON-LD types and flags invalid blocks", () => {
    const html = '<html><head></head><body><script type="application/ld+json">{"@graph":[{"@type":"Article"},{"@type":["FAQPage"]}]}</script><script type="application/ld+json">{oops</script></body></html>';
    expect(extractPage(page("https://x.test/", html)).jsonld_types).toEqual(["Article", "FAQPage", "INVALID_JSON"]);
  });
});

describe("parseSitemap", () => {
  it("reads locations, lastmod and hreflang alternates", () => {
    const { entries } = parseSitemap(fixture("sitemap.xml"));
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ loc: "https://healthguide.cy/ru/paphos", lastmod: "2026-11-21T22:00:00.000Z" });
    expect(entries[0].alternates.ar).toBe("https://healthguide.cy/ar/paphos");
  });
});

describe("robots rules", () => {
  it("passes the production robots.txt", () => {
    expect(blockedPaths(fixture("robots.txt"), site.robots.must_not_block)).toEqual([]);
  });
  it("catches a site-wide Disallow for *", () => {
    expect(blockedPaths("User-agent: *\nDisallow: /\n", ["/en"])).toEqual(["Disallow: / blocks /en"]);
  });
  it("ignores rules for other bots", () => {
    expect(blockedPaths("User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n", ["/en"])).toEqual([]);
  });
});

describe("checkPage", () => {
  const url = "https://healthguide.cy/ru/paphos";
  it("passes the production district page except the brand-name warning", () => {
    const findings = checkPage(site, extractPage(page(url, fixture("ru-paphos.html"))));
    const problems = findings.filter((f) => f.verdict !== "PASS");
    expect(problems.map((f) => f.id)).toEqual(["page.brand:/ru/paphos"]);
    expect(problems[0]).toMatchObject({ severity: "low", owner_decision: true });
  });
  it("fails noindex as critical", () => {
    const html = fixture("ru-paphos.html").replace("<head>", '<head><meta name="robots" content="noindex"/>');
    const finding = checkPage(site, extractPage(page(url, html))).find((f) => f.id.startsWith("page.noindex"));
    expect(finding).toMatchObject({ verdict: "FAIL", severity: "critical" });
  });
  it("fails a missing hreflang locale", () => {
    const html = fixture("ru-paphos.html").replace(/<link rel="alternate" hrefLang="ar"[^>]*>/, "");
    const finding = checkPage(site, extractPage(page(url, html))).find((f) => f.id.startsWith("page.hreflang"));
    expect(finding).toMatchObject({ verdict: "FAIL", actual: "missing ar" });
  });
  it("reports a redirecting sitemap URL as critical", () => {
    const finding = checkPage(site, extractPage(page(url, "", 308, { location: "https://healthguide.cy/en" })))[0];
    expect(finding).toMatchObject({ verdict: "FAIL", severity: "critical", evidence: "HTTP 308 → https://healthguide.cy/en" });
  });
});

describe("runCriticalCheck", () => {
  it("is clean on production-like responses", async () => {
    const result = await runCriticalCheck(smallSite, fakeFetcher());
    const bad = result.findings.filter((f) => f.verdict === "FAIL" || f.verdict === "BLOCKER");
    expect(bad).toEqual([]);
    expect(result.coverage.discovered).toBeGreaterThanOrEqual(site.key_paths.length);
  });
  it("turns an unreachable robots.txt into a BLOCKER, not a guess", async () => {
    const result = await runCriticalCheck(smallSite, fakeFetcher({
      "https://healthguide.cy/robots.txt": { url: "", status: 0, headers: {}, body: "", bytes: 0, error: "timeout" },
    }));
    expect(result.findings.find((f) => f.id === "robots.status")).toMatchObject({ verdict: "BLOCKER", evidence: "timeout" });
  });
  it("fails when the owner's Content-Signal line disappears", async () => {
    const result = await runCriticalCheck(smallSite, fakeFetcher({
      "https://healthguide.cy/robots.txt": page("https://healthguide.cy/robots.txt", "User-Agent: *\nAllow: /\n"),
    }));
    expect(result.findings.find((f) => f.id === "robots.owner-lines")).toMatchObject({ verdict: "FAIL", severity: "critical" });
  });
});

describe("runRedirectCheck", () => {
  it("accepts one permanent hop and ignores Vercel share tokens", async () => {
    const config: SiteConfig = { ...site, redirects: [{ from: "https://pafospharmacy.vercel.app/ru/paphos", to: "https://healthguide.cy/ru/paphos" }] };
    const fetcher: Fetcher = async (url) =>
      url.startsWith("https://pafospharmacy")
        ? page(url, "", 308, { location: "https://healthguide.cy/ru/paphos?_vercel_share=abc" })
        : page(url, "ok");
    const { findings } = await runRedirectCheck(config, fetcher);
    expect(findings[0]).toMatchObject({ verdict: "PASS" });
  });
  it("fails a temporary redirect", async () => {
    const config: SiteConfig = { ...site, redirects: [{ from: "https://old.test/", to: "https://healthguide.cy/" }] };
    const { findings } = await runRedirectCheck(config, async (url) =>
      url.startsWith("https://old") ? page(url, "", 302, { location: "https://healthguide.cy/" }) : page(url, "ok"));
    expect(findings[0]).toMatchObject({ verdict: "FAIL" });
  });
});

describe("drift", () => {
  const url = "https://healthguide.cy/ru/paphos";
  const before = extractPage(page(url, fixture("ru-paphos.html")));
  const baseline = { schema: BASELINE_SCHEMA, site_id: "healthguide-cy", captured_at: "2026-11-25T08:00:00Z", pages: [before] } as const;
  it("reports nothing when nothing changed", () => {
    expect(compareToBaseline({ ...baseline, pages: [before] }, [before])).toEqual([]);
  });
  it("treats a lost canonical as high and a new title as informational", () => {
    const after = { ...before, canonical: "https://healthguide.cy/en/paphos", title: "New title" };
    const findings = compareToBaseline({ ...baseline, pages: [before] }, [after]);
    expect(findings.find((f) => f.id === "drift.canonical:/ru/paphos")).toMatchObject({ verdict: "FAIL", severity: "high" });
    expect(findings.find((f) => f.id === "drift.title:/ru/paphos")).toMatchObject({ severity: "info" });
  });
  it("treats an added noindex as critical and its removal as an improvement", () => {
    const worse = compareToBaseline({ ...baseline, pages: [before] }, [{ ...before, robots_meta: "noindex" }]);
    expect(worse[0]).toMatchObject({ verdict: "FAIL", severity: "critical" });
    const better = compareToBaseline({ ...baseline, pages: [{ ...before, robots_meta: "noindex" }] }, [before]);
    expect(better[0]).toMatchObject({ verdict: "PASS", severity: "info" });
  });
});

describe("contracts", () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const contract = (name: string) => JSON.parse(readFileSync(join(process.cwd(), "seo/contracts", name), "utf8"));

  it("run reports and notifications match the published JSON Schemas", async () => {
    const result = await runCriticalCheck(smallSite, fakeFetcher({
      "https://healthguide.cy/robots.txt": page("https://healthguide.cy/robots.txt", "User-Agent: *\nDisallow: /\n"),
    }));
    const report = buildReport({
      site, job: "critical", trigger: "schedule",
      started: new Date("2026-11-25T06:00:00Z"), finished: new Date("2026-11-25T06:01:00Z"), ...result,
    });
    expect(report.run_id).toBe("healthguide-cy.critical.20261125T060000Z");
    expect(report.local_time).toBe("2026-11-25T08:00:00");
    expect(report.status).toBe("fail");
    const validateReport = ajv.compile(contract("run-report.v1.schema.json"));
    expect(validateReport(report), JSON.stringify(validateReport.errors)).toBe(true);

    const notification = buildNotification(report, site.name);
    expect(notification.level).toBe("critical");
    expect(notification.destination.route).toBe("site:healthguide-cy");
    expect(notification.text.length).toBeLessThanOrEqual(3500);
    const validateNotification = ajv.compile(contract("notification.v1.schema.json"));
    expect(validateNotification(notification), JSON.stringify(validateNotification.errors)).toBe(true);
  });

  it("the site config matches its schema", () => {
    const validate = ajv.compile(contract("site-config.v1.schema.json"));
    expect(validate(site), JSON.stringify(validate.errors)).toBe(true);
  });
});
