# Roadmap

The roadmap stays narrow. Availability claims expand only when a trustworthy source can support them.

## COMPLETED — foundation and official ingestion

- Mobile-first Next.js/PWA-ready pharmacy finder with Today/Tomorrow, call, directions, optional location, and truthful status language.
- Reproducible Supabase migrations for `pharmacies`, timed `availability_intervals`, and date-only `duty_assignments`, with constraints, indexes, grants, and RLS.
- `Europe/Nicosia` day windows, half-open interval logic, separate open/duty/on-call derivation, and focused automated tests.
- Cyprus Pharmaceutical Services ingestion pipeline for the current 2026 private-pharmacy directory and May–September 2026 rota resources.
- Registration-number identity, pragmatic provenance, idempotent upsert keys, validation/reporting, and a checked-in normalized snapshot.
- All published districts retained in data; the UI remains Paphos-only and displays 90 real pharmacy identities with applicable official date-only assignments.
- Nullable coordinates, address-based Directions, and no invented ordinary hours, duty hours, opening mode, or on-call mode.

## NOW — validate the official-data experience

- Verify the source refresh cadence and define behavior before the published duty coverage ends on 2026-09-30.
- User-test the “On Duty, exact hours not published—call first” wording with residents, expats, and tourists.
- Confirm how corrections and disappeared/renumbered pharmacy records should be reconciled before automating imports.
- Keep source, coverage, and retrieval information visible enough for users to understand the data limit.

## NEXT — improve actionable availability

- Find and validate a pharmacy-specific ordinary-opening source before enabling real-data Open Now filtering.
- Find a trustworthy timed source for `duty/open` or `duty/on_call`; keep those facts in `availability_intervals` only.
- Evaluate a geocoding enrichment with its own provenance, accuracy review, and correction path; do not overwrite the meaning of official address data.
- Schedule the existing importer only after refresh, failure, alerting, and reconciliation behavior are accepted.
- Decide the next language based on validated need and design the translation/content boundary.

## LATER — expansion and B2B

- Add district selection when product scope expands beyond Paphos.
- Greek, Russian, and Arabic support.
- Pharmacy verification and business accounts.
- Pharmacy profile, product, and service information.
- Push notifications, SEO pages, and privacy-respecting analytics.
- Evaluate map view and server-side geospatial search only when user testing or national scale justifies them.

Paid placement, if ever introduced, must remain separate from safety-critical availability and proximity results.
