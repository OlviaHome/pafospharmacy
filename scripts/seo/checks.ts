import {
  extractPage,
  mapLimit,
  parseSitemap,
  sameUrl,
  type Fetcher,
  type Finding,
  type PageSnapshot,
  type SiteConfig,
  type SitemapEntry,
} from "./core";

/**
 * Daily critical check: is the site reachable and indexable the way the owner decided?
 * Read-only. Every finding quotes raw evidence; a check that cannot run is a BLOCKER, never a guess.
 */
export async function runCriticalCheck(site: SiteConfig, fetcher: Fetcher) {
  const findings: Finding[] = [];
  const add = (finding: Finding) => findings.push(finding);

  // 1. robots.txt
  const robotsUrl = new URL("/robots.txt", site.origin).toString();
  const robots = await fetcher(robotsUrl);
  if (robots.status !== 200) {
    add({
      id: "robots.status",
      check: "robots",
      verdict: robots.status === 0 ? "BLOCKER" : "FAIL",
      severity: "critical",
      url: robotsUrl,
      evidence: robots.error ?? `HTTP ${robots.status}`,
      expected: "HTTP 200",
      rule: "seo-geo-optimization §4",
    });
  } else {
    const missing = site.robots.must_contain.filter((line) => !robots.body.includes(line));
    add({
      id: "robots.owner-lines",
      check: "robots",
      verdict: missing.length ? "FAIL" : "PASS",
      severity: "critical",
      url: robotsUrl,
      evidence: missing.length ? `missing: ${missing.join(" | ")}` : site.robots.must_contain.join(" | "),
      expected: "every owner-decided robots line present",
      rule: "owner decision",
      owner_decision: true,
    });
    const blocked = blockedPaths(robots.body, site.robots.must_not_block);
    add({
      id: "robots.blocks-key-paths",
      check: "robots",
      verdict: blocked.length ? "FAIL" : "PASS",
      severity: "critical",
      url: robotsUrl,
      evidence: blocked.length ? blocked.join("; ") : `none of ${site.robots.must_not_block.join(", ")} disallowed for *`,
      rule: "seo-geo-optimization §2.1",
    });
  }

  // 2. sitemap
  const sitemap = await fetcher(site.sitemap);
  let entries: SitemapEntry[] = [];
  if (sitemap.status !== 200) {
    add({
      id: "sitemap.status",
      check: "sitemap",
      verdict: sitemap.status === 0 ? "BLOCKER" : "FAIL",
      severity: "critical",
      url: site.sitemap,
      evidence: sitemap.error ?? `HTTP ${sitemap.status}`,
      expected: "HTTP 200",
    });
  } else {
    entries = parseSitemap(sitemap.body).entries;
    const origin = new URL(site.origin).origin;
    const foreign = entries.filter((entry) => new URL(entry.loc).origin !== origin).map((e) => e.loc);
    const duplicates = entries.map((e) => e.loc).filter((loc, i, all) => all.indexOf(loc) !== i);
    add({
      id: "sitemap.size",
      check: "sitemap",
      verdict: entries.length >= site.sitemap_min_urls ? "PASS" : "FAIL",
      severity: "critical",
      url: site.sitemap,
      evidence: `${entries.length} <url> entries`,
      expected: `>= ${site.sitemap_min_urls}`,
    });
    add({
      id: "sitemap.hygiene",
      check: "sitemap",
      verdict: foreign.length || duplicates.length ? "FAIL" : "PASS",
      severity: "high",
      url: site.sitemap,
      evidence: foreign.length || duplicates.length
        ? `foreign: ${foreign.slice(0, 5).join(", ")}; duplicates: ${[...new Set(duplicates)].slice(0, 5).join(", ")}`
        : "all URLs on the site origin, no duplicates",
    });
  }

  // 3. pages: every sitemap URL plus the key paths
  const urls = [...new Set([...entries.map((e) => e.loc), ...site.key_paths.map((p) => new URL(p, site.origin).toString())])];
  const alternatesByUrl = new Map(entries.map((e) => [e.loc, e.alternates]));
  const pages = await mapLimit(urls, 4, async (url) => extractPage({ ...(await fetcher(url)), url }));
  let failedFetch = 0;
  for (const page of pages) {
    if (page.status === 0) failedFetch += 1;
    findings.push(...checkPage(site, page, alternatesByUrl.get(page.url)));
  }

  return {
    findings,
    pages,
    coverage: { discovered: urls.length, checked: urls.length - failedFetch, failed_fetch: failedFetch, not_checked: 0 },
    metrics: {
      sitemap_urls: entries.length,
      pages_checked: pages.length - failedFetch,
      max_html_bytes: Math.max(0, ...pages.map((p) => p.bytes)),
    },
  };
}

/** Per-page rules. Exported for tests and for the weekly tech audit. */
export function checkPage(site: SiteConfig, page: PageSnapshot, sitemapAlternates?: Record<string, string>): Finding[] {
  const findings: Finding[] = [];
  const url = page.url;
  const id = (name: string) => `${name}:${new URL(url).pathname}`;

  if (page.status !== 200) {
    findings.push({
      id: id("page.status"),
      check: "page",
      verdict: page.status === 0 ? "BLOCKER" : "FAIL",
      severity: "critical",
      url,
      evidence: page.status === 0 ? "fetch failed" : `HTTP ${page.status}${page.location ? ` → ${page.location}` : ""}`,
      expected: "HTTP 200 without redirect",
      fix: "A sitemap or key URL must answer 200 itself; fix the route or the sitemap entry.",
    });
    return findings;
  }

  const noindex = [page.robots_meta, page.x_robots_tag].filter(Boolean).join(", ");
  if (/\b(noindex|none)\b/i.test(noindex)) {
    findings.push({
      id: id("page.noindex"),
      check: "page",
      verdict: "FAIL",
      severity: "critical",
      url,
      evidence: `robots: ${noindex}`,
      expected: "indexable",
      rule: "seo-geo-optimization §5",
    });
  }

  findings.push({
    id: id("page.canonical"),
    check: "page",
    verdict: sameUrl(page.canonical, url) ? "PASS" : "FAIL",
    severity: "high",
    url,
    evidence: page.canonical ? `<link rel="canonical" href="${page.canonical}">` : "no canonical",
    expected: url,
    rule: "seo-geo-optimization §6",
  });

  const path = new URL(url).pathname;
  const localized = site.localized_path_prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
    || site.locales.some((locale) => path === `/${locale}` || path.startsWith(`/${locale}/`));
  if (localized) {
    const missing = [...site.locales, "x-default"].filter((lang) => !page.hreflang[lang]);
    const selfLocale = site.locales.find((locale) => path === `/${locale}` || path.startsWith(`/${locale}/`));
    const selfOk = selfLocale ? sameUrl(page.hreflang[selfLocale], url) : true;
    const mismatch = sitemapAlternates
      ? Object.entries(sitemapAlternates).filter(([lang, href]) => !sameUrl(page.hreflang[lang], href)).map(([lang]) => lang)
      : [];
    findings.push({
      id: id("page.hreflang"),
      check: "page",
      verdict: missing.length || !selfOk || mismatch.length ? "FAIL" : "PASS",
      severity: "high",
      url,
      evidence: Object.entries(page.hreflang).map(([l, h]) => `${l}=${new URL(h, site.origin).pathname}`).join(" ") || "no hreflang",
      expected: `${[...site.locales, "x-default"].join(", ")}; self-referencing; same set as sitemap`,
      actual: [missing.length ? `missing ${missing.join(",")}` : "", !selfOk ? "no self link" : "", mismatch.length ? `differs from sitemap: ${mismatch.join(",")}` : ""].filter(Boolean).join("; ") || undefined,
      rule: "seo-geo-optimization §13",
    });
    if (selfLocale && page.lang && !page.lang.toLowerCase().startsWith(selfLocale)) {
      findings.push({
        id: id("page.lang"),
        check: "page",
        verdict: "WARN",
        severity: "medium",
        url,
        evidence: `<html lang="${page.lang}">`,
        expected: selfLocale,
      });
    }
  }

  findings.push({
    id: id("page.title"),
    check: "page",
    verdict: page.title ? "PASS" : "FAIL",
    severity: "high",
    url,
    evidence: page.title ? `<title>${page.title}</title>` : "no <title>",
  });
  if (page.title && site.brand.name && !page.title.includes(site.brand.name)) {
    findings.push({
      id: id("page.brand"),
      check: "page",
      verdict: "WARN",
      severity: "low",
      url,
      evidence: `<title>${page.title}</title>`,
      expected: `brand "${site.brand.name}"`,
      rule: "owner decision (brand name)",
      owner_decision: true,
    });
  }
  findings.push({
    id: id("page.h1"),
    check: "page",
    verdict: page.h1 ? "PASS" : "WARN",
    severity: "medium",
    url,
    evidence: page.h1 ? `<h1>${page.h1}</h1>` : "no <h1> in server HTML",
  });
  if (page.bytes > site.page_weight_warn_bytes) {
    findings.push({
      id: id("page.weight"),
      check: "page",
      verdict: "WARN",
      severity: "medium",
      url,
      evidence: `${Math.round(page.bytes / 1024)} KB of HTML`,
      expected: `<= ${Math.round(site.page_weight_warn_bytes / 1024)} KB`,
      rule: "seo-geo-optimization §12 (lab signal, confirm with field data)",
    });
  }
  return findings;
}

/** Disallow rules in the `User-Agent: *` group that cover any of the given paths. */
export function blockedPaths(robotsTxt: string, paths: string[]): string[] {
  const lines = robotsTxt.split(/\r?\n/).map((line) => line.replace(/#.*/, "").trim());
  const disallows: string[] = [];
  let inStar = false;
  let lastWasAgent = false;
  for (const line of lines) {
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey?.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      inStar = lastWasAgent ? inStar || value === "*" : value === "*";
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (inStar && key === "disallow" && value) disallows.push(value);
  }
  return paths.flatMap((path) =>
    disallows.filter((rule) => path.startsWith(rule.replace(/\*$/, ""))).map((rule) => `Disallow: ${rule} blocks ${path}`),
  );
}

/** Legacy hosts and moved URLs must reach their target in one permanent hop. */
export async function runRedirectCheck(site: SiteConfig, fetcher: Fetcher) {
  const findings: Finding[] = [];
  for (const { from, to, note } of site.redirects) {
    const first = await fetcher(from);
    const permanent = first.status === 301 || first.status === 308;
    // Strip query noise some hosts append (e.g. share tokens) before comparing.
    const location = first.location ? new URL(first.location, from) : undefined;
    location?.searchParams.forEach((_, key) => key.startsWith("_vercel") && location.searchParams.delete(key));
    const target = location?.toString();
    let finalStatus: number | undefined;
    if (permanent && target) finalStatus = (await fetcher(target)).status;
    const ok = permanent && sameUrl(target, to) && finalStatus === 200;
    findings.push({
      id: `redirect:${from}`,
      check: "redirect",
      verdict: first.status === 0 ? "BLOCKER" : ok ? "PASS" : "FAIL",
      severity: "high",
      url: from,
      evidence: first.status === 0 ? first.error ?? "fetch failed" : `HTTP ${first.status} → ${target ?? "(no Location)"} → HTTP ${finalStatus ?? "-"}`,
      expected: `301/308 → ${to} → 200 (one hop)`,
      ...(note ? { rule: note } : {}),
    });
  }
  return { findings, coverage: { discovered: site.redirects.length, checked: site.redirects.length, failed_fetch: 0, not_checked: 0 } };
}
