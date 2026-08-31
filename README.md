# Paphos Pharmacy

Vertical Slice 1 is a mobile-first pharmacy finder built with Next.js, TypeScript, Tailwind CSS, and Supabase/PostgreSQL.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. When Supabase variables are absent, the application automatically uses clearly labeled synthetic development fixtures.

## Optional Supabase data

Copy `.env.example` to `.env.local` and set both values:

```text
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

Set both variables or neither. No service-role key is used by the application. Apply `supabase/migrations` and `supabase/seed.sql` with the Supabase CLI before connecting a project.

`SITE_URL` is optional and supplies the canonical origin for social metadata. It defaults to `http://localhost:3000`.

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

All bundled pharmacy names, contact details, schedules, and duty states are synthetic development data. They are not official or current Cyprus pharmacy information.
