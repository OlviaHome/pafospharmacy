# Paphos Pharmacy

Vertical Slice 1 is a mobile-first pharmacy finder built with Next.js, TypeScript, Tailwind CSS, and Supabase/PostgreSQL.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. When Supabase variables are absent, the application uses the checked-in normalized Cyprus Pharmaceutical Services snapshot and keeps the UI focused on Paphos.

## Optional Supabase data

Copy `.env.example` to `.env.local` and set both values:

```text
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

Set both variables or neither. No service-role key is used by the application. Apply `supabase/migrations` and `supabase/seed.sql` with the Supabase CLI before connecting a project.

## Refresh official data

The importer downloads the exact resources listed in `lib/ingestion/official-sources.ts`, validates and normalizes all districts, then refreshes the checked-in snapshot:

```bash
npm run ingest:official
```

To upsert the same normalized data into an already migrated Supabase project, set `SUPABASE_SECRET_KEY` only in the trusted local environment and run `npm run ingest:official -- --write-supabase`. Never expose that key to browser code or commit it.

## Reconcile pharmacy coordinates

The Paphos coordinate artifact is generated separately from official data with OpenStreetMap Nominatim:

```bash
npm run geocode:pharmacies -- --district Paphos
```

The checked-in cache makes that command reconciliation-only on normal reruns. `--refresh` deliberately requests fresh provider results and must continue to follow the [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/): one machine/thread, no more than one request per second, identifying requests, attribution, and local caching. Do not schedule the public endpoint or expand it to all districts as a routine job.

After applying the geocoding migration, a trusted environment may add `--write-supabase`; this updates only accepted coordinate/provenance fields and requires `SUPABASE_URL` plus a local `SUPABASE_SECRET_KEY`. The official importer intentionally omits those fields so refreshing the directory cannot erase enrichment. Ambiguous and failed results remain review data and are never written as pharmacy coordinates.

Geoapify is used only for records unresolved by Nominatim and for manual Paphos location search. Create a free server key at [Geoapify MyProjects](https://myprojects.geoapify.com/) and add it to `.env.local` as `GEOAPIFY_API_KEY` (never `NEXT_PUBLIC_GEOAPIFY_API_KEY`). The checked-in second-provider cache makes normal reruns reconciliation-only:

```bash
npm run geocode:geoapify
```

Use `--refresh` only for an intentional new provider pass. The app keeps the key behind `/api/location-search`; selected GPS and manual origins stay in browser memory and are not persisted. Geoapify and underlying source attribution must remain visible when its results are used.

`SITE_URL` is optional and supplies the canonical origin for social metadata. It defaults to `http://localhost:3000`.

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Normal runtime pharmacy identity and date-only duty data comes from Cyprus Pharmaceutical Services and is attributed under CC BY 4.0. The release covers duty assignments from 2026-05-01 through 2026-09-30; it does not publish ordinary opening hours, exact duty hours, service mode, or coordinates. Accepted coordinates are separately attributed Nominatim/OpenStreetMap or Geoapify enrichment. Synthetic data remains only in tests and the development seed.
