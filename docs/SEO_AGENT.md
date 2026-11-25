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
| 1 | Foundation: skills, config, contracts, `critical`, `redirects`, `drift-baseline`, `regression`, tests | review the PR | done (#27) |
| 2 | Search Console (read-only) + Bing Webmaster + IndexNow; `stats-indexing` collector | grant access (Google, Bing), approve IndexNow | 2.1 GSC: **done** 2026-11-25 (#28, first run 45677685864: Search Analytics, URL Inspection, Sitemaps all PASS). 2.2 Bing: **done** 2026-11-25 (#31, D-069, OAuth `webmaster.read`; first run 45690834716: all 7 APIs PASS, status warn — new site, no Bing data yet). IndexNow: separate decision |
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
| `bing-stats` | Monday 08:20 | 09:15 |
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

## Search Console (stage 2.1)

- Access: a Google Cloud service account (`oa-seo-agent` project) added to the property as a
  **Restricted** user; only the `webmasters.readonly` scope. No Google SDK. Setup: `docs/SEO_GSC_SETUP.md`.
- Preferred, keyless: Workload Identity Federation. Google trusts only GitHub Actions jobs of this
  repository on `main` in environment `seo-readonly`; they get a 15-minute read-only token
  (`GSC_ACCESS_TOKEN`). Two non-secret environment variables: `GCP_WIF_PROVIDER`, `GSC_SERVICE_ACCOUNT`.
- Fallback: environment secret `GSC_SERVICE_ACCOUNT_JSON`, used only when keyless is not configured,
  passed only to `stats-indexing`. Never in the repository or chat.
- Data: totals for the last 28 complete days (ending 3 days ago) vs the 28 before, pages and
  queries (top 250 in the private data file), the owner's target queries, URL Inspection for every
  sitemap URL, sitemap status. Query text is private: it goes only to the `private: true` data file
  (`oa.seo.gsc-data/v1`), never into findings, notifications or logs.
- Indexing verdicts: indexed → PASS; not yet indexed/unknown → WARN (normal for a new domain);
  Google-chosen canonical differs, fetch failure → FAIL high; robots/noindex block → FAIL critical.
- Public repository: CI prints only status counts and uploads nothing until stage 3 provides
  private storage. Manual runs: Actions → "SEO agent (manual)" → Run workflow.

## Bing Webmaster Tools (stage 2.2)

- Access: OAuth 2.0 client "OA SEO Agent (read-only)" with the `webmaster.read` scope only (D-069).
  No API key — it would give full account access. Variable `BING_CLIENT_ID`, environment secrets
  `BING_CLIENT_SECRET` and `BING_REFRESH_TOKEN` in `seo-readonly`; passed only to `bing-stats`.
  Each run trades the refresh token for a one-hour access token.
- Data (`GetUserSites`, `GetRankAndTrafficStats`, `GetQueryStats`, `GetCrawlStats`, `GetFeeds`,
  `GetCrawlIssues`, `GetUrlInfo` for key paths): clicks/impressions for 28 days vs the 28 before,
  latest crawl day (crawled, in index, 4xx/5xx, robots-blocked, malware), sitemap feed status,
  key-page crawl status. Query text and issue URLs only in the private `oa.seo.bing-data/v1` file.
- Verdicts: site not verified → FAIL; sitemap missing → WARN (owner decision); feed error → FAIL;
  processing → WARN; no data yet → WARN; malware → FAIL critical; any API error → BLOCKER for that API.
- If Bing answers InvalidToken: re-authorise the same read-only client and replace
  `BING_REFRESH_TOKEN`. Never switch to an API key.

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
