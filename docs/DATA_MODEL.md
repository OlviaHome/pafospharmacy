# Data Model

## Principles

- PostgreSQL is the source of truth.
- Availability comes from explicit stored intervals, not inferred legislation or recurring-hours rules.
- Duty assignment and service mode are separate dimensions with a small set of valid combinations.
- Each pharmacy has independent ordinary and duty timelines. Intervals cannot overlap within one timeline, but ordinary and duty intervals may overlap each other.
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

One row represents one explicit interval in either the ordinary or duty timeline for one pharmacy. The previous name `duty_schedule` was rejected because ordinary opening periods are not duty assignments and that name would blur the distinction.

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

- `ordinary` + `open`: physically open during ordinary hours; this row makes no claim about duty assignment.
- `duty` + `open`: officially on duty and physically open.
- `duty` + `on_call`: officially on duty with on-call service. This row does not independently prove physical opening, but it does not negate an overlapping `ordinary/open` row.
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
- Intervals for the same pharmacy and `schedule_kind` must not overlap. A PostgreSQL exclusion constraint over `pharmacy_id`, `schedule_kind`, and `tstzrange(starts_at, ends_at, '[)')` enforces this; Supabase supports the required `btree_gist` extension.
- An ordinary interval and a duty interval for the same pharmacy may overlap. Their source facts remain independent, and ingestion must not split either interval solely because of the cross-kind overlap.
- When the duty service mode changes, store adjacent non-overlapping duty rows such as `duty/open` followed by `duty/on_call`.
- Source conflicts within the same schedule kind must fail validation and be reviewed.

The exclusion constraint should be equivalent to:

```sql
exclude using gist (
  pharmacy_id with =,
  schedule_kind with =,
  tstzrange(starts_at, ends_at, '[)') with &&
)
```

It rejects a pair of rows only when the pharmacy and schedule kind are both equal and the time ranges overlap. Different schedule kinds therefore remain allowed to overlap.

State derivation at instant `t` uses all active rows where `starts_at <= t AND t < ends_at`. The constraints allow at most one ordinary row and one duty row:

| Active ordinary row | Active duty row | Open now | On duty | On call |
|---|---|---|---|---|
| `ordinary/open` | none | yes | no | no |
| none | `duty/open` | yes | yes | no |
| none | `duty/on_call` | no | yes | yes |
| none | `duty/unknown` | unknown | yes | unknown |
| `ordinary/open` | `duty/open` | yes | yes | no |
| `ordinary/open` | `duty/on_call` | yes | yes | yes |
| `ordinary/open` | `duty/unknown` | yes | yes | unknown |

In rule form:

- **Open Now** is true if any active row has `service_mode = open`. An ordinary/open row can therefore prove physical opening even when the duty mode is on-call or unknown.
- **On Duty** is true if an active duty row exists.
- **On Call** follows only the active duty row: true for `duty/on_call`, false for `duty/open`, and unknown for `duty/unknown`.

No active interval means the pharmacy is not explicitly recorded as available for that instant. It may be described as closed/not on duty only when the underlying source is known to be complete for that window; otherwise the UI must present availability as unknown.

A Today/Tomorrow query selects intervals where `starts_at < day_end AND ends_at > day_start`. The application must still display the relevant interval rather than implying the entire day has one status.

## Initial indexes

- PostgreSQL automatically indexes each primary key.
- Add a B-tree index on `availability_intervals.pharmacy_id` because PostgreSQL does not automatically index foreign-key columns.
- The same-kind non-overlap exclusion constraint creates a GiST index over the pharmacy, schedule kind, and time range. Use it for interval-overlap queries where appropriate and confirm the final query plan with `EXPLAIN` rather than adding speculative indexes.

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
- overlapping `ordinary/open` and `duty/open` intervals;
- overlapping `ordinary/open` and `duty/on_call` intervals;
- rejected invalid pairs and rejected same-kind overlaps.

## Deferred data concepts

Add these only after requirements and source formats are known:

- source/provenance and import-run records;
- verification and freshness metadata;
- separate on-call contact details if the authoritative data requires them;
- translations;
- pharmacy business accounts, services, and profile content;
- geospatial columns or national-region modeling.
