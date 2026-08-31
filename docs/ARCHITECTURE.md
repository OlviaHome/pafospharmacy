# Architecture

## Goals

- Deliver the fastest useful mobile path to current pharmacy information.
- Keep availability rules testable and independent from React components.
- Preserve the distinction between open, on-duty, and on-call states end to end.
- Support future verified data ingestion without building that ingestion system now.
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
  └─ availability_intervals

Future trusted ingestion/admin process ────────────────► PostgreSQL
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

PostgreSQL is the source of truth for pharmacy details and explicit schedule intervals. Public clients never receive a secret/service-role key. Tables in an exposed schema use Row Level Security and least-privilege grants; anonymous access is read-only, and public writes are denied.

The application should explicitly configure any required Data API exposure rather than relying on project defaults. Trusted seed, ingestion, or administrative writes run only in a server-side or development context.

### Future ingestion

Official data import is a separate trusted boundary, not part of page rendering and not part of the first slice. Once an authoritative source is selected, ingestion should validate, normalize, record provenance, and publish availability intervals. Ordinary opening and official duty data may arrive separately and may overlap; ingestion must not split an ordinary interval merely because a duty interval overlaps it. It must reject overlaps within the same schedule kind and must not silently embed inferred legal rules.

## Request and calculation flow

1. The server determines the requested local-day window using the `Europe/Nicosia` IANA time zone and converts its boundaries to instants.
2. The data layer fetches active pharmacies and `availability_intervals` records that overlap that window.
3. At a given instant, the constraints permit at most one active ordinary interval and at most one active duty interval. The domain layer derives status across both:
   - **Open Now** is true if any active interval has `service_mode = open`;
   - **On Duty** is true if an active `schedule_kind = duty` interval exists;
   - **On Call** is true if the active duty interval has `service_mode = on_call`;
   - a duty interval with `service_mode = unknown` proves duty assignment but does not establish open or on-call mode;
   - an active `ordinary/open` interval independently proves Open Now, even when an overlapping duty interval is `on_call` or `unknown`.
4. For Today, the domain layer also evaluates the current instant. Tomorrow never receives an “open now” value.
5. The browser optionally obtains coordinates and calculates approximate Haversine distance against each pharmacy's coordinates.
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

- Unit tests cover interval boundaries, valid context/mode pairs, duty-mode transitions, cross-kind overlap derivation, unknown duty mode, overnight periods, Cyprus day boundaries, and distance calculations.
- Data-access tests cover day-window queries and inactive pharmacies.
- Database tests verify valid-pair constraints, allowed cross-kind overlaps, rejected same-kind overlaps, grants, RLS allow/deny behavior, and indexes.
- A focused mobile browser test covers location granted/denied, Today/Tomorrow, filters, call, and directions.
- Visual checks use realistic narrow-screen sizes and accessible tap targets.

## Deferred architecture

Do not introduce a map SDK, PostGIS, authentication, a CMS/admin portal, queues, realtime subscriptions, analytics, notification infrastructure, or a generalized rule engine in the first slice. Add a boundary only when an accepted requirement needs it.
