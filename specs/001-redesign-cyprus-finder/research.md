# Research: Cyprus-wide Pharmacy Finder Redesign

## Decision 1: Enhance the current finder incrementally

**Decision**: Preserve `PharmacyFinder` as the interactive state owner and refine its existing
presentation. Extract only small presentational pieces that gain an independent semantic contract.

**Rationale**: The current working tree already implements most feature behavior and has focused test
coverage. An incremental approach minimizes regression risk and protects uncommitted user work.

**Alternatives considered**:

- Rebuild the finder from a blank component: rejected because it would duplicate working logic and
  increase the chance of losing privacy, status, search, and localization behavior.
- Introduce a new state library: rejected because current local state and memoized derivations are
  sufficient for one finder surface.

## Decision 2: Retain the current server/client boundary

**Decision**: Keep server-side data fetching in the locale page and browser interaction in the client
finder. Do not move database or schedule logic into presentation components.

**Rationale**: Next.js 16 guidance supports Server Components for source-near data access and Client
Components for state, event handlers, effects, and `navigator.geolocation`. The current boundary
already matches that model and the constitution.

**Alternatives considered**:

- Fetch pharmacy data from the client: rejected because it expands the client boundary and weakens the
  existing server-only data-access design.
- Move interactive district state to the server: rejected because tabs, filters, search, and optional
  location require immediate browser interaction and must not add network requests.

## Decision 3: Keep one loaded national dataset and district-first derivation

**Decision**: Continue deriving `districtPharmacies` first, then pharmacy search, availability filter,
distance calculation, sorting, counts, and visible results.

**Rationale**: This ordering already enforces the constitution's geographic integrity at current
scale and makes cross-district leakage testable without a new data/API contract.

**Alternatives considered**:

- Add a district parameter to the pharmacy data request: deferred because the current dataset is small
  and already loaded once; this would add network and caching complexity without user value.
- Maintain five independent finder states: rejected because duplicated filter/search state would be
  harder to reason about and test.

## Decision 4: Clear district-scoped manual origins on tab change

**Decision**: When the district changes, cancel pending manual lookup, clear suggestions and errors,
and clear an active manual origin. Retain an active GPS origin.

**Rationale**: A manual origin is selected from a district-filtered provider result and must not drive
distance in another district. GPS is independent of district and can truthfully measure straight-line
distance to the newly selected district.

**Alternatives considered**:

- Keep every origin: rejected because a previous-district manual match can produce confusing distance.
- Clear GPS too: rejected because it would discard explicit permission and violate the established
  view-independent origin behavior without a truth or privacy benefit.

## Decision 5: Use scrollable text tabs with semantic selected state

**Decision**: Keep five text-only district buttons in one horizontally scrollable mobile region, with
a non-color active indicator, visible focus, and an assistive-technology selected state.

**Rationale**: This meets the compact mobile requirement without adding icons that compete with
district names or invent geography symbolism. Local overflow preserves page width.

**Alternatives considered**:

- Icons plus labels: rejected by the specification and unnecessary for five known text labels.
- Dropdown-only district selection: rejected because it hides peer destinations and slows switching.
- Wrap tabs to multiple rows: rejected because it destabilizes header height and scan order.

## Decision 6: Use natural card height with structural consistency

**Decision**: Keep a shared card hierarchy and flexible action placement, but allow cards to grow with
addresses, translations, hours, conflicts, and safety notices. Never clamp critical content.

**Rationale**: Visual consistency comes from order, spacing, typography, and aligned actions—not a
fixed content box that can hide safety information.

**Alternatives considered**:

- Fixed card heights with line clamping: rejected because it violates critical-content visibility.
- Masonry layout: rejected because it harms scan order and keyboard predictability.

## Decision 7: Render status from existing domain outputs

**Decision**: Preserve the existing availability and official schedule evaluators. Presentation uses
their active periods and modes for ordinary, daytime duty, gap, night call-first, conflict, and unknown
states.

**Rationale**: The evaluators already encode source-bounded 23:00 summer and 22:00 winter transitions,
previous-day overnight coverage, and unsupported-date behavior.

**Alternatives considered**:

- Hard-code a universal 22:00–08:00 UI rule: rejected because it would misstate other supported
  profiles and unsupported dates.
- Materialize display intervals in storage: rejected by the constitution and data model.

## Decision 8: Keep localization typed and review RTL visually

**Decision**: Add presentation copy, if required, through the typed message interface and all four
dictionaries in one change. Continue using logical CSS properties and bidi isolation, plus explicit
Arabic visual review.

**Rationale**: Type parity prevents missing locale strings, while semantic RTL alone cannot catch
wrapping, icon order, action order, or mixed-script visual defects.

**Alternatives considered**:

- Reuse English strings in untranslated locales: rejected because safety meaning must be equivalent.
- Add direction-specific duplicate components: rejected because logical styling provides one testable
  structure with less drift.

## Decision 9: Do not add a map in this feature

**Decision**: Preserve the current list and any map/list experience found at implementation start, but
do not create a new map as part of the redesign.

**Rationale**: The current working tree has no in-app map or switcher, the product roadmap treats a map
as separate work, and the specification requires preservation rather than expansion.

**Alternatives considered**:

- Add a map now: rejected as out of scope and a source of geospatial, accessibility, and provider risk.
- Remove Directions because no map exists: rejected because Directions is a working user action.

## Decision 10: Separate feature regressions from snapshot debt

**Decision**: Require zero new failures in affected suites and record the four current geocoding
snapshot failures separately during full-suite runs.

**Rationale**: The failures are caused by registry/enrichment artifact drift outside this UI feature.
Fixing them here would broaden scope and risk changing provenance data.

**Alternatives considered**:

- Ignore the full suite: rejected because other regressions could be missed.
- Regenerate snapshots during the redesign: rejected because it is unrelated data work requiring its
  own review.

## Decision 11: Reconcile documentation selectively

**Decision**: Update active product/UI scope to Cyprus-wide while retaining Paphos-specific historical,
geocoding, and Places reconciliation facts where still accurate.

**Rationale**: Current guidance conflicts with the constitution, but broad replacement of the word
Paphos would erase valid provenance.

**Alternatives considered**:

- Leave documentation drift: rejected because future work would continue to receive contradictory
  instructions.
- Replace every Paphos reference: rejected because many references accurately describe source-limited
  enrichment.

## Open Clarifications

None. The specification, constitution, current implementation, and local Next.js guidance resolve the
planning decisions needed for this phase.
