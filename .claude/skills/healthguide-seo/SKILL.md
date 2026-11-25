---
name: healthguide-seo
description: Project context, priorities and owner decisions for SEO and AI-search work on HealthGuide.cy (healthguide.cy, Health Guide Cyprus) — duty/open pharmacies by district, hospitals, blog, four languages (en, el, ru, ar). Use for any SEO, indexing, structured-data, title/meta, hreflang, sitemap, robots or AI-visibility task in this repository, together with the seo-agent and seo-geo-optimization skills.
---

# HealthGuide.cy — SEO context

Read with `seo-agent` (how jobs run) and `seo-geo-optimization` (what search and answer engines
document). This file wins where they differ. Site config: `seo/site.json`.

## The site

- Answers "which pharmacy can I use right now?" for Nicosia, Limassol, Larnaca, Famagusta, Paphos;
  plus a hospitals directory and a blog. Next.js on Vercel, data in Supabase.
- Locales `en` (default, x-default), `el`, `ru`, `ar` (RTL). URLs `/{locale}`, `/{locale}/{district}`,
  `/{locale}/hospitals`, `/{locale}/blog/{slug}`. Root `/` serves the English page with canonical `/en`.
- Product rules in `AGENTS.md` and `docs/` bind SEO work too: never blur **open now**, **on duty**
  and **on call**; never state unverified schedule or legal facts; official sources stay canonical.
- Medical topic (YMYL): trust beats volume. No invented facts, statistics, reviews or authors.

## Already done — do not redo

- hreflang for all four locales + `x-default` (English page of the same group) in page metadata and
  in the sitemap (PR #15); canonical = page of the language shown.
- Honest sitemap `lastmod`: district/home pages change only when that day's duty roster changes (#26).
- District tabs on home pages are real links (#25); district SEO pages exist; homepage SEO copy
  approved for four locales.
- robots.txt is a route (`app/robots.txt/route.ts`) because it carries `Content-Signal`.
- Blog: `Article` + `FAQPage` JSON-LD, hreflang only for published languages, technical checklist
  `docs/BLOG_TECH_CHECKLIST.md`; editorial Telegram bot owns writing, facts and publishing.
- Legacy host `pafospharmacy.vercel.app` → `healthguide.cy`, permanent, path kept (D-051).

## Owner decisions (report, never change)

- `Content-Signal: ai-train=no, search=yes, ai-input=yes`: allowed in search and AI answers, not in
  training. No blocking of AI search or user-triggered bots.
- Public brand "Health Guide Cyprus" (D-058), never translated. Titles currently end in
  "HealthGuide.cy": a known mismatch, reported as an owner decision, not auto-fixed.
- Nothing is published, merged, deployed or migrated without Olga's explicit approval.
- No new architecture or new page types from a handful of Search Console queries.
- Paid SEO tools and new paid APIs need approval; the blog bot budget is separate and not for SEO.

## Goals and target queries

Google page 1 for "duty pharmacy cyprus", "pharmacy on duty cyprus", "open pharmacy cyprus" and
open/duty pharmacy + city (Paphos, Limassol, Nicosia, Larnaca, Agia Napa, Polis), in all four
languages; Arabic is an opening because competitors lack it. Visibility in AI answers for the same
questions.

## Known open items (from the 2026-11-25 baseline)

- No JSON-LD on home, district and hospital pages (only blog articles have it). Candidates:
  `WebSite` + `Organization` (brand), `BreadcrumbList`, `ItemList` of pharmacies with `Pharmacy`
  items built from official data only (no Google Places content, per AGENTS.md).
- HTML weight: `/ru/paphos` ≈ 520 KB, `/` ≈ 1.1 MB of HTML. Check field Core Web Vitals before
  calling it a problem.
- Search Console is connected read-only and keyless (stage 2.1, D-067); Bing Webmaster and IndexNow are not connected yet.

## Checks specific to this site

- Every district page in every locale: status 200, self-canonical, 5 hreflang links, H1 present in
  server HTML, today's duty pharmacies present in server HTML (not only after JavaScript).
- `lastmod` must never move just because the sitemap was regenerated.
- Arabic pages: `dir="rtl"` and `lang="ar"`.
