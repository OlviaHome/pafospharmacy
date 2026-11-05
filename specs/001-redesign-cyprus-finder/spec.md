# Feature Specification: Cyprus-wide Pharmacy Finder Redesign

**Feature Branch**: `not-created (no branch hook configured)`

**Created**: 2026-11-03

**Status**: Draft

**Input**: User description: "Redesign the Cyprus-wide pharmacy finder around five district tabs,
district-scoped results and counts, a revised header, consistent cards with visible hours, truthful
normal/duty/night status, responsive multilingual presentation, and honest distance wording. Assess
the existing implementation and account for stale Paphos-only documentation without implementing the
redesign yet."

## Current State and Gap Analysis

This assessment describes the current working tree, not only the last committed state. The focused
finder, district-data, manual-search, and location-route test suites passed 104 tests on 2026-11-03.

| Capability | Current status | Remaining specification gap |
|------------|----------------|-----------------------------|
| Five district tabs | Implemented baseline | Acceptance coverage must exercise all five text-only tabs, mobile horizontal scrolling, and a clearly visible active state. |
| District-specific lists and counts | Implemented baseline | All list, total-count, duty-count, search, empty, and error states must be proven free of cross-district leakage. |
| District summary | Implemented baseline | The selected district, Cyprus-local date, total count, and duty count must update together without a secondary "updating..." line. |
| Updated header | Partially implemented | The live finder has Cyprus Pharmacy branding, information links, and language selection; consistent behavior in compact and loading states still needs acceptance coverage. |
| Consistent pharmacy cards and visible hours | Implemented baseline | Cards must align consistently within the same responsive context while expanding rather than truncating critical safety content. |
| Normal, duty, and nighttime status | Implemented baseline | Daytime duty, scheduled gaps, and nighttime call-first wording need explicit visual and localized acceptance coverage. |
| Mobile-first responsive layout | Partially implemented | Compact spacing, touch targets, horizontal district-tab scrolling, card consistency, and the full mobile/tablet/desktop acceptance matrix are not yet formal gates. |
| English, Greek, Russian, and Arabic RTL | Implemented baseline | District navigation, counts, headers, cards, and distance disclosure must all be verified in every locale. |
| Honest distance presentation | Implemented baseline | Straight-line disclosure exists; all distance-bearing states must be checked to ensure none imply road distance or travel time. |
| District-switch search state | Partially implemented | Suggestions are cleared, but a manual origin selected for the previous district can remain active; district-scoped manual state must not leak across tabs. |
| Existing map/list experience | Must be preserved | The redesign must not remove a working list, map, view switcher, or other functioning finder capability solely to simplify the new presentation. |
| Cyprus-wide documentation | Missing | Several architecture, decision, roadmap, and data-model statements still describe a Paphos-only UI and must be reconciled during implementation. |

The Cyprus-wide requirements in `PRODUCT.md` and Constitution v1.1.0 are authoritative for this
feature. Earlier Paphos-only statements are historical implementation constraints, not requirements
that narrow this specification.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Choose a District and See Only Its Pharmacies (Priority: P1)

A resident, visitor, or tourist selects one of the five Cyprus districts and immediately sees the
pharmacies, counts, and search results for that district only.

**Why this priority**: Geographic integrity is the foundation of a trustworthy national finder. A
cross-district result can waste critical time and make every later status or distance claim misleading.

**Independent Test**: Supply distinct pharmacies and duty assignments for all five districts, select
each tab in turn, and verify that its list, total count, duty count, searches, and empty state contain
only records from the selected district.

**Acceptance Scenarios**:

1. **Given** pharmacy records in all five supported districts, **When** the user selects each district
   tab, **Then** only that district's pharmacies appear and the selected tab is unambiguous.
2. **Given** different total and on-duty counts by district, **When** the district or selected day
   changes, **Then** both counts update to the chosen district and day without values from another
   district.
3. **Given** a pharmacy or manual-location query, **When** the selected district changes, **Then** any
   displayed matches are re-evaluated within the new district and stale suggestions or manual origins
   from the previous district are not used.
4. **Given** a district with no matches for the active filter, **When** results are displayed, **Then**
   the empty state names or clearly inherits that district and does not show another district's data.
5. **Given** a narrow mobile viewport, **When** all five district tabs do not fit at once, **Then** the
   text-only tab row scrolls horizontally, contains no district icons, and keeps the active tab clearly
   visible.
6. **Given** a district or day change, **When** the result view updates, **Then** one district summary
   updates the selected district name, Cyprus-local date, total pharmacy count, and duty count together
   without showing a small auxiliary "updating..." line.

---

### User Story 2 - Understand Whether a Pharmacy Can Be Used Now (Priority: P1)

A user can scan a consistent pharmacy card and distinguish normal physical opening, official duty,
a scheduled duty gap, nighttime telephone availability, closed status, and unavailable schedule data.

**Why this priority**: The product's primary safety promise depends on never treating on duty or
nighttime phone coverage as proof that the premises are physically open.

**Independent Test**: Present cards at representative ordinary-open, ordinary-closed, duty-open,
duty-gap, overnight-call, tomorrow, and unsupported-date instants and verify the visible status and
hours against the supported official rules.

**Acceptance Scenarios**:

1. **Given** a pharmacy inside a supported normal opening period, **When** its card is shown for Today,
   **Then** it is identified as physically open and its applicable opening periods are visible.
2. **Given** a pharmacy assigned to duty but outside a mandatory duty-open period, **When** its card is
   shown, **Then** it remains identified as on duty without being labeled open.
3. **Given** an assigned pharmacy in its supported overnight phone period, **When** its card is shown,
   **Then** the card says to call first and does not imply that the premises are open.
4. **Given** overlapping trustworthy normal and duty facts, **When** the card is shown, **Then** all
   applicable states remain distinct and any conflict warning is visible.
5. **Given** an unsupported date or missing trustworthy schedule data, **When** the card is shown,
   **Then** hours and status are explicitly unavailable rather than guessed.
6. **Given** Tomorrow is selected, **When** cards are shown, **Then** tomorrow's periods are visible and
   no live Open Now claim is repurposed for tomorrow.
7. **Given** a supported official duty profile transitions to overnight phone coverage at 22:00,
   **When** that boundary is reached, **Then** the card changes to localized call-first wording through
   the source-supported end time, generally 08:00, without claiming physical opening.
8. **Given** cards with different address or safety-message lengths, **When** they share the same
   responsive layout, **Then** their visual structure remains consistent and any card with additional
   critical content expands instead of truncating or hiding it to force equal height.
9. **Given** cards in the same responsive row or context have different pharmacy-name or address
   lengths, **When** those cards are displayed in any supported browser, **Then** the top edges of duty
   panels that are present differ by no more than 1 CSS pixel and the top edges of opening-hours panels
   differ by no more than 1 CSS pixel within that row. If no card in the row has duty content, no duty-
   panel space is reserved; single-column cards use natural vertical flow without artificial alignment
   gaps; alignment from one multi-column row does not affect another; and all addresses and safety-
   critical information remain fully visible and untruncated.

---

### User Story 3 - Find a Nearby Pharmacy Without Misleading Distance Claims (Priority: P2)

A user may browse without location, use device location, or select a manual area or address and see
approximate distance only where a trusted pharmacy coordinate exists.

**Why this priority**: Proximity helps users act quickly, but it must remain optional, private, and
truthful about what is and is not known.

**Independent Test**: Exercise no-origin, device-origin, and manual-origin paths with pharmacies that
have known and unknown coordinates, then verify ordering, visibility, labels, and district isolation.

**Acceptance Scenarios**:

1. **Given** no location origin, **When** the user browses a district, **Then** every matching pharmacy
   remains usable without a distance and no location permission is required.
2. **Given** an explicit location origin and trusted pharmacy coordinates, **When** results appear,
   **Then** known approximate straight-line distances sort nearest-first and unknown-distance records
   remain visible afterward.
3. **Given** a displayed distance, **When** the user reads its label, **Then** it is clearly identified
   as straight-line distance and is not described as road distance, route distance, or travel time.
4. **Given** the user changes availability filter or day, **When** results update, **Then** the chosen
   origin remains available without requesting device permission again.
5. **Given** a manual origin selected within one district, **When** another district is selected,
   **Then** that district-scoped manual origin is cleared or replaced before distance is shown there.

---

### User Story 4 - Use the Finder on Any Supported Device and Language (Priority: P2)

A user can complete the primary pharmacy-finding journey on a small phone or larger screen in English,
Greek, Russian, or Arabic, with correct right-to-left behavior for Arabic.

**Why this priority**: Cyprus residents and visitors need the same safety meaning regardless of
language, script direction, or device size.

**Independent Test**: Complete district selection, status review, search, call, and directions in all
four locales at representative phone, tablet, and desktop widths using pointer and keyboard input.

**Acceptance Scenarios**:

1. **Given** any supported locale, **When** the finder is opened, **Then** the header, district tabs,
   controls, counts, statuses, hours, actions, errors, and distance disclosure use that locale.
2. **Given** Arabic is active, **When** mixed-script official identity, telephone numbers, times,
   distances, and URLs appear, **Then** the page is right-to-left while those stable values remain
   legible and correctly ordered.
3. **Given** a narrow phone viewport, **When** the user navigates the finder, **Then** every district tab
   and primary control remains reachable without clipped critical content or horizontal page overflow.
4. **Given** keyboard-only navigation, **When** the user moves through the header, tabs, filters,
   search, cards, and actions, **Then** focus order, accessible names, and selected states are clear.
5. **Given** a phone-sized Arabic view, **When** district tabs, summaries, statuses, addresses, hours,
   and actions are displayed, **Then** the composition is compact and touch-friendly, the overall flow
   is right-to-left, and mixed-direction safety content remains readable.

---

### User Story 5 - Keep Existing Finder Paths Working (Priority: P3)

A returning user can continue using the working finder experiences that existed before the visual
redesign, including the pharmacy list and any map/list switching available at implementation time.

**Why this priority**: A visual redesign must improve comprehension without silently removing useful,
working behavior or forcing users into a narrower path.

**Independent Test**: Record the working finder capabilities before implementation, complete the
redesign, and verify that each capability remains reachable and preserves its prior user value unless
a separately approved specification explicitly replaces it.

**Acceptance Scenarios**:

1. **Given** the existing list, search, filter, location, Call, and Directions experiences, **When** the
   redesign is complete, **Then** each remains reachable and functional.
2. **Given** a working map or map/list switcher exists at implementation start, **When** the redesign is
   complete, **Then** it remains available and respects the selected district and active filters.
3. **Given** a working feature is not named as a removal in this specification, **When** redesign scope
   is reviewed, **Then** visual simplification alone is not accepted as a reason to remove it.

### Edge Cases

- A supported district has zero pharmacies, zero duty assignments, or zero matches for a filter.
- A pharmacy's district is missing or is not one of the five supported district values.
- A district is changed while a manual-location request is pending or suggestions are visible.
- A manual origin from the former district remains selected when another district tab is chosen.
- A pharmacy has no trusted coordinates, an expired coordinate, or a quarantined ambiguous match.
- Device location is denied, unavailable, slow, or changes between requests.
- Search text uses Greek, Cyrillic, Arabic, Latin, mixed script, or decomposed Unicode characters.
- Counts change at a Cyprus day boundary or when Today/Tomorrow changes.
- A pharmacy has multiple opening periods separated by an afternoon break.
- A duty period crosses midnight and belongs to the previous assignment date until its supported end.
- Normal opening and duty status overlap, or recorded intervals conflict with a derived duty mode.
- The evaluated date falls outside the supported regular or duty rule coverage.
- Official pharmacy names or addresses are longer than typical and contain mixed-direction content.
- A localized label expands beyond the space available in a tab, badge, button, or card.
- A district tab becomes partially obscured at either end of a horizontally scrolled tab row.
- Pharmacy cards in the same row contain substantially different address, hours, or warning lengths.
- A supported nighttime duty boundary occurs at 22:00 while another versioned profile uses a
  different source-defined transition time.
- The safety message needed by one card is longer than the space available in neighboring cards.
- A working map/list switcher exists at implementation start even though a new map is outside scope.
- Only some pharmacies in the selected district have trusted coordinates.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The finder MUST present exactly five first-class district choices: Nicosia, Limassol,
  Larnaca, Famagusta, and Paphos.
- **FR-002**: Exactly one district MUST be visibly and programmatically selected whenever the finder is
  showing district-scoped content.
- **FR-003**: The selected district MUST consistently scope pharmacy lists, filtered results, total
  counts, on-duty counts, search matches, suggestions, loading states, empty states, and errors.
- **FR-004**: A district view MUST NOT display or count a pharmacy, duty assignment, cached suggestion,
  or manual search result belonging to another district.
- **FR-005**: District totals MUST show the selected district's active pharmacy count and the on-duty
  count for the selected Cyprus local day.
- **FR-006**: Switching districts MUST cancel or discard pending and displayed manual-location results
  for the previous district.
- **FR-007**: When a district changes, a manual origin selected under the previous district MUST be
  cleared unless it is independently verified within the newly selected district; a device-location
  origin MAY remain because it is not district-derived.
- **FR-008**: Search text that remains after a district change MUST be visibly re-evaluated only against
  the newly selected district.
- **FR-009**: The header MUST provide Cyprus Pharmacy identity, language selection, and access to the
  essential service-information and data-source disclosures without obstructing the primary task on
  small screens.
- **FR-010**: The header and its loading state MUST preserve recognizable branding and a stable entry
  point while avoiding a false impression that stale pharmacy results are current.
- **FR-011**: Every pharmacy card MUST use a consistent hierarchy for current status, official identity,
  official address, applicable hours, distance when known, Call, and Directions.
- **FR-012**: Every card MUST show the selected day's applicable physical-opening periods or an explicit
  hours-unavailable or closed-all-day explanation.
- **FR-013**: Cards MUST keep normal opening, official duty assignment, and nighttime phone coverage as
  separate visible concepts, including when more than one applies.
- **FR-014**: Open Now MUST mean physical opening at the current instant through a trustworthy normal
  period, duty-open period, or recorded open interval; on-duty assignment or nighttime phone coverage
  alone MUST NOT qualify.
- **FR-015**: A scheduled duty gap MUST identify the pharmacy as on duty while explicitly stating that
  the premises are not currently in a mandatory duty-open interval.
- **FR-016**: Nighttime coverage MUST use call-first wording, show its supported time boundary, and MUST
  NOT imply physical opening.
- **FR-017**: Unsupported dates, missing facts, and source gaps MUST be displayed as unknown or
  unavailable rather than inferred.
- **FR-018**: Today MUST be the default day; Tomorrow MUST show tomorrow's supported periods without a
  live Open Now filter or badge.
- **FR-019**: All, Open Now, and On Duty filters MUST operate only within the selected district and day;
  Open Now MUST be unavailable when it cannot truthfully apply.
- **FR-020**: Pharmacies without trusted coordinates MUST remain visible with status, address, Call, and
  Directions behavior that does not invent a coordinate.
- **FR-021**: Location sharing MUST remain optional, explicit, transient, and unnecessary for district
  browsing, status, hours, Call, or Directions.
- **FR-022**: A displayed proximity value MUST be labeled as approximate straight-line distance and
  MUST state that an actual walking or driving route may be longer.
- **FR-023**: The finder MUST NOT derive, label, or imply road distance, route distance, or travel time
  from straight-line distance.
- **FR-024**: With an origin present, results with known trusted distances MUST sort nearest-first within
  the selected district, followed by all matching pharmacies without a distance.
- **FR-025**: The finder MUST NOT describe the trusted-coordinate subset as globally nearest among every
  pharmacy when some selected-district pharmacies lack coordinates.
- **FR-026**: English, Greek, Russian, and Arabic MUST provide equivalent district, status, schedule,
  action, error, source, and distance meaning.
- **FR-027**: Arabic MUST use a right-to-left page direction while official identity, telephone values,
  times, distances, coordinates, and URLs preserve their natural readable direction.
- **FR-028**: The district tabs, header controls, filters, search, cards, and actions MUST remain usable
  with touch, pointer, and keyboard input from a 320-pixel-wide phone through desktop layouts.
- **FR-029**: Ordinary users MUST NOT need an account or login to use any feature in this specification.
- **FR-030**: Official identity and address MUST remain canonical and visibly separate from coordinate
  enrichment, matching evidence, and provider attribution.
- **FR-031**: Implementation of this feature MUST reconcile the superseded Paphos-only statements in
  the architecture, decisions, roadmap, and data-model documentation with the Cyprus-wide product and
  Constitution v1.1.0.
- **FR-032**: Paid or promotional content, if introduced later, MUST NOT alter district counts,
  availability truth, official-duty status, or proximity ordering.

### UI/UX Requirements

- **UX-001**: The district switcher MUST contain five text-only tabs—Nicosia, Limassol, Larnaca,
  Famagusta, and Paphos—with no district icons.
- **UX-002**: On mobile, the district-tab row MUST scroll horizontally when needed without causing the
  page itself to overflow horizontally, and every tab MUST remain reachable by touch and keyboard.
- **UX-003**: The active district MUST have an unmistakable visual state that does not rely on color
  alone, and its selected state MUST also be available to assistive technology.
- **UX-004**: The district summary MUST present the selected district name, current Cyprus-local date,
  total pharmacy count, and selected-day duty count as one coherent summary. All four values MUST
  update when their governing state changes, and the summary MUST NOT include a small "updating..."
  status line.
- **UX-005**: Pharmacy cards shown within the same responsive context MUST use a consistent visual
  hierarchy, spacing system, action placement, and intended height behavior so lists are easy to scan.
- **UX-006**: Equal-height presentation MUST NOT truncate, clamp, collapse, obscure, or remove an
  address, opening hours, status explanation, conflict warning, nighttime call-first instruction, or
  other safety-critical content. A card MUST expand when necessary to show that content fully.
- **UX-007**: Every pharmacy card MUST keep the address readable, make opening hours visible without a
  secondary expansion action, and present Call and Directions as clear, touch-friendly actions.
- **UX-008**: Status presentation MUST establish a clear hierarchy among normal physical opening,
  daytime official duty, scheduled duty gaps, closed status, nighttime call-first coverage, conflicts,
  and unavailable data. Meaning MUST be conveyed by localized wording as well as visual styling.
- **UX-009**: Daytime duty, scheduled duty gaps, and nighttime coverage MUST use human-readable wording
  derived from the applicable supported official schedule profile. When a supported profile begins
  overnight coverage at 22:00, the wording MUST switch at 22:00 and communicate call-first coverage
  through its source-supported end time, generally 08:00. Profiles with another supported transition
  time MUST use that source-defined time instead of forcing 22:00.
- **UX-010**: The finder MUST be compact, clean, readable, and touch-friendly on small screens, with
  primary interactive targets at least 44 by 44 CSS pixels and no critical action dependent on hover.
- **UX-011**: Arabic MUST be visually correct in right-to-left layout across the header, district tabs,
  summary, filters, cards, status messages, hours, and actions, while stable numbers and mixed-script
  official identity remain readable in their natural direction.
- **UX-012**: CyNightMeds MAY inform the clarity and compactness of the district-switching experience
  as a visual reference, but the redesign MUST NOT copy its composition, branding, visual identity, or
  treat it as a template.
- **UX-013**: The redesign MUST preserve the working finder list and any working map/list experience
  present at implementation start. It MUST NOT remove an existing working feature solely because the
  current redesign emphasizes the finder list.
- **UX-014**: In every supported browser and every multi-column card row, pharmacy cards MUST use a
  row-scoped shared internal grid so that the top edges of duty panels that are present differ by no
  more than 1 CSS pixel and the top edges of opening-hours panels differ by no more than 1 CSS pixel,
  regardless of pharmacy-name or address length. If no card in that row has duty content, the row MUST
  reserve no duty-panel space. Single-column layouts MUST use natural vertical flow without artificial
  alignment gaps, and track sizing or alignment MUST NOT propagate between unrelated card rows. The
  top text area MAY vary, but alignment MUST improve scanability without hiding, truncating,
  compressing, or visually degrading any address or safety-critical information. Alignment MUST NOT
  depend on translating, normalizing, rewriting, or otherwise shortening address content; an address-
  shortening strategy is not defined by this specification.

### Scope Boundaries

This feature does not require creation of a new map view, road routing, travel-time estimates, accounts,
pharmacy business profiles, push notifications, automated official-data synchronization, new
availability rule families, or a new source of pharmacy identity. Any working map/list experience
present at implementation start remains in scope for preservation. The feature does not reinterpret
overnight duty as physical opening and does not expand schedule claims beyond the dates supported by
versioned official sources.

### Key Entities *(include if feature involves data)*

- **District**: One of the five supported Cyprus district scopes; determines which pharmacies, counts,
  searches, and suggestions may appear together.
- **Pharmacy**: The canonical official pharmacy identity, registration, address, public telephone,
  district, optional trusted coordinate, and attributed source facts shown in a card.
- **Selected Day**: Today or Tomorrow in Cyprus local time; determines the date used for hours and duty
  counts while never redefining Open Now for a future date.
- **Availability State**: Distinct physical-opening, on-duty, on-call, closed, conflict, or unknown
  meanings derived from trustworthy facts and supported rules.
- **Schedule Period**: A source-backed or rule-derived time period for normal opening, mandatory duty
  opening, or nighttime phone coverage.
- **Search Origin**: An optional transient device location or user-selected manual location used only
  for approximate proximity presentation.
- **Distance Presentation**: An optional approximate straight-line value tied to a trusted pharmacy
  coordinate, with explicit limitations and no routing inference.
- **Locale**: English, Greek, Russian, or Arabic presentation rules, including right-to-left layout and
  bidirectional isolation where required.

## Success Criteria *(mandatory)*

### Measurable Outcomes

SC-002 and SC-003 are post-implementation user-research targets. They remain product success goals,
but they are not implementation-phase technical acceptance gates and cannot be marked as achieved from
automated tests, fixture reviews, screenshots, or expert visual inspection. The current implementation
phase is accepted against the objective checks in SC-001, SC-004 through SC-010, and DAC-001 through
DAC-011; later research with representative participants is required to measure SC-002 and SC-003.

- **SC-001**: Across a five-district acceptance dataset, 100% of district-tab selections produce the
  correct pharmacy list, total count, duty count, search results, and empty state with zero records
  leaking from another district.
- **SC-002 — Post-implementation user-research target**: At least 90% of representative residents,
  expats, and tourists can select a district and identify a usable pharmacy or a truthful no-match
  state within 10 seconds on their first attempt.
- **SC-003 — Post-implementation user-research target**: At least 95% of usability-test participants
  correctly distinguish physical opening, on-duty assignment, and nighttime call-first coverage after
  viewing the relevant cards.
- **SC-004**: In every supported day/status test case, 100% of visible pharmacy cards show applicable
  hours, a closed-all-day reason, or an explicit unavailable state.
- **SC-005**: All tested distance-bearing views in all four locales identify distance as approximate
  straight-line distance; zero views label or imply it as road distance or travel time.
- **SC-006**: The complete primary journey—district selection, filtering or search, reading status and
  hours, and reaching Call or Directions—can be completed without login or location sharing.
- **SC-007**: All four locales pass the same functional acceptance scenarios, and Arabic passes them in
  right-to-left layout without critical clipping, reversed time/number values, or inaccessible actions.
- **SC-008**: At representative phone, tablet, and desktop widths from 320 pixels upward, all five
  district choices and every primary control remain reachable without horizontal page overflow.
- **SC-009**: Changing districts while manual search is pending, showing suggestions, or holding a
  selected manual origin results in zero stale previous-district suggestions or distances.
- **SC-010**: The final feature review finds no active Paphos-only UI requirement in the project
  documentation that contradicts the Cyprus-wide product and Constitution v1.1.0.

### Design Acceptance Criteria

For the current implementation phase, these criteria are verified only through observable interface
state, content, accessibility semantics, geometry, interaction, and regression behavior. Screenshots
may document visual state and measured layout, but they do not demonstrate real-user comprehension or
task-completion speed.

- **DAC-001**: At widths from 320 pixels upward, the district switcher contains exactly five text-only
  tabs, contains no district icons, scrolls horizontally when needed, and exposes all tabs without
  horizontal page overflow.
- **DAC-002**: In every supported locale, the active district is identifiable in visual review without
  relying on color alone and exposes a selected state to assistive technology.
- **DAC-003**: After every district, day, or relevant data change, the district summary shows the
  correct district name, Cyprus-local date, total pharmacy count, and duty count, with no auxiliary
  "updating..." line.
- **DAC-004**: Within each tested responsive context, pharmacy cards maintain consistent hierarchy,
  spacing, and action placement. Cards align consistently where content allows and expand where needed;
  zero critical addresses, hours, status explanations, warnings, or actions are truncated or hidden.
- **DAC-005**: In ordinary-open, ordinary-closed, daytime-duty, scheduled-gap, nighttime-call-first,
  conflict, and unavailable-data examples, every card MUST visibly render the expected localized
  primary state and applicable action guidance from the supported rule fixture without requiring
  another view. The states MUST remain distinguishable without color alone; applicable hours or an
  explicit unavailable reason MUST remain visible; and duty or call-first wording MUST NOT claim
  physical opening. This technical check establishes interface conformance only; SC-003 requires
  separate post-implementation participant research.
- **DAC-006**: For a supported 22:00 overnight transition, the last daytime state before 22:00 and the
  first nighttime state at 22:00 show different, localized human-readable wording; the nighttime state
  says to call first through the supported end time, generally 08:00, and never says the premises are
  open.
- **DAC-007**: At phone, tablet, and desktop widths, all primary controls and actions are readable,
  reachable by touch and keyboard, and have a minimum interactive area of 44 by 44 CSS pixels.
- **DAC-008**: Arabic visual review passes on phone and desktop with correct right-to-left composition,
  readable mixed-direction identity and time values, no clipped critical content, and no reversed
  Call or Directions action order that changes meaning.
- **DAC-009**: Regression review confirms that 100% of the working finder capabilities recorded before
  implementation—including the list and any existing map/list switcher—remain available unless a
  separately approved specification explicitly removes one.
- **DAC-010**: Visual review confirms that CyNightMeds was used only as a reference for clarity and not
  copied as the product's layout, branding, or visual identity.
- **DAC-011**: In every supported browser, each tested multi-column card row with short and long
  pharmacy names or addresses has a maximum 1 CSS-pixel difference among the top-edge positions of
  duty panels that are present and a maximum 1 CSS-pixel difference among the top-edge positions of
  all opening-hours panels in that row. A row in which no card has duty content reserves zero duty-
  panel space. Single-column layouts retain natural vertical flow without artificial gaps, and the
  content or track sizes of one multi-column row do not alter panel positions in an unrelated row.
  Every tested case keeps addresses and safety-critical content fully visible, readable, unaltered,
  and untruncated.

## Assumptions

- `PRODUCT.md` and Constitution v1.1.0 define the intended Cyprus-wide product and supersede earlier
  Paphos-only UI scope statements for this feature.
- The existing official dataset continues to provide active pharmacy identities and duty assignments
  for all five supported districts; this feature does not create missing source facts.
- The initial active district may follow the existing product default, provided one district is always
  explicit and the user can reach every other district immediately.
- Existing Today/Tomorrow, All/Open Now/On Duty, Call, Directions, optional location, and source-
  attribution behavior remains in scope and must not regress.
- Existing versioned regular and duty rules remain the sole basis for schedule-derived claims.
- A manual location is district-scoped; device location is not, but either origin remains transient
  and unpersisted.
- Directions may hand off to a mapping service, but the finder itself provides no road distance or
  travel-time estimate in this feature.
- The existing implementation is a valid baseline to preserve where it already satisfies these
  requirements; the plan should target verified gaps rather than rebuild completed behavior.
- CyNightMeds is a visual reference for a compact district-switching pattern only; Cyprus Pharmacy
  retains its own information hierarchy, branding, and visual identity.
- Card consistency means shared structure and alignment within the same responsive context, not a
  fixed height that overrides content safety or readability.
- Address shortening remains undecided and outside this feature specification; card alignment does
  not require translating, normalizing, rewriting, or otherwise shortening address content.

## Documentation Reconciliation Notes

The implementation phase must review and reconcile at least these outdated statements:

- `docs/ARCHITECTURE.md` states that the repository selects Paphos for the current UI.
- `docs/DECISIONS.md` D-019 keeps product queries and UI focused on Paphos.
- `docs/ROADMAP.md` describes the UI as Paphos-only and defers district selection.
- `docs/DATA_MODEL.md` says the UI selects Paphos and lists national UI selection as excluded.
- `AGENTS.md` still introduces the project as Paphos Pharmacy even though the governing product and
  constitution now define Cyprus Pharmacy as a five-district service.

These notes do not authorize changing historical source facts, Paphos-specific coordinate enrichment,
or provider reconciliation scope. They require only that current product/UI scope documentation stop
contradicting the Cyprus-wide finder once the feature is implemented.
