# Quickstart: Validate the Cyprus-wide Finder Redesign

## Purpose

Use this guide during implementation and review to prove the redesign satisfies the specification
without regressing existing finder behavior. Read [the UI contract](./contracts/finder-ui-contract.md)
and [the transient data model](./data-model.md) before validation.

## Prerequisites

- Node.js 22 or newer
- Project dependencies installed
- Current working tree preserved; do not reset or discard uncommitted files
- Local official snapshot available for development when Supabase settings are absent

## 1. Record the Baseline

```bash
git status --short
npm run typecheck
npx vitest run components/pharmacy-finder.test.tsx lib/data/pharmacies.test.ts lib/location/manual-search.test.ts app/api/location-search/route.test.ts
npm test
```

Expected planning baseline on 2026-11-03:

- Typecheck passes.
- Focused suites pass 104/104 tests.
- Full suite passes 244/248 tests; four Paphos geocoding snapshot reconciliation tests fail because
  registry and enrichment snapshots differ. Do not treat those failures as redesign work.

Before implementation, re-run and record the actual baseline. Zero new affected-suite failures are
allowed.

## 2. Start the Local Finder

```bash
npm run dev
```

Open each locale route:

- `/en`
- `/el`
- `/ru`
- `/ar`

Do not enter real medical information in manual location search.

## 3. Five-District Matrix

For Nicosia, Limassol, Larnaca, Famagusta, and Paphos:

1. Select the district using the text-only tab.
2. Confirm the active state is visible without relying only on color.
3. Confirm the summary district, Cyprus-local date, total pharmacy count, and duty count update together.
4. Confirm no `updating...` line appears.
5. Confirm every listed pharmacy belongs to the selected district.
6. Exercise All and On Duty; exercise Open Now for Today when supported.
7. Search a pharmacy name/address and submit a manual-location query; confirm both remain district-scoped.
8. Confirm empty and error states do not show another district's values.

## 4. District-Change Origin Matrix

1. Select a manual location in Paphos and confirm straight-line distance appears where trusted.
2. Switch to another district.
3. Confirm the previous manual origin, suggestions, errors, and distance are cleared.
4. Repeat using GPS.
5. Confirm the GPS origin remains and no second permission request occurs.

## 5. Status and Hours Matrix

Use automated fixtures or controlled test instants for:

- ordinary open;
- ordinary afternoon break;
- ordinary closed;
- daytime mandatory duty-open;
- scheduled duty gap;
- summer night call-first from 23:00;
- winter night call-first from 22:00;
- previous-day overnight carry through the supported end boundary;
- exact 08:00 end boundary;
- overlapping/conflicting facts;
- unsupported date; and
- Tomorrow.

For each state, verify visible hours or explicit unavailability, human-readable localized wording, and
no false physical-opening claim.

## 6. Responsive and Visual Matrix

Review widths 320, 375, 768, 1024, and 1440 CSS pixels at 100% browser zoom. Run the complete matrix in
English and Arabic. Use English to verify left-to-right composition and Arabic to verify the same card
grid in right-to-left composition.

Prepare three fixture cases, each pairing a short official address with a substantially longer official
address without translating, normalizing, rewriting, or shortening either value:

1. **All-duty row**: at least two adjacent cards render duty panels.
2. **Mixed-duty row**: one adjacent card renders a duty panel and the other has no duty status.
3. **No-duty row**: adjacent cards render no duty panels.

The rendered card root, duty panel, and hours panel must be available to the browser verifier through
`[data-pharmacy-card]`, `[data-card-panel="duty"]`, and `[data-card-panel="hours"]`, respectively.
A no-duty card must not render the duty-panel selector.

At every width:

- no page-level horizontal overflow;
- all five district tabs remain reachable through local horizontal scrolling when needed;
- the active tab remains visible;
- primary targets measure at least 44 by 44 CSS pixels;
- header, controls, summary, cards, and footer remain readable;
- long address/status/hour fixtures show fully without line clamps or hidden overflow;
- Call and Directions remain visible and aligned consistently; and
- card growth preserves critical content even when neighboring cards are shorter.

### Objective UX-014 / DAC-011 Measurement

For each fixture and locale:

1. Set the exact viewport width, keep browser zoom at 100%, wait for `document.fonts.ready`, and wait for
   layout to settle after the cards render.
2. Group `[data-pharmacy-card]` elements by their visual row using card-root
   `getBoundingClientRect().top` values. Compare panels only between cards sharing that row.
3. Read `getBoundingClientRect().top` from every `[data-card-panel="hours"]` in the row. Calculate
   `max(top) - min(top)`. The row passes only when the result is no more than **1 CSS pixel**.
4. In the all-duty case, perform the same calculation for `[data-card-panel="duty"]`. The duty row
   passes only when the result is no more than **1 CSS pixel**.
5. In the mixed-duty case, confirm the no-duty card contains no duty selector or duty wording, then
   confirm all hours panels still pass the 1 CSS-pixel tolerance.
6. In the no-duty case, confirm there are no duty selectors and no reserved duty-height gap. Hours
   panels must still pass the 1 CSS-pixel tolerance in a multi-column row.
7. At a width where cards form a single column, do not compare unrelated cards. Confirm natural
   identity → optional duty → hours order and no empty duty slot instead.
8. Confirm the full official addresses and every warning, call-first instruction, hours value, Call
   action, and Directions action remain visible and unaltered in all cases.

Record the raw CSS-pixel top values, calculated differences, locale, viewport width, fixture case, and
pass/fail result in the validation record. Capture English and Arabic screenshots at every acceptance
width, named or labeled with locale, width, and fixture case. Each screenshot must show the complete
adjacent card row—or the complete single-column card at phone widths—including identity, duty content
when present, opening hours, and actions.

## 7. Localization and RTL Matrix

Run the full primary journey in EN and AR, then spot-check EL and RU expansion.

For Arabic verify:

- page, header, tabs, summary, controls, cards, and actions compose right-to-left;
- official mixed-script identity remains readable;
- clock ranges, telephone values, distances, and URLs retain stable direction;
- icons and text do not reverse safety meaning;
- status badges and actions wrap without clipping; and
- keyboard focus follows a meaningful order.

## 8. Preservation Matrix

Verify all capabilities inventoried before implementation remain available:

- district selection and list;
- Today/Tomorrow;
- All/Open Now/On Duty;
- pharmacy text filtering;
- manual location and GPS;
- optional straight-line distance;
- known/unknown distance ordering;
- progressive reveal;
- Call and Directions;
- language switching;
- About, Privacy, Terms, and Data Sources navigation;
- source/provider attribution; and
- unknown/unavailable messaging.

If an in-app map/list switcher exists at implementation time, add it to this matrix before editing.

## 9. Automated Completion Checks

```bash
npm run typecheck
npm run lint
npx vitest run components/pharmacy-finder.test.tsx lib/data/pharmacies.test.ts lib/location/manual-search.test.ts app/api/location-search/route.test.ts app/i18n-routing.test.tsx app/legal-pages.test.tsx
npm test
```

Expected result: typecheck, lint, and every affected suite pass with zero new failures. Any remaining
full-suite failure must match the separately recorded pre-implementation baseline.

## 10. Documentation Reconciliation

```bash
rg -n -i 'Paphos-only|UI selects Paphos|focused on Paphos|district selection' AGENTS.md docs
```

Confirm active UI/product guidance is Cyprus-wide while accurate Paphos-specific geocoding and Places
history remains intact.
