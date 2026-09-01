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
  ├─ obtains optional device location or selects a manual search origin
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

Official Paphos addresses
              │
              ▼
One-time Nominatim batch ──► cached results + reconciliation report
              ├────────────► accepted coordinates merged at read time
              └────────────► optional provenance-only Supabase update

Unresolved Paphos addresses ──► one-time Geoapify batch ──► second cached report

Manual area/address ──► Next.js server-only route ──► Geoapify search
                    ◄── explicit Paphos match list ◄──┘
```

## Runtime boundaries

### Browser

The browser owns a neutral `searchOrigin`, client-side distance calculation, mobile interaction, and opening call/directions intents. An origin may be device GPS, a user-selected manual geocoder result, or absent. GPS is requested only after an explicit tap, is never persisted or sent to the application server, and a denial exposes manual search without retrying permission automatically. Manual queries go to the server-only location route and the selected coordinate remains in in-memory component state; neither GPS nor manual origins are written to the database, browser storage, or location history. No-origin browse mode remains a complete product path.

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

### Coordinate enrichment

Geocoding is a separate trusted batch boundary; it is not part of official CSV normalization and never runs during page rendering. The current Paphos batch uses the public OpenStreetMap Nominatim search service without credentials or billing. Its [usage policy](https://operations.osmfoundation.org/policies/nominatim/) permits a smaller one-time bulk task only with a single thread and machine, no more than one request per second, an identifying User-Agent, attribution, and locally cached results. The script therefore spaces requests by 1.1 seconds and checkpoints raw results after every pharmacy. It is not an interactive application API, autocomplete service, or approved recurring/national production geocoder.

The batch submits official street text, municipality/community, district, postal code when present, and Cyprus. The `countrycodes=cy` hard filter is combined with application checks for Cyprus, district geography, locality/postcode, street, and exact building or pharmacy-POI evidence. Nominatim does not expose a match-confidence score; `high` and `medium` are conservative application reconciliation grades. Road centroids, town centres, equal competing matches, and wrong-country/district candidates remain ambiguous and receive no coordinates.

The checked-in geocoding artifact retains the exact query, retrieval time, raw provider results, accepted OSM object identifier, reconciliation reasons, status, and report. The official snapshot remains unchanged. The snapshot data path merges only accepted enrichment by official registration number; the optional database writer updates only coordinate/provenance columns. Conversely, official directory upserts omit those columns so a later source refresh cannot erase enrichment.

Geoapify is the second provider for the 82 records not accepted by Nominatim and for interactive manual location search. `GEOAPIFY_API_KEY` stays server-only: the trusted batch loads it locally and the browser calls a no-store Next.js route rather than Geoapify directly. Requests are constrained to a Paphos rectangle and application reconciliation rejects non-Cyprus/non-Paphos results, centroids, non-pharmacy amenities, insufficient official-address evidence, competing candidates, and provider result identifiers reused for different official addresses. The cached artifact retains raw result/source attribution and match metadata. The free plan permits limited commercial use, storage of geocoded results, 3,000 daily credits, and 5 requests/second without a card, subject to Geoapify and underlying data attribution; usage must be monitored before material traffic growth.

The authoritative release is [Cyprus Pharmaceutical Services dataset 817](https://www.data.gov.cy/en/dataset/817), including its attached 2026 private-pharmacy directory and five May–September 2026 district rota CSVs. The older [private-pharmacies dataset 815](https://www.data.gov.cy/en/dataset/815) is retained only as research context because its published resource is labelled 2024–2025. All imported resources are CC BY 4.0. Exact resource URLs and coverage are versioned in `lib/ingestion/official-sources.ts` and copied into snapshot metadata and row provenance.

## Request and calculation flow

1. The server determines Today/Tomorrow using the `Europe/Nicosia` IANA time zone.
2. The data layer fetches active Paphos pharmacies, timed intervals overlapping the window, and date-only duty assignments for its local dates. Without configured Supabase credentials it maps the checked-in official snapshot and accepted Paphos geocoding artifact through the same domain shape.
3. At a given instant, the domain layer derives status across timed and date-only facts:
   - **Open Now** is true if any active interval has `service_mode = open`;
   - **On Duty** is true if an active timed duty interval exists or an official assignment exists for the local date;
   - **On Call** is true if the active duty interval has `service_mode = on_call`;
   - a duty interval with `service_mode = unknown` proves duty assignment but does not establish open or on-call mode;
   - a date-only assignment has no service mode and cannot establish Open Now or On Call;
   - an active `ordinary/open` interval independently proves Open Now, even when an overlapping duty interval is `on_call` or `unknown`.
4. When no complete ordinary-hours source exists, absence of an open interval is unknown rather than proof of closure, and the Open Now filter is omitted.
5. The browser optionally obtains GPS or asks the server-only Geoapify route for Paphos manual-location suggestions. Choosing a suggestion replaces the prior `searchOrigin`; clearing it returns to no-origin mode.
6. For any origin, the browser calculates approximate Haversine distance only for pharmacies with accepted, separately attributed coordinates. Known distances sort nearest-first; unknown distances remain visible after them.
7. The normal located All view initially shows the nearest 10 results and can reveal the complete set. On Duty is never truncated, and lack of an origin preserves the full existing list.
8. The presentation layer renders exact status language, schedule times, call actions, and directions actions. Directions prefers accepted coordinates while the card continues to display the official address.

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

Official records have nullable coordinates. Of the current 90 Paphos records, 8 retain conservatively accepted Nominatim enrichment and 20 have separately accepted Geoapify enrichment, for 28 trusted coordinate pairs (31.1%). Every other pharmacy remains visible without distance and uses its official address for Directions. Distance is formatted in metres below 1 km and to one decimal kilometre otherwise. The UI attributes both providers and never presents coordinates as official Cyprus Pharmaceutical Services fields.

If the dataset later expands nationally or server-side proximity queries become necessary, PostGIS can be evaluated then. It is not an MVP dependency.

## PWA and freshness

PWA-ready means the application can provide appropriate manifest metadata and a mobile install experience. It does not mean duty data is safely available offline. Schedule/API responses should be network-fresh or have a short, explicit freshness policy; the UI must not label stale cached data as current. Offline schedule caching and push notifications are deferred.

## Security and privacy

- No consumer authentication or personal profile data exists in the first slice.
- Location permission is optional, requested in context, and denied permission falls back to manual search or browse-all.
- Precise GPS is never sent to the server or persisted. Manual queries necessarily go to Geoapify through a no-store server route, but the selected origin is not stored.
- `GEOAPIFY_API_KEY` is server-only and is never prefixed with `NEXT_PUBLIC_`.
- Only public pharmacy and schedule fields are returned to the application.
- Anonymous roles receive only required `SELECT` privileges and matching RLS policies.
- Secret/service-role credentials are server-only and reserved for trusted operations.
- Environment-specific secrets are never committed.

## Verification strategy

- Unit tests cover CSV quoting and Greek text, source dates, identity normalization, malformed records, deterministic upsert preparation, interval boundaries, date-only duty derivation, Cyprus day boundaries, GPS/manual/no-origin state, denied-location fallback, distance calculations, known/unknown distance ordering, progressive limits, manual result handling, and two-provider geocoder reconciliation.
- Data-access tests cover day-window queries and inactive pharmacies.
- Database tests verify valid-pair constraints, allowed cross-kind overlaps, rejected same-kind overlaps, the date-only duty schema, grants, RLS allow/deny behavior, and indexes.
- A focused mobile browser test covers location granted/denied, Today/Tomorrow, filters, call, and directions.
- Visual checks use realistic narrow-screen sizes and accessible tap targets.

## Deferred architecture

Do not introduce a map SDK, PostGIS, authentication, a CMS/admin portal, queues, realtime subscriptions, analytics, notification infrastructure, or a generalized rule engine in the first slice. Add a boundary only when an accepted requirement needs it.
