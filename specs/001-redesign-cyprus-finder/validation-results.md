# Cyprus-wide Pharmacy Finder Redesign Validation Results

**Baseline date**: 2026-11-04  
**Branch**: `main`  
**Commit**: `f6ea516e63aa1117caac9b7ced2f5d3b05f1a710`

## Preservation Rules

- The 25 modified tracked files listed below are the user's pre-existing redesign work.
- Do not reset, checkout, stash, discard, overwrite wholesale, or broadly reformat these changes.
- The pre-Spec-Kit tracked-file backup remains at `../pharmacy-before-speckit.patch` (205 KB).
- The Spec Kit backup remains at `/Users/olga/Desktop/pharmacy-speckit-untracked-backup-2026-11-04.tar.gz` (101 KB).
- Automated tests, deterministic browser checks, measurements, and screenshots are technical evidence
  only. They cannot establish the SC-002 task-time or SC-003 comprehension research outcomes.

## Initial Working Tree

```text
 M app/[locale]/layout.tsx
 M app/[locale]/page.tsx
 M app/api/location-search/route.test.ts
 M app/api/location-search/route.ts
 M app/globals.css
 M app/manifest.ts
 M components/information-page.tsx
 M components/localized-content-page.tsx
 M components/pharmacy-finder.test.tsx
 M components/pharmacy-finder.tsx
 M docs/ARCHITECTURE.md
 M docs/PRODUCT.md
 M lib/data/pharmacies.test.ts
 M lib/data/pharmacies.ts
 M lib/geocoding/geoapify.test.ts
 M lib/geocoding/geoapify.ts
 M lib/i18n/locales/ar.ts
 M lib/i18n/locales/el.ts
 M lib/i18n/locales/en.ts
 M lib/i18n/locales/ru.ts
 M lib/i18n/types.ts
 M lib/location/location-search-server.ts
 M lib/location/manual-search.test.ts
 M lib/location/manual-search.ts
 M public/icon.svg
?? .agents/
?? .specify/
?? specs/
```

## Initial Capability Inventory

- Five text-only district tabs and district-first list filtering.
- District totals, selected-day duty counts, pharmacy text search, and district-scoped manual search.
- Today/Tomorrow and All/Open Now/On Duty controls.
- Ordinary-open, duty-open, scheduled-gap, nighttime-call-first, conflict, and unknown states.
- Visible selected-day hours, official identity/address, Call, and Directions.
- English, Greek, Russian, and Arabic dictionaries with Arabic RTL and bidi isolation.
- Optional transient GPS/manual origins, approximate straight-line distance, and unknown-coordinate
  pharmacy retention.
- Progressive result reveal, legal/source navigation, and provider/source attribution.
- Cyprus Pharmacy header with About, Data Sources, and language selection.
- No in-app map or map/list switcher exists in the initial working tree.

## Implementation-Phase Technical Evidence

### Baseline commands

- `npm run typecheck`: **PASS**. Next route types generated and TypeScript completed with exit code 0.
- Focused command from `quickstart.md`: **PASS**, 4 files and 104/104 tests.
- `npm test`: **BASELINE PARTIAL PASS**, 22/24 files and 244/248 tests. The only failures are the
  four previously documented snapshot reconciliation tests:
  - `lib/geocoding/geoapify-snapshot.test.ts`: 2 failures.
  - `lib/geocoding/snapshot.test.ts`: 2 failures.
- No finder, district, location, route, localization, legal, status, hours, or distance test failed.
- Ignore-file verification: existing `.gitignore` and `eslint.config.mjs` cover the detected project;
  no Docker, publishing, Prettier, Terraform, or Helm ignore file is required.

### Next.js 16 implementation constraints

- `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md` confirms
  that finder state, event handlers, effects, `navigator.geolocation`, and `scrollIntoView` belong in
  the existing Client Component; server data loading should remain in the locale page.
- `node_modules/next/dist/docs/01-app/01-getting-started/11-css.md` confirms that global CSS imported
  by the root layout is supported. The card-grid change can stay scoped in `app/globals.css` without a
  new client boundary or style system.
- `node_modules/next/dist/docs/03-architecture/supported-browsers.md` defines the default floor as
  Chrome 111+, Edge 111+, Firefox 111+, and Safari 16.4+. DAC-011 must hold across this matrix.
- CSS subgrid/fallback behavior must be verified in browsers rather than inferred from DOM structure.
  Any supported-browser fallback must retain full content and the same 1 CSS-pixel alignment limit.

### Foundational characterization

- Added component coverage for located progressive reveal and explicit unsupported-schedule messaging.
- Expanded route characterization to all five districts for uncached, cached, empty, and provider-
  error paths; every cache key and provider request remains district-scoped.
- Existing data coverage already proves national loading, all five district values, active-only
  Supabase selection, and the absence of a runtime Paphos filter.
- Focused result: **PASS**, 3 files and 107/107 tests.

### User Story 1 — district integrity

- Added a five-district component matrix for membership, totals, selected-day duty counts, filters,
  retained text queries, summaries, and empty states.
- Added transition coverage proving that district changes cancel/ignore stale manual lookups, clear
  manual suggestions/errors/origins, preserve GPS origins, retain and re-scope raw pharmacy queries,
  and reset progressive reveal.
- Added route coverage for cached, uncached, empty, and provider-error behavior in every district.
- Focused result: **PASS**, 4 files and 124/124 tests.
- Live browser smoke result: **PASS** on 2026-11-04. Exactly one active text tab and a matching live
  summary were observed for all five districts: Nicosia 251/6 duty, Limassol 210/5, Larnaca 101/3,
  Famagusta 50/2, and Paphos 92/3. Counts reflect the current local fixture/runtime data and are
  recorded as scoping evidence, not immutable product constants.
- Baseline variance: none in affected district, finder, data, or location-search behavior.

### UX-014 / DAC-011 prerequisite gate

- **PASS before card-grid test or implementation work.** The finder UI contract supplies stable card,
  duty-panel, and hours-panel selectors, short/long official-address fixtures, all/mixed/no-duty rows,
  natural single-column behavior, collapsed all-empty duty tracks, and the 1 CSS-pixel
  `getBoundingClientRect().top` rule.
- The quickstart supplies the five acceptance widths, font-ready measurement procedure, visual-row
  grouping, English/Arabic screenshots, content-visibility checks, and technical-evidence labeling.
- The plan completes the prerequisite set with independent-row fixtures, no cross-row propagation,
  and the supported Chrome/Edge, Firefox, and WebKit/Safari browser-family matrix.

### User Story 2 — truthful card hierarchy and shared grid

- Added stable card, row, identity, duty, hours, proximity, and action selectors plus structural
  fixtures for all-duty, mixed-duty, no-duty, short/long address, independent-row, and natural DOM-order
  cases. The new fixtures failed before the markup/layout change and pass afterward.
- Implemented five intrinsic card tracks scoped to each adjacent pair. Modern engines use row subgrid;
  the Chrome 111–116 fallback uses the parent row tracks with a separate visual card surface. Neither
  path measures content in JavaScript, assigns fixed content heights, rewrites addresses, or truncates
  safety information.
- Component/status result: **PASS**, 61/61 tests. Typecheck: **PASS**.
- Available in-app Chromium-family browser, English and Arabic: **PASS** at 320, 375, 768, 1024,
  and 1440 CSS pixels. At every multi-column width, the maximum measured duty-panel and hours-panel
  top-edge differences were both **0 CSS pixels**. Phone widths used natural stacked flow, and empty
  duty regions measured 0 pixels. Multi-column live data covered all-duty, mixed-duty, and no-duty
  rows with official address lengths from 29 to 118 characters; all-empty rows had 0-pixel duty tracks.
  Document scroll width equaled viewport width in every EN/AR case, and the Arabic document remained
  `dir="rtl"`.
- Ten viewport screenshots (EN/AR × five widths) were captured during the browser run as technical
  visual evidence. They are not treated as user-comprehension evidence.
- **Outstanding T018 environment limit**: this host exposes only the in-app Chromium-family browser;
  Firefox and WebKit/Safari executables are not available. The cross-browser source fallback is in
  place, but T018 remains incomplete until its required Firefox and WebKit/Safari measurements run.

### User Story 3 — honest proximity

- **PASS**, 3 files and 72/72 tests. The matrix covers complete browsing without an origin, explicit
  GPS and manual origins, manual-origin removal on district change, GPS persistence across district,
  day, and filter changes, known-before-unknown ordering, and retention of pharmacies without usable
  coordinates.
- Distance appears only when both an origin and pharmacy coordinates are present. All four locales
  label it as approximate straight-line distance and warn that walking/driving routes may be longer.
- The calculation path accepts only coordinate pairs and calls `haversineDistanceKm`; no routing
  provider, road-distance value, speed assumption, or travel-time derivation exists in the finder.
- GPS remains transient client state and manual matches remain district-scoped; no persistence path was
  introduced.

### User Story 4 — responsive header and four-locale equivalence

- Added a shared `FinderHeader` used by both the live finder and truthful loading fallback. Cyprus
  Pharmacy identity, language selection, About, and Data Sources remain reachable at every width; the
  loading state exposes no stale district count or result implication.
- Added table-driven EN/EL/RU/AR coverage for district labels, summaries, statuses, hours, errors,
  Call/Directions, straight-line disclosure, RTL, and bidi-stable official/numeric values. No
  translation parity gap requiring new inferred schedule language was found.
- Typecheck: **PASS**. Focused header/finder/i18n result: **PASS**, 3 files and 78/78 tests.
- Available-browser responsive matrix: **PASS** for EN and AR at 320, 375, 768, 1024, and 1440 CSS
  pixels, plus EL/RU spot checks at 320 and 1440. Every case had 0 page-level horizontal overflow,
  exactly one active district tab, and the expected LTR/RTL document direction. EN/AR multi-column
  duty and hours drift remained 0 CSS pixels.
- Every visible primary control in the measured EN/AR matrix was at least 44 by 44 CSS pixels,
  including language selection, compact header links, district tabs, date/filter controls, manual
  search submission, location, and card actions. A 12-step phone-width keyboard sample reached the
  language selector, both information links, all five district tabs, date controls, and filters in
  logical order; every focused element matched `:focus-visible`.
- Source audit found no CyNightMeds assets, names, or copied implementation references. The product
  retains its independent Cyprus Pharmacy branding. These deterministic results remain technical
  conformance evidence only and do not prove SC-002 or SC-003.

### Pre-integration preservation re-audit

- Re-audit date: 2026-11-04. All **25/25** tracked files from the initial dirty-tree inventory remain
  modified in place; none was reset, checked out, stashed, or lost. The original patch and separate
  Spec Kit archive remain outside the repository at their recorded paths.
- The initial capability inventory remains present: five-district list/count/search scoping;
  Today/Tomorrow and availability filters; distinct regular/duty/gap/night/conflict/unknown states;
  visible hours and unchanged official identity/address; Call/Directions; four locales and RTL;
  transient GPS/manual proximity with honest straight-line disclosure; progressive reveal;
  legal/source navigation and attribution; and the Cyprus Pharmacy header.
- No in-app map or map/list switcher exists at this re-audit point. Google Maps remains an explicit
  outbound Directions action only, so there is no concurrent map experience to preserve or test.

### User Story 5 — preservation matrix

- **PASS**, 4 files and 148/148 tests across the finder, localized routing/header, legal/information
  pages, and district-scoped location-search route.
- Line-by-line comparison with the T001 and T028 inventories confirms district selection/list,
  Today/Tomorrow, All/Open Now/On Duty, text filtering, manual location, GPS, optional straight-line
  distance, known/unknown ordering, progressive reveal, Call, Directions, four-language selection,
  About/Privacy/Terms/Data Sources routes, official/provider attribution, and unavailable-data
  messaging remain implemented and covered.
- Added explicit legal-page regression coverage for the official directory, CC BY, regular-hours and
  duty-hours rules, OpenStreetMap, Geoapify, Google Maps, and localized return-to-finder navigation.
- No map/list feature existed in either inventory, and no such feature was removed. Unauthorized
  removals or preservation exceptions: **none**.

## Post-Implementation User-Research Targets

- **SC-002**: Pending representative participant research; no technical evidence is treated as proof
  of the 10-second target.
- **SC-003**: Pending representative participant research; no technical evidence is treated as proof
  of the 95% comprehension target.

### Documentation reconciliation and Constitution v1.1.0 gate

- **PASS — active scope.** `AGENTS.md`, Architecture, Data Model, Decisions, Roadmap, and Product now
  agree that Cyprus Pharmacy supports Nicosia, Limassol, Larnaca, Famagusta, and Paphos. The selected
  district scopes pharmacy lists, summary/duty counts, text results, and manual-location lookup, and
  district-bound manual search state is cleared on a switch.
- **PASS — historical/source-specific wording retained.** D-047 supersedes D-019 for UI scope and
  D-039 for the active name without rewriting either historical record. Remaining Paphos references
  describe the accurately bounded Nominatim/Geoapify/Google Places enrichment cohort, offline sync,
  current coordinate evidence, or unsupported per-pharmacy seasonal exception; they do not claim a
  Paphos-only finder. Map work remains a separate roadmap item.
- **PASS — truthful availability and distance.** Open, official duty, scheduled gaps, and overnight
  call-first remain distinct. Distance is derived only from coordinates, labeled approximate
  straight-line distance in all four locales, and never converted into road distance or travel time.
- **PASS — privacy and least privilege.** GPS/manual origins remain transient, GPS stays client-side,
  manual lookup remains server-proxied and district-scoped, and no new persistence or credential
  exposure was introduced.
- **PASS — provenance and source boundaries.** Official identity/address remain canonical;
  Paphos-specific coordinate enrichment stays separate and attributed; ambiguous/disputed provider
  matches remain excluded from trusted runtime fallback.
- **PASS — inclusive and testable behavior.** EN/EL/RU/AR and Arabic RTL retain equivalent safety
  meaning, browse-all remains complete within the selected district, unknown-coordinate records stay
  visible, and district/status/distance behavior remains covered at domain, data, route, component,
  and deterministic browser levels.
- Active Paphos-only UI contradictions found after reconciliation: **none**. The constitution's own
  Sync Impact Report intentionally preserves the conflicts identified before this implementation;
  it was not rewritten as part of the documentation tasks.

### Final automated quality gates

- `npm run typecheck`: **PASS** (exit 0; Next route types and TypeScript completed).
- `npm run lint`: **PASS** (exit 0; no ESLint findings).
- Focused finder/data/manual-location/route/i18n/legal command from `quickstart.md`: **PASS**, 6 files
  and **160/160** tests.
- `npm test`: **BASELINE PARTIAL PASS**, 22/24 files and **280/284** tests. The only failures remain the
  same four pre-implementation snapshot reconciliation tests: two in
  `lib/geocoding/geoapify-snapshot.test.ts` and two in `lib/geocoding/snapshot.test.ts`. Their stale
  90-record Paphos enrichment artifacts do not match the current 92-record official cohort. No new
  failure category appeared; all finder, district, location, route, localization, legal, status,
  hours, distance, accessibility, and card-structure tests passed.

### Final objective acceptance review

- **SC-001 and SC-009 — PASS:** five-district list/count/search/empty-state matrices and pending,
  suggested, errored, and selected-manual-origin transitions show zero cross-district leakage.
- **SC-004 and SC-005 — PASS:** the status matrix always exposes applicable hours/unavailable reasons,
  and every distance-bearing locale labels coordinate distance as approximate straight-line distance
  without route or duration inference.
- **SC-006 through SC-008 — PASS:** the no-login/no-location primary journey, four-locale equivalence,
  Arabic RTL, 320–1440 CSS-pixel responsive matrix, keyboard access, and 44-by-44 CSS-pixel primary
  controls passed deterministic checks.
- **SC-010 — PASS:** active project documentation now describes the Cyprus-wide UI; retained Paphos
  wording is historical or explicitly limited to sourced enrichment and seasonal evidence.
- **DAC-001 through DAC-010 — PASS:** five icon-free text tabs, non-color/assistive active state,
  dynamic summary without an updating line, visible untruncated card content, source-backed status
  transitions, 22:00 call-first wording, touch/keyboard access, Arabic composition, preservation, and
  independent visual identity all have recorded automated or browser evidence above.
- **DAC-011 — PARTIAL / ENVIRONMENT BLOCKER:** available Chromium evidence passes every required width,
  English and Arabic, mixed/all/no-duty rows, independent rows, natural phone flow, untruncated content,
  and a maximum measured duty/hours drift of **0 CSS pixels**. Firefox and WebKit/Safari executables are
  unavailable on this host, so the required every-supported-browser confirmation—and therefore T018
  and T038—cannot be completed honestly in this environment.
- **SC-002 and SC-003 — PENDING USER RESEARCH:** no automated test, screenshot, expert review, or
  geometry measurement is claimed as evidence of task speed or real-user status comprehension.
