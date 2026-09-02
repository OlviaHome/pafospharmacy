# Product

## Product summary

Paphos Pharmacy is a mobile-first pharmacy finder for Paphos, Cyprus. Its primary job is to answer one urgent question as quickly and clearly as possible:

> Which pharmacy can I use right now?

The first product is an English-language web app with PWA-ready architecture. It is not a native mobile application and it is not intended to be a generic pharmacy directory.

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
- Availability calculated only from explicit timed facts; duty assignment may also come from an explicit official date record.
- Optional browser geolocation or a user-selected Paphos area/address as the origin for approximate distance.
- An **Open Now** filter for the current instant only when trustworthy opening data is available.
- An **On Duty** filter for the selected local calendar day.
- A Today/Tomorrow selector using Cyprus local time.
- Call and directions actions.
- English-only UI.

The default experience must remain useful when location permission is denied or unavailable. Users have three explicit paths: **Use my location**, **Enter area or address**, or browse every pharmacy without sharing location. A denied device permission exposes manual search immediately rather than ending in an error. No origin is required for pharmacy status, address, call, or directions.

Manual search accepts Paphos areas, municipalities, streets, landmarks, hotels, and addresses supported by the geocoder. The user chooses from a short list of Cyprus/Paphos-constrained matches; the application never silently selects among multiple plausible locations.

Distance ordering is limited to pharmacies with verified map coordinates. Pharmacies without coordinates remain visible without a distance, and the UI must not imply that the ordered subset is globally nearest among every Paphos pharmacy.

## Day and filter behavior

- **Today** is the default view and shows current state plus today's relevant schedule periods.
- **Tomorrow** shows explicit schedule periods that overlap tomorrow in Cyprus local time.
- **Open now** always means the real current instant. It is hidden or disabled for Tomorrow rather than being redefined.
- **On duty** for a selected day means that an explicit on-duty interval overlaps that day or an official date-only rota assignment exists. Date-only cards must say that exact hours were not published.

## Trust and safety rules

- Do not infer official duty hours or Cyprus legal rules from general opening-hours conventions.
- Do not present synthetic seed records as real operating information.
- Show the three availability concepts separately, even when combining them would make the UI simpler.
- Time-sensitive schedule responses must not be served as current from an unbounded offline cache.
- Unknown or missing data should be presented as unknown, not guessed.
- A date-only duty assignment must not be presented as proof of physical opening or on-call mode.
- Paid placement must never alter safety-critical truth or ranking, including which pharmacy is closest, physically open, or officially on duty.

## Commercial direction

The basic consumer experience is expected to remain free. Potential monetization is primarily future B2B functionality such as enhanced pharmacy profiles, verification, analytics, and business tools. Monetization work is outside the first slice.

## Explicit non-goals for the first slice

- Native iOS or Android applications.
- User accounts or mandatory login.
- Greek, Russian, or Arabic UI.
- Map view.
- Automated official-data synchronization.
- Pharmacy verification or pharmacy business accounts.
- Push notifications, SEO landing pages, analytics, or product/service catalogues.
- Rule engines that encode Cyprus legislation.
- Paid placement.

## Open product questions

- What refresh and reconciliation process should run after the current official May–September 2026 release?
- What exact source wording best helps users understand that a date assignment contains no exact duty hours?
- Does official on-call data use the pharmacy's public number or a separate contact mechanism?
- What ranking best answers the urgent question without implying that “on duty” means “open”?
- Which directions provider or neutral handoff gives the best experience across common Cyprus devices?
