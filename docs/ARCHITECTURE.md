# Architecture

## Goals

- Deliver the fastest useful mobile path to current pharmacy information.
- Keep availability rules testable and independent from React components.
- Preserve the distinction between open, on-duty, and on-call states end to end.
- Support reproducible official-data ingestion without coupling it to page rendering.
- Avoid dependencies that the first vertical slice does not need.

## System context

```text
Browser / installed PWA
  ├─ obtains optional device location
  ├─ renders filters, status, call, and directions
  └─ requests pharmacy data
              │
              ▼
Next.js application
  ├─ presentation: App Router pages and React components
  ├─ domain: time-window, status, filtering, and distance functions
  └─ data access: server-only Supabase repository/modules
              │
              ▼
Supabase / PostgreSQL
  ├─ pharmacies
  ├─ availability_intervals (trustworthy timed facts only)
  └─ duty_assignments (official date-only rota facts)

Cyprus Open Data CSV resources
              │
              ▼
Trusted ingestion script ──► normalized checked-in snapshot
              └────────────► optional idempotent Supabase upsert
```

## Runtime boundaries

### Browser

The browser owns permission-based geolocation, client-side distance calculation, mobile interaction, and opening call/directions intents. User coordinates remain on the device in the first slice. If permission is denied, the app omits distance without blocking the core list.

### Next.js application

Next.js is the application-facing read boundary. Data access lives in server-only modules rather than presentation components. A small domain layer contains pure, testable functions for:

- determining whether an interval contains an instant;
- determining whether an interval overlaps Today or Tomorrow;
- deriving open, on-duty, and on-call meaning across the independent ordinary and duty timelines;
- filtering and sorting results;
- calculating approximate straight-line distance.

React components receive display-ready domain values and do not recreate schedule rules.

### Supabase/PostgreSQL

PostgreSQL is the production source of truth for pharmacy details, explicit timed intervals, and date-only duty assignments. Public clients never receive a secret/service-role key. Tables in an exposed schema use Row Level Security and least-privilege grants; anonymous access is read-only, and public writes are denied.

The application should explicitly configure any required Data API exposure rather than relying on project defaults. Trusted seed, ingestion, or administrative writes run only in a server-side or development context.

For local inspection, the server-only data module reads the checked-in normalized official snapshot when both Supabase environment variables are absent. The snapshot contains every imported district, while the repository selects Paphos for the current UI. A partial configuration or a failed configured Supabase read is an error rather than a silent fallback, so a production data outage cannot be disguised.

### Official ingestion

Official data import is a separate trusted boundary and never runs during page rendering. The script downloads the exact Cyprus Open Data CSV resources, parses quoted/Greek content, validates required fields and dates, normalizes phones and registration identity, preserves provenance, produces a deterministic-shape snapshot, and can optionally upsert to Supabase in batches.

The current resources establish pharmacy-directory facts and date-only rota assignments. They do not establish ordinary hours, exact duty hours, open/on-call mode, or coordinates. The importer therefore writes `pharmacies` and `duty_assignments` only; it does not manufacture `availability_intervals`. Unexpected records are reported rather than silently discarded. Stable registration numbers and source record identifiers make reruns idempotent. Multi-number house-phone fields retain both their exact decoded source value and every distinct valid normalized number; no number is promoted to the singular convenience field without an unambiguous source value.

The authoritative release is [Cyprus Pharmaceutical Services dataset 817](https://www.data.gov.cy/en/dataset/817), including its attached 2026 private-pharmacy directory and five May–September 2026 district rota CSVs. The older [private-pharmacies dataset 815](https://www.data.gov.cy/en/dataset/815) is retained only as research context because its published resource is labelled 2024–2025. All imported resources are CC BY 4.0. Exact resource URLs and coverage are versioned in `lib/ingestion/official-sources.ts` and copied into snapshot metadata and row provenance.

## Request and calculation flow

1. The server determines Today/Tomorrow using the `Europe/Nicosia` IANA time zone.
2. The data layer fetches active Paphos pharmacies, timed intervals overlapping the window, and date-only duty assignments for its local dates. Without configured Supabase credentials it maps the checked-in official snapshot through the same domain shape.
3. At a given instant, the domain layer derives status across timed and date-only facts:
   - **Open Now** is true if any active interval has `service_mode = open`;
   - **On Duty** is true if an active timed duty interval exists or an official assignment exists for the local date;
   - **On Call** is true if the active duty interval has `service_mode = on_call`;
   - a duty interval with `service_mode = unknown` proves duty assignment but does not establish open or on-call mode;
   - a date-only assignment has no service mode and cannot establish Open Now or On Call;
   - an active `ordinary/open` interval independently proves Open Now, even when an overlapping duty interval is `on_call` or `unknown`.
4. When no complete ordinary-hours source exists, absence of an open interval is unknown rather than proof of closure, and the Open Now filter is omitted.
5. The browser optionally obtains coordinates and calculates approximate Haversine distance only for pharmacies that have separately sourced coordinates.
6. The presentation layer renders exact status language, schedule times, call actions, and directions actions.

## Time handling

- Persist schedule boundaries as `timestamptz` instants.
- Use UTC in transport, logs, and tests.
- Interpret and display calendar days in `Europe/Nicosia`.
- Model overnight periods as one interval where `ends_at > starts_at`; do not split them at midnight unless a source requires it.
- Use half-open interval semantics, `[starts_at, ends_at)`, so adjacent periods do not overlap at their boundary.
- Keep intervals for the same pharmacy and `schedule_kind` non-overlapping. Ordinary and duty intervals may overlap each other; a mode change within the duty timeline uses adjacent duty intervals.
- Use an injected clock in domain tests so daylight-saving and boundary cases are deterministic.

## Distance and directions

The first slice uses a small pharmacy dataset, so Haversine distance in the browser is sufficient and avoids adding PostGIS. The result is straight-line distance and should be presented as approximate, not as travel distance. Directions are delegated to a mapping application/provider, which computes the route.

Official records currently have nullable coordinates. They remain visible without distance, and Directions uses the official address as its query. Future geocoding must be a separately attributed enrichment rather than a mutation presented as official source data.

If the dataset later expands nationally or server-side proximity queries become necessary, PostGIS can be evaluated then. It is not an MVP dependency.

## PWA and freshness

PWA-ready means the application can provide appropriate manifest metadata and a mobile install experience. It does not mean duty data is safely available offline. Schedule/API responses should be network-fresh or have a short, explicit freshness policy; the UI must not label stale cached data as current. Offline schedule caching and push notifications are deferred.

## Security and privacy

- No consumer authentication or personal profile data exists in the first slice.
- Location permission is optional, requested in context, and coordinates stay in the browser.
- Only public pharmacy and schedule fields are returned to the application.
- Anonymous roles receive only required `SELECT` privileges and matching RLS policies.
- Secret/service-role credentials are server-only and reserved for trusted operations.
- Environment-specific secrets are never committed.

## Verification strategy

- Unit tests cover CSV quoting and Greek text, source dates, identity normalization, malformed records, deterministic upsert preparation, interval boundaries, date-only duty derivation, Cyprus day boundaries, and distance calculations.
- Data-access tests cover day-window queries and inactive pharmacies.
- Database tests verify valid-pair constraints, allowed cross-kind overlaps, rejected same-kind overlaps, the date-only duty schema, grants, RLS allow/deny behavior, and indexes.
- A focused mobile browser test covers location granted/denied, Today/Tomorrow, filters, call, and directions.
- Visual checks use realistic narrow-screen sizes and accessible tap targets.

## Deferred architecture

Do not introduce a map SDK, PostGIS, authentication, a CMS/admin portal, queues, realtime subscriptions, analytics, notification infrastructure, or a generalized rule engine in the first slice. Add a boundary only when an accepted requirement needs it.
