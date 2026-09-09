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
| D-020 | 2026-08-31 | Use the checked-in normalized official snapshot when Supabase is unconfigured; keep synthetic fixtures only in tests and the development seed. | **Superseded by D-033 for production.** Local inspection gets traceable official identities and rota dates without requiring premature cloud credentials. |
| D-021 | 2026-08-31 | Keep coordinates nullable and treat geocoding as a future separately sourced enrichment. | The official resources publish addresses but not coordinates. Imported pharmacies remain usable through address-based directions; distance is omitted rather than invented. |
| D-022 | 2026-09-01 | Preserve an official house-phone field as raw text plus an ordered array of distinct valid E.164 values; populate the existing singular value only when exactly one distinct number exists. | Four directory fields contain multiple valid numbers with no stated priority. Keeping all values avoids data loss, while leaving the singular field null prevents an arbitrary Call target. The current UI remains conservative and continues to call only the separately published pharmacy telephone. |
| D-023 | 2026-09-01 | Use public OpenStreetMap Nominatim for the one-time 90-record Paphos address enrichment, with a cached single-thread batch at 1.1-second intervals. | It requires no API key, account, or billing and is practical for this deliberately small run. Its public policy requires identifying requests, attribution, local caching, and at most one request per second; recurring or larger national production use must move to a suitable hosted provider or self-hosted service. Google Geocoding was not used because its API requires billing and credentials. |
| D-024 | 2026-09-01 | Store geocoding provenance on `pharmacies`, accept only precise building/pharmacy results, and keep raw attempts in a separate checked-in artifact. | Coordinates are enrichment, never official directory facts. Provider, result ID, query, application quality grade, and time make accepted coordinates auditable without another MVP table. Road/town centroids and equal candidates remain ambiguous. Official upserts do not touch coordinate fields. |
| D-025 | 2026-09-01 | When location is available, sort known distances nearest-first, place unknown distances after them, and initially show 10 results only in the normal All view. | This makes a small set of trusted nearby results immediately usable without hiding unmatched pharmacies. The ordering applies only to the verified-coordinate subset and is not a global-nearest claim. Show all restores the full list, On Duty is never truncated, and no-location behavior is unchanged. |
| D-026 | 2026-09-01 | Use Geoapify as the keyed second geocoder for unresolved Paphos pharmacy addresses and server-proxied manual location search. | Its free plan supports this limited commercial MVP, stored results, Greek/international search, and Paphos filtering without a card, with required Geoapify/source attribution. The key remains server-only. Evidence-based reconciliation accepted 20 of 82 attempts; centroids, non-pharmacy amenities, competing matches, and reused result identifiers remain ambiguous. |
| D-027 | 2026-09-01 | Model proximity around a transient `searchOrigin` that may be GPS, a selected manual match, or absent. | Geolocation remains optional and denied permission immediately exposes manual search. GPS never leaves the browser; neither origin type is persisted. A chosen manual result replaces the prior origin, Clear restores browse-all, and no account/saved-address system is introduced. |
| D-028 | 2026-09-02 | Keep manual location lookup submit-based and budget each session with a three-character minimum, 400-millisecond delay, stale-request cancellation, normalized-query cache, and three-suggestion maximum. | Typing never consumes Geoapify credits, rapid or repeated submissions do not create avoidable requests, and the provider is asked for no more choices than the compact UI presents. The cache is deliberately transient and stores no location history. |
| D-029 | 2026-09-03 | Use Google Places API (New) as the preferred Paphos pharmacy identity/location layer only for fresh exact matches, with official registration number remaining canonical. | Phone-first reconciliation produced 81 exact, 3 probable, 3 ambiguous, and 3 no-match results across all 90. Place IDs are durable; Google-returned content and coordinates are isolated in a cache capped at 30 days and targeted for refresh at day 25. Probable/ambiguous rows cannot drive distance or Directions, while existing Geoapify/Nominatim enrichment remains unchanged as fallback and comparison data. |
| D-030 | 2026-09-07 | Keep `searchOrigin` independent from availability-filter and day selection. | A user-selected GPS or manual origin persists across All, On Duty, Today, and Tomorrow. Every filtered view reuses the same trusted pharmacy coordinates, sorts known distances first, preserves unknown-coordinate results, and requests geolocation only after an explicit location-button action. |
| D-031 | 2026-09-09 | Persist durable Google Place IDs and reconciliation metadata, but only cache coordinates for exact matches; never persist Google display name, formatted address, or phone. | A provider match can verify a destination without redefining the official Cyprus source record. The coordinate pair remains independent from descriptive Google fields and expires within 30 days. Provider disagreements become manual-review evidence rather than automatic official-address overrides. |
| D-032 | 2026-09-09 | Quarantine accepted fallback coordinates when they disagree by more than 250 m with an exact Google identity location until manual verification. | Registrations 413, 467, 607, 690, 869, 893, and 1210 retain their Geoapify results as review evidence, but those coordinates are excluded from Supabase fallback writes and runtime fallback selection. Fresh exact Google remains usable; expiry produces an unknown coordinate rather than silently activating the disputed location. |
| D-033 | 2026-09-09 | Use Supabase as the configured runtime source and permit the checked-in snapshot fallback only in local development and tests. | Production requires the server-only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` pair and fails on missing, partial, or unavailable Supabase access instead of silently serving stale snapshot data. The runtime does not require or read a privileged key. |

## Current assumptions requiring validation

- Supabase remains the managed PostgreSQL/Data API provider for production deployment.
- The Next.js server can fetch the complete 90-record Paphos result set for client-side display and any future distance calculation.
- The IANA `Europe/Nicosia` zone is the correct display/calendar zone for the initial market.
- A normal call to the published pharmacy number is an appropriate first action, while the published house number remains stored but is not automatically presented as an on-call instruction.
- Today/Tomorrow date-level duty filtering is useful when cards explicitly state that exact hours were not published.

## Decisions intentionally deferred

- Automated ingestion frequency, reconciliation, correction, and stale-data policy after the current September 2026 coverage ends.
- Production ranking and tie-breaking beyond truthful status and the accepted nearest-first behavior.
- Directions-provider strategy.
- National Google Places reconciliation, cloud scheduling, quota monitoring, and production refresh alerting beyond the current manual Paphos process.
- A trustworthy source for pharmacy-specific ordinary opening hours and timed duty modes.
- Multilingual routing and content model.
- Pharmacy verification and B2B authorization model.

## References

- [Supabase: Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase: Tables and Data](https://supabase.com/docs/guides/database/tables)
- [Supabase: Postgres extensions](https://supabase.com/docs/guides/database/extensions)
- [Supabase changelog: explicit Data/GraphQL API exposure](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)
- [PostgreSQL: Range types and exclusion constraints](https://www.postgresql.org/docs/current/rangetypes.html#RANGETYPES-CONSTRAINT)
- [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/)
- [Nominatim Search API](https://nominatim.org/release-docs/latest/api/Search/)
- [OpenStreetMap copyright and attribution](https://www.openstreetmap.org/copyright)
- [Geoapify pricing and free-plan terms](https://www.geoapify.com/pricing/)
- [Geoapify Geocoding API and storage statement](https://www.geoapify.com/geocoding-api/)
- [Geoapify terms and attribution](https://www.geoapify.com/terms-and-conditions/)
- [Google Geocoding API usage and billing](https://developers.google.com/maps/documentation/geocoding/usage-and-billing)
- [Google Places API (New) Text Search](https://developers.google.com/maps/documentation/places/web-service/text-search)
- [Google Places content and attribution policies](https://developers.google.com/maps/documentation/places/web-service/policies)
- [Google Maps Platform EEA service terms](https://cloud.google.com/archive/terms/maps-platform/eea/maps-service-terms-20251118)
