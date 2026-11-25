import type { Finding, PageSnapshot, Severity, Verdict } from "./core";

/**
 * SEO drift: a baseline of the SEO-critical parts of every page, and a diff against it.
 * Run `drift-baseline` before an SEO change ships and `regression` after it is live.
 */
export const BASELINE_SCHEMA = "oa.seo.drift-baseline/v1";

export interface DriftBaseline {
  schema: typeof BASELINE_SCHEMA;
  site_id: string;
  captured_at: string;
  git_sha?: string;
  pages: PageSnapshot[];
}

type Field = keyof PageSnapshot;

/** How serious a change is depends on what changed, not on how much. */
const RULES: Array<{ field: Field; severity: Severity; verdict: Verdict; label: string }> = [
  { field: "status", severity: "critical", verdict: "FAIL", label: "HTTP status" },
  { field: "robots_meta", severity: "critical", verdict: "FAIL", label: "robots meta" },
  { field: "x_robots_tag", severity: "critical", verdict: "FAIL", label: "X-Robots-Tag" },
  { field: "canonical", severity: "high", verdict: "FAIL", label: "canonical" },
  { field: "hreflang", severity: "high", verdict: "FAIL", label: "hreflang set" },
  { field: "lang", severity: "medium", verdict: "WARN", label: "html lang" },
  { field: "jsonld_types", severity: "medium", verdict: "WARN", label: "structured data types" },
  { field: "title", severity: "info", verdict: "WARN", label: "title" },
  { field: "description", severity: "info", verdict: "WARN", label: "meta description" },
  { field: "h1", severity: "info", verdict: "WARN", label: "H1" },
];

function show(value: unknown): string {
  if (value === undefined || value === null || value === "") return "(none)";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "(none)";
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, string>).sort(([a], [b]) => a.localeCompare(b));
    return entries.length ? entries.map(([k, v]) => `${k}=${v}`).join(" ") : "(none)";
  }
  return String(value);
}

export function compareToBaseline(baseline: DriftBaseline, current: PageSnapshot[]): Finding[] {
  const findings: Finding[] = [];
  const now = new Map(current.map((page) => [page.url, page]));
  for (const before of baseline.pages) {
    const after = now.get(before.url);
    const path = new URL(before.url).pathname;
    if (!after) {
      findings.push({
        id: `drift.removed:${path}`,
        check: "drift",
        verdict: before.status === 200 ? "WARN" : "PASS",
        severity: before.status === 200 ? "high" : "info",
        url: before.url,
        evidence: "URL was in the baseline and is no longer in the sitemap or key paths",
      });
      continue;
    }
    for (const rule of RULES) {
      const was = show(before[rule.field]);
      const is = show(after[rule.field]);
      if (was === is) continue;
      // A page that got better (e.g. 404 → 200, noindex removed) is reported, not flagged.
      const improved =
        (rule.field === "status" && after.status === 200) ||
        ((rule.field === "robots_meta" || rule.field === "x_robots_tag") &&
          !/\b(noindex|none)\b/i.test(String(after[rule.field] ?? "")));
      findings.push({
        id: `drift.${rule.field}:${path}`,
        check: "drift",
        verdict: improved ? "PASS" : rule.verdict,
        severity: improved ? "info" : rule.severity,
        url: before.url,
        evidence: `${rule.label}: ${was} → ${is}`,
        expected: improved ? undefined : "unchanged unless the change was intended",
      });
    }
  }
  const known = new Set(baseline.pages.map((page) => page.url));
  for (const page of current) {
    if (known.has(page.url)) continue;
    findings.push({
      id: `drift.added:${new URL(page.url).pathname}`,
      check: "drift",
      verdict: "PASS",
      severity: "info",
      url: page.url,
      evidence: `new URL, HTTP ${page.status}`,
    });
  }
  return findings;
}
