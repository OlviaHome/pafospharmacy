/**
 * OA Studio SEO agent — site-agnostic core.
 *
 * Everything here is driven by a site config (seo/site.json) and produces run reports in the
 * oa.seo.run-report/v1 format (seo/contracts). Nothing in this folder may import site code,
 * so the folder can be copied to another project unchanged.
 */

export const REPORT_SCHEMA = "oa.seo.run-report/v1";
export const AGENT_NAME = "oa-seo-agent";
export const AGENT_VERSION = "0.1.0";
export const USER_AGENT = "OA-SEO-Agent/0.1 (+read-only audit)";

export type Verdict = "PASS" | "WARN" | "FAIL" | "BLOCKER" | "NOT_CHECKED" | "ABSENT";
export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type JobName =
  | "critical"
  | "stats-indexing"
  | "bing-stats"
  | "tech-audit"
  | "weekly-report"
  | "ai-visibility"
  | "regression"
  | "redirects"
  | "drift-baseline";

export interface SiteConfig {
  site_id: string;
  name: string;
  origin: string;
  timezone: string;
  locales: string[];
  default_locale: string;
  sitemap: string;
  robots: { must_contain: string[]; must_not_block: string[] };
  sitemap_min_urls: number;
  /** URL paths whose pages must carry hreflang for every locale plus x-default. */
  localized_path_prefixes: string[];
  key_paths: string[];
  redirects: Array<{ from: string; to: string; note?: string }>;
  page_weight_warn_bytes: number;
  brand: { name: string };
  /** Search Console property, e.g. "sc-domain:example.com" or "https://example.com/". */
  gsc?: { property: string };
  /** Owner's target queries, tracked by position; never mixed into notifications with other queries. */
  target_queries?: string[];
}

export interface Finding {
  id: string;
  check: string;
  verdict: Verdict;
  severity: Severity;
  url?: string;
  evidence: string;
  expected?: string;
  actual?: string;
  rule?: string;
  fix?: string;
  owner_decision?: boolean;
}

export interface RunReport {
  schema: typeof REPORT_SCHEMA;
  run_id: string;
  site_id: string;
  job: JobName;
  trigger: "schedule" | "manual" | "post-change";
  started_at: string;
  finished_at: string;
  local_time: string;
  timezone: string;
  status: "ok" | "warn" | "fail" | "blocked";
  summary: Record<Verdict, number>;
  coverage: { discovered: number; checked: number; failed_fetch: number; not_checked: number };
  findings: Finding[];
  metrics: Record<string, number>;
  /** Side files of the run (e.g. private Search Console tables), relative to the report file. */
  artifacts?: Array<{ name: string; path: string; schema: string; private: boolean }>;
  agent: { name: string; version: string; git_sha?: string };
}

export interface FetchResult {
  url: string;
  status: number;
  location?: string;
  headers: Record<string, string>;
  body: string;
  bytes: number;
  error?: string;
}

export type Fetcher = (url: string) => Promise<FetchResult>;

/** Raw HTTP, one hop, no redirect following: audits must see what bots see. */
export const httpFetch: Fetcher = async (url) => {
  try {
    const response = await fetch(url, {
      redirect: "manual",
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xml,text/plain;q=0.9,*/*;q=0.5" },
      signal: AbortSignal.timeout(25_000),
    });
    const body = response.status >= 300 && response.status < 400 ? "" : await response.text();
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => (headers[key.toLowerCase()] = value));
    return {
      url,
      status: response.status,
      location: response.headers.get("location") ?? undefined,
      headers,
      body,
      bytes: Buffer.byteLength(body),
    };
  } catch (error) {
    return { url, status: 0, headers: {}, body: "", bytes: 0, error: String(error) };
  }
};

export async function mapLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------- HTML extraction (head tags only; deliberately small and dependency-free) ----------

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function attr(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  return match ? decodeEntities(match[2] ?? match[3] ?? "") : undefined;
}

export interface PageSnapshot {
  url: string;
  status: number;
  location?: string;
  bytes: number;
  lang?: string;
  title?: string;
  description?: string;
  canonical?: string;
  robots_meta?: string;
  x_robots_tag?: string;
  hreflang: Record<string, string>;
  h1?: string;
  jsonld_types: string[];
}

export function extractPage(result: FetchResult): PageSnapshot {
  const html = result.body;
  const headEnd = html.search(/<\/head>/i);
  const head = headEnd >= 0 ? html.slice(0, headEnd) : html;
  const snapshot: PageSnapshot = {
    url: result.url,
    status: result.status,
    location: result.location,
    bytes: result.bytes,
    hreflang: {},
    jsonld_types: [],
  };
  const htmlTag = html.match(/<html\b[^>]*>/i)?.[0];
  if (htmlTag) snapshot.lang = attr(htmlTag, "lang");
  const title = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) snapshot.title = decodeEntities(title[1].trim());

  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = attr(tag, "name")?.toLowerCase();
    if (name === "description") snapshot.description = attr(tag, "content");
    if (name === "robots" || name === "googlebot") {
      const content = attr(tag, "content") ?? "";
      snapshot.robots_meta = snapshot.robots_meta ? `${snapshot.robots_meta}, ${content}` : content;
    }
  }
  for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = attr(tag, "rel")?.toLowerCase();
    const href = attr(tag, "href");
    if (!href) continue;
    if (rel === "canonical") snapshot.canonical = href;
    if (rel === "alternate") {
      const lang = attr(tag, "hreflang");
      if (lang) snapshot.hreflang[lang.toLowerCase()] = href;
    }
  }
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) snapshot.h1 = decodeEntities(h1[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
  snapshot.x_robots_tag = result.headers["x-robots-tag"];

  const types = new Set<string>();
  for (const block of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      collectTypes(JSON.parse(block[1]), types);
    } catch {
      types.add("INVALID_JSON");
    }
  }
  snapshot.jsonld_types = [...types].sort();
  return snapshot;
}

function collectTypes(node: unknown, types: Set<string>): void {
  if (Array.isArray(node)) return node.forEach((item) => collectTypes(item, types));
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  const type = record["@type"];
  if (typeof type === "string") types.add(type);
  if (Array.isArray(type)) type.forEach((value) => typeof value === "string" && types.add(value));
  if (record["@graph"]) collectTypes(record["@graph"], types);
}

// ---------- Sitemap ----------

export interface SitemapEntry {
  loc: string;
  lastmod?: string;
  alternates: Record<string, string>;
}

export function parseSitemap(xml: string): { entries: SitemapEntry[]; sitemaps: string[] } {
  const entries: SitemapEntry[] = [];
  for (const block of xml.match(/<url>[\s\S]*?<\/url>/gi) ?? []) {
    const loc = block.match(/<loc>\s*([^<]+?)\s*<\/loc>/i)?.[1];
    if (!loc) continue;
    const alternates: Record<string, string> = {};
    for (const link of block.match(/<xhtml:link\b[^>]*>/gi) ?? []) {
      const lang = attr(link, "hreflang");
      const href = attr(link, "href");
      if (lang && href) alternates[lang.toLowerCase()] = href;
    }
    entries.push({
      loc: decodeEntities(loc),
      lastmod: block.match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/i)?.[1],
      alternates,
    });
  }
  const sitemaps = [...xml.matchAll(/<sitemap>[\s\S]*?<loc>\s*([^<]+?)\s*<\/loc>[\s\S]*?<\/sitemap>/gi)].map((m) => m[1]);
  return { entries, sitemaps };
}

// ---------- Reports ----------

export function localTime(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
  return parts.replace(" ", "T");
}

export function buildReport(args: {
  site: SiteConfig;
  job: JobName;
  trigger: RunReport["trigger"];
  started: Date;
  finished: Date;
  findings: Finding[];
  coverage: RunReport["coverage"];
  metrics?: Record<string, number>;
  artifacts?: RunReport["artifacts"];
  gitSha?: string;
}): RunReport {
  const summary: Record<Verdict, number> = { PASS: 0, WARN: 0, FAIL: 0, BLOCKER: 0, NOT_CHECKED: 0, ABSENT: 0 };
  for (const finding of args.findings) summary[finding.verdict] += 1;
  const status = runStatus(summary, args.coverage);
  const stamp = args.started.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return {
    schema: REPORT_SCHEMA,
    run_id: `${args.site.site_id}.${args.job}.${stamp}`,
    site_id: args.site.site_id,
    job: args.job,
    trigger: args.trigger,
    started_at: args.started.toISOString(),
    finished_at: args.finished.toISOString(),
    local_time: localTime(args.started, args.site.timezone),
    timezone: args.site.timezone,
    status,
    summary,
    coverage: args.coverage,
    findings: args.findings,
    metrics: args.metrics ?? {},
    ...(args.artifacts?.length ? { artifacts: args.artifacts } : {}),
    agent: { name: AGENT_NAME, version: AGENT_VERSION, ...(args.gitSha ? { git_sha: args.gitSha } : {}) },
  };
}

/**
 * A run is "ok" only when every check actually ran. A check that could not run (BLOCKER) or a URL
 * that could not be fetched makes the run "blocked", never "ok" or "warn": unknown is not success.
 * Precedence: fail > blocked > warn > ok.
 */
export function runStatus(summary: Record<Verdict, number>, coverage: RunReport["coverage"]): RunReport["status"] {
  if (summary.FAIL > 0) return "fail";
  if (summary.BLOCKER > 0 || coverage.failed_fetch > 0 || coverage.checked === 0) return "blocked";
  if (summary.WARN > 0) return "warn";
  return "ok";
}

/** Process exit code for schedulers: 0 ok/warn, 2 critical FAIL, 3 any check could not run. */
export function exitCode(report: RunReport): number {
  if (report.findings.some((f) => f.severity === "critical" && f.verdict === "FAIL")) return 2;
  if (report.status === "blocked" || report.status === "fail") return 3;
  return 0;
}

export function sameUrl(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  try {
    const left = new URL(a);
    const right = new URL(b);
    const path = (u: URL) => (u.pathname.length > 1 ? u.pathname.replace(/\/+$/, "") : u.pathname);
    return left.origin === right.origin && path(left) === path(right) && left.search === right.search;
  } catch {
    return a === b;
  }
}
