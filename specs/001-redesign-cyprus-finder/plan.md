# Implementation Plan: Cyprus-wide Pharmacy Finder Redesign

**Branch**: `main` (no feature branch created) | **Date**: 2026-11-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-redesign-cyprus-finder/spec.md`

## Summary

Deliver an incremental visual and UX redesign of the existing Cyprus-wide finder without replacing
its working domain, data, privacy, localization, or location behavior. The current working tree already
implements five district tabs, district-scoped lists and counts, the Cyprus Pharmacy header, visible
hours, distinct ordinary/duty/night states, four locales with Arabic RTL, and honest straight-line
distance disclosure. Implementation therefore concentrates on visual acceptance hardening, complete
five-district regression coverage, safe district-switch state, loading/header consistency, card
layout and critical-content visibility, a shared internal card grid that aligns duty and opening-hours
panels across adjacent cards, touch/keyboard accessibility, RTL visual QA, and documentation
reconciliation.

The approach keeps server-side data loading and pure availability rules unchanged. The existing
`PharmacyFinder` client boundary remains the state owner; presentation is adjusted through its current
internal card/status structure and extracted only where a small, independently testable presentational
component materially reduces risk. No database migration, public route change, new map, or new schedule
rule is planned.

## Technical Context

**Language/Version**: TypeScript 5.9, React 19.2, Node.js 22 or newer

**Primary Dependencies**: Next.js 16.3 App Router, Tailwind CSS 4.3, Lucide React, Supabase client,
existing date/availability/duty/regular-hours domain modules

**Storage**: Existing Supabase/PostgreSQL production data and checked-in development snapshots; no
schema or persistence change

**Testing**: Vitest 4, Testing Library, server-rendered markup checks, Next route type generation,
TypeScript type checking, ESLint, and manual responsive/RTL visual validation

**Target Platform**: Mobile-first responsive web/PWA across the current stable Chromium
(Chrome/Edge), Firefox, and WebKit/Safari browser families available at implementation validation,
on phone, tablet, and desktop where applicable; minimum acceptance width 320 CSS pixels. Every browser
in this supported matrix must satisfy DAC-011 rather than receiving a degraded alignment exception.

**Project Type**: Next.js web application with server-rendered data boundary and interactive client
finder

**Performance Goals**: Preserve the approximately 10-second user task goal; district/day/filter
changes must use already loaded data and must not add a network request; visual changes must not add a
new blocking request or unbounded result rendering

**Constraints**: Preserve all current uncommitted work; no login; no location persistence; GPS remains
client-side; manual search remains district-scoped; no inferred road distance or travel time; no
critical-content truncation; 44-by-44 CSS-pixel primary touch targets; four equivalent locales; Arabic
RTL and bidirectional isolation; within-row duty and opening-hours top-edge alignment to a maximum 1
CSS-pixel difference in every supported browser, with no unused all-empty duty track, no artificial
single-column gap, no cross-row track propagation, no fixed content heights, no address rewriting, and
no excessive cross-card whitespace; no new map requirement; no direct Places ordinary-hours content

**Scale/Scope**: Five districts, four locales, Today/Tomorrow, three Today filters and two Tomorrow
filters, current national pharmacy dataset, existing trusted-coordinate subset, one finder page plus
its loading state and legal/source navigation

### Baseline Verification

- `npm run typecheck`: passes on 2026-11-03.
- Focused finder, data, manual-search, and location-route suites: 104/104 tests pass.
- Full `npm test`: 244/248 tests pass. Four pre-existing Paphos geocoding snapshot reconciliation
  tests fail because checked-in enrichment artifacts and the refreshed official registry differ.
- No working in-app map or map/list switcher is present in the current working tree. The list, Call,
  Directions, search, location, filters, legal links, and attribution paths are the preservation
  baseline. Implementation must re-audit this immediately before editing in case concurrent
  uncommitted work adds a map/list experience.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Constitutional gate | Pre-design result | Plan response |
|---------------------|-------------------|---------------|
| Truthful availability semantics | PASS | Reuse existing pure normal/duty/on-call derivation. Change presentation and localized wording only; never collapse duty or nighttime phone coverage into Open Now. |
| Source-bounded facts and provenance | PASS | No source, schedule, identity, coordinate, or persistence change. Existing attribution and unknown states remain visible. |
| Privacy and least privilege | PASS | Keep GPS client-side, manual origin transient, current server proxy, current grants, and no-login path unchanged. |
| Fast, complete, inclusive access | PASS | Preserve browse-all and unknown-coordinate records; prioritize compact mobile UX, five districts, four locales, RTL, and 44-pixel targets. |
| Testable boundaries and deliberate scope | PASS | Keep domain logic outside presentation; add characterization and acceptance tests before visual edits; avoid a broad component rewrite. |
| Five-district geographic integrity | PASS | Add complete list/count/search/empty/error coverage for all five districts and clear previous-district manual origins. |
| Honest distance | PASS | Preserve approximate straight-line disclosure, trusted-coordinate-only ordering, and unknown-distance visibility. |
| Documentation alignment | PASS | Reconcile active Paphos-only UI statements while preserving historical and Paphos-specific enrichment facts. |

**Pre-design gate result**: PASS. No constitutional exception or complexity waiver is required.

**Post-design re-check**: PASS. The data model introduces no new persisted facts, the UI contract
preserves truth and privacy boundaries, the validation guide covers all five districts and locales,
the shared card tracks preserve complete safety content and canonical addresses, and the proposed
documentation work changes product/UI scope language without rewriting source history.

## Existing Implementation Assessment

### Already implemented and to be preserved

- Server-side loading already returns active pharmacies and duty assignments across all five districts.
- The client already filters the shared dataset by the selected district before pharmacy search,
  availability filtering, counts, sorting, and rendering.
- Five text-only district buttons already exist with horizontal overflow and a selected underline.
- The results heading already shows localized district, Cyprus-local selected date, total pharmacy
  count, and selected-day duty count; there is no current `updating...` line.
- The live header already contains Cyprus Pharmacy branding, About, Data Sources, and language choice.
- Cards already show official identity/address, badges, supported hours, conflict and nighttime
  notices, approximate distance, Call, and Directions.
- Existing domain evaluators already distinguish normal physical opening, duty-open time, scheduled
  gaps, previous-day overnight coverage, supported 22:00/23:00 transitions, and unknown dates.
- All four dictionaries already contain district, count, status, hours, action, error, and honest
  distance strings; the locale layout already supplies Arabic `dir="rtl"` and bidi isolation.
- Existing result ordering retains unknown coordinates and labels known values as straight-line
  estimates.
- Existing focused tests cover representative district switching, district-bound search, normal/duty/
  nighttime boundaries, all-locale status copy, RTL isolation, distance disclosure, and origin
  persistence across filter/day changes.

### Missing or incomplete work

- Characterization coverage does not exercise all five districts across list, count, filter, search,
  empty, loading, cached, and error states.
- A selected manual origin is not cleared when the district changes, allowing distance from a location
  chosen under the former district to remain visible.
- The active-tab treatment needs explicit non-color and assistive-technology acceptance, plus checks
  that mobile scrolling never hides the active tab or clips end tabs.
- The live and loading headers are not covered by one shared acceptance contract.
- The manual-search submit control is currently smaller than the agreed 44-by-44 target.
- Card structure uses full-height flex layout, but there is no regression proof that long addresses,
  translated status text, warnings, or hours are never clamped or hidden to force equal heights.
- Cards do not define row-scoped shared internal tracks, so different pharmacy-name or address lengths
  can shift the duty and opening-hours panels vertically. Mixed rows containing cards without duty
  status also lack an explicit alignment rule that avoids fabricated content and excessive empty space.
- Responsive and Arabic checks are mostly semantic/unit checks; there is no complete phone/tablet/
  desktop visual matrix for layout, touch targets, wrapping, action order, and horizontal overflow.
- CyNightMeds reference boundaries and Cyprus Pharmacy visual independence are not encoded in the
  current implementation review process.
- Architecture, decisions, roadmap, data-model guidance, and `AGENTS.md` retain active Paphos-only UI
  language that conflicts with the product and Constitution v1.1.0.
- The full test suite has four unrelated snapshot failures that could obscure real redesign regressions
  unless baseline and feature-specific outcomes are reported separately.

## Project Structure

### Documentation (this feature)

```text
specs/001-redesign-cyprus-finder/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── finder-ui-contract.md
├── checklists/
│   └── requirements.md
└── tasks.md                 # created later by $speckit-tasks
```

### Source Code (repository root)

```text
app/
├── [locale]/
│   ├── layout.tsx           # locale direction and shared page shell
│   └── page.tsx             # server data boundary and loading state
├── api/location-search/
│   ├── route.ts             # unchanged district-scoped manual search contract
│   └── route.test.ts
└── globals.css              # global tokens, focus treatment, overflow safeguards

components/
├── pharmacy-finder.tsx      # finder state orchestration and current presentation
├── pharmacy-finder.test.tsx # component and interaction regression suite
├── language-selector.tsx
└── site-footer.tsx

lib/
├── data/pharmacies.ts       # unchanged five-district server data loading
├── domain/                  # unchanged pure availability/date/distance/results logic
├── i18n/
│   ├── types.ts
│   └── locales/{en,el,ru,ar}.ts
└── location/                # unchanged origin/manual-search boundaries except UI reset usage

docs/
├── PRODUCT.md
├── ARCHITECTURE.md
├── DATA_MODEL.md
├── DECISIONS.md
└── ROADMAP.md
```

**Structure Decision**: Keep the existing single Next.js application and its server/client boundary.
Do not introduce a design system package, state library, API layer, or database abstraction. Prefer
small presentational helpers inside `pharmacy-finder.tsx`; extract a component only when it gains an
independent semantic contract and focused test without moving domain evaluation into UI code.

## Proposed Implementation Sequence

### 1. Freeze and characterize the working baseline

- Record `git status --short` and the exact focused/full test outcomes before editing.
- Add characterization tests for current Call, Directions, Today/Tomorrow, filters, optional GPS,
  manual search, straight-line distance, attribution, locale routes, and legal navigation.
- Inventory any map/list capability again at implementation start; preserve it if concurrent work has
  introduced one.
- Keep the four known snapshot failures in a separate baseline note; do not change geocoding artifacts
  as part of this visual feature.

### 2. Complete district-state integrity

- Preserve the existing all-district dataset and client-side district-first filtering.
- Add a shared five-district test matrix covering list contents, total count, duty count, filter result,
  pharmacy-name/address search, manual-location request district, empty state, and error state.
- On district change, cancel outstanding manual lookup, clear suggestions/errors, reset progressive
  reveal, and clear any manual origin from the former district. Preserve a GPS origin because it is not
  district-derived.
- Ensure raw query text, if retained, is visibly re-evaluated only against the new district.

### 3. Apply the visual redesign without replacing orchestration

- Refine the existing header and loading header to one visual contract: Cyprus Pharmacy identity,
  language selection, essential information access, compact mobile layout, and no stale-data cue.
- Keep five text-only district tabs. Strengthen the active state with a non-color cue, selected
  semantics, focus visibility, and automatic visibility within the mobile scroll area.
- Retain the existing district summary values while establishing one readable summary hierarchy and
  explicitly excluding a secondary `updating...` line.
- Rebalance hero, controls, summary, grid, card spacing, and action density using existing design
  tokens. CyNightMeds informs compactness only; do not copy its composition or identity.
- Increase any undersized primary control to the 44-by-44 minimum without reducing input usability.

### 4. Harden card hierarchy and duty communication

- Keep the current card information order but make physical-opening state, daytime duty, scheduled
  gap, nighttime call-first, and unavailable state visually scannable without relying on color alone.
- Reuse existing source-backed time values and localized messages. Do not introduce hard-coded 22:00
  or 08:00 claims; render the active supported profile, including 23:00 summer or 22:00 winter starts.
- Maintain visible selected-day hours and readable wrapping for official name/address.
- Define one semantic internal card grid with content-driven tracks for the identity/address area, the
  optional duty panel, the opening-hours panel, additional safety notices, and actions. Keep the top
  text area intrinsically sized so pharmacy names and official addresses wrap naturally and remain
  unchanged.
- In multi-column layouts, use CSS Grid subgrid or an equivalent standards-based shared-track
  mechanism scoped independently to each visual row. Within a row, the maximum difference between the
  measured top edges of duty panels that are present is 1 CSS pixel, and the maximum difference between
  the measured top edges of all opening-hours panels is 1 CSS pixel, regardless of name or address
  length. Track sizing from one row must not propagate to any unrelated row. Do not use JavaScript
  height measurement as the primary layout mechanism.
- For a card without duty status, render no duty panel, placeholder message, or fabricated status.
  Leave its duty track semantically empty only when an adjacent card needs that track; if no card in
  the row has a duty panel, the track collapses. Scope track sizing to the visual row rather than the
  entire result grid so one content-heavy card does not create empty space throughout the list.
- Preserve natural, content-driven height at every track. Long addresses, translated status text,
  warnings, duty instructions, and hours expand the relevant shared row instead of being clamped,
  hidden, compressed, or overlaid. At single-column breakpoints, return to natural stacked flow so no
  cross-card alignment gap is reserved. Never truncate an address or any safety-critical information.
- Treat excessive whitespace as a responsive-layout failure: keep shared alignment limited to cards
  that are genuinely adjacent, and collapse to fewer columns where available width cannot support
  readable, touch-friendly cards. Do not shorten, translate, normalize, or rewrite address content to
  obtain alignment.
- Keep Call and Directions prominent, reachable, and stable across content lengths and RTL.

### 5. Complete responsive, accessibility, and localization acceptance

- Validate 320, 375, 768, 1024, and 1440 CSS-pixel widths in English and Arabic, with spot checks in
  Greek and Russian for text expansion.
- Confirm page-level horizontal overflow is absent while district and filter rows can scroll locally.
- Test pointer, touch-size, and keyboard order; active tab/filter/day states must be available to
  assistive technology and not depend on color.
- Review Arabic visually for logical spacing, alignment, icon/text order, badge wrapping, time/address
  isolation, and Call/Directions action order.
- Exercise DAC-011 in every supported browser with short and long pharmacy names and addresses in the
  same visual row, including rows where every card has duty status, only some cards have duty status,
  and no card has duty status, plus at least two adjacent result rows with different content heights.
  Measure top edges and require no more than a 1 CSS-pixel difference within each row; confirm an all-
  empty duty row reserves no duty-panel space and that sizing does not propagate between rows. At phone
  widths, confirm the single-column layout uses natural flow and removes artificial alignment gaps
  while preserving panel order and all address and safety-critical content.
- Add or adjust dictionary keys in all four locale resources together if the visual hierarchy requires
  new human-readable labels; never synthesize schedule meaning inside translations.

### 6. Regression validation and documentation reconciliation

- Run typecheck, lint, focused finder/location suites, then the full suite. Report the four known
  snapshot failures separately unless they have been independently resolved by the owner of that data.
- Validate the UI contract and quickstart matrix before declaring design acceptance.
- Update `PRODUCT.md`, `ARCHITECTURE.md`, `DATA_MODEL.md`, `DECISIONS.md`, `ROADMAP.md`, and the active
  `AGENTS.md` introduction so current product/UI scope is Cyprus-wide.
- Preserve historical Paphos-only geocoding, Google Places reconciliation, counts, and provenance
  statements where they describe actual source coverage rather than current UI scope.

## Testing Strategy

| Layer | Planned coverage |
|-------|------------------|
| Pure domain | Retain all availability, duty-boundary, regular-hours, date, distance, and sorting tests unchanged except for genuine regression additions. |
| Finder component | Five-district matrix; summary updates; district-change origin reset; tab semantics; no `updating...` line; card safety content; duty/gap/night wording; structural coverage for cards with and without duty panels; preserved filters/location/actions. |
| Localization | Equivalent labels and state meaning in EN/EL/RU/AR; plural counts; mixed-script identity; Arabic direction and stable LTR values. |
| Route/data | Retain district-scoped manual-search request/cache isolation and all-district data loading tests; no contract change expected. |
| Responsive/accessibility | Visual matrix at agreed widths in every supported Chromium, Firefox, and WebKit/Safari family; DAC-011 comparison fixtures with short/long names and addresses, all/mixed/no duty presence, and multiple independent rows; maximum 1 CSS-pixel within-row duty/hours top-edge difference; zero reserved duty space for all-empty rows; no cross-row propagation; natural no-gap single-column flow; untruncated addresses and safety content; local tab scrolling; no page overflow; 44-pixel targets; keyboard/focus/selected semantics; non-color state cues. |
| Regression | Typecheck, lint, focused 104-test baseline, full suite with known snapshot failures separated, and preservation inventory for every working finder path. |
| Documentation | Search for active Paphos-only UI claims and verify each is reconciled or explicitly retained as historical/source-specific context. |

## Architectural Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Large dirty working tree | Visual edits could overwrite unrelated user work or misattribute behavior. | Treat the current working tree as baseline, inspect diffs before every edit, avoid broad formatting, patch narrowly, and never reset or checkout user files. |
| Monolithic client finder | Layout edits can accidentally alter search, status, distance, or permission state. | Add characterization tests first; preserve state/domain calls; extract only small presentational units with explicit props. |
| Manual-origin district leakage | Distance can remain based on a location selected for the former district. | Clear manual origins on district change while retaining GPS, and test pending, selected, and cached manual states. |
| Equal-height pressure | Fixed heights or clamping can hide safety instructions, hours, or long translated addresses. | Use natural height and structural alignment; prohibit clamps/hidden overflow for critical content; include long-content fixtures. |
| Shared-grid alignment versus whitespace | A global fixed track or placeholder duty panel could create large blank areas, imply a false duty state, or couple unrelated result rows. | Share intrinsic tracks only among cards in the same visual row, collapse an unused duty track, render no fake duty content, use natural single-column flow, and reduce the column count when card width becomes unsuitable. |
| Shared-track browser behavior | Subgrid or fallback differences could shift panel starts at a supported breakpoint even when content remains visible. | Require the primary layout and any supported-browser fallback to meet the same maximum 1 CSS-pixel within-row DAC-011 tolerance across the Chromium, Firefox, and WebKit/Safari matrix; measure duty/hours top edges rather than relying only on DOM structure, and reject a fallback that merely preserves content while losing required alignment. |
| Schedule wording drift | Visual copy could hard-code winter 22:00 behavior and misstate summer 23:00 or unsupported dates. | Use existing rule outputs and source-backed boundaries; test both profiles and unknown coverage. |
| RTL visual regressions | Semantic `dir="rtl"` can still leave spacing, icon order, and mixed values wrong. | Use logical properties/bidi isolation and perform explicit Arabic phone/desktop visual review. |
| Global style bleed | Token or base-style changes can regress legal pages and footer. | Prefer scoped utility changes; if global tokens change, run legal-page and footer regression checks in all directions. |
| Uneven national coordinate coverage | Some districts may appear less useful if users mistake missing distance for missing pharmacies. | Keep all pharmacies visible, repeat trusted-coordinate limitations, and never imply global-nearest completeness. |
| Full-suite baseline failures | Existing snapshot failures can hide new failures or tempt unrelated data edits. | Record exact baseline, require zero new failures in affected suites, and track snapshot reconciliation separately from this feature. |
| Documentation history loss | Replacing all Paphos language could erase accurate provider-specific provenance. | Change only active UI/product scope statements; retain Paphos-specific enrichment history and evidence. |
| Reference imitation | Treating CyNightMeds as a template could undermine product identity or import unsuitable patterns. | Use it only to evaluate compact tab clarity; review final composition and branding for independent design. |

## Complexity Tracking

No constitutional violations or exceptional complexity are planned. The design reuses existing state,
domain functions, data contracts, localization resources, and testing infrastructure.
