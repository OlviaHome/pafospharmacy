# SEO agent

A read-only SEO and AI-search agent for HealthGuide.cy, built so OA Studio can reuse it for other
sites. Decision: D-066. Skills: `.claude/skills/seo-agent` (how jobs run), `.claude/skills/healthguide-seo`
(this site's context and owner decisions), `.claude/skills/seo-geo-optimization` (documented engine
rules, CC BY 4.0).

## Layout

| Path | Site-specific? | Purpose |
|---|---|---|
| `scripts/seo/` | no | Checks, drift, notification builder, CLI (`npm run seo -- <job>`). Imports no site code. |
| `seo/contracts/` | no | JSON Schemas: `run-report.v1`, `notification.v1`, `site-config.v1`. The orchestrator reads only these. |
| `seo/site.json` | yes | Origin, locales, sitemap, owner robots lines, key paths, redirects, brand. No secrets. |
| `.claude/skills/healthguide-seo/` | yes | Context, what is already done, owner decisions, goals. |
| `.seo-runs/` | — | Local run output (git-ignored) until history storage is chosen in stage 3. |

## Data exchange

- **Run report** (`oa.seo.run-report/v1`): one immutable JSON file per run, `run_id =
  <site_id>.<job>.<UTC stamp>`. Findings carry `verdict` (PASS/WARN/FAIL/BLOCKER/NOT_CHECKED/ABSENT),
  `severity`, verbatim `evidence`, a stable `id` and `owner_decision`.
- **Notification** (`oa.notify/v1`): plain text ≤ 3,500 characters, `level`, `dedupe_key`,
  `destination.route = site:<site_id>`. The orchestrator maps the route to the Telegram chat and topic
  ("OA Studio · Command Center" → HealthGuide.cy) and owns the bot token. Agents never send.
  Delivery rules: `critical` now; `warning` now but not again while `dedupe_key` is unchanged;
  `info` may be batched into a digest.

## Stages

| # | Stage | Needs Olga | Status |
|---|---|---|---|
| 1 | Foundation: skills, config, contracts, `critical`, `redirects`, `drift-baseline`, `regression`, tests | review the PR | this PR |
| 2 | Search Console (read-only) + Bing Webmaster + IndexNow; `stats-indexing` collector | grant access (Google, Bing), approve IndexNow | next |
| 3 | Runtime, schedules (Asia/Nicosia) and permanent history storage; post-deploy regression trigger | choose storage, approve secrets and migration | after 2 |
| 4 | Agent jobs: Wednesday tech audit, Friday report and plan, monthly AI-visibility panel | approve AI-panel budget | after 3 |
| 5 | Telegram delivery through the OA Studio orchestrator | separate project | contract ready |
| 6 | First fixes as PRs (structured data for site pages, brand in titles) with baseline/regression | approve each PR | after 2 |

## Schedule (target, stage 3)

All scheduled runs finish before 09:30 Asia/Nicosia so their notifications reach the OA Studio
Daily Digest, which the orchestrator sends at 10:00. Envelopes carry
`delivery = { mode, digest: "daily", for_date }`: `digest` waits for the digest; `immediate`
(only `critical` level) is sent at once and is listed in the digest as well.

| Job | Asia/Nicosia | Must be written by |
|---|---|---|
| `critical` | daily 08:00 | 08:30 |
| `stats-indexing` | Monday 08:15 | 09:15 |
| `tech-audit` | Wednesday 08:30 | 09:30 |
| `weekly-report` (+ plan for next week) | Friday 08:45 | 09:30 |
| `ai-visibility` | first Monday of the month 08:45 | 09:30 |
| `redirects` | Monday 08:05 | 08:30 |
| `regression` | after each production deploy that changes SEO files, or on request | — (immediate if critical) |

A run that has not written its report by its deadline is itself reported as missing in the digest.
Schedulers that only speak UTC fire at both possible UTC hours and the job runs only when the local
hour matches, so daylight-saving changes cannot shift or double a run.

## Exit codes and blocked runs

`0` ok or warnings only · `2` a critical check failed · `3` a check could not run (BLOCKER, a URL
that could not be fetched, no baseline) or another FAIL. A blocked run is never "ok": its status is
`blocked`, its notification says the result is unknown, and it needs action.

## Safety

Read-only access everywhere (Search Console "Restricted" user, Bing read API); secrets only in the
runner's secret store; reports and logs never contain secrets; fixes only as PRs; no merge, deploy,
production migration, URL removal, disavow, bot-rule or AI-opt-out change by the agent.

## Running by hand

```bash
npm run seo -- critical            # daily critical check
npm run seo -- redirects           # legacy host and HTTPS redirects
npm run seo -- drift-baseline      # before an SEO change ships
npm run seo -- regression          # after it is live
```

Exit code 2 means a critical check failed. Output goes to `.seo-runs/` (override with `--out`).
