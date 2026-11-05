# Data Model: Cyprus-wide Pharmacy Finder Redesign

## Scope

This feature does not change the persisted pharmacy, availability interval, duty assignment, or
coordinate models. It defines the presentation and transient-state model needed to implement and test
the redesigned finder safely.

## Existing Persisted Entities (Unchanged)

### Pharmacy

Canonical official identity with registration number, official address, public telephone, district,
active state, source provenance, optional separately attributed coordinate, timed intervals, and
date-only duty assignments.

**Relevant invariants**:

- `district` must map to one supported district before the record can appear in a district view.
- Missing or untrusted coordinates do not remove the pharmacy from the list.
- Official identity/address are not replaced by geocoder or Places display fields.

### Availability Interval

Trustworthy timed fact with start, end, schedule kind, and service mode.

**Relevant invariants**:

- Half-open interval semantics remain unchanged.
- Intervals may overlap across ordinary and duty layers, never within one schedule kind for a pharmacy.
- A phone/on-call interval does not prove physical opening.

### Duty Assignment

Official date-only rota fact for one pharmacy and Cyprus local date.

**Relevant invariants**:

- The row proves on-duty assignment only.
- Supported versioned duty rules may derive daytime open periods, gaps, and overnight phone periods at
  runtime without modifying the row.

## Transient Finder Entities

### Supported District

One of `Nicosia`, `Limassol`, `Larnaca`, `Famagusta`, or `Paphos`.

**Relationships**:

- Owns a view of zero or more active pharmacies.
- Scopes pharmacy search, manual-location requests/results, list/count derivation, and empty/error states.

**Validation rules**:

- Exactly one district is selected while district content is visible.
- No pharmacy, count, suggestion, or manual match from another district may enter the selected view.

### Finder View State

| Field | Values | Rules |
|-------|--------|-------|
| `selectedDistrict` | Supported District | Always present and visible. |
| `selectedDay` | Today or Tomorrow | Evaluated in `Asia/Nicosia`; Today is initial value. |
| `availabilityFilter` | All, Open Now, On Duty | Open Now is not available for Tomorrow or unsupported current rules. |
| `pharmacyQuery` | Normalized transient text | Applied only after district scoping. |
| `manualSearchState` | Idle, Searching, Error | Pending work is cancelled on district/query replacement. |
| `manualSuggestions` | Zero to three district matches | Cleared on district change and never shared across district scope. |
| `searchOrigin` | None, GPS, or Manual | Transient; manual origin clears on district change; GPS may remain. |
| `resultsExpanded` | Boolean | Resets on district, day, filter, or origin changes. |
| `currentInstant` | Current instant | Advances during the session; local-day rollover reloads current facts. |

### District Summary

| Field | Derivation |
|-------|------------|
| Localized district name | Selected district plus active locale |
| Cyprus-local date | Selected day window in `Asia/Nicosia` |
| Total pharmacy count | All active pharmacies in selected district, before availability filter |
| Duty count | Selected-district pharmacies with a relevant assignment for selected local date |

**Validation rules**:

- All four fields update from one consistent selected district/day state.
- The summary has no asynchronous `updating...` substate because district/day derivation is local.
- Counts use locale-aware digits and plural forms.

### Pharmacy Card Presentation

| Field group | Content |
|-------------|---------|
| Status | Physical open/closed/unknown, on-duty assignment, on-call, conflict |
| Identity | Official name and readable official address |
| Hours | Selected-day normal/duty physical-opening periods or explicit unavailable/closed reason |
| Duty guidance | Daytime duty, scheduled gap, or active call-first period with supported boundaries |
| Proximity | Optional approximate straight-line distance and limitation text |
| Actions | Call or phone-unavailable state; Directions handoff |
| Attribution context | Existing source/location notes outside or associated with the list |

**Validation rules**:

- Critical content is never clamped, truncated, hidden, or removed for equal height.
- Cards share hierarchy, spacing, and action placement within one responsive context.
- Stable time, telephone, coordinate, and mixed-script values preserve readable direction.

### Status Presentation

| State | Physical opening claim | Required user wording |
|-------|------------------------|-----------------------|
| Ordinary open | Yes | Open now plus applicable normal hours |
| Ordinary closed/break | No | Closed/break plus next supported period when known |
| Daytime duty-open | Yes | Open now and on duty, with supported duty hours |
| Scheduled duty gap | No | On duty, premises not in a mandatory open interval |
| Nighttime on-call | No | Night duty/call first, with active start/end boundaries |
| Conflict | Not simplified | Call-to-confirm warning plus underlying facts |
| Unsupported/unknown | No inferred claim | Hours/status unavailable |

### Distance Presentation

Optional value derived from a transient origin and trusted pharmacy coordinate.

**Validation rules**:

- Described as approximate straight-line distance.
- Never labeled or transformed into road distance, route distance, or travel time.
- Unknown-distance pharmacies remain visible after known-distance results.

### Locale Presentation

One of English, Greek, Russian, or Arabic.

**Validation rules**:

- Equivalent status, schedule, action, error, and limitation meaning in every locale.
- Arabic owns page RTL; mixed-script identity and stable numeric/time values use bidi isolation.

## State Transitions

| Event | Required transition |
|-------|---------------------|
| Select district | Set district; cancel manual lookup; clear suggestions/error; clear manual origin; retain GPS origin; reset reveal; re-derive summary/results. |
| Select Today/Tomorrow | Set day; reset reveal; replace invalid Open Now filter with All; preserve origin. |
| Select availability filter | Set allowed filter; reset reveal; preserve district/day/origin. |
| Edit manual query | Cancel prior lookup; clear any origin; clear suggestions/error; derive district pharmacy-name/address matches. |
| Submit manual query | Send normalized query plus selected district; expose at most three same-district suggestions. |
| Choose manual suggestion | Set manual origin; clear suggestions/error; retain selected district; reset reveal. |
| Request GPS | Ask only after explicit action; set transient GPS origin on success; never send it to the server. |
| Clear origin | Remove origin/query and restore complete selected-district browse. |
| Cyprus date rollover | Reload current facts and re-derive day/status/count presentation. |

## Persistence Impact

None. No migration, table, stored boolean, schedule materialization, location history, or browser-storage
change is permitted by this plan.
