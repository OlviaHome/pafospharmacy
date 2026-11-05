# Finder UI Contract

## Purpose

This contract defines the observable behavior and accessibility surface of the Cyprus-wide finder.
It does not redefine pharmacy source facts, availability rules, or external provider interfaces.

## 1. Header Contract

- Shows Cyprus Pharmacy identity on live and loading views.
- Keeps language selection reachable on mobile.
- Keeps essential About and Data Sources access reachable without obstructing the primary task.
- Does not imply that loading or stale content is current pharmacy availability.

## 2. District Switcher Contract

- Contains exactly five text-only controls: Nicosia, Limassol, Larnaca, Famagusta, and Paphos.
- Contains no district icons.
- Exposes exactly one selected district to assistive technology.
- Uses a visible non-color active cue and a visible keyboard focus cue.
- Scrolls locally on mobile when needed; it does not create page-level horizontal overflow.
- Keeps every tab reachable and brings the newly selected tab into view when necessary.

## 3. District Summary Contract

One coherent summary exposes:

1. localized selected district name;
2. selected Cyprus-local date;
3. total active pharmacy count for that district; and
4. on-duty count for that district and selected date.

The four values update together after district/day changes. No `updating...` line is shown.

## 4. District Isolation Contract

- Lists, filters, counts, pharmacy text matches, manual requests, suggestions, empty states, and errors
  are scoped to the selected district.
- Selecting a new district cancels pending manual lookup and clears previous-district suggestions,
  errors, and manual origin.
- GPS origin may persist; manual origin may not cross district scope without independent verification.
- Cached manual suggestions are keyed by district and never reused across districts.

## 5. Card Contract

Every visible card follows this order:

1. current status group for Today, when supported;
2. official name and readable official address;
3. safety conflict or duty guidance when applicable;
4. selected-day opening hours or explicit unavailable/closed explanation;
5. optional straight-line distance and limitation;
6. Call and Directions actions.

Cards in the same responsive context share hierarchy, spacing, and action placement. Natural content
height wins over visual equality. Names, addresses, hours, warnings, call-first instructions, and
actions are never line-clamped, hidden, or omitted to force equal height.

### UX-014 Shared Card Grid

- Within each responsive visual row containing two or more cards, cards use shared, content-driven
  internal grid tracks for the identity/address area, optional duty panel, and opening-hours panel.
- Duty panels that are present begin on one shared horizontal guide. Opening-hours panels begin on a
  second shared horizontal guide across every card in that row, regardless of pharmacy-name or address
  length.
- The top text area may contain different amounts of content. Its shared track grows to the tallest
  natural content in that visual row; it is not assigned a fixed content height.
- A card without duty status renders no duty panel, placeholder wording, or fabricated status. Its
  opening-hours panel still begins on the shared hours guide when an adjacent card has duty content.
- When no card in a visual row has duty content, the unused duty track collapses. Track height is never
  propagated to unrelated rows, and a single-column layout reserves no cross-card alignment gap.
- Alignment never depends on translating, normalizing, rewriting, shortening, line-clamping, hiding,
  compressing, or visually degrading an official address or any safety-critical content.
- Browser verification uses stable non-visible selectors: `[data-pharmacy-card]` on the card root,
  `[data-card-panel="duty"]` on a rendered duty panel, and `[data-card-panel="hours"]` on the
  opening-hours panel. A card without duty content does not expose a duty-panel selector.

## 6. Status Contract

- `Open Now` is reserved for physical opening at the current instant.
- `On Duty` remains visible during supported duty-open periods and scheduled duty gaps.
- A scheduled gap states that the pharmacy is on duty but the premises are not in a mandatory open
  interval.
- Active overnight phone coverage says `call first`, shows supported boundaries, and never says the
  premises are open.
- The displayed transition uses the applicable official profile: currently 23:00 for the supported
  summer profile and 22:00 for the supported winter profile, each through its supported end time.
- Unsupported dates and missing source facts render unknown/unavailable, never inferred hours.
- Meaning is conveyed with words and structure, not color alone.

## 7. Distance Contract

- Distance is optional and appears only for trusted coordinates with an explicit transient origin.
- It is labeled approximate straight-line distance.
- It never claims road distance, route distance, or travel time.
- Pharmacies without trusted coordinates remain visible and are not described as farther away.

## 8. Responsive and Interaction Contract

- Acceptance widths: 320, 375, 768, 1024, and 1440 CSS pixels.
- Primary interactive targets have at least a 44-by-44 CSS-pixel area.
- Critical actions do not require hover.
- Page-level horizontal overflow is absent; only designated tab/filter regions may scroll locally.
- Pointer, touch, and keyboard users can reach header, tabs, day/filter controls, search, cards, Call,
  Directions, and progressive reveal in a meaningful order.

### DAC-011 Browser Verification

- Verify at 320, 375, 768, 1024, and 1440 CSS pixels at 100% browser zoom after document fonts are
  ready and layout has settled.
- Use fixtures that place short and long official addresses in the same visual row for: two cards with
  duty panels, a mixed row with duty content on only one card, and two cards without duty panels.
- For every visual row containing two or more cards, read each relevant element's
  `getBoundingClientRect().top` value in CSS pixels. The difference between the maximum and minimum
  opening-hours top values MUST be no more than 1 CSS pixel.
- Where a row contains at least two duty panels, the difference between the maximum and minimum duty
  panel top values MUST be no more than 1 CSS pixel. A mixed row verifies that the no-duty card exposes
  no duty panel or fabricated duty content while its opening-hours panel still meets the hours
  tolerance.
- A row with no duty panels MUST expose no duty-panel selectors and MUST collapse the unused duty
  track. At single-column widths, verify natural panel order and the absence of a reserved alignment
  gap rather than comparing unrelated cards.
- Capture screenshots for English and Arabic at every acceptance width. Each screenshot set identifies
  the locale, viewport width, fixture case, and adjacent cards, and shows complete names, addresses,
  duty guidance where applicable, opening hours, and actions. Record the measured top values and
  pass/fail result alongside the screenshots.

## 9. Localization and RTL Contract

- EN, EL, RU, and AR expose equivalent meaning and functionality.
- Arabic uses RTL composition across header, tabs, summary, controls, cards, and actions.
- Official identity uses automatic bidi isolation; telephone, time, distance, coordinate, and URL
  values retain stable readable direction.
- Translated expansion may grow cards or controls; it must not hide critical content.

## 10. Preservation Contract

The redesign preserves all working capabilities present at implementation start unless a separately
approved specification removes one. The current baseline includes district tabs, list, Today/Tomorrow,
All/Open Now/On Duty, pharmacy text filtering, manual location search, GPS, approximate distance,
progressive reveal, Call, Directions, language switching, legal/source navigation, attribution, and
unknown-data messaging. No in-app map or map/list switcher is present in the current baseline; if one
appears through concurrent user work before implementation, it must be preserved and re-tested.

## 11. Visual Reference Contract

CyNightMeds may inform evaluation of compact tab clarity only. Cyprus Pharmacy retains independent
branding, composition, status hierarchy, content model, and visual identity.
