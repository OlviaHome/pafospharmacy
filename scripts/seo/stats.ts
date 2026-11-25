import { mapLimit, type Finding, type SiteConfig } from "./core";
import type { GscClient, SearchAnalyticsRow, SitemapStatus, UrlInspection } from "./gsc";

/**
 * Monday job: Search Console statistics and indexing, read-only.
 * Numbers go to `metrics` (report) and the detailed tables to a private data file
 * (oa.seo.gsc-data/v1). Query text never goes into findings or notifications: search queries
 * are private business data and notifications may travel through shared channels.
 */
export const GSC_DATA_SCHEMA = "oa.seo.gsc-data/v1";

export interface GscData {
  schema: typeof GSC_DATA_SCHEMA;
  site_id: string;
  property: string;
  periods: { current: Period; previous: Period };
  totals: { current: Totals; previous: Totals };
  pages: SearchAnalyticsRow[];
  queries: SearchAnalyticsRow[];
  targets: Array<{ query: string; found: boolean; clicks: number; impressions: number; position: number | null }>;
  inspections: Array<{ url: string; result?: UrlInspection; error?: string }>;
  sitemaps: SitemapStatus[];
}

interface Period { start: string; end: string }
interface Totals { clicks: number; impressions: number; ctr: number; position: number }

const DAY = 86_400_000;
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/** Last 28 complete days ending 3 days ago (Search Console's usual data lag), and the 28 before. */
export function periods(now: Date): { current: Period; previous: Period } {
  const end = new Date(now.getTime() - 3 * DAY);
  const start = new Date(end.getTime() - 27 * DAY);
  const prevEnd = new Date(start.getTime() - DAY);
  const prevStart = new Date(prevEnd.getTime() - 27 * DAY);
  return { current: { start: isoDay(start), end: isoDay(end) }, previous: { start: isoDay(prevStart), end: isoDay(prevEnd) } };
}

function totals(rows: SearchAnalyticsRow[]): Totals {
  const row = rows[0];
  return row
    ? { clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position }
    : { clicks: 0, impressions: 0, ctr: 0, position: 0 };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function classifyInspection(url: string, result: UrlInspection): Finding {
  const path = new URL(url).pathname;
  const base = { id: `index:${path}`, check: "indexing", url, rule: "seo-geo-optimization §5, §6" };
  const state = result.coverageState ?? "unknown";
  const evidence = [
    `coverage="${state}"`,
    result.indexingState ? `indexing=${result.indexingState}` : "",
    result.robotsTxtState ? `robots=${result.robotsTxtState}` : "",
    result.pageFetchState ? `fetch=${result.pageFetchState}` : "",
    result.lastCrawlTime ? `crawled=${result.lastCrawlTime}` : "",
  ].filter(Boolean).join(" ");

  if (result.robotsTxtState === "DISALLOWED" || /BLOCKED_BY_(META_TAG|HTTP_HEADER)/.test(result.indexingState ?? "")) {
    return { ...base, verdict: "FAIL", severity: "critical", evidence, expected: "crawlable and indexable" };
  }
  if (result.pageFetchState && !["SUCCESSFUL", "PAGE_FETCH_STATE_UNSPECIFIED"].includes(result.pageFetchState)) {
    return { ...base, verdict: "FAIL", severity: "high", evidence, expected: "fetch=SUCCESSFUL" };
  }
  if (result.googleCanonical && result.userCanonical && result.googleCanonical !== result.userCanonical) {
    return {
      ...base,
      verdict: "FAIL",
      severity: "high",
      evidence: `${evidence} google_canonical=${result.googleCanonical} user_canonical=${result.userCanonical}`,
      expected: "Google keeps the declared canonical",
    };
  }
  if (result.verdict === "PASS" || /indexed/i.test(state) && !/not indexed/i.test(state)) {
    return { ...base, verdict: "PASS", severity: "medium", evidence };
  }
  // Unknown / discovered / crawled-not-indexed: normal for a new domain, worth watching, not an emergency.
  return { ...base, verdict: "WARN", severity: "medium", evidence, expected: "Submitted and indexed" };
}

export async function runStatsIndexing(
  site: SiteConfig & { gsc?: { property: string }; target_queries?: string[] },
  gsc: GscClient | Error,
  sitemapUrls: string[],
  now: Date,
) {
  const property = site.gsc?.property ?? "";
  if (gsc instanceof Error || !property) {
    const evidence = gsc instanceof Error ? gsc.message : "site.json has no gsc.property";
    return {
      findings: [{
        id: "gsc.access", check: "gsc", verdict: "BLOCKER" as const, severity: "high" as const, evidence,
        fix: "Grant the service account Restricted access in Search Console and set GSC_SERVICE_ACCOUNT_JSON in the runner's secrets.",
      }],
      coverage: { discovered: sitemapUrls.length, checked: 0, failed_fetch: 0, not_checked: sitemapUrls.length },
      metrics: {},
      data: undefined,
    };
  }

  const findings: Finding[] = [];
  const range = periods(now);
  const query = (period: Period, extra: Record<string, unknown> = {}) =>
    gsc.searchAnalytics({ startDate: period.start, endDate: period.end, type: "web", ...extra });

  // Each API is confirmed separately (gsc.api.*), so a first run shows exactly which one works.
  let currentTotals: SearchAnalyticsRow[] = [];
  let previousTotals: SearchAnalyticsRow[] = [];
  let pages: SearchAnalyticsRow[] = [];
  let queries: SearchAnalyticsRow[] = [];
  try {
    [currentTotals, previousTotals, pages, queries] = await Promise.all([
      query(range.current),
      query(range.previous),
      query(range.current, { dimensions: ["page"], rowLimit: 1000 }),
      query(range.current, { dimensions: ["query"], rowLimit: 1000 }),
    ]);
    findings.push({ id: "gsc.api.search-analytics", check: "gsc-api", verdict: "PASS", severity: "high", evidence: `4 requests answered; ${pages.length} pages, ${queries.length} queries with impressions` });
  } catch (error) {
    findings.push({ id: "gsc.api.search-analytics", check: "gsc-api", verdict: "BLOCKER", severity: "high", evidence: errorText(error) });
  }
  const current = totals(currentTotals);
  const previous = totals(previousTotals);

  const targets = (site.target_queries ?? []).map((target) => {
    const row = queries.find((r) => r.keys[0]?.toLowerCase() === target.toLowerCase());
    return { query: target, found: Boolean(row), clicks: row?.clicks ?? 0, impressions: row?.impressions ?? 0, position: row ? Math.round(row.position * 10) / 10 : null };
  });

  // Indexing: every sitemap URL. The inspection quota (2,000/day per property) covers this site many times over.
  const inspections = await mapLimit(sitemapUrls, 3, async (url) => {
    try {
      return { url, result: await gsc.inspect(url) };
    } catch (error) {
      return { url, error: errorText(error) };
    }
  });
  const inspectionErrors = inspections.filter((item) => item.error).length;
  findings.push({
    id: "gsc.api.url-inspection",
    check: "gsc-api",
    verdict: inspections.length > 0 && inspectionErrors < inspections.length ? "PASS" : "BLOCKER",
    severity: "high",
    evidence: inspections.length === 0
      ? "no sitemap URLs to inspect"
      : `${inspections.length - inspectionErrors} of ${inspections.length} answered${inspectionErrors ? `; first error: ${inspections.find((i) => i.error)?.error}` : ""}`,
  });
  let inspected = 0;
  const indexedByLocale: Record<string, number> = {};
  for (const item of inspections) {
    if (item.error || !item.result) {
      findings.push({ id: `index:${new URL(item.url).pathname}`, check: "indexing", verdict: "BLOCKER", severity: "medium", url: item.url, evidence: item.error ?? "no inspection result" });
      continue;
    }
    inspected += 1;
    const finding = classifyInspection(item.url, item.result);
    findings.push(finding);
    if (finding.verdict === "PASS") {
      const locale = site.locales.find((l) => new URL(item.url).pathname.split("/")[1] === l) ?? "other";
      indexedByLocale[locale] = (indexedByLocale[locale] ?? 0) + 1;
    }
  }

  // Sitemaps as Search Console sees them.
  let sitemaps: SitemapStatus[] = [];
  try {
    sitemaps = await gsc.sitemaps();
    findings.push({ id: "gsc.api.sitemaps", check: "gsc-api", verdict: "PASS", severity: "high", evidence: `${sitemaps.length} sitemap(s) listed` });
    const ours = sitemaps.find((s) => s.path === site.sitemap);
    if (!ours) {
      findings.push({ id: "gsc.sitemap.submitted", check: "gsc", verdict: "WARN", severity: "high", url: site.sitemap, evidence: `submitted: ${sitemaps.map((s) => s.path).join(", ") || "(none)"}`, expected: `${site.sitemap} submitted`, owner_decision: true });
    } else {
      const errors = Number(ours.errors ?? 0);
      const warnings = Number(ours.warnings ?? 0);
      const stale = ours.lastDownloaded ? now.getTime() - Date.parse(ours.lastDownloaded) > 7 * DAY : true;
      findings.push({
        id: "gsc.sitemap.status", check: "gsc",
        verdict: errors > 0 ? "FAIL" : warnings > 0 || stale ? "WARN" : "PASS",
        severity: errors > 0 ? "high" : "medium",
        url: site.sitemap,
        evidence: `lastDownloaded=${ours.lastDownloaded ?? "never"} errors=${errors} warnings=${warnings} pending=${ours.isPending ?? false}`,
      });
    }
  } catch (error) {
    findings.push({ id: "gsc.api.sitemaps", check: "gsc-api", verdict: "BLOCKER", severity: "high", evidence: errorText(error) });
  }

  const metrics: Record<string, number> = {
    gsc_clicks_28d: current.clicks,
    gsc_impressions_28d: current.impressions,
    gsc_ctr_28d: Math.round(current.ctr * 10_000) / 10_000,
    gsc_position_28d: Math.round(current.position * 10) / 10,
    gsc_clicks_prev_28d: previous.clicks,
    gsc_impressions_prev_28d: previous.impressions,
    gsc_pages_with_impressions: pages.length,
    gsc_queries_with_impressions: queries.length,
    target_queries_seen: targets.filter((t) => t.found).length,
    target_queries_total: targets.length,
    indexed_pages: Object.values(indexedByLocale).reduce((a, b) => a + b, 0),
    inspected_pages: inspected,
    ...Object.fromEntries(Object.entries(indexedByLocale).map(([locale, count]) => [`indexed_pages_${locale}`, count])),
  };

  const data: GscData = {
    schema: GSC_DATA_SCHEMA, site_id: site.site_id, property, periods: range,
    totals: { current, previous }, pages: pages.slice(0, 250), queries: queries.slice(0, 250), targets, inspections, sitemaps,
  };
  return {
    findings,
    coverage: { discovered: sitemapUrls.length, checked: inspected, failed_fetch: 0, not_checked: sitemapUrls.length - inspected },
    metrics,
    data,
  };
}
