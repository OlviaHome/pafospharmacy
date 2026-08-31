# Paphos Pharmacy Agent Guide

Paphos Pharmacy is a mobile-first Next.js/PWA product that helps people in Paphos answer: “Which pharmacy can I use right now?”

Read the relevant documentation before making changes:

- [Product](docs/PRODUCT.md): users, scope, UX rules, and commercial guardrails.
- [Architecture](docs/ARCHITECTURE.md): boundaries, data flow, security, and time handling.
- [Data model](docs/DATA_MODEL.md): tables, fields, constraints, and access rules.
- [Decisions](docs/DECISIONS.md): accepted decisions and open questions.
- [Roadmap](docs/ROADMAP.md): NOW, NEXT, and LATER scope.

Working rules:

- Keep **open now**, **on duty**, and **on call** distinct in data, logic, and UI. Model duty assignment separately from service mode using only the valid combinations in the data model; do not recreate them as independent booleans.
- Derive availability from explicit, non-overlapping intervals. Never encode unverified Cyprus legal or duty-hour assumptions.
- Optimize the ordinary-user path for mobile use, no login, and an answer in about 10 seconds.
- Keep future features out of the current slice unless they are required for a clean boundary.
- Update the relevant documentation whenever introducing a meaningful product, architecture, or data-model decision.
