---
name: seo-agent
description: Runs the OA Studio SEO agent for a website repository — daily critical checks, weekly statistics/indexing, technical audits, weekly reports, monthly AI-search visibility, redirect checks and post-change regression checks — and records every result as an oa.seo.run-report/v1 file. Use when asked to run an SEO check, audit or report for a site that has seo/site.json, or when a scheduled SEO job starts.
---

# OA Studio SEO agent

Site-agnostic. Everything about the site is in `seo/site.json`; the rules for what is true about
search and AI answer engines are in the `seo-geo-optimization` skill; the site's own context,
priorities and owner decisions are in that site's project skill (for HealthGuide.cy:
`healthguide-seo`). Read the project skill first: it overrides this one.

## Hard rules

1. **Read-only by default.** Audits never change the site, Search Console, Bing, DNS, Vercel or data.
2. **Changes only as a pull request** from a new branch. Never push to `main`, never merge,
   never enable auto-merge, never deploy, never run a production migration.
3. **Owner decisions are not yours** (`owner_decision: true`): bot and AI-training rules,
   opting out of AI answers, removing or redirecting pages that have traffic, public facts,
   brand name, paid tools. Report them; do not change them.
4. **Evidence or nothing.** Quote raw bytes (status line, tag, header). A check that cannot run
   is `BLOCKER` with the reason; never estimate. Do not judge HTML from a summarising fetch tool.
5. **Least privilege.** Search Console and Bing access is read-only. Secrets come from the
   runner's environment, never from the repository, never printed, never written to reports.
6. **Do not send messages.** Write `*.notify.json` envelopes (oa.notify/v1); the OA Studio
   orchestrator delivers them.
7. At most two attempts to fix the same thing; then stop and report.

## Jobs

| Job | When (site time zone) | What | Tooling |
|---|---|---|---|
| `critical` | daily 08:00 | robots.txt owner lines, sitemap, every sitemap URL and key path: status, noindex, canonical, hreflang, title, H1 | `npm run seo -- critical` |
| `stats-indexing` | Monday | Search Console clicks/impressions/CTR/position by page × query (28 d vs previous 28 d), URL Inspection for sitemap URLs, sitemap status; Bing Webmaster equivalents | stage 2 collector |
| `tech-audit` | Wednesday | full audit per `seo-geo-optimization` §25 on a template sample; page weight, structured data, internal links, integrity (§25.4) | `critical` output + agent review |
| `weekly-report` | Friday | what shipped, what moved (numbers with sources), what is broken, plan for next week, at most three asks of the owner | reads the week's reports |
| `ai-visibility` | first Monday of the month | fixed prompt panel per locale: is the site named or cited, which sources are cited, wrong facts | stage 4 |
| `drift-baseline` | before an SEO PR is merged | snapshot of SEO-critical tags | `npm run seo -- drift-baseline` |
| `regression` | after an SEO change is live | compare with the baseline plus the critical check | `npm run seo -- regression` |
| `redirects` | weekly and after domain changes | legacy hosts and moved URLs: one permanent hop to a 200 | `npm run seo -- redirects` |

## Output

Every run writes `<out>/<site_id>/<job>/<YYYY-MM>/<run_id>.json` (validated by
`seo/contracts/run-report.v1.schema.json`), a matching `.notify.json`, and `latest.json`.
Findings keep a stable `id` so trends and de-duplication work across runs. Prose reports
(weekly) go in the report's findings and in a Markdown file next to the JSON, never instead of it.

## Turning findings into work

- Safe, reversible fixes with a clear rule → one GitHub Issue per fix (title, evidence, rule,
  how to verify) for the owner's `ready-for-claude` pipeline, or a PR when the job is asked to fix.
- Owner decisions → listed in the report under "needs your decision", never acted on.
- Every SEO PR: take a `drift-baseline` before merge, run `regression` after deploy, attach both
  run ids to the PR.

## Reusing for another site

Copy `scripts/seo/`, `seo/contracts/`, this skill and `seo-geo-optimization`; write a new
`seo/site.json` and a short project skill with the site's context and owner decisions.
Nothing else changes.
