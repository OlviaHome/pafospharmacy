import { mapLimit, type Finding, type SiteConfig } from "./core";
import { bingDate, type BingClient, type BingCrawlIssue, type BingCrawlRow, type BingFeed, type BingQueryRow, type BingTrafficRow, type BingUrlInfo } from "./bing";

/**
 * Monday job: Bing Webmaster Tools statistics, read-only. Mirrors stats-indexing for Google:
 * every API is confirmed by its own finding (bing.api.*), numbers go to `metrics`, and the detail
 * (query text, crawl-issue URLs) only to a private data file (oa.seo.bing-data/v1).
 * A freshly added site has no Bing data for a few days: empty answers are WARN, not FAIL.
 */
export const BING_DATA_SCHEMA = "oa.seo.bing-data/v1";

const DAY = 86_400_000;

export interface BingData {
  schema: typeof BING_DATA_SCHEMA;
  site_id: string;
  site_url: string;
  traffic: Array<{ date: string; clicks: number; impressions: number }>;
  queries: BingQueryRow[];
  crawl: Array<BingCrawlRow & { date: string }>;
  feeds: BingFeed[];
  crawl_issues: BingCrawlIssue[];
  url_info: Array<{ url: string; result?: BingUrlInfo; error?: string }>;
}

export type BingSiteConfig = SiteConfig & { bing?: { site_url: string }; key_paths?: string[] };

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const isoDay = (date: Date | undefined) => (date ? date.toISOString().slice(0, 10) : "");

/** Sums clicks/impressions over [now-28d, now) and the 28 days before. */
export function trafficWindows(rows: BingTrafficRow[], now: Date) {
  const sum = (from: number, to: number) => rows.reduce(
    (acc, row) => {
      const t = bingDate(row.Date)?.getTime();
      if (t === undefined || t < from || t >= to) return acc;
      return { clicks: acc.clicks + (row.Clicks ?? 0), impressions: acc.impressions + (row.Impressions ?? 0) };
    },
    { clicks: 0, impressions: 0 },
  );
  const end = now.getTime();
  return { current: sum(end - 28 * DAY, end), previous: sum(end - 56 * DAY, end - 28 * DAY) };
}

function sameSite(a: string, b: string): boolean {
  const norm = (u: string) => u.trim().toLowerCase().replace(/\/+$/, "");
  return norm(a) === norm(b);
}

/** Bing feed status words seen in the UI/API: Success, Pending, Processing, Error/Failed, Warnings. */
export function classifyFeed(feed: BingFeed | undefined, sitemap: string): Finding {
  const base = { id: "bing.sitemap.status", check: "bing", url: sitemap };
  if (!feed) {
    return { ...base, verdict: "WARN", severity: "high", evidence: "sitemap is not among Bing feeds", expected: `${sitemap} submitted in Bing Webmaster Tools`, owner_decision: true };
  }
  const status = (feed.Status ?? "unknown").toString();
  const evidence = `status=${status} urls=${feed.UrlCount ?? "?"} submitted=${isoDay(bingDate(feed.Submitted)) || "?"} last_crawled=${isoDay(bingDate(feed.LastCrawled)) || "never"}`;
  if (/error|fail/i.test(status)) return { ...base, verdict: "FAIL", severity: "high", evidence, expected: "status=Success" };
  if (/success/i.test(status) && !/warn/i.test(status)) return { ...base, verdict: "PASS", severity: "medium", evidence };
  return { ...base, verdict: "WARN", severity: "medium", evidence, expected: "status=Success" };
}

export function classifyUrlInfo(url: string, result: BingUrlInfo): Finding {
  const path = new URL(url).pathname;
  const crawled = bingDate(result.LastCrawledDate);
  // Bing reports never-crawled dates as year 0001 / 1601; treat anything before 2000 as "never".
  const crawledOk = crawled && crawled.getUTCFullYear() >= 2000;
  const evidence = `http=${result.HttpStatus ?? "?"} crawled=${crawledOk ? isoDay(crawled) : "never"} discovered=${isoDay(bingDate(result.DiscoveryDate)) || "?"}`;
  const base = { id: `bing.url:${path}`, check: "bing-index", url };
  if (crawledOk && result.HttpStatus && result.HttpStatus >= 400) {
    return { ...base, verdict: "FAIL", severity: "high", evidence, expected: "http=200" };
  }
  if (crawledOk && result.HttpStatus === 200) return { ...base, verdict: "PASS", severity: "medium", evidence };
  return { ...base, verdict: "WARN", severity: "medium", evidence, expected: "crawled by Bingbot with http=200" };
}

export async function runBingStats(site: BingSiteConfig, bing: BingClient | Error, now: Date) {
  const siteUrl = site.bing?.site_url ?? "";
  const keyUrls = (site.key_paths ?? []).map((path) => new URL(path, site.origin).toString());
  if (bing instanceof Error || !siteUrl) {
    return {
      findings: [{
        id: "bing.access", check: "bing", verdict: "BLOCKER" as const, severity: "high" as const,
        evidence: bing instanceof Error ? bing.message : "site.json has no bing.site_url",
        fix: "Check BING_CLIENT_ID (variable), BING_CLIENT_SECRET and BING_REFRESH_TOKEN (secrets) in environment seo-readonly. Do not switch to an API key.",
      }],
      coverage: { discovered: keyUrls.length, checked: 0, failed_fetch: 0, not_checked: keyUrls.length },
      metrics: {},
      data: undefined,
    };
  }

  const findings: Finding[] = [];
  if (bing.refreshTokenRotated) {
    findings.push({ id: "bing.auth.rotation", check: "bing", verdict: "WARN", severity: "high", evidence: "Bing returned a new refresh token; the stored one may stop working", fix: "Re-authorise the OAuth client and replace BING_REFRESH_TOKEN.", owner_decision: true });
  }

  // One call per API, each confirmed separately, so a failure names the exact method.
  async function call<T>(id: string, fn: () => Promise<T>, fallback: T, describe: (value: T) => string): Promise<T> {
    try {
      const value = await fn();
      findings.push({ id: `bing.api.${id}`, check: "bing-api", verdict: "PASS", severity: "high", evidence: describe(value) });
      return value;
    } catch (error) {
      findings.push({ id: `bing.api.${id}`, check: "bing-api", verdict: "BLOCKER", severity: "high", evidence: errorText(error) });
      return fallback;
    }
  }

  const sites = await call("user-sites", () => bing.userSites(), [], (v) => `${v.length} site(s)`);
  const ours = sites.find((s) => sameSite(s.Url, siteUrl));
  if (findings.some((f) => f.id === "bing.api.user-sites" && f.verdict === "PASS")) {
    findings.push(ours?.IsVerified
      ? { id: "bing.site.verified", check: "bing", verdict: "PASS", severity: "high", url: siteUrl, evidence: "site listed and verified" }
      : { id: "bing.site.verified", check: "bing", verdict: "FAIL", severity: "high", url: siteUrl, evidence: ours ? "site listed but not verified" : "site not in this account", expected: "verified" });
  }

  const traffic = await call("traffic", () => bing.rankAndTraffic(), [], (v) => `${v.length} day(s)`);
  const queries = await call("query-stats", () => bing.queryStats(), [], (v) => `${v.length} row(s)`);
  const crawl = await call("crawl-stats", () => bing.crawlStats(), [], (v) => `${v.length} day(s)`);
  const feeds = await call("feeds", () => bing.feeds(), [], (v) => `${v.length} feed(s)`);
  const issues = await call("crawl-issues", () => bing.crawlIssues(), [], (v) => `${v.length} URL(s) with issues`);

  if (findings.some((f) => f.id === "bing.api.feeds" && f.verdict === "PASS")) {
    findings.push(classifyFeed(feeds.find((f) => sameSite(f.Url, site.sitemap)), site.sitemap));
  }

  const windows = trafficWindows(traffic, now);
  if (findings.some((f) => f.id === "bing.api.traffic" && f.verdict === "PASS") && traffic.length === 0) {
    findings.push({ id: "bing.data.traffic", check: "bing", verdict: "WARN", severity: "low", evidence: "Bing has no traffic data yet (normal for the first days after adding a site)" });
  }

  const crawlSorted = [...crawl]
    .map((row) => ({ ...row, date: isoDay(bingDate(row.Date)) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const latest = crawlSorted[crawlSorted.length - 1];
  if (latest) {
    const errors = (latest.Code4xx ?? 0) + (latest.Code5xx ?? 0) + (latest.DnsFailures ?? 0) + (latest.ConnectionTimeout ?? 0);
    const robots = latest.BlockedByRobotsTxt ?? 0;
    const malware = latest.ContainsMalware ?? 0;
    findings.push({
      id: "bing.crawl.latest", check: "bing",
      verdict: malware > 0 ? "FAIL" : errors > 0 || robots > 0 ? "WARN" : "PASS",
      severity: malware > 0 ? "critical" : "medium",
      evidence: `date=${latest.date} crawled=${latest.CrawledPages ?? 0} in_index=${latest.InIndex ?? 0} 4xx=${latest.Code4xx ?? 0} 5xx=${latest.Code5xx ?? 0} robots_blocked=${robots} malware=${malware}`,
    });
  }
  if (issues.length > 0) {
    findings.push({ id: "bing.crawl.issues", check: "bing", verdict: "WARN", severity: "medium", evidence: `${issues.length} URL(s) with crawl issues (list in the private data file)` });
  }

  // Key pages only: GetUrlInfo has a daily quota and the sitemap is already covered by GetFeeds.
  const urlInfo = await mapLimit(keyUrls, 2, async (url) => {
    try {
      return { url, result: await bing.urlInfo(url) };
    } catch (error) {
      return { url, error: errorText(error) };
    }
  });
  const urlErrors = urlInfo.filter((u) => u.error).length;
  if (urlInfo.length > 0) {
    findings.push({
      id: "bing.api.url-info", check: "bing-api",
      verdict: urlErrors < urlInfo.length ? "PASS" : "BLOCKER", severity: "high",
      evidence: `${urlInfo.length - urlErrors} of ${urlInfo.length} answered${urlErrors ? `; first error: ${urlInfo.find((u) => u.error)?.error}` : ""}`,
    });
  }
  let checked = 0;
  for (const item of urlInfo) {
    if (!item.result) continue;
    checked += 1;
    findings.push(classifyUrlInfo(item.url, item.result));
  }

  const metrics: Record<string, number> = {
    bing_clicks_28d: windows.current.clicks,
    bing_impressions_28d: windows.current.impressions,
    bing_clicks_prev_28d: windows.previous.clicks,
    bing_impressions_prev_28d: windows.previous.impressions,
    bing_queries_with_impressions: new Set(queries.map((q) => q.Query)).size,
    bing_crawl_issue_urls: issues.length,
    bing_key_pages_crawled: findings.filter((f) => f.check === "bing-index" && f.verdict === "PASS").length,
    bing_key_pages_checked: checked,
  };
  if (latest) {
    metrics.bing_crawled_pages_latest = latest.CrawledPages ?? 0;
    metrics.bing_in_index_latest = latest.InIndex ?? 0;
  }
  const feed = feeds.find((f) => sameSite(f.Url, site.sitemap));
  if (feed?.UrlCount !== undefined) metrics.bing_sitemap_urls = feed.UrlCount;

  const data: BingData = {
    schema: BING_DATA_SCHEMA,
    site_id: site.site_id,
    site_url: siteUrl,
    traffic: traffic.map((r) => ({ date: isoDay(bingDate(r.Date)), clicks: r.Clicks ?? 0, impressions: r.Impressions ?? 0 })),
    queries: queries.slice(0, 250),
    crawl: crawlSorted,
    feeds,
    crawl_issues: issues.slice(0, 250),
    url_info: urlInfo,
  };
  return {
    findings,
    coverage: { discovered: keyUrls.length, checked, failed_fetch: 0, not_checked: keyUrls.length - checked },
    metrics,
    data,
  };
}
