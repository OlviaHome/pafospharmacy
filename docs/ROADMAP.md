# Roadmap

The roadmap stays narrow. Availability claims expand only when a trustworthy source can support them.

## COMPLETED — foundation and official ingestion

- Mobile-first Next.js/PWA-ready pharmacy finder with Today/Tomorrow, call, directions, optional location, and truthful status language.
- Reproducible Supabase migrations for `pharmacies`, timed `availability_intervals`, and date-only `duty_assignments`, with constraints, indexes, grants, and RLS.
- `Europe/Nicosia` day windows, half-open interval logic, separate open/duty/on-call derivation, and focused automated tests.
- Cyprus Pharmaceutical Services ingestion pipeline for the current 2026 private-pharmacy directory and May–September 2026 rota resources.
- Registration-number identity, pragmatic provenance, idempotent upsert keys, validation/reporting, and a checked-in normalized snapshot.
- All published districts retained in data; the UI remains Paphos-only and displays 90 real pharmacy identities with applicable official date-only assignments.
- Nullable coordinates, address-based Directions, and no persisted generated schedule modes.
- Reproducible Paphos-only Nominatim enrichment with cached raw results, conservative ambiguity handling, separate coordinate provenance, and eight accepted precise matches.
- Geoapify second-provider reconciliation for the 82 unresolved records, with 20 additional accepted coordinates, retained provider/source provenance, and conservative rejection of reused geometries and non-pharmacy amenities.
- Three optional proximity paths—GPS, explicit manual Paphos location selection, or browse-all—using transient `searchOrigin` state and no GPS persistence.
- Located results sorted nearest-first with unknown distances retained, human-readable distance, a nearest-10 progressive reveal for All, and untruncated On Duty results.
- Full 90-record Paphos Google Places API (New) reconciliation using official-phone-first identity evidence: 81 exact matches, 3 probable, 3 ambiguous, and 3 no match.
- A 30-day expiring Google content/coordinate cache with day-25 manual refresh, durable Place IDs, exact-only runtime trust, and unchanged Geoapify/Nominatim fallback data.
- View-independent GPS/manual origins retained across All, On Duty, Today, and Tomorrow, with nearest-first duty results and no repeated permission request on filter changes.
- A source-bounded `Europe/Nicosia` evaluator for the official May–September 2026 duty notice, including scheduled gaps and previous-day overnight phone coverage through 08:00, without generated database intervals.
- A separate versioned `Europe/Nicosia` evaluator for the official 2026 regular summer/winter pharmacy schedule and verified closure holidays; **Open Now** is the union of regular-open and duty-open periods.
- Original English master copy with independent-service branding, concise homepage disclosure, and About, Privacy, Terms, and Data Sources pages.

## NOW — validate the official-data experience

- Verify the source refresh cadence and define behavior before the published duty coverage ends on 2026-09-30.
- User-test the distinct mandatory duty-open, scheduled-gap, and overnight-call wording with residents, expats, and tourists.
- Confirm how corrections and disappeared/renumbered pharmacy records should be reconciled before automating imports.
- Keep source, coverage, and retrieval information visible enough for users to understand the data limit.

## NEXT — product sequence

1. Internationalization for English, Greek, Russian, and Arabic, including automatic browser-language detection, a manual language selector, persisted user choice, and full Arabic right-to-left support.
2. A local Paphos location index with Geoapify retained as fallback.
3. Map view.
4. Doctors / Medical help 24/7.
5. Verified PWA installability.
6. Revisit formal legal/operator details when the product becomes commercial or a formal entity and custom domain are established.

Supporting data work remains deliberately source-led: integrate an official per-pharmacy seasonal registry before applying seasonal exceptions; manually review non-exact or materially disagreeing location matches; and schedule imports only after refresh, failure, alerting, and reconciliation behavior are accepted. Any future Places UI Kit experiment remains separately approved and presentation-only.

## LATER — expansion and B2B

- Add district selection when product scope expands beyond Paphos.
- Pharmacy verification and business accounts.
- Pharmacy profile, product, and service information.
- Push notifications, SEO pages, and privacy-respecting analytics.
- Evaluate map view and server-side geospatial search only when user testing or national scale justifies them.

Paid placement, if ever introduced, must remain separate from safety-critical availability and proximity results.
