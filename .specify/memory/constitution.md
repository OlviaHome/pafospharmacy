<!--
Sync Impact Report
- Version change: 1.0.0 -> 1.1.0
- Modified principles:
  - IV. Fast, Complete, Inclusive Access (added Cyprus-wide district integrity)
- Added sections: none
- Removed sections: none
- Expanded constraints:
  - Added consistent five-district scoping for pharmacy lists, counts, and search results
  - Added truthful straight-line distance labeling and prohibited road/travel inference
- Documentation conflicts identified (not modified):
  - `docs/ARCHITECTURE.md` says the repository selects Paphos for the current UI
  - `docs/DECISIONS.md` D-019 keeps the product query and UI focused on Paphos
  - `docs/ROADMAP.md` says the UI remains Paphos-only and defers district selection
  - `docs/DATA_MODEL.md` says the UI selects Paphos and national UI selection is excluded
- Follow-up TODOs: none
-->
# Cyprus Pharmacy Constitution

## Core Principles

### I. Truthful Availability Semantics
Open now, on duty, and on call MUST remain distinct in data, domain logic, filters, and copy.
Open now means physical opening at the evaluated instant; on duty means an explicit official rota
assignment; on call means phone contact may be required. The application MUST derive these states
from trustworthy facts and versioned runtime rules, never from independent stored booleans. Unknown,
unsupported, or missing coverage MUST be presented as unknown rather than inferred. This principle is
non-negotiable because collapsing these states can send a person to a closed pharmacy.

### II. Source-Bounded Facts and Provenance
Every pharmacy identity, rota assignment, schedule rule, coordinate, and status claim MUST retain its
source, applicable scope, and effective coverage. Official registration identity and address remain
canonical; nullable source gaps MUST be preserved. Date-only rota facts MUST remain date-only, and
generated schedule periods MUST NOT be persisted as source facts. Provider enrichment MUST remain
separate from official data, and ambiguous or materially conflicting matches MUST require human
review. Runtime claims MUST stop at the boundary supported by their cited, versioned sources.

### III. Privacy and Least Privilege
The ordinary-user path MUST require no account. Device location MUST be requested only after an
explicit user action, remain client-side and transient, and never be persisted or sent to the
application server. Manual search origins MUST also remain transient. Credentials and trusted writes
MUST stay server-side; exposed database schemas MUST use row-level security, least-privilege grants,
and public read-only access to the minimum required columns. Provider data MUST be retained only when
the product has a documented purpose and policy-compliant retention basis.

### IV. Fast, Complete, Inclusive Access
The mobile-first experience MUST help a user reach an actionable answer in about ten seconds through
clear status, call, and directions actions. Denied or unavailable location access MUST NOT block the
product: browse-all remains complete within the selected district, and records without coordinates
remain visible. The Cyprus-wide experience MUST support Nicosia, Limassol, Larnaca, Famagusta, and
Paphos as first-class district scopes. English, Greek, Russian, and Arabic experiences MUST preserve
the same safety meaning; Arabic MUST support right-to-left layout and identity, telephone, coordinate,
time, and URL values MUST retain correct direction. Accessibility, responsive behavior, geographic
integrity, and explicit user choice take precedence over decorative or promotional complexity.

### V. Testable Boundaries and Deliberate Scope
Availability, time-window, filtering, distance, and versioned schedule rules MUST live in pure,
testable domain modules rather than React components. Data access MUST remain server-only and separate
from presentation, while ingestion and enrichment MUST remain reproducible trusted batch boundaries
that never run during page rendering. Changes MUST include tests proportionate to safety and regression
risk, especially at time-zone, midnight, half-open interval, unsupported-date, and source-boundary
edges. Work MUST stay within the accepted roadmap; future features require a clean boundary and a
documented decision before they enter the current slice.

## Product and Technical Constraints

- The application MUST use the repository's approved Next.js App Router, React, TypeScript, Tailwind
  CSS, Supabase/PostgreSQL, and PWA-ready architecture unless an accepted decision changes the stack.
- Cyprus calendar and schedule evaluation MUST use `Asia/Nicosia` with half-open interval semantics.
- The supported district set is Nicosia, Limassol, Larnaca, Famagusta, and Paphos. The active district
  MUST consistently scope pharmacy lists, displayed counts, availability results, manual search
  queries, and returned search suggestions. Results from another district MUST NOT be merged into or
  counted within the selected district, including during loading, empty, cached, or error states.
- Trustworthy timed facts belong in `availability_intervals`; overlaps are forbidden within one
  pharmacy and `schedule_kind` but permitted across independent ordinary and duty layers.
- Official date-only rota facts belong in `duty_assignments`; the row alone proves only on-duty status
  for its Cyprus local date.
- The official regular schedule and official duty schedule MUST remain independent rule layers. Open
  now is their physical-opening union; overnight phone coverage never constitutes physical opening.
- Google Places data MUST remain separate from canonical official fields and existing geocoding.
  Probable or ambiguous candidates MUST NOT drive distance, directions, filtering, or status logic.
- Coordinate-to-coordinate distance MUST be described as approximate straight-line distance. It MUST
  NOT be labeled or interpreted as road distance, route distance, or travel time, and none of those
  values may be inferred from straight-line distance. Road distance and travel time require output
  from an explicit routing provider with appropriate attribution.
- Direct Places API ordinary-hours content MUST NOT be fetched or persisted for this EEA product.
- Paid placement MUST NOT alter safety-critical truth, availability, official-duty, or proximity
  ranking.

## Development Workflow and Quality Gates

1. Read the relevant product, architecture, data-model, decision, and roadmap documents before design
   or implementation. Read the installed Next.js version's local guidance before changing Next.js
   code.
2. State the source and coverage for every new availability or identity claim. Do not encode legal,
   schedule, seasonal, or provider assumptions without authoritative evidence.
3. Keep domain evaluation independent from UI and persistence. Schema or contract changes MUST update
   migrations, types, access rules, and source documentation together.
4. Add or update focused automated tests for changed domain rules and boundary conditions. Validate
   user-visible behavior across supported locales, mobile layouts, all five district scopes,
   no-location browsing, truthful distance labels, and unknown data states when affected. Tests for
   district-aware behavior MUST verify list, count, and search-result isolation together.
5. Update `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/DECISIONS.md`, or
   `docs/ROADMAP.md` whenever a meaningful product, architecture, data, governance, or scope decision
   changes.
6. Reviews MUST explicitly verify constitution compliance. Any exception MUST be documented with its
   rationale, affected safety properties, migration or rollback plan, and expiry or follow-up.

## Governance

This constitution governs all specifications, plans, tasks, implementation, and review in this
repository. Where guidance conflicts, the constitution controls; the product, architecture, data
model, decisions, roadmap, and `AGENTS.md` provide the detailed rules that implement it.

Amendments MUST be proposed as an explicit constitution change, explain the motivation and migration
impact, update affected repository documentation, and receive human approval before dependent work is
accepted. Constitution versions follow semantic versioning: MAJOR for incompatible principle removal
or redefinition, MINOR for a new principle or materially expanded governance, and PATCH for
non-semantic clarification. Every amendment records its date and a Sync Impact Report.

Every specification and plan MUST pass a constitution check before implementation. Every review MUST
confirm compliance and require explicit justification for added complexity or exceptions. Periodic
governance review MUST occur when official data coverage, legal/provider constraints, product scope,
or core architecture changes.

**Version**: 1.1.0 | **Ratified**: 2026-11-03 | **Last Amended**: 2026-11-03
