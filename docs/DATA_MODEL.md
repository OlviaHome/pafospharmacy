# Data Model

## Principles

- PostgreSQL is the production source of truth; the checked-in normalized snapshot keeps local development reproducible without cloud credentials.
- Store only what a source actually establishes. Never turn a date-only duty assignment into invented start/end times or a service mode.
- `availability_intervals` contains only trustworthy timed facts. `duty_assignments` contains official date-only rota facts.
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
| `latitude` / `longitude` | `double precision` | no | Nullable WGS84 enrichment. The official files do not publish coordinates. |
| `source` | `text` | yes | Constrained provenance category: `legacy`, `synthetic_fixture`, `cyprus_open_data`, `pharmacy_confirmed`, or `third_party`. |
| `source_dataset` | `text` | no | Human-readable source dataset name. |
| `source_record_identifier` | `text` | no | Stable source-scoped record key. Unique with `source` when present. |
| `source_resource_url` | `text` | no | Exact resource URL. |
| `source_retrieved_at` | `timestamptz` | no | Retrieval instant. |
| `is_active` | `boolean` | yes | Defaults to `true`; inactive locations are omitted from public results. |
| `created_at` / `updated_at` | `timestamptz` | yes | Audit timestamps. |

Names and addresses are not identity keys. Coordinates, postal codes, and telephone numbers remain nullable rather than being invented or blocking ingestion.

The 2026 official directory contains four `House Tel. No.` fields with multiple distinct valid numbers, using spaces, hyphens, or a line break as separators. The importer preserves the exact decoded field in `house_phone_raw` and every distinct valid number in `house_phone_e164_values`. It leaves `house_phone_e164` null for those rows rather than choosing a preferred number without a source-backed rule. The current UI Call action continues to use the separate singular pharmacy telephone and does not expose or prioritize these house-number alternatives.

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

A date-only assignment may coexist with a later trustworthy timed duty interval. It proves `On Duty` for that date, while the timed interval—if present—provides any instant-level duty mode.

## Derived state

At instant `t` and its Cyprus local date:

- **Open Now** is true only if an active interval has `service_mode = open`. A date-only duty assignment never proves it. If ordinary-opening coverage is incomplete and no timed open fact exists, the value is unknown rather than false.
- **On Duty** is true if an active timed duty interval exists or a `duty_assignments` row exists for the local date.
- **On Call** is true only from an active `duty/on_call` interval. A date-only assignment establishes no mode, so On Call is unavailable/unknown rather than inferred.
- An overlapping `ordinary/open` interval independently proves physical opening even when duty information has no service mode.

Today/Tomorrow duty filtering uses `duty_date` for date-only assignments and interval overlap (`starts_at < day_end AND ends_at > day_start`) for timed facts. “Open Now” is never redefined for Tomorrow.

## Indexes, access, and idempotency

- Unique constraints support idempotent upserts on official registration number and source record identifier.
- `availability_intervals.pharmacy_id` and `duty_assignments(duty_date, pharmacy_id)` are indexed.
- `pharmacies(district)` has a partial index for active rows.
- Anonymous/authenticated application roles receive read-only access to active pharmacy data; public writes are denied and RLS policies are explicit.
- Trusted ingestion uses a server-side secret key only when explicitly asked to write to Supabase. The browser never receives it.

## Official data snapshot

The current snapshot contains the 2026 private-pharmacy directory and May–September 2026 district duty resources published by Cyprus Pharmaceutical Services through the National Open Data Portal under CC BY 4.0. It preserves all five published districts while the UI selects Paphos.

The importer stores pharmacy identity/provenance and date-only duty assignments. It creates no ordinary-opening intervals, duty intervals, service modes, or coordinates from these files. Synthetic intervals remain limited to automated tests and the development seed.

## Deferred concepts

- Geocoding as a separately sourced enrichment.
- Trustworthy pharmacy-specific ordinary-opening intervals.
- Trustworthy timed duty/open or duty/on-call intervals.
- Import-run history and field-level provenance if reconciliation needs justify them.
- Translations, pharmacy accounts, services, profiles, PostGIS, and national UI selection.
