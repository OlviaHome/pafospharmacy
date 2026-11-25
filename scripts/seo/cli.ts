/**
 * OA Studio SEO agent CLI (read-only).
 *
 *   npm run seo -- critical            daily critical check
 *   npm run seo -- redirects           legacy host / moved URL check
 *   npm run seo -- drift-baseline      snapshot SEO-critical tags before a change
 *   npm run seo -- regression          compare the live site with the latest baseline
 *
 * Options: --site <path> (default seo/site.json), --out <dir> (default .seo-runs),
 *          --trigger schedule|manual|post-change, --baseline <file>.
 * Output: <out>/<site_id>/<job>/<YYYY-MM>/<run_id>.json, a matching .notify.json and latest.json.
 * Exit code 2 when a critical finding fails, so a scheduler can mark the run red.
 */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { runCriticalCheck, runRedirectCheck } from "./checks";
import { buildReport, httpFetch, type JobName, type RunReport, type SiteConfig } from "./core";
import { BASELINE_SCHEMA, compareToBaseline, type DriftBaseline } from "./drift";
import { buildNotification } from "./notify";

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

function save(out: string, site: SiteConfig, report: RunReport) {
  const dir = join(out, site.site_id, report.job, report.local_time.slice(0, 7));
  write(join(dir, `${report.run_id}.json`), report);
  const notification = buildNotification(report, site.name);
  write(join(dir, `${report.run_id}.notify.json`), notification);
  write(join(out, site.site_id, report.job, "latest.json"), report);
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
    process.exitCode = report.findings.some((f) => f.severity === "critical" && f.verdict === "FAIL") ? 2 : 0;
    return;
  }
  if (command === "redirects") {
    const result = await runRedirectCheck(site, httpFetch);
    const report = buildReport({ site, job: "redirects", trigger, started, finished: new Date(), gitSha: sha, ...result });
    save(out, site, report);
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
      console.error("No baseline. Run `npm run seo -- drift-baseline` before the change ships.");
      process.exitCode = 1;
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
    process.exitCode = findings.some((f) => f.severity === "critical" && f.verdict === "FAIL") ? 2 : 0;
    return;
  }
  console.error("Usage: npm run seo -- critical | redirects | drift-baseline | regression [--site seo/site.json] [--out .seo-runs]");
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
