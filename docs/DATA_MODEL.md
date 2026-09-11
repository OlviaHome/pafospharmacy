# Data Model

## Principles

- PostgreSQL is the production source of truth; the checked-in normalized snapshot keeps local development reproducible without cloud credentials.
- Store only what a source actually establishes. Never turn a date-only duty assignment into stored start/end times or a service mode; a separately sourced, versioned duty-hours notice may be evaluated at runtime.
- `availability_intervals` contains only trustworthy timed facts. `duty_assignments` contains official date-only rota facts.
- Google Places identity reconciliation is keyed by official registration number and kept separate from official fields and existing geocoding enrichment.
- Ordinary opening, timed duty service, and date-only duty assignment are related but independent dimensions.
- Store instants as `timestamptz`, use half-open intervals, and interpret calendar dates with `Europe/Nicosia`.
- Use lowercase `snake_case`, identity primary keys, explicit constraints, indexed foreign keys, least-privilege grants, and RLS on exposed tables.

## `pharmacies`

One row represents one pharmacy location. The internal identity remains `id`; `official_registration_number` is the stable external identity used by the Cyprus importer.

| Field | Type | Required | Purpose / constraint |
|---|---|---:|---|
| `id` | `bigint` identity | yes | Primary key. |
| `official_registration_number` | `text` | no | Unique official external identity when supplied. Non-empty when present. |
| `name` | `text` | yes | Display label. For official rows this is transparently derived from pharmacist surname and given name. |
| `pharmacist_given_name` | `text` | no | Official given name. |
| `pharmacist_surname` | `text` | no | Official surname. |
| `address_line` | `text` | yes | Official street/address text; non-empty. |
| `address_additional` | `text` | no | Landmark or additional address information. |
| `locality` | `text` | yes | Municipality/community display text; non-empty. |
| `district` | `text` | no | Import district such as Paphos, Limassol, Larnaca, Nicosia, or Famagusta. |
| `postal_code` | `text` | no | Postal code when published. |
| `phone_e164` | `text` | no | Pharmacy telephone normalized to E.164 when valid. |
| `house_phone_raw` | `text` | no | Exact decoded `House Tel. No.` source-field content, preserving separators and embedded line breaks. |
| `house_phone_e164_values` | `text[]` | yes | Distinct valid normalized numbers in source order; defaults to an empty array. Multiple values have no implied priority. |
| `house_phone_e164` | `text` | no | Conservative singular convenience value, populated only when the source field resolves to exactly one distinct valid number. It is not automatically treated as an on-call instruction. |
| `latitude` / `longitude` | `double precision` | no | Nullable WGS84 enrichment. Both are null or both are present; the official files do not publish them. |
| `geocode_provider` | `text` | no | Provider identifier for geocoded coordinates, currently `openstreetmap_nominatim` or `geoapify`. |
| `geocode_result_identifier` | `text` | no | Accepted provider result key. Nominatim uses the OSM object type and ID; Geoapify uses its returned `place_id`. |
| `geocode_query` | `text` | no | Exact official-address query submitted to the provider. |
| `geocode_quality` | `text` | no | Conservative application grade: `high` or `medium`; not a provider confidence score. |
| `geocoded_at` | `timestamptz` | no | Retrieval instant for the accepted result. |
| `source` | `text` | yes | Constrained provenance category: `legacy`, `synthetic_fixture`, `cyprus_open_data`, `pharmacy_confirmed`, or `third_party`. |
| `source_dataset` | `text` | no | Human-readable source dataset name. |
| `source_record_identifier` | `text` | no | Stable source-scoped record key. Unique with `source` when present. |
| `source_resource_url` | `text` | no | Exact resource URL. |
| `source_retrieved_at` | `timestamptz` | no | Retrieval instant. |
| `is_active` | `boolean` | yes | Defaults to `true`; inactive locations are omitted from public results. |
| `created_at` / `updated_at` | `timestamptz` | yes | Audit timestamps. |

Names and addresses are not identity keys. Coordinates, postal codes, and telephone numbers remain nullable rather than being invented or blocking ingestion.

Geocoding provenance is all-or-none: if `geocode_provider` is set, a complete coordinate pair, result identifier, query, quality, and timestamp are required. Rows with non-geocoded coordinates such as synthetic fixtures may leave all geocoding provenance null. Official directory imports omit every coordinate/provenance column during database upsert, preserving the separation between official address facts and later enrichment.

The 2026 official directory contains four `House Tel. No.` fields with multiple distinct valid numbers, using spaces, hyphens, or a line break as separators. The importer preserves the exact decoded field in `house_phone_raw` and every distinct valid number in `house_phone_e164_values`. It leaves `house_phone_e164` null for those rows rather than choosing a preferred number without a source-backed rule. All three House Tel. columns are internal source/provenance fields: anonymous and authenticated Data API roles have no `SELECT` privilege on them, and the runtime repository does not place them in the public `Pharmacy` domain object or client serialization. The current UI Call action continues to use the separate singular pharmacy telephone and does not expose or prioritize these house-number alternatives.

## `pharmacy_google_places`

One Paphos-only row links a canonical official registration number to durable Google Place reconciliation metadata and an optional temporary coordinate cache. This table does not replace any official identity, name, address, phone, or existing Geoapify/Nominatim enrichment.

| Field | Type | Required | Purpose / constraint |
|---|---|---:|---|
| `official_registration_number` | `text` | yes | Primary key and foreign key to the canonical official pharmacy identity; deletion is restricted. |
| `place_id` | `text` | no | Long-lived Google provider identifier. Required for exact, probable, or ambiguous matches; null for no match. |
| `display_name` | `text` | no | Reserved compatibility column constrained to null; Google display names are not persisted. |
| `formatted_address` | `text` | no | Reserved compatibility column constrained to null; Google addresses are not persisted or promoted to official data. |
| `latitude` / `longitude` | `double precision` | no | Temporary cache pair for exact identity matches only; both present or both null and range constrained. It does not depend on descriptive Google fields. |
| `google_phone_e164` | `text` | no | Reserved compatibility column constrained to null; Google phone values are used during reconciliation but not persisted. |
| `classification` | `text` | yes | `exact_identity_match`, `probable_match`, `ambiguous`, or `no_match`. |
| `matching_evidence` | `text[]` | yes | Machine-readable evidence such as exact phone, compatible postcode/locality/street, or conflicting/insufficient identity. |
| `retrieved_at` | `timestamptz` | yes | Places response retrieval instant. |
| `expires_at` | `timestamptz` | yes | Hard coordinate-cache expiry, later than retrieval and no more than 720 hours afterward. |
| `created_at` / `updated_at` | `timestamptz` | yes | Audit timestamps. |

Only a fresh `exact_identity_match` with a complete coordinate pair may supply distance sorting or Directions. Probable and ambiguous matches are durable review data but can never store or supply runtime coordinates. The database stores no Google-returned display name, formatted address, or phone; on expiry, coordinates are refreshed or cleared while the Place ID and reconciliation metadata may remain. A partial unique index prevents one exact Place ID from being assigned to multiple official pharmacies.

RLS permits anonymous/authenticated reads only for active pharmacies with a fresh exact coordinate row. Trusted scripts receive explicit write grants through the server-side service role. The database constraint caps cache lifetime at 30 consecutive days, and the refresh script targets day 25.

## `availability_intervals`

One row is one explicit, trustworthy timed fact. The name `duty_schedule` remains rejected because this table may hold ordinary opening intervals as well as timed duty service.

| Field | Type | Required | Purpose / constraint |
|---|---|---:|---|
| `id` | `bigint` identity | yes | Primary key. |
| `pharmacy_id` | `bigint` | yes | Foreign key to `pharmacies.id`; deletion is restricted. |
| `starts_at` | `timestamptz` | yes | Inclusive start instant. |
| `ends_at` | `timestamptz` | yes | Exclusive end instant; later than `starts_at`. |
| `schedule_kind` | `text` | yes | `ordinary` or `duty`. |
| `service_mode` | `text` | yes | `open`, `on_call`, or `unknown`. |
| `created_at` / `updated_at` | `timestamptz` | yes | Audit timestamps. |

Only these combinations are valid:

- `ordinary/open`
- `duty/open`
- `duty/on_call`
- `duty/unknown`

`duty/unknown` is appropriate only when a source provides trustworthy interval boundaries but does not establish the mode during that interval. It is not a substitute for missing time data.

Intervals cannot overlap for the same pharmacy and `schedule_kind`. An ordinary interval and a duty interval may overlap because they are independent facts. PostgreSQL enforces this with a GiST exclusion constraint over `pharmacy_id`, `schedule_kind`, and `tstzrange(starts_at, ends_at, '[)')`. Ingestion must not split ordinary intervals merely to accommodate cross-kind overlap.

## `duty_assignments`

One row records the official fact that a pharmacy is assigned to the rota on one Cyprus calendar date.

| Field | Type | Required | Purpose / constraint |
|---|---|---:|---|
| `id` | `bigint` identity | yes | Primary key. |
| `pharmacy_id` | `bigint` | yes | Foreign key to `pharmacies.id`; deletion is restricted. |
| `duty_date` | `date` | yes | Published rota date, interpreted in `Europe/Nicosia`. |
| `source` | `text` | yes | `cyprus_open_data`, `pharmacy_confirmed`, or `third_party`. |
| `source_dataset` | `text` | yes | Dataset name. |
| `source_record_identifier` | `text` | yes | Stable source-scoped idempotency key. Unique with `source`. |
| `source_resource_url` | `text` | yes | Exact official CSV URL. |
| `source_retrieved_at` | `timestamptz` | yes | Retrieval instant. |
| `created_at` / `updated_at` | `timestamptz` | yes | Audit timestamps. |

There is deliberately no `service_mode`, `starts_at`, or `ends_at`. The current official source establishes none of them. A uniqueness constraint on pharmacy, date, and dataset also prevents duplicate semantic assignments.

A date-only assignment may coexist with a later trustworthy timed duty interval. The row proves `On Duty` for that date but has no stored service mode. During a separately supported official rule period, the application may combine the row with the versioned notice profile to derive a transient duty-open, scheduled-gap, or overnight on-call state.

## Derived state

At instant `t` and its Cyprus local date:

- **Open Now** is true if an active interval has `service_mode = open` or a supported official duty assignment is currently inside the cited notice's mandatory open period. Outside supported rule coverage, a date-only assignment never proves it. If ordinary-opening coverage is incomplete and no trustworthy open fact exists, the value is unknown rather than false.
- **On Duty** is true if an active timed duty interval exists, a `duty_assignments` row exists for the local date, or the previous date's supported assignment is still in its overnight phone period.
- **On Call** is true from an active `duty/on_call` interval or the supported official notice's 23:00–08:00 period for the preceding assignment date. The date-only row by itself still establishes no service mode.
- An overlapping `ordinary/open` interval independently proves physical opening even when duty information has no service mode.

Today/Tomorrow duty filtering uses `duty_date` for date-only assignments and interval overlap (`starts_at < day_end AND ends_at > day_start`) for timed facts. The current Today view also retains the previous assignment through its supported 08:00 overnight boundary. “Open Now” is never redefined for Tomorrow.

## Indexes, access, and idempotency

- Unique constraints support idempotent upserts on official registration number and source record identifier.
- `availability_intervals.pharmacy_id` and `duty_assignments(duty_date, pharmacy_id)` are indexed.
- `pharmacy_google_places.expires_at` is indexed for refresh/purge work; exact Place IDs are unique.
- `pharmacies(district)` has a partial index for active rows.
- Anonymous/authenticated application roles receive column-level read-only access to the pharmacy fields required by the runtime; House Tel. columns are excluded, public writes are denied, and RLS policies remain explicit.
- Trusted ingestion uses a server-side secret key only when explicitly asked to write to Supabase. The browser never receives it.

## Official data snapshot

The current snapshot contains the 2026 private-pharmacy directory and May–September 2026 district duty resources published by Cyprus Pharmaceutical Services through the National Open Data Portal under CC BY 4.0. It preserves all five published districts while the UI selects Paphos.

The importer stores pharmacy identity/provenance and date-only duty assignments. It creates no ordinary-opening intervals, duty intervals, service modes, or coordinates from these files. The 2026 duty-hours evaluator is pure runtime logic sourced from the separate official notice and never persists generated intervals. Synthetic intervals remain limited to automated tests and the development seed.

## Geocoding enrichment snapshots

`data/geocoding/paphos-nominatim-2026.json` is a separately versioned enrichment artifact keyed by official registration number. It contains provider/policy/license metadata, source-snapshot identity, exact queries and timestamps, cached raw results, reconciliation outcomes, accepted coordinates, and aggregate counts.

`data/geocoding/paphos-geoapify-2026.json` has the same purpose for only the 82 Paphos pharmacies not accepted by Nominatim. It additionally retains provider confidence/match metadata and each result's underlying datasource attribution. Geoapify accepted 20 records after cross-record duplicate-result and non-pharmacy-amenity rejection; combined accepted evidence is 28 of 90. Seven Geoapify results materially disagree with an exact Google identity location and are quarantined for manual review, leaving 21 trusted fallback rows eligible for persistence. The two artifacts remain separate so each provider's provenance and terms stay auditable.

`data/geocoding/paphos-google-place-links-2026.json` records the full 90-pharmacy phone-first reconciliation without retaining Google response content or coordinates. It keeps canonical registration number, Place ID, classification, evidence, retrieval time, and comparison/report metadata. Full fields requested for identity verification live only in the ignored local cache at `data/geocoding/cache/paphos-google-places.json`; Supabase persists only fresh exact coordinates from that cache, never Google name, address, or phone. Current results are 81 exact, 3 probable, 3 ambiguous, and 3 no match. Exact fresh Google coordinates take runtime precedence; only non-disputed accepted Geoapify/Nominatim coordinates may act as fallback.

`scripts/sync-geocoding-snapshots.ts` is the Paphos-only offline synchronization boundary. It reads the official snapshot, durable Google links, temporary local Google cache, and accepted Nominatim/Geoapify artifacts; validates registration uniqueness, artifact agreement, cache limits, and expected coverage; and defaults to a no-write report. Its manual-review output contains the seven exact matches whose providers disagree by more than 250 m plus every probable, ambiguous, and no-match record. The seven disputed fallbacks stay in that evidence but are excluded from runtime merging and the 21-row trusted fallback write plan. It never changes official source fields or treats textual addresses as verified physical locations.

Only `accepted` records not subsequently quarantined by cross-provider reconciliation are merged into application data or written to coordinate columns. An accepted result must remain in Cyprus and Paphos and match a precise building/house or pharmacy POI using source-backed locality/postcode/street evidence. Street-only and locality-only coordinates are intentionally `ambiguous`, even when useful as search hints, because they are unsafe as Directions destinations. `failed` means the provider returned no result; it does not mean the official pharmacy or address is invalid.

`searchOrigin` is transient application state, not a database entity. GPS and selected manual-location coordinates are deliberately absent from the schema and are never stored as pharmacy coordinates.

## Deferred concepts

- Trustworthy pharmacy-specific ordinary-opening intervals.
- Persisted timed duty/open or duty/on-call facts from a pharmacy-specific timed source; the current notice-derived schedule remains transient.
- Import-run history and field-level provenance if reconciliation needs justify them.
- Translations, pharmacy accounts, services, profiles, PostGIS, and national UI selection.
