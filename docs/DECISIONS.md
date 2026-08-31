# Decisions

Accepted decisions are recorded here so later implementation sessions do not silently reopen or contradict them. Add a dated entry when a meaningful product, architecture, security, or data-model choice is made. Superseded decisions remain in the file and link to their replacement.

## Accepted

| ID | Date | Decision | Rationale and consequence |
|---|---|---|---|
| D-001 | 2026-08-31 | Build the first product as a mobile-first Next.js web app with PWA-ready structure, not native apps. | One codebase is the fastest MVP path and matches the requested delivery model. |
| D-002 | 2026-08-31 | Calculate availability only from explicit database intervals. | Cyprus duty rules and official hours have not been verified. No legislation or assumed recurring-hours logic belongs in the MVP. |
| D-003 | 2026-08-31 | Model each availability interval with constrained `schedule_kind` (`ordinary` or `duty`) and `service_mode` (`open`, `on_call`, or `unknown`). | Three independent booleans admitted invalid combinations. Separate dimensions preserve duty assignment while allowing only ordinary/open, duty/open, duty/on-call, and duty/unknown. Text checks are easier to extend safely than a database enum. |
| D-004 | 2026-08-31 | Store schedule boundaries as `timestamptz`, use half-open intervals, and derive calendar days in `Europe/Nicosia`. | This handles overnight periods and daylight-saving transitions without treating local clock text as an instant. |
| D-005 | 2026-08-31 | Calculate approximate Haversine distance in the browser for the first slice. | The dataset is small, coordinates stay on-device, and PostGIS would add unused complexity. Directions providers calculate actual routes separately. |
| D-006 | 2026-08-31 | Keep data access in server-only Next.js modules; expose read-only public data with least-privilege grants and RLS. | This separates presentation from persistence and protects all write paths. Public clients never receive secret/service-role credentials. |
| D-007 | 2026-08-31 | Keep “Open now” tied to the real current instant and hide or disable it for Tomorrow. | “Open tomorrow” is a schedule claim, not “open now.” Redefining the label would violate the core status language. |
| D-008 | 2026-08-31 | Allow the app to work without geolocation. | Browser permission can be denied or unavailable; status, address, call, and directions still provide value. |
| D-009 | 2026-08-31 | Use only `pharmacies` and `availability_intervals` in the initial schema, with identity primary keys and indexed foreign keys. | **Superseded by D-016.** A third table became materially necessary when the official source proved to contain dates but no trustworthy times. |
| D-010 | 2026-08-31 | Do not rely on offline caching for current schedule answers. | Installability is useful, but stale pharmacy availability can be misleading. Time-sensitive data needs an explicit freshness policy. |
| D-011 | 2026-08-31 | Use the pharmacy's public E.164 telephone number for the first call action. | A separate on-call contact field is deferred until an authoritative source proves it is required and safe to expose. |
| D-012 | 2026-08-31 | Keep all development records clearly synthetic. | Plausible test data must never be mistaken for real-time healthcare-access information. |
| D-013 | 2026-08-31 | Keep intervals non-overlapping per pharmacy and enforce the invariant with a PostgreSQL range exclusion constraint. | **Superseded by D-014.** This incorrectly treated ordinary availability and duty assignment as one timeline. |
| D-014 | 2026-08-31 | Prohibit interval overlap only within the same pharmacy and `schedule_kind`; allow ordinary and duty intervals to overlap. | Ordinary availability and official duty assignment are independent facts and may come from separate sources. An exclusion constraint over pharmacy, schedule kind, and time range enforces each timeline without forcing ingestion to split cross-kind overlaps. |
| D-015 | 2026-08-31 | Use synthetic fixtures only when both Supabase settings are absent; do not fall back after partial configuration or a failed configured read. | **Superseded by D-020.** Official data is now available for normal local runtime. |
| D-016 | 2026-08-31 | Add `duty_assignments` for official date-only rota facts and keep `availability_intervals` strictly timed. | The official resources publish a duty date but no trustworthy start/end times. A date-only row proves On Duty without fabricating instants or mode. The table has no `service_mode`; timed duty/open and duty/on-call remain interval facts for a future source. |
| D-017 | 2026-08-31 | Use the Cyprus Pharmaceutical Services 2026 private-pharmacy directory and May–September 2026 duty resources from the National Open Data Portal under CC BY 4.0. | The directory attached to dataset 817 is current for 2026, unlike the older 2024–2025 resource on dataset 815. Exact resource URLs, retrieval time, dataset names, and attribution are preserved. |
| D-018 | 2026-08-31 | Use official registration number as the stable external pharmacy identity; keep the internal identity primary key. | Names, addresses, and phones can change or collide. Registration identity plus source record identifiers supports idempotent pharmacy and duty upserts. |
| D-019 | 2026-08-31 | Import every published district, but keep the product query and UI focused on Paphos. | National ingestion avoids a future database/import redesign without adding a district selector or expanding current product scope. |
| D-020 | 2026-08-31 | Use the checked-in normalized official snapshot when Supabase is unconfigured; keep synthetic fixtures only in tests and the development seed. | Local inspection gets traceable official identities and rota dates without requiring premature cloud credentials. Partial or failed configured Supabase access remains a visible error. |
| D-021 | 2026-08-31 | Keep coordinates nullable and treat geocoding as a future separately sourced enrichment. | The official resources publish addresses but not coordinates. Imported pharmacies remain usable through address-based directions; distance is omitted rather than invented. |

## Current assumptions requiring validation

- Supabase remains the managed PostgreSQL/Data API provider for production deployment.
- The Next.js server can fetch the complete 90-record Paphos result set for client-side display and any future distance calculation.
- The IANA `Europe/Nicosia` zone is the correct display/calendar zone for the initial market.
- A normal call to the published pharmacy number is an appropriate first action, while the published house number remains stored but is not automatically presented as an on-call instruction.
- Today/Tomorrow date-level duty filtering is useful when cards explicitly state that exact hours were not published.

## Decisions intentionally deferred

- Automated ingestion frequency, reconciliation, correction, and stale-data policy after the current September 2026 coverage ends.
- Production ranking and tie-breaking beyond truthful status and approximate distance.
- Directions-provider strategy.
- Geocoding provider and field-level provenance for enriched coordinates.
- A trustworthy source for pharmacy-specific ordinary opening hours and timed duty modes.
- Multilingual routing and content model.
- Pharmacy verification and B2B authorization model.

## References

- [Supabase: Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase: Tables and Data](https://supabase.com/docs/guides/database/tables)
- [Supabase: Postgres extensions](https://supabase.com/docs/guides/database/extensions)
- [Supabase changelog: explicit Data/GraphQL API exposure](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)
- [PostgreSQL: Range types and exclusion constraints](https://www.postgresql.org/docs/current/rangetypes.html#RANGETYPES-CONSTRAINT)
