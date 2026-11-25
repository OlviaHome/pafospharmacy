/**
 * OA Studio SEO agent CLI (read-only).
 *
 *   npm run seo -- critical            daily critical check
 *   npm run seo -- redirects           legacy host / moved URL check
 *   npm run seo -- drift-baseline      snapshot SEO-critical tags before a change
 *   npm run seo -- regression          compare the live site with the latest baseline
 *   npm run seo -- stats-indexing      Search Console statistics, URL inspection, sitemaps (read-only)
 *
 * Options: --site <path> (default seo/site.json), --out <dir> (default .seo-runs),
 *          --trigger schedule|manual|post-change, --baseline <file>.
 * Output: <out>/<site_id>/<job>/<YYYY-MM>/<run_id>.json, a matching .notify.json and latest.json.
 * Exit codes: 0 ok/warn, 2 a critical check failed, 3 a check could not run or another FAIL —
 * a scheduler must never read a blocked run as a successful one.
 */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { runCriticalCheck, runRedirectCheck } from "./checks";
import { buildReport, exitCode, httpFetch, localTime, parseSitemap, type JobName, type RunReport, type SiteConfig } from "./core";
import { BASELINE_SCHEMA, compareToBaseline, type DriftBaseline } from "./drift";
import { createGscClient, gscClientWithToken, parseServiceAccount, type GscClient } from "./gsc";
import { buildNotification, publicErrorLine, publicLogLine } from "./notify";
import { runStatsIndexing } from "./stats";

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function gitSha(): string | undefined {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return undefined;
  }
}

function write(path: string, data: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function runDir(out: string, site: SiteConfig, job: string, localTime: string) {
  return join(out, site.site_id, job, localTime.slice(0, 7));
}

/**
 * SEO_PUBLIC_LOGS=1 (set in CI of a public repository): print only the run status and counts.
 * Findings, metrics and private side files stay in the output directory.
 */
function save(out: string, site: SiteConfig, report: RunReport) {
  const dir = runDir(out, site, report.job, report.local_time);
  write(join(dir, `${report.run_id}.json`), report);
  const notification = buildNotification(report, site.name);
  write(join(dir, `${report.run_id}.notify.json`), notification);
  write(join(out, site.site_id, report.job, "latest.json"), report);
  if (process.env.SEO_PUBLIC_LOGS === "1") {
    console.log(publicLogLine(report));
    return;
  }
  console.log(notification.text);
  console.log(`\n→ ${join(dir, `${report.run_id}.json`)}`);
}

function latestBaseline(out: string, site: SiteConfig): string | undefined {
  const dir = join(out, site.site_id, "drift-baseline");
  if (!existsSync(dir)) return undefined;
  const files = readdirSync(dir).filter((name) => name.endsWith(".baseline.json")).sort();
  return files.length ? join(dir, files[files.length - 1]) : undefined;
}

async function main() {
  const command = process.argv[2] as JobName | undefined;
  const site = JSON.parse(readFileSync(option("site", "seo/site.json"), "utf8")) as SiteConfig;
  const out = option("out", ".seo-runs");
  const trigger = option("trigger", "manual") as RunReport["trigger"];
  const started = new Date();
  const sha = gitSha();

  if (command === "critical") {
    const result = await runCriticalCheck(site, httpFetch);
    const report = buildReport({ site, job: "critical", trigger, started, finished: new Date(), gitSha: sha, ...result });
    save(out, site, report);
    process.exitCode = exitCode(report);
    return;
  }
  if (command === "redirects") {
    const result = await runRedirectCheck(site, httpFetch);
    const report = buildReport({ site, job: "redirects", trigger, started, finished: new Date(), gitSha: sha, ...result });
    save(out, site, report);
    process.exitCode = exitCode(report);
    return;
  }
  if (command === "drift-baseline") {
    const { pages } = await runCriticalCheck(site, httpFetch);
    const baseline: DriftBaseline = { schema: BASELINE_SCHEMA, site_id: site.site_id, captured_at: started.toISOString(), git_sha: sha, pages };
    const stamp = started.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const path = join(out, site.site_id, "drift-baseline", `${stamp}.baseline.json`);
    write(path, baseline);
    console.log(`Baseline of ${pages.length} pages → ${path}`);
    return;
  }
  if (command === "regression") {
    const baselinePath = option("baseline", latestBaseline(out, site) ?? "");
    if (!baselinePath || !existsSync(baselinePath)) {
      // A regression check without a baseline did not happen: record it as blocked, do not stay silent.
      const report = buildReport({
        site, job: "regression", trigger: "post-change", started, finished: new Date(), gitSha: sha,
        coverage: { discovered: 0, checked: 0, failed_fetch: 0, not_checked: 1 },
        findings: [{
          id: "regression.baseline", check: "drift", verdict: "BLOCKER", severity: "high",
          evidence: baselinePath ? `baseline not found: ${baselinePath}` : "no drift baseline captured before the change",
          fix: "Run `npm run seo -- drift-baseline` before the next SEO change ships.",
        }],
      });
      save(out, site, report);
      process.exitCode = exitCode(report);
      return;
    }
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as DriftBaseline;
    const current = await runCriticalCheck(site, httpFetch);
    const findings = [...compareToBaseline(baseline, current.pages), ...current.findings.filter((f) => f.verdict !== "PASS")];
    const report = buildReport({
      site,
      job: "regression",
      trigger: "post-change",
      started,
      finished: new Date(),
      gitSha: sha,
      findings,
      coverage: current.coverage,
      metrics: { ...current.metrics, baseline_pages: baseline.pages.length },
    });
    save(out, site, report);
    process.exitCode = exitCode(report);
    return;
  }
  if (command === "stats-indexing") {
    // Preferred: a short-lived token from Workload Identity Federation; fallback: a JSON key.
    let client: GscClient | Error;
    try {
      const property = site.gsc?.property ?? "";
      if (process.env.GSC_ACCESS_TOKEN) client = gscClientWithToken(process.env.GSC_ACCESS_TOKEN, property);
      else if (process.env.GSC_SERVICE_ACCOUNT_JSON) client = await createGscClient(parseServiceAccount(process.env.GSC_SERVICE_ACCOUNT_JSON), property);
      else client = new Error("No Search Console credentials: set GSC_ACCESS_TOKEN (keyless) or GSC_SERVICE_ACCOUNT_JSON");
    } catch (error) {
      client = error instanceof Error ? error : new Error(String(error));
    }
    const sitemap = await httpFetch(site.sitemap);
    const urls = sitemap.status === 200 ? parseSitemap(sitemap.body).entries.map((e) => e.loc) : [];
    const result = await runStatsIndexing(site, client, urls, started);
    const findings = sitemap.status === 200 ? result.findings : [
      ...result.findings,
      { id: "sitemap.status", check: "sitemap", verdict: "BLOCKER" as const, severity: "high" as const, url: site.sitemap, evidence: sitemap.error ?? `HTTP ${sitemap.status}` },
    ];
    let artifacts: RunReport["artifacts"];
    if (result.data) {
      // Same start stamp as the run id, so the data file sits next to its report.
      const stamp = started.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
      const name = `${site.site_id}.stats-indexing.${stamp}.gsc-data.json`;
      artifacts = [{ name: "gsc-data", path: name, schema: "oa.seo.gsc-data/v1", private: true }];
      write(join(runDir(out, site, "stats-indexing", localTime(started, site.timezone)), name), result.data);
    }
    const report = buildReport({
      site, job: "stats-indexing", trigger, started, finished: new Date(), gitSha: sha,
      findings, coverage: result.coverage, metrics: result.metrics, artifacts,
    });
    save(out, site, report);
    process.exitCode = exitCode(report);
    return;
  }
  console.error("Usage: npm run seo -- critical | redirects | stats-indexing | drift-baseline | regression [--site seo/site.json] [--out .seo-runs]");
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(process.env.SEO_PUBLIC_LOGS === "1" ? publicErrorLine(error) : error);
  process.exitCode = 1;
});
