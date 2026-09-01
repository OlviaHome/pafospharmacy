# Paphos Pharmacy Agent Guide

Paphos Pharmacy is a mobile-first Next.js/PWA product that helps people in Paphos answer: “Which pharmacy can I use right now?”

Read the relevant documentation before making changes:

- [Product](docs/PRODUCT.md): users, scope, UX rules, and commercial guardrails.
- [Architecture](docs/ARCHITECTURE.md): boundaries, data flow, security, and time handling.
- [Data model](docs/DATA_MODEL.md): tables, fields, constraints, and access rules.
- [Decisions](docs/DECISIONS.md): accepted decisions and open questions.
- [Roadmap](docs/ROADMAP.md): NOW, NEXT, and LATER scope.

Working rules:

- Keep **open now**, **on duty**, and **on call** distinct in data, logic, and UI; do not recreate them as independent stored booleans.
- Keep trustworthy timed facts in `availability_intervals`. For one pharmacy, intervals may overlap across `ordinary` and `duty`, but never within the same `schedule_kind`.
- Keep official date-only rota facts in `duty_assignments`. They prove On Duty for a Cyprus local date but never prove Open Now, On Call, a service mode, or exact hours. Never invent timestamps or encode unverified Cyprus legal assumptions.
- Preserve official registration identity, source attribution, and nullable source gaps. Keep geocoded coordinates separately attributed, never overwrite the official address, and never promote ambiguous road/town matches to pharmacy coordinates. Treat future opening-hours data as separately sourced enrichment too.
- Keep proximity centered on a transient optional `searchOrigin`: GPS stays client-side and unpersisted, manual matches may replace it, and browse-all must remain complete. Keep geocoder credentials server-only and preserve per-provider attribution/provenance.
- Optimize the ordinary-user path for mobile use, no login, and an answer in about 10 seconds.
- Keep future features out of the current slice unless they are required for a clean boundary.
- Update the relevant documentation whenever introducing a meaningful product, architecture, or data-model decision.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
