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
  ├─ domain: time-window, versioned duty rules, status, filtering, and distance
  └─ data access: server-only Supabase repository/modules
              │
              ▼
Supabase / PostgreSQL
  ├─ pharmacies
  ├─ availability_intervals (trustworthy timed facts only)
  ├─ duty_assignments (official date-only rota facts)
  └─ pharmacy_google_places (durable links + expiring exact coordinates)

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

Official Paphos identity + phone ──► Google Places API (New) reconciliation
                                 ├─► durable Place ID/classification links
                                 └─► 30-day exact-coordinate cache

Manual area/address ──► Next.js server-only route ──► Geoapify search
                    ◄── explicit Paphos match list ◄──┘
```

## Runtime boundaries

### Browser

The browser owns a neutral `searchOrigin`, client-side distance calculation, mobile interaction, and opening call/directions intents. An origin may be device GPS, a user-selected manual geocoder result, or absent. GPS is requested only after an explicit tap, is never persisted or sent to the application server, and a denial exposes manual search without retrying permission automatically. The active origin is view-independent: All/On Duty and Today/Tomorrow transitions preserve it and never invoke geolocation again. Manual search is explicitly submitted rather than autocomplete: typing alone makes no request. Submissions require at least three normalized characters, wait 400 milliseconds, cancel stale work, reuse identical normalized queries from an in-memory session cache, and request at most three suggestions. Queries go to the server-only location route and the selected coordinate remains in in-memory component state; neither GPS nor manual origins are written to the database, browser storage, or location history. No-origin browse mode remains a complete product path.

### Next.js application

Next.js is the application-facing read boundary. Data access lives in server-only modules rather than presentation components. A small domain layer contains pure, testable functions for:

- determining whether an interval contains an instant;
- determining whether an interval overlaps Today or Tomorrow;
- deriving open, on-duty, and on-call meaning across the independent ordinary and duty timelines;
- filtering and sorting results;
- calculating approximate straight-line distance.

React components receive display-ready domain values and do not recreate schedule rules.

### Supabase/PostgreSQL

PostgreSQL is the production source of truth for pharmacy details, explicit timed intervals, date-only duty assignments, and the current expiring Google Places coordinate cache. Public clients never receive a secret/service-role key. Tables in an exposed schema use Row Level Security and least-privilege grants; anonymous access is read-only, and public writes are denied. Public Data API roles receive column-level pharmacy `SELECT` grants rather than broad table-level `SELECT`; official House Tel. source fields remain available to privileged ingestion but are not readable through the public runtime roles. The Places table exposes only unexpired exact-match coordinates for active pharmacies; probable, ambiguous, no-match, and expired rows remain unavailable to public clients. Durable Place IDs, classifications, and matching evidence remain server-managed, while Google display names, formatted addresses, and phones are constrained to null.

The application should explicitly configure any required Data API exposure rather than relying on project defaults. Trusted seed, ingestion, or administrative writes run only in a server-side or development context.

For local development and tests only, the server-only data module reads the checked-in normalized official snapshot when both Supabase environment variables are absent. The snapshot contains every imported district, while the repository selects Paphos for the current UI. Production requires `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`; missing or partial configuration and failed configured reads are errors rather than silent fallback, so a production data outage cannot be disguised. The runtime never reads `SUPABASE_SECRET_KEY`.

### Official ingestion

Official data import is a separate trusted boundary and never runs during page rendering. The script downloads the exact Cyprus Open Data CSV resources, parses quoted/Greek content, validates required fields and dates, normalizes phones and registration identity, preserves provenance, produces a deterministic-shape snapshot, and can optionally upsert to Supabase in batches.

The current CSV resources establish pharmacy-directory facts and date-only rota assignments. They do not establish ordinary hours, exact duty hours, open/on-call mode, or coordinates. The importer therefore writes `pharmacies` and `duty_assignments` only; it does not manufacture `availability_intervals`. A separate cited Cyprus Pharmaceutical Services notice establishes a fixed May–September 2026 duty-hours profile. The domain layer may combine that profile with an assignment at runtime, but the importer and database row remain date-only. Unexpected records are reported rather than silently discarded. Stable registration numbers and source record identifiers make reruns idempotent. Multi-number house-phone fields retain both their exact decoded source value and every distinct valid normalized number; no number is promoted to the singular convenience field without an unambiguous source value. These House Tel. fields remain in the official snapshot and privileged database model for provenance, but the runtime repository deliberately omits them from its public domain object and client serialization. The Call action continues to use only the separately published pharmacy telephone.

### Coordinate enrichment

Geocoding is a separate trusted batch boundary; it is not part of official CSV normalization and never runs during page rendering. The current Paphos batch uses the public OpenStreetMap Nominatim search service without credentials or billing. Its [usage policy](https://operations.osmfoundation.org/policies/nominatim/) permits a smaller one-time bulk task only with a single thread and machine, no more than one request per second, an identifying User-Agent, attribution, and locally cached results. The script therefore spaces requests by 1.1 seconds and checkpoints raw results after every pharmacy. It is not an interactive application API, autocomplete service, or approved recurring/national production geocoder.

The batch submits official street text, municipality/community, district, postal code when present, and Cyprus. The `countrycodes=cy` hard filter is combined with application checks for Cyprus, district geography, locality/postcode, street, and exact building or pharmacy-POI evidence. Nominatim does not expose a match-confidence score; `high` and `medium` are conservative application reconciliation grades. Road centroids, town centres, equal competing matches, and wrong-country/district candidates remain ambiguous and receive no coordinates.

The checked-in geocoding artifact retains the exact query, retrieval time, raw provider results, accepted OSM object identifier, reconciliation reasons, status, and report. The official snapshot remains unchanged. The snapshot data path merges accepted enrichment by official registration number only when it is not quarantined by later cross-provider review; the optional database writer updates only coordinate/provenance columns. Conversely, official directory upserts omit those columns so a later source refresh cannot erase enrichment.

Geoapify is the second provider for the 82 records not accepted by Nominatim and for interactive manual location search. `GEOAPIFY_API_KEY` stays server-only: the trusted batch loads it locally and the browser calls a no-store Next.js route rather than Geoapify directly. The route accepts POST JSON only, reads at most 1 KiB, requires exactly one string query, normalizes it with NFKC/trim/collapsed whitespace, enforces the 3–120-character range, and uses Origin and Fetch Metadata only as browser defense in depth. It caps both the provider request and returned sanitized list at the three suggestions the UI can display and returns generic upstream errors. A normalized query is checked against Vercel Runtime Cache before any provider-budget operation; successful sanitized results remain in that shared cache for five minutes, so cache hits consume neither the Firewall bucket nor Geoapify quota. Only a cache miss with available provider configuration checks the constant-key `paphos-location-search` through the single `@vercel/firewall` rule before calling Geoapify. The temporary Hobby configuration is a fixed 60-second window allowing two provider-bound misses; exhaustion returns 429 without contacting Geoapify, and a missing production Firewall rule fails closed. This distributed enforcement is not replaced by process memory. Requests are constrained to a Paphos rectangle and application reconciliation rejects non-Cyprus/non-Paphos results, centroids, non-pharmacy amenities, insufficient official-address evidence, competing candidates, and provider result identifiers reused for different official addresses. The cached artifact retains raw result/source attribution and match metadata. The free plan permits limited commercial use, storage of geocoded results, 3,000 daily credits, and 5 requests/second without a card, subject to Geoapify and underlying data attribution; usage must be monitored before material traffic growth.

Google Places API (New) is the preferred business-identity/location layer for Paphos exact matches. The batch queries normalized official phone first and uses official address, postcode, locality, and Paphos geography as verification; pharmacist/business name is secondary and can never establish a match by itself. It requests only Place ID, display name, formatted address, location, and phone needed for identity verification. Cross-record duplicate exact Place IDs are downgraded to ambiguous.

Official registration number remains canonical. The durable checked-in artifact keeps registration-to-Place-ID links, classifications, evidence, and comparison metadata but no Google-returned content or coordinates. Google name, address, and phone used during matching live only in the ignored local cache and are never written to Supabase. Only exact-match latitude/longitude may be copied into `pharmacy_google_places`; those coordinates are refreshed from day 25 and must be refreshed or cleared by day 30. The database enforces exact-only coordinates and the maximum expiry, while RLS and runtime checks reject stale coordinates. Existing Nominatim/Geoapify artifacts remain comparison evidence, but the seven fallbacks that disagree with an exact Google location by more than 250 m are not persisted or used automatically until manual verification.

The offline `scripts/sync-geocoding-snapshots.ts` command is the only preparation path for copying the existing Paphos artifacts without contacting a geocoder. It defaults to dry-run, validates the complete 90-registration set and provider agreement, produces the 16-record manual-review report, excludes the seven disputed fallback coordinates, and requires `--write-supabase` before constructing a privileged client. Its 21 pharmacy updates are restricted to the six coordinate/provenance columns; official name, address, phone, and registration are never in an update payload. Material provider disagreement is review evidence, not an address correction.

### Ordinary opening-hours research

Direct Places API opening-hours content is not an approved ordinary-hours source for this EEA-billed product. Places UI Kit is the preferred Google proof-of-concept because the EEA Places API permitted-use and no-use-with-any-map restrictions do not apply to the kit, provided its attribution, links, and notices remain intact. An Essentials Place Details element can be configured by an existing exact Place ID to render only Google-managed open-now/opening-hours content inside an official pharmacy card; Google content remains visually and logically separate from the official Cyprus identity. The JavaScript UI Kit is currently experimental/pre-GA, so production adoption must retain a graceful “hours unavailable” fallback and be rechecked against current terms and component stability.

The widget is a presentation boundary, not an application data source. Its public API exposes the rendered place's ID/location/viewport and load/error events, but not opening status as structured output. Place Search's `isOpenNow` option filters a new Google search, not this application's known official Place-ID set. Therefore the application must not inspect widget text or shadow DOM, persist its content, or use it to drive the custom opening filter. The current filter is temporarily labelled **Confirmed Open** and remains the union of trustworthy application-owned open facts—currently the official duty-open evaluator because ordinary coverage is absent. A future UI Kit experiment should instantiate details lazily for an exact-match card only after explicit user action, preserving the official list and avoiding 81 homepage requests.

The authoritative release is [Cyprus Pharmaceutical Services dataset 817](https://www.data.gov.cy/en/dataset/817), including its attached 2026 private-pharmacy directory and five May–September 2026 district rota CSVs. The older [private-pharmacies dataset 815](https://www.data.gov.cy/en/dataset/815) is retained only as research context because its published resource is labelled 2024–2025. All imported resources are CC BY 4.0. Exact resource URLs and coverage are versioned in `lib/ingestion/official-sources.ts` and copied into snapshot metadata and row provenance.

## Request and calculation flow

1. The server determines Today/Tomorrow using the `Europe/Nicosia` IANA time zone.
2. The data layer fetches active Paphos pharmacies, timed intervals overlapping the window, date-only duty assignments from the previous local date through Tomorrow (the previous date is needed only for overnight coverage), and any fresh exact Google cache rows. Only in local development and tests, when both Supabase settings are absent, it maps the checked-in official snapshot, durable Google Place links, the ignored fresh local Google cache when present, and existing accepted Paphos geocoding artifacts through the same domain shape. Production has no snapshot fallback.
3. At a given instant, the domain layer derives status across timed, date-only, and versioned official-rule facts:
   - **Open Now** is true if any active interval has `service_mode = open` or a supported official assignment is inside the notice's mandatory duty-open period;
   - **On Duty** is true if an active timed duty interval exists or an official assignment exists for the local date;
   - **On Call** is true if the active duty interval has `service_mode = on_call` or the supported previous/current assignment is inside the notice's 23:00–08:00 phone period;
   - a duty interval with `service_mode = unknown` proves duty assignment but does not establish open or on-call mode;
   - a date-only assignment has no service mode; only its combination with the separately sourced, date-bounded official notice can derive the transient duty mode;
   - an active `ordinary/open` interval independently proves Open Now, even when an overlapping duty interval is `on_call` or `unknown`.
4. When no complete ordinary-hours source exists, absence of an ordinary open fact is unknown rather than proof of closure. During supported official duty-rule coverage, the filter remains available under the temporary **Confirmed Open** label and is explicitly described as the confirmed duty-open subset rather than a complete ordinary-hours result.
5. The browser optionally obtains GPS or asks the server-only Geoapify route for Paphos manual-location suggestions. Choosing a suggestion replaces the prior `searchOrigin`; clearing it returns to no-origin mode.
6. For any origin and availability filter, including On Duty, the browser calculates approximate Haversine distance only for pharmacies with accepted, separately attributed coordinates. Fresh exact Google coordinates take precedence; otherwise existing accepted Geoapify/Nominatim coordinates remain available. The official address string is never re-geocoded when a trusted coordinate exists. Known distances sort nearest-first within that verified-coordinate subset; this is not a claim that they are globally nearest among all 90 pharmacies. Unknown distances remain visible after them. Device-to-device distance differences may reflect different GPS fixes, not different pharmacy coordinates.
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
- The supported official duty profile is `cyprus-duty-2026-may-september`: Mon/Tue/Thu/Fri 13:30–16:00 and 19:30–23:00; Wed/Sat 13:30–23:00; Sunday and the notice holidays (1 May, 1 June, 15 August) 08:00–23:00; then phone availability for prescriptions until 08:00. It applies only to assignment dates from 1 May through 30 September 2026, with the final overnight period allowed to finish on 1 October.
- General statutory hours never establish that an individual pharmacy is physically open. They are not ordinary-hours input, including for seasonal pharmacies excepted from 2026.

## Distance and directions

The first slice uses a small pharmacy dataset, so Haversine distance in the browser is sufficient and avoids adding PostGIS. The result is straight-line distance and should be presented as approximate, not as travel distance. Directions are delegated to a mapping application/provider, which computes the route.

Official records have nullable coordinates, and their textual addresses are preserved source facts—not automatically verified physical locations. The current Google reconciliation has 81 fresh exact matches (90.0%). Together with separately accepted fallback enrichment for 3 non-exact cases, the current runtime has 84 coordinate destinations; the other 6 pharmacies remain visible without distance and use an address-only Directions fallback. The trusted fallback set contains 21 records: 18 overlap exact Google matches and 3 extend coverage. If Google becomes unavailable or expires completely, coverage therefore falls safely to 21—not 28—because seven disputed Geoapify coordinates remain quarantined. Directions and distance use fresh exact Google coordinates first, then trusted persisted Geoapify/Nominatim coordinates, and never re-geocode the official string when either exists. The UI explicitly says distance is available only for verified map coordinates and does not describe that partial ordering as globally nearest. Distance is formatted in metres below 1 km and to one decimal kilometre otherwise. The UI attributes every active provider and never presents coordinates as official Cyprus Pharmaceutical Services fields.

If the dataset later expands nationally or server-side proximity queries become necessary, PostGIS can be evaluated then. It is not an MVP dependency.

## PWA and freshness

PWA-ready means the application can provide appropriate manifest metadata and a mobile install experience. It does not mean duty data is safely available offline. Schedule/API responses should be network-fresh or have a short, explicit freshness policy; the UI must not label stale cached data as current. Offline schedule caching and push notifications are deferred.

## Security and privacy

- No consumer authentication or personal profile data exists in the first slice.
- Location permission is optional, requested in context, and denied permission falls back to manual search or browse-all.
- Precise GPS is never sent to the server or persisted. Manual queries necessarily go to Geoapify through a no-store server route, but the selected origin is not stored.
- `GEOAPIFY_API_KEY` is server-only and is never prefixed with `NEXT_PUBLIC_`.
- `GOOGLE_PLACES_API_KEY` is server-only and is used only by the trusted reconciliation/refresh script.
- Only public pharmacy and schedule fields are returned to the application. House Tel. source fields are retained for privileged ingestion/provenance but are omitted from runtime queries, domain objects, client serialization, and anonymous/authenticated column grants.
- Anonymous roles receive only required `SELECT` privileges and matching RLS policies.
- Secret/service-role credentials are server-only and reserved for trusted operations.
- Environment-specific secrets are never committed.

## Verification strategy

- Unit tests cover CSV quoting and Greek text, source dates, identity normalization, malformed records, deterministic upsert preparation, interval boundaries, date-only duty derivation, Cyprus day boundaries, GPS/manual/no-origin state, origin persistence across filter/day changes, no repeated permission request, duty-distance ordering, denied-location fallback, distance calculations, known/unknown distance ordering, progressive limits, strict manual-search request parsing/body/origin controls, shared manual-query caching and provider-budget outcomes, manual result handling, public House Tel. omission, phone-first Places classification, duplicate Place IDs, disputed-fallback quarantine, and 30-day cache trust/purge boundaries.
- Data-access tests cover Paphos/day-window Supabase queries, runtime coordinate priority, disputed-fallback rejection, and production fail-closed behavior.
- Database tests verify valid-pair constraints, allowed cross-kind overlaps, rejected same-kind overlaps, the date-only duty schema, grants, RLS allow/deny behavior, and indexes.
- A focused mobile browser test covers location granted/denied, Today/Tomorrow, filters, call, and directions.
- Visual checks use realistic narrow-screen sizes and accessible tap targets.

## Deferred architecture

Do not introduce a map SDK, PostGIS, authentication, a CMS/admin portal, queues, realtime subscriptions, analytics, cloud refresh scheduling, notification infrastructure, or a generalized rule engine in the first slice. Add a boundary only when an accepted requirement needs it.
