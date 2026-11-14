# Blog technical checklist

Technical checks for published blog pages. They are separate from article writing: the editorial
bot and `lib/editorial/checks.ts` check text and facts; this list checks how the site serves a page.
Run it after deploys that touch the blog and on the first published article in each language.
Mark an item "not checked" (with the reason) when the access or tool it needs is missing; never
guess a result.

| # | Check | How | Pass |
|---|-------|-----|------|
| 1 | Server-rendered text | `curl -s https://healthguide.cy/ru/blog/<slug>` (or "View source") | HTTP 200; the H1, body text, FAQ and source links are in the raw HTML without JavaScript |
| 2 | Status codes | Open an unknown slug, a draft slug and `/ru/blog/preview/<wrong token>` | 404 for all three; drafts are never public |
| 3 | Canonical | `<link rel="canonical">` on `/ru/blog/<slug>`, `/ru/blog/<slug>?lang=en` and on a language without a translation (fallback) | Always the page of the language actually shown (`/ru/…`, `/en/…`) |
| 4 | hreflang | `<link rel="alternate" hreflang>` on each published language | Every published language lists all published languages plus `x-default`; unpublished languages are absent |
| 5 | Sitemap | `https://healthguide.cy/sitemap.xml` | Contains each published language URL once with a true `lastmod`; no drafts, previews or `?lang=` URLs; every listed URL returns 200 |
| 6 | Structured data | Copy the `application/ld+json` block into the Rich Results Test / Schema validator | Valid JSON-LD; `Article` (headline, dates, author, inLanguage) matches the page; `FAQPage` only when the FAQ is visible and its questions and answers match exactly |
| 7 | robots.txt | `https://healthguide.cy/robots.txt` | `Allow: /`, `Disallow: /api/`, `Content-Signal: ai-train=no, search=yes, ai-input=yes`, sitemap URL |
| 8 | Preview privacy | Open a preview link | `noindex, nofollow`; no view is counted |
| 9 | Analytics | Vercel Analytics → page views for the article path; view counter on the page after the next cache refresh (≤ 1 hour) | Page views recorded; counter increases once per browser tab session; bots ignored |
| 10 | Mobile and speed | Open on a phone (or 390 px emulation) and run PageSpeed Insights | No horizontal scroll; text readable before images load; record the real score and image weights, or "not checked" |
| 11 | Images | Inspect cover and inline images | Load from Supabase Storage or Unsplash; alt text in the page language; photo credit and licence under stock photos |
| 12 | Language switch | Use the article switch and the site language selector | Article switch changes only the article (`?lang=`); site switch changes both; missing translation falls back to English with a notice |
| 13 | Search Console | Inspect the URL and the submitted sitemap | Only with Search Console access; otherwise "not checked" |
