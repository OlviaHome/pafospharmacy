# Data Model

## Principles

- PostgreSQL is the source of truth.
- Availability comes from explicit stored intervals, not inferred legislation or recurring-hours rules.
- Duty assignment and service mode are separate dimensions with a small set of valid combinations.
- Intervals form one canonical, non-overlapping timeline per pharmacy. Invalid or conflicting source data is rejected rather than combined into ambiguous states.
- Use lowercase `snake_case` identifiers, `bigint generated always as identity` primary keys, and `timestamptz` audit/schedule timestamps.
- Store instants with time-zone awareness and interpret calendar days using `Europe/Nicosia` in the domain layer.
- Every table in an exposed schema has Row Level Security enabled and explicit least-privilege grants.

This is a logical MVP model, not a migration. Exact SQL will be created and verified during the first vertical slice.

## `pharmacies`

One row represents one pharmacy location.

| Field | Type | Required | Purpose / constraint |
|---|---|---:|---|
| `id` | `bigint` identity | yes | Primary key. |
| `name` | `text` | yes | Public display name; non-empty. |
| `address_line` | `text` | yes | Public street/address text; non-empty. |
| `locality` | `text` | yes | Locality or district display text; non-empty. |
| `postal_code` | `text` | no | Postal code when known. |
| `phone_e164` | `text` | yes | Telephone URI source for the MVP call action. Validate formatting at ingestion/application boundaries. |
| `latitude` | `double precision` | yes | WGS84 latitude with a check from `-90` through `90`. |
| `longitude` | `double precision` | yes | WGS84 longitude with a check from `-180` through `180`. |
| `is_active` | `boolean` | yes | Defaults to `true`; inactive locations are excluded from public results. |
| `created_at` | `timestamptz` | yes | Defaults to the current instant. |
| `updated_at` | `timestamptz` | yes | Updated by the write path; defaults to the current instant. |

Names are not unique: different locations may legitimately share a brand or similar name. Coordinates support distance and directions without adding a geospatial extension in the first slice.

## `availability_intervals`

One row represents one explicit, canonical availability interval for one pharmacy. The previous name `duty_schedule` was rejected because ordinary opening periods are not duty assignments and that name would blur the distinction.

| Field | Type | Required | Purpose / constraint |
|---|---|---:|---|
| `id` | `bigint` identity | yes | Primary key. |
| `pharmacy_id` | `bigint` | yes | Foreign key to `pharmacies.id`. |
| `starts_at` | `timestamptz` | yes | Inclusive start instant. |
| `ends_at` | `timestamptz` | yes | Exclusive end instant; must be later than `starts_at`. |
| `schedule_kind` | `text` | yes | `ordinary` or `duty`; identifies whether the interval is part of the official duty rota. |
| `service_mode` | `text` | yes | `open`, `on_call`, or `unknown`; identifies how service is available without changing duty meaning. |
| `created_at` | `timestamptz` | yes | Defaults to the current instant. |
| `updated_at` | `timestamptz` | yes | Updated by the write path; defaults to the current instant. |

Use `text` plus check constraints rather than PostgreSQL enum types so a future verified source can add a value through an ordinary migration. Only these pairs are valid:

- `ordinary` + `open`: physically open during ordinary hours and not identified as on duty.
- `duty` + `open`: officially on duty and physically open.
- `duty` + `on_call`: officially on duty, not physically open, and contact by phone may be required.
- `duty` + `unknown`: officially on duty, but the source does not establish whether the pharmacy is open or on call.

`ordinary` + `on_call` and `ordinary` + `unknown` are invalid. `unknown` is explicit rather than an accidental null: it prevents incomplete official data from being guessed as either open or on call.

The migration should express the pair rule as a database check equivalent to:

```sql
(schedule_kind = 'ordinary' and service_mode = 'open')
or
(schedule_kind = 'duty' and service_mode in ('open', 'on_call', 'unknown'))
```

Additional constraints and invariants:

- `ends_at > starts_at`.
- Deleting a pharmacy should be restricted while schedule history exists; normal removal uses `pharmacies.is_active = false`.
- Intervals for one pharmacy must not overlap. A PostgreSQL exclusion constraint over `pharmacy_id` and `tstzrange(starts_at, ends_at, '[)')` will enforce this; Supabase supports the required `btree_gist` extension.
- When a duty assignment changes from physically open to on call, store adjacent `duty/open` and `duty/on_call` rows. When ordinary opening overlaps a duty assignment, classify the overlap as `duty/open` and split surrounding ordinary time as needed.
- Source conflicts must fail validation and be reviewed; the application must never merge contradictory intervals with logical OR.

State derivation at instant `t` uses the single active row where `starts_at <= t AND t < ends_at` and the following mapping:

| Active pair | Open now | On duty | On call |
|---|---|---|---|
| `ordinary/open` | yes | no | no |
| `duty/open` | yes | yes | no |
| `duty/on_call` | no | yes | yes |
| `duty/unknown` | unknown | yes | unknown |

For `duty/unknown`, only on-duty status is known; the UI must not guess the service mode. No active interval means the pharmacy is not explicitly recorded as available for that instant. It may be described as closed/not on duty only when the underlying source is known to be complete for that window; otherwise the UI must present availability as unknown.

A Today/Tomorrow query selects intervals where `starts_at < day_end AND ends_at > day_start`. The application must still display the relevant interval rather than implying the entire day has one status.

## Initial indexes

- PostgreSQL automatically indexes each primary key.
- Add a B-tree index on `availability_intervals.pharmacy_id` because PostgreSQL does not automatically index foreign-key columns.
- The non-overlap exclusion constraint creates a GiST index over the pharmacy and time range. Use it for interval-overlap queries where appropriate and confirm the final query plan with `EXPLAIN` rather than adding speculative indexes.

The GiST exclusion index is justified by correctness, not scale. Partitioning, PostGIS, materialized views, and additional query indexes remain unnecessary until measured behavior justifies them.

## Read/write access

- Public application access is read-only.
- Anonymous reads return active pharmacies and schedule rows belonging to active pharmacies.
- Anonymous insert, update, and delete privileges are not granted.
- RLS is enabled on both tables if they are in an exposed schema, with explicit read policies and database tests for allow/deny behavior.
- Trusted development seeds and future ingestion use server-side credentials that never reach the browser.

## Development data

Seed several plausible Paphos-area records with realistic coordinates, phone formatting, and adjacent mode-transition examples. Every seed record and UI environment must be clearly labeled as synthetic/test data so it cannot be mistaken for current pharmacy advice.

Include test intervals for:

- `ordinary/open`;
- `duty/open`;
- `duty/on_call`;
- `duty/unknown`;
- an overnight interval;
- a pharmacy with no matching interval;
- adjacent `duty/open` and `duty/on_call` intervals sharing a boundary;
- rejected invalid pairs and rejected overlaps.

## Deferred data concepts

Add these only after requirements and source formats are known:

- source/provenance and import-run records;
- verification and freshness metadata;
- separate on-call contact details if the authoritative data requires them;
- translations;
- pharmacy business accounts, services, and profile content;
- geospatial columns or national-region modeling.
