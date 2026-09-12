# Product

## Product summary

Paphos Pharmacy is a mobile-first pharmacy finder for Paphos, Cyprus. Its primary job is to answer one urgent question as quickly and clearly as possible:

> Which pharmacy can I use right now?

The first product is a multilingual web app with English master copy, Greek, Russian, and Arabic interfaces, and PWA-ready architecture. It is not a native mobile application and it is not intended to be a generic pharmacy directory.

## Users

- Cyprus residents who need current pharmacy availability.
- Expats who may not understand the local duty system.
- Tourists who need a clear answer with minimal local knowledge.

Ordinary users must not be required to register or log in.

## Product promise

A user should ideally reach a useful, actionable answer within approximately 10 seconds. The home screen therefore prioritizes current pharmacy information, location, calling, and directions over navigation or marketing content.

The product's long-term advantage should come from speed, trustworthy data, clear status language, multilingual support, and eventually useful connections between pharmacies and users.

## Status language

These states are distinct but related and must never be used as synonyms:

- **Open now:** the pharmacy is physically open at the current instant.
- **On duty:** the pharmacy is assigned to an explicit duty-schedule period. This does not by itself prove that its door is open.
- **On call:** the pharmacist may need to be contacted by phone. This does not mean the pharmacy is physically open.

A pharmacy can have more than one state at once. UI copy and filters must say exactly which state is being shown.

## First vertical slice

The first slice includes only:

- A mobile-first Next.js application using the App Router, React, TypeScript, and Tailwind CSS.
- PWA-ready structure, including basic install metadata, without promising offline schedule accuracy.
- Supabase/PostgreSQL with `pharmacies`, timed `availability_intervals`, and date-only `duty_assignments` tables.
- Official Cyprus Pharmaceutical Services pharmacy identities and date-only rota assignments, with visible CC BY 4.0 attribution.
- Availability calculated from explicit timed facts, the versioned 2026 official regular pharmacy schedule, and—during the published May–September 2026 coverage only—the official duty-hours notice applied to an explicit official duty-date record.
- Optional browser geolocation or a user-selected Paphos area/address as the origin for approximate distance.
- An **Open Now** filter whose current official-schedule meaning is the union of the regular pharmacy schedule and any active mandatory duty-open period.
- An **On Duty** filter for the selected local calendar day.
- A Today/Tomorrow selector using Cyprus local time.
- Call and directions actions.
- Locale-prefixed English, Greek, Russian, and Arabic UI with browser-language detection, an explicit saved language choice, and Arabic right-to-left layout.

The default experience must remain useful when location permission is denied or unavailable. Users have three explicit paths: **Use my location**, **Enter area or address**, or browse every pharmacy without sharing location. A denied device permission exposes manual search immediately rather than ending in an error. No origin is required for pharmacy status, address, call, or directions.

Manual search accepts Paphos areas, municipalities, streets, landmarks, hotels, and addresses supported by the geocoder. The user chooses from a short list of Cyprus/Paphos-constrained matches; the application never silently selects among multiple plausible locations.

Distance ordering is limited to pharmacies with verified map coordinates. Pharmacies without coordinates remain visible without a distance, and the UI must not imply that the ordered subset is globally nearest among every Paphos pharmacy.

Once the user chooses GPS or a manual area/address, that origin persists while switching between All, On Duty, Today, and Tomorrow. On Duty results use the same trusted pharmacy coordinates and sort known distances nearest-first, followed by every pharmacy without coordinates. Filter/day changes never request device location again; only an explicit location-button tap may do so.

For the current Paphos reconciliation, only a fresh Google Places exact identity match may be preferred for distance and Directions. Probable or ambiguous Places candidates are never used silently. Existing independently accepted coordinate enrichment remains available as fallback, and the displayed pharmacy identity/address always remains the official Cyprus record.

## Day and filter behavior

- **Today** is the default view and shows current state plus today's relevant schedule periods.
- **Tomorrow** shows explicit schedule periods that overlap tomorrow in Cyprus local time.
- **Open now** always means the real current instant. It is hidden or disabled for Tomorrow rather than being redefined.
- **On duty** for a selected day means that an explicit on-duty interval overlaps that day or an official date-only rota assignment exists. During the supported 2026 notice period, cards may also show the notice's mandatory duty-open and overnight phone periods without modifying the assignment row.
- **Open now** includes a pharmacy when the supported official regular schedule is open or an assigned pharmacy is inside a supported mandatory duty-open period. A scheduled duty gap, overnight phone coverage, or unsupported schedule date does not qualify.

## Trust and safety rules

- Apply duty hours only from a cited, versioned official notice and only within its explicit effective dates; do not infer them from general opening-hours conventions.
- Apply regular hours only from the cited, versioned pharmacy-hours order and its verified 2026 holiday calendar. Unsupported years are unknown rather than extrapolated.
- Do not present synthetic seed records as real operating information.
- Show the three availability concepts separately, even when combining them would make the UI simpler.
- Time-sensitive schedule responses must not be served as current from an unbounded offline cache.
- Unknown or missing data should be presented as unknown, not guessed.
- A date-only duty assignment alone must not be presented as proof of physical opening or on-call mode. The supported official 2026 notice plus that assignment may establish the applicable duty-open or overnight phone period at runtime.
- The regular schedule is a product-level “should be open” claim under the official order, not evidence against exceptional individual closures such as illness or staffing. No Paphos pharmacy receives the 2026 seasonal exception because an official per-pharmacy seasonal registry is not integrated.
- Paid placement must never alter safety-critical truth or ranking, including which pharmacy is closest, physically open, or officially on duty.

## Commercial direction

The basic consumer experience is expected to remain free. Potential monetization is primarily future B2B functionality such as enhanced pharmacy profiles, verification, analytics, and business tools. Monetization work is outside the first slice.

## Explicit non-goals for the first slice

- Native iOS or Android applications.
- User accounts or mandatory login.
- Map view.
- Automated official-data synchronization.
- Pharmacy verification or pharmacy business accounts.
- Push notifications, SEO landing pages, analytics, or product/service catalogues.
- General or open-ended rule engines beyond the cited, versioned 2026 regular and duty profiles.
- Paid placement.

## Open product questions

- What refresh and reconciliation process should run after the current official May–September 2026 release?
- What official per-pharmacy source can identify seasonal pharmacies or exceptional individual schedules?
- Does official on-call data use the pharmacy's public number or a separate contact mechanism?
- What ranking best answers the urgent question without implying that “on duty” means “open”?
- Which directions provider or neutral handoff gives the best experience across common Cyprus devices?
