# Google Places Paphos Reconciliation

## Scope and result

The 2026 official Paphos subset contains 90 pharmacies. Google Places API (New) Text Search was queried with the approved minimal field mask: Place ID, display name, formatted address, location, and returned phone where available. Matching used normalized official pharmacy phone first; official street, house number, postal code, locality, and Paphos geography verified identity; pharmacy/person name was secondary and never sufficient alone.

| Classification | Count | Runtime coordinate trust |
|---|---:|---|
| Exact identity match | 81 | Yes, only while the coordinate cache is fresh |
| Probable match | 3 | No |
| Ambiguous | 3 | No |
| No match | 3 | No |
| **Total** | **90** | **81 / 90 (90.0%) Google coverage** |

Existing Geoapify/Nominatim enrichment is unchanged. Three of the nine non-exact Google records have a separately accepted fallback, so the current application has 84 coordinate destinations and keeps the remaining 6 visible with address-based Directions.

## Manual review

Non-exact identity cases:

| Registration | Official name | Classification | Reason |
|---|---|---|---|
| 433 | Νικολαϊδου Κωνσταντία | Probable | Strong name/address evidence but returned phone conflicts with the official phone. |
| 708 | Παπαγεωργίου Στέφανος | Probable | Exact official address/business evidence; Google returned no phone for exact verification. |
| 1342 | Κοκκίνου Δωροθέα | Probable | Exact official address/business evidence; Google returned no phone for exact verification. |
| 749 | Έλληνα Ειρήνη | Ambiguous | Compatible Paphos/postcode result but insufficient phone/name identity evidence. |
| 760 | Χριστοδουλίδου Μαρία | Ambiguous | Compatible Paphos/name result but insufficient phone/address identity evidence. |
| 1225 | Πολυκάρπου Ίκαρος | Ambiguous | More than one Place candidate carried the exact phone and compatible address evidence. |
| 731 | Χατζηχαραλάμπους Κλεόπας | No match | No candidate was accepted. |
| 1170 | Παπουνίδου Μιλένα | No match | No candidate was accepted. |
| 1372 | Κλεάνθους (Πατερέγα) Ναταλία | No match | No candidate was accepted. |

Seven exact phone-backed identities disagree by more than 250 m with an existing accepted Geoapify coordinate and remain flagged for comparison review:

| Registration | Official name | Difference |
|---|---|---:|
| 413 | Χαραλάμπους Άννα | 388 m |
| 467 | Μακαρίου Γεώργιος | 805 m |
| 607 | Μάη - Φραγκούδη Ελένη | 1,093 m |
| 690 | Δημητρίου Γιώργος | 303 m |
| 869 | Ταλιώτου Μαρία | 310 m |
| 893 | Νικολαίδου Μαρία | 681 m |
| 1210 | Γαβριήλ Άννα | 924 m |

Registration 607 resolves to the manually verified Google coordinates `34.7565252, 32.4164677`; the exact official phone matches.

The union of non-exact cases and material coordinate disagreements is 16 manual-review cases.

## Storage and refresh

`data/geocoding/paphos-google-place-links-2026.json` is the durable, checked-in reconciliation artifact. It contains Place IDs, canonical registration numbers, classifications, evidence, retrieval times, and comparison metadata, but no Google-returned names, addresses, phones, or coordinates.

Google-returned content lives in the ignored local cache at `data/geocoding/cache/paphos-google-places.json` or the `pharmacy_google_places` table. The table enforces an expiry no later than 720 hours after retrieval, and RLS exposes only fresh exact coordinate rows. Runtime loading independently checks classification, Place ID, coordinate completeness, and expiry.

Run the reproducible refresh at or before day 25:

```bash
npm run geocode:google -- --refresh
```

With configured Supabase server credentials, append `--write-supabase` to refresh the database cache. If refresh cannot be completed by expiry, purge expired response content while retaining Place IDs and classifications:

```bash
npm run geocode:google -- --purge-expired
```

The current cache begins reaching its refresh target on 28 September 2026 and hard expiry on 3 October 2026. Cloud scheduling is deliberately deferred.
