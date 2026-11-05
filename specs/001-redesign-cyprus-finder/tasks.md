---

description: "Dependency-ordered implementation tasks for the Cyprus-wide Pharmacy Finder redesign"
---

# Tasks: Cyprus-wide Pharmacy Finder Redesign

**Input**: Design documents from `specs/001-redesign-cyprus-finder/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`,
`contracts/finder-ui-contract.md`, `quickstart.md`, Constitution v1.1.0

**Tests**: Required because the specification and constitution require five-district, safety-state,
localization, responsive, privacy, and regression validation. Automated results, deterministic browser
checks, and screenshots are technical conformance evidence only; they MUST NOT be reported as proof of
the post-implementation SC-002 task-time or SC-003 status-comprehension research targets.

**Organization**: Remaining work is grouped by user story. Existing functionality is inventoried
separately and protected by characterization tests rather than scheduled for reimplementation.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel after its phase prerequisites because it touches different files and
  does not depend on another incomplete task in the same phase.
- **[Story]**: Maps the task to a user story from `spec.md`.
- Every task names the file or files it changes or records results in.

## Already Implemented — Preserve, Do Not Rebuild

The current working tree already provides these baseline capabilities:

- five text-only district tabs and district-first pharmacy filtering;
- district-specific lists, total counts, duty counts, pharmacy search, and manual-search requests;
- the Cyprus Pharmacy live header, service links, and language selector;
- Today/Tomorrow and All/Open Now/On Duty controls;
- visible selected-day hours, official identity/address, Call, and Directions on pharmacy cards;
- distinct ordinary-open, daytime-duty, scheduled-gap, nighttime-call-first, conflict, and unknown
  domain outputs, including supported 23:00 summer and 22:00 winter transitions;
- English, Greek, Russian, and Arabic dictionaries, Arabic page RTL, and bidi isolation;
- optional transient GPS/manual origins, trusted-coordinate-only straight-line distance, and retention
  of pharmacies without coordinates;
- progressive result reveal, legal/source navigation, and source/provider attribution; and
- server-side national data loading with pure domain rules and no account requirement.

These behaviors are the preservation baseline. Tasks below may refine their presentation or close a
verified gap, but MUST NOT replace their data contracts, schedule semantics, privacy boundaries, or
working user paths.

## Remaining Work Overview

1. Freeze and characterize the current dirty-tree baseline.
2. Fix district-switch leakage for pending/manual search state while preserving GPS state.
3. Implement UX-014/DAC-011 using a row-scoped shared internal card grid.
4. Finish mobile-first, header, accessibility, touch-target, and RTL refinements.
5. Validate all five districts, four locales, safety states, distance truthfulness, and preserved paths.
6. Reconcile active Paphos-only product/UI documentation without erasing accurate Paphos-specific
   enrichment history.

---

## Phase 1: Setup — Freeze the Preservation Baseline

**Purpose**: Protect the user's uncommitted work and establish the exact behavior and failure baseline
before any implementation task begins.

- [X] T001 Create `specs/001-redesign-cyprus-finder/validation-results.md` with separate implementation-phase technical evidence and post-implementation user-research sections; record `git status --short`, the current commit/branch, the working list/search/filter/location/Call/Directions/legal/attribution capabilities, and whether a map or map/list switcher exists; explicitly state that uncommitted files must not be reset, checked out, or broadly reformatted and that SC-002/SC-003 cannot be passed by automated tests or screenshots.
- [X] T002 Run the baseline commands from `specs/001-redesign-cyprus-finder/quickstart.md` and record exact typecheck, focused-suite, and full-suite results in `specs/001-redesign-cyprus-finder/validation-results.md`, separating the four known geocoding snapshot failures from redesign regressions.

**Checkpoint**: The preservation inventory and test baseline are reviewable before code changes.

---

## Phase 2: Foundational — Characterize Shared Boundaries

**Purpose**: Add regression protection for behavior shared by all stories before closing individual
gaps.

**CRITICAL**: Complete this phase before any user-story implementation.

- [X] T003 Review the installed Next.js 16 guidance under `node_modules/next/dist/docs/` for Client Components, responsive styling, and supported CSS behavior, then record constraints relevant to the finder and CSS subgrid/fallback approach in `specs/001-redesign-cyprus-finder/validation-results.md`.
- [X] T004 [P] Extend preservation characterization in `components/pharmacy-finder.test.tsx` for Today/Tomorrow, All/Open Now/On Duty, pharmacy text filtering, manual location, GPS, progressive reveal, Call, Directions, unknown-data messaging, attribution, and straight-line disclosure, adding only coverage missing from the current suite.
- [X] T005 [P] Extend shared data and route characterization in `lib/data/pharmacies.test.ts` and `app/api/location-search/route.test.ts` to prove national loading, supported-district validation, district-keyed cache isolation, and same-district sanitized suggestions without changing their runtime contracts.

**Checkpoint**: Existing behavior is protected and the implementation constraints are documented.

---

## Phase 3: User Story 1 — Choose a District and See Only Its Pharmacies (Priority: P1) 🎯 MVP

**Goal**: Guarantee five-district list/count/search integrity and eliminate stale manual-search state
when switching districts.

**Independent Test**: Select every district against distinct fixtures and verify its list, total count,
duty count, pharmacy search, manual request, empty state, and summary contain only that district. Switch
districts while manual search is pending, showing suggestions/errors, and holding a manual origin;
confirm all former-district state and distance disappear while an active GPS origin remains.

### Tests for User Story 1

- [X] T006 [US1] Add a five-district component matrix in `components/pharmacy-finder.test.tsx` covering list membership, total count, selected-day duty count, All/Open Now/On Duty filtering, retained pharmacy query re-evaluation, summary updates, and district-specific empty states for Nicosia, Limassol, Larnaca, Famagusta, and Paphos.
- [X] T007 [US1] Add failing district-transition tests in `components/pharmacy-finder.test.tsx` for pending manual lookup cancellation, stale promise completion, visible suggestions, error state, selected manual origin/distance, retained raw query, progressive reveal reset, and GPS-origin preservation.
- [X] T008 [P] [US1] Expand `app/api/location-search/route.test.ts` with table-driven requests for all five supported districts, proving normalized cache keys and returned suggestions never cross district scope in cached, uncached, empty, and error responses.

### Implementation for User Story 1

- [X] T009 [US1] Update `chooseDistrict` and related manual-lookup completion guards in `components/pharmacy-finder.tsx` to cancel pending lookup, clear suggestions/errors, clear only a manual `searchOrigin`, preserve a GPS origin, reset progressive reveal, and re-evaluate retained query text only against the newly selected district.
- [X] T010 [US1] Strengthen district-tab and summary behavior in `components/pharmacy-finder.tsx` so exactly one text-only tab has programmatic and non-color visual selection, the active tab is brought into the local mobile scroll region, and district/date/total/duty values update as one summary without an `updating...` line.
- [X] T011 [US1] Run the User Story 1 focused tests and five-district manual matrix from `specs/001-redesign-cyprus-finder/quickstart.md`, then record results and any baseline variance in `specs/001-redesign-cyprus-finder/validation-results.md`.

**Checkpoint**: Geographic integrity and district-switch search-state isolation pass independently.

---

## Phase 4: User Story 2 — Understand Whether a Pharmacy Can Be Used Now (Priority: P1)

**Goal**: Preserve truthful status/hours semantics while implementing UX-014 and DAC-011 for aligned,
scan-friendly cards that never hide safety information.

**Independent Test**: Render ordinary-open, ordinary-closed, daytime-duty, scheduled-gap,
nighttime-call-first, conflict, unsupported, and Tomorrow cards with short/long names and addresses.
In every supported browser, each multi-column visual row keeps duty-panel top edges that exist and all
opening-hours-panel top edges within 1 CSS pixel. All-empty duty rows reserve no duty space, independent
rows do not share track sizing, single-column cards use natural flow without artificial gaps, and no
address or safety-critical content is truncated or altered.

### UX-014 / DAC-011 Contract Gate for User Story 2

- [X] T012 [US2] Verify that `specs/001-redesign-cyprus-finder/contracts/finder-ui-contract.md`, `specs/001-redesign-cyprus-finder/quickstart.md`, and the supported-browser matrix in `specs/001-redesign-cyprus-finder/plan.md` define the finalized UX-014/DAC-011 prerequisites before test or code changes: stable card/duty/hours selectors, short/long-address all-duty/mixed-duty/no-duty and independent-row fixtures, row-scoped and natural single-column behavior, zero duty space for all-empty rows, `getBoundingClientRect().top` measurements with a maximum 1 CSS-pixel within-row difference, all five acceptance widths, every supported browser family, and English/Arabic screenshots; record the gate result in `specs/001-redesign-cyprus-finder/validation-results.md` and do not start T013–T018 until it passes.

### Tests for User Story 2

- [X] T013 [US2] Extend the objective technical status matrix in `components/pharmacy-finder.test.tsx` for ordinary open/closed, daytime duty-open, scheduled duty gap, 23:00 summer and 22:00 winter call-first transitions, previous-day overnight carry, conflict, unsupported date, and Tomorrow, asserting the expected localized primary state, applicable guidance, visible hours or unavailable reason, non-color semantics, and no false physical-opening claim; treat the results as DAC-005 interface-conformance evidence, not proof of SC-003 participant comprehension.
- [X] T014 [US2] Add shared-grid fixtures and structural assertions in `components/pharmacy-finder.test.tsx` for adjacent cards with short/long names and addresses, rows where all, some, or no cards have duty guidance, at least two unrelated rows with different content heights, and single-column ordering; assert identifiable identity, optional duty, hours, distance, and action regions, no fabricated duty copy or all-empty duty spacer, no cross-row grouping, unchanged untruncated official addresses, and complete safety-critical content.

### Implementation for User Story 2

- [X] T015 [US2] Refactor only the presentation markup inside `components/pharmacy-finder.tsx` into stable semantic card regions for status/identity, optional duty or conflict guidance, opening hours, proximity, and actions while retaining the existing domain derivations, official address string, links, and localized messages.
- [X] T016 [US2] Implement the row-scoped shared-track layout in `app/globals.css` and wire its classes in `components/pharmacy-finder.tsx`: use CSS Grid subgrid or the documented standards-based equivalent so each multi-column row independently keeps present duty-panel and all hours-panel top edges within 1 CSS pixel in every supported browser; collapse duty space when no card in that row has duty content; prevent track sizing from propagating between rows; use natural single-column flow without artificial gaps; leave cards without duty content semantically empty; and avoid JavaScript height measurement, fixed content heights, line clamps, hidden overflow, address or safety-content truncation, or address rewriting.
- [X] T017 [US2] Refine card hierarchy and action placement in `components/pharmacy-finder.tsx` so physical opening, daytime duty, scheduled gaps, nighttime call-first, conflicts, and unavailable states remain readable without color alone; keep opening hours visible and Call/Directions stable for long content and RTL.
- [ ] T018 [US2] Execute the objective DAC-004/DAC-005/DAC-006/DAC-011 card matrix in every supported Chromium, Firefox, and WebKit/Safari family at applicable 320, 375, 768, 1024, and 1440 CSS-pixel contexts; record expected visible state/guidance, measured maximum within-row duty-panel and hours-panel top-edge differences of no more than 1 CSS pixel, zero reserved duty space in all-empty rows, no alignment propagation between unrelated rows, natural no-gap single-column flow, fallback behavior, and fully visible untruncated addresses and safety-critical content in `specs/001-redesign-cyprus-finder/validation-results.md`; label screenshots and measurements as technical visual evidence only, not SC-003 comprehension evidence.

**Checkpoint**: Status meaning remains truthful and the shared card grid passes UX-014/DAC-011.

---

## Phase 5: User Story 3 — Find a Nearby Pharmacy Without Misleading Distance Claims (Priority: P2)

**Goal**: Preserve optional, private, district-safe proximity without implying route distance or travel
time.

**Independent Test**: Exercise browse-all, GPS, and manual-origin paths with known and unknown trusted
coordinates. Known straight-line values sort first within the selected district, unknown-distance
pharmacies remain visible, manual origins clear on district change, GPS persists, and no copy implies a
road route or duration.

### Tests and Validation for User Story 3

- [X] T019 [US3] Extend `components/pharmacy-finder.test.tsx` to cover no-origin completeness, explicit GPS/manual origins, known-before-unknown ordering, trusted-coordinate-only distance, manual-origin clearing after district change, GPS persistence across district/day/filter changes, and equivalent approximate straight-line disclosure in EN/EL/RU/AR.
- [X] T020 [P] [US3] Extend pure regression coverage in `lib/domain/distance.test.ts` and `lib/domain/results.test.ts` for straight-line calculation, stable known-distance ordering, retention of unknown-distance records, and absence of any road-distance or travel-time derivation.
- [X] T021 [US3] Run the district-change origin and distance matrices from `specs/001-redesign-cyprus-finder/quickstart.md` and record privacy, ordering, disclosure, and zero-route-inference results in `specs/001-redesign-cyprus-finder/validation-results.md`.

**Checkpoint**: Proximity remains optional, transient, complete, and honestly labeled.

---

## Phase 6: User Story 4 — Use the Finder on Any Supported Device and Language (Priority: P2)

**Goal**: Complete the compact responsive design, accessible interaction, four-locale equivalence, and
correct Arabic RTL presentation.

**Independent Test**: Complete district selection, search, status review, Call, and Directions in EN,
EL, RU, and AR at 320, 375, 768, 1024, and 1440 CSS pixels using pointer and keyboard. Verify 44-by-44
primary targets, local tab scrolling, no page overflow, visible focus/selection, complete text, and
correct RTL/mixed-direction values.

### Tests for User Story 4

- [X] T022 [US4] Add live/loading header contract coverage in `app/i18n-routing.test.tsx` and `components/pharmacy-finder.test.tsx` for Cyprus Pharmacy identity, reachable language selection, About/Data Sources access, compact behavior, and no stale-result implication.
- [X] T023 [US4] Add table-driven four-locale acceptance coverage in `components/pharmacy-finder.test.tsx` and `lib/i18n/config.test.ts` for district labels, summaries, statuses, hours, errors, Call/Directions, distance disclosure, Arabic RTL, and bidi-stable official identity, telephone, time, distance, and URL values.

### Implementation for User Story 4

- [X] T024 [US4] Align the live and loading header presentation in `components/pharmacy-finder.tsx` and `app/[locale]/page.tsx` while preserving branding, language selection, essential information links, loading truthfulness, and existing server/client boundaries.
- [X] T025 [US4] Complete mobile-first control, spacing, wrapping, local-overflow, focus, and non-color active-state refinements in `components/pharmacy-finder.tsx` and `app/globals.css`, including the manual-search submit button and every other primary control at a minimum 44-by-44 CSS-pixel target.
- [X] T026 [US4] Reconcile any four-locale finder-copy parity gaps exposed by T023 in `lib/i18n/types.ts`, `lib/i18n/locales/en.ts`, `lib/i18n/locales/el.ts`, `lib/i18n/locales/ru.ts`, and `lib/i18n/locales/ar.ts`, preserving source-backed schedule wording and avoiding translation-layer schedule inference.
- [X] T027 [US4] Execute the responsive/localization matrix for EN and AR at every acceptance width plus EL/RU expansion spot checks, then record objective overflow, touch-target, keyboard, focus, active-state, wrapping, RTL, bidi, and CyNightMeds-independence results in `specs/001-redesign-cyprus-finder/validation-results.md`; do not infer SC-002 task speed or SC-003 comprehension from screenshots or deterministic interaction checks.

**Checkpoint**: All supported devices and locales provide equivalent, accessible safety meaning.

---

## Phase 7: User Story 5 — Keep Existing Finder Paths Working (Priority: P3)

**Goal**: Prove the redesign did not remove or weaken any working finder path.

**Independent Test**: Compare the completed finder with the Phase 1 inventory and verify every recorded
capability remains reachable and functional. If a map/list experience appeared through concurrent
uncommitted work, verify it is preserved and respects district/filter state.

### Preservation and Regression Tasks for User Story 5

- [X] T028 [US5] Re-audit the current working tree immediately before final integration and update the capability/map-list inventory in `specs/001-redesign-cyprus-finder/validation-results.md` without resetting or overwriting concurrent uncommitted changes.
- [X] T029 [US5] Extend end-to-end component and route regression coverage in `components/pharmacy-finder.test.tsx`, `app/i18n-routing.test.tsx`, and `app/legal-pages.test.tsx` for every Phase 1 capability, including legal/source navigation and any map/list behavior present at implementation time.
- [X] T030 [US5] Execute the preservation matrix in `specs/001-redesign-cyprus-finder/quickstart.md`, compare it line-by-line with the inventories from T001 and T028, and record zero unauthorized removals or the exact separately approved exception in `specs/001-redesign-cyprus-finder/validation-results.md`.

**Checkpoint**: The visual redesign is a strict functional superset of the recorded baseline.

---

## Phase 8: Polish, Documentation Reconciliation, and Final Gates

**Purpose**: Synchronize acceptance documentation, remove active Paphos-only product/UI contradictions,
and run final constitutional and regression gates.

- [X] T031 [P] Reconcile current Cyprus-wide UI and district-scoping language in `docs/ARCHITECTURE.md` while preserving accurate Paphos-specific geocoding, Google Places, provider, and provenance boundaries.
- [X] T032 [P] Reconcile the national finder selection and transient-state descriptions in `docs/DATA_MODEL.md` while preserving accurate Paphos-only enrichment-table and offline-synchronization facts.
- [X] T033 [P] Add superseding Cyprus-wide product/UI decisions in `docs/DECISIONS.md` for D-019 and any affected naming/scope decision without rewriting historical decisions or source evidence.
- [X] T034 [P] Update current and future district-selection scope in `docs/ROADMAP.md` so the implemented five-district finder is no longer described as deferred, while retaining separate map and enrichment roadmap items.
- [X] T035 [P] Update the active project introduction in `AGENTS.md` and audit `docs/PRODUCT.md` for remaining active Paphos-only UI language, preserving the accurate per-pharmacy seasonal and enrichment limitations.
- [X] T036 Search `AGENTS.md` and `docs/` for active Paphos-only UI contradictions, verify historical/source-specific Paphos statements remain intact, re-run the Constitution v1.1.0 gates, and record results in `specs/001-redesign-cyprus-finder/validation-results.md`.
- [X] T037 Run typecheck, lint, focused finder/data/location/route/i18n/legal suites, and the full test suite from `specs/001-redesign-cyprus-finder/quickstart.md`; require zero new affected-suite failures, separate any unchanged snapshot debt, and record final results in `specs/001-redesign-cyprus-finder/validation-results.md`.
- [ ] T038 Review the final diff against `specs/001-redesign-cyprus-finder/spec.md`, `specs/001-redesign-cyprus-finder/plan.md`, and `specs/001-redesign-cyprus-finder/checklists/requirements.md`; confirm UX-014/DAC-011 and the objective implementation-phase criteria SC-001, SC-004–SC-010, and DAC-001–DAC-011 have technical evidence; record SC-002 and SC-003 as pending post-implementation user research unless representative participant studies have actually measured them, and never use automated results or screenshots as proof of those research outcomes in `specs/001-redesign-cyprus-finder/validation-results.md`.

**Checkpoint**: Documentation, constitutional checks, objective visual acceptance, and automated
regression gates agree with the implemented Cyprus-wide finder; the separate SC-002 and SC-003 user-
research targets remain explicitly unclaimed until measured with representative participants.

---

## Dependencies and Implementation Order

### Phase Dependencies

- **Phase 1 — Setup**: Starts immediately; T002 depends on T001.
- **Phase 2 — Foundational**: Depends on Phase 1 and blocks all user-story implementation.
- **Phase 3 — User Story 1**: Depends on Phase 2 and is the first implementation increment because it
  closes the geographic-integrity and search-state leak.
- **Phase 4 — User Story 2**: Depends on Phase 2; execute after US1 in the recommended single-developer
  order so the highest-risk state fix lands before card restructuring. T012 is a mandatory contract
  gate; T013–T018 must not begin until the existing UX-014/DAC-011 contract and quickstart procedure
  pass that verification.
- **Phase 5 — User Story 3**: Depends on US1 because manual-origin district clearing is implemented
  there; otherwise it preserves existing distance behavior.
- **Phase 6 — User Story 4**: Depends on US2 because responsive and RTL review must validate the final
  card-grid structure.
- **Phase 7 — User Story 5**: Depends on all desired implementation stories and verifies preservation.
- **Phase 8 — Polish**: Depends on US1–US5 and completes documentation and final gates.

### User Story Dependency Graph

```text
Setup → Foundation → US1 district integrity ──→ US3 honest proximity ──┐
                   └→ US2 truthful cards/grid → US4 responsive/i18n ──┼→ US5 preservation → Polish
                                                                    ──┘
```

### Within Each User Story

- Add or extend the story's tests before changing implementation.
- For US2, complete the T012 contract/quickstart gate before authoring card-grid tests or changing card
  implementation.
- Confirm gap-specific tests fail for the intended reason; characterization tests for implemented
  behavior should pass before implementation.
- Preserve pure domain/data boundaries before changing presentation.
- Complete focused automated checks before manual visual acceptance.
- Record validation evidence before moving to a dependent story.
- Classify automated, deterministic browser, and screenshot evidence as technical conformance only;
  do not infer task speed or real-user comprehension from it.

### Parallel Opportunities

- T004 and T005 can run in parallel after T003.
- T008 can run in parallel with T006–T007 because it touches the route suite, not the component suite.
- T020 can run in parallel with T019 because it touches pure domain tests.
- T031–T035 can run in parallel after implementation because each owns distinct documentation files.
- US3 test work can overlap with early US2 work after US1 is complete, but US4 visual acceptance waits
  for the shared card grid.

---

## Parallel Execution Examples

### User Story 1

```text
Task T006/T007: Five-district and district-transition component tests in components/pharmacy-finder.test.tsx
Task T008: Five-district cache/request isolation tests in app/api/location-search/route.test.ts
```

### User Story 2

```text
Task T012: Verify the finalized UX-014/DAC-011 contract and browser-based quickstart procedure
Then T013/T014: Status and shared-grid fixtures in components/pharmacy-finder.test.tsx
Then T015 → T016 → T017: Semantic regions, shared tracks, and final hierarchy
Then T018: Browser-based DAC-011 visual evidence
```

### User Story 3

```text
Task T019: Finder-level origin and disclosure tests in components/pharmacy-finder.test.tsx
Task T020: Pure distance/result ordering tests in lib/domain/distance.test.ts and lib/domain/results.test.ts
```

### User Story 4

```text
Task T022: Live/loading header contract tests
Task T023: Four-locale and RTL acceptance tests
Then T024–T026: Header, responsive interaction, and locale parity changes
Then T027: Full responsive/localization visual matrix
```

### User Story 5

```text
Task T028: Re-inventory concurrent working functionality
Then T029: Preservation regression coverage
Then T030: Compare the completed experience with both inventories
```

---

## Implementation Strategy

### MVP First

The minimum safe increment is Setup + Foundational + User Story 1:

1. Freeze the dirty-tree and test baseline.
2. Protect existing working functionality with characterization coverage.
3. Fix district-switch manual search/origin leakage.
4. Validate all five districts independently.
5. Stop and review before any card markup change.

### Incremental Delivery

1. **Preservation foundation**: T001–T005.
2. **Geographic integrity MVP**: T006–T011.
3. **Truthful shared card grid**: T012–T018.
4. **Honest proximity regression**: T019–T021.
5. **Responsive and four-locale acceptance**: T022–T027.
6. **Whole-product preservation**: T028–T030.
7. **Documentation and final gates**: T031–T038.

Each increment must pass its independent test before the next dependent phase starts.

## Notes

- Do not reset, checkout, stash, discard, or broadly reformat the user's existing uncommitted changes.
- Re-read `git diff` before every implementation patch and keep edits narrow.
- Do not reimplement working district, status, distance, localization, or data-loading logic merely to
  support the redesign.
- Do not create a new map, routing estimate, database migration, stored status boolean, or client-side
  data-fetch layer.
- Never hard-code a universal 22:00–08:00 claim; use the active source-backed duty profile.
- Never shorten, translate, normalize, rewrite, clamp, or hide official address or safety-critical
  content to make cards align.
- Treat the four known geocoding snapshot failures as separately reported debt unless their owning data
  work resolves them independently.
- Keep SC-002's 10-second usability goal and SC-003's 95% status-comprehension goal as post-
  implementation user-research targets; no current task may mark them passed from tests or screenshots.
