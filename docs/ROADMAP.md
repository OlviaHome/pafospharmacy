# Roadmap

The roadmap is deliberately narrow. Move work between sections only when the product requirement is accepted; do not promote a feature merely because the stack can support it.

## NOW — first vertical slice

1. **Foundation**
   - Keep this knowledge base current.
   - Scaffold Next.js App Router with TypeScript and Tailwind CSS.
   - Add PWA manifest/install metadata without offline schedule promises.
2. **Trusted data shape**
   - Set up local Supabase configuration and reproducible migrations.
   - Create only `pharmacies` and `availability_intervals`, including valid-pair and same-kind non-overlap constraints, indexes, grants, and RLS.
   - Add clearly labeled synthetic Paphos-area seed records covering ordinary/open, duty/open, duty/on-call, and duty/unknown.
3. **Domain slice**
   - Implement and test Cyprus day windows, half-open interval evaluation, constrained state derivation, filters, and Haversine distance as presentation-independent functions.
   - Add a server-only repository/data-access boundary.
4. **Mobile experience**
   - Build the actionable home list with Today/Tomorrow, Open Now, and On Duty behavior defined in the product document.
   - Request geolocation in context and degrade cleanly when unavailable.
   - Add call and directions actions.
5. **Verification**
   - Test time boundaries, overnight periods, adjacent mode transitions, allowed cross-kind overlaps, rejected same-kind overlaps, RLS/grants, and inactive records.
   - Verify the core journey on narrow mobile screens with location granted and denied.
   - Confirm synthetic data cannot be confused with live production advice.

The slice is complete when a mobile user can open the app, understand each pharmacy's exact state, optionally see approximate distance, and call or request directions without an account.

## NEXT — validate trust and market fit

- Confirm and license an authoritative Cyprus pharmacy/duty data source.
- Define provenance, freshness, validation, failure, and correction behavior before importing official data.
- Replace synthetic data with a verified ingestion path and visible freshness/source information.
- Test the urgent-answer UX with residents, expats, and tourists; refine copy and ranking without merging the three states.
- Decide the next language based on validated user need, then design the translation/content boundary.
- Evaluate map view only if user testing shows the list and directions handoff are insufficient.

## LATER — expansion and B2B

- Expand from Paphos to the rest of Cyprus.
- Greek, Russian, and Arabic support.
- Automatic official-data synchronization and reconciliation.
- Pharmacy verification and business accounts.
- Pharmacy profile, product, and service information.
- Push notifications.
- SEO landing pages and privacy-respecting analytics.
- B2B pharmacy profiles, verification, analytics, and business features.
- Evaluate server-side geospatial search when national scale requires it.

Paid placement, if ever introduced, must remain separate from safety-critical availability and proximity results.
