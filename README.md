# Interactive Learning Platform

A free, open-source, local-first alternative to H5P for classrooms (EAL, ELA, Science, world languages). Teachers build interactive activities without code; students complete them on any device, online or offline. Deterministic grading, private-by-design reporting, and (from Phase 5) roster-verified submissions to Google Drive without a central student database.

**Status: Phase 1 (foundation) — working, tested, not production-ready.** No sign-in or Drive features yet; everything stays in the browser.

## What works now
- Teacher library: create, edit, duplicate, delete, import/export (`.ilp.json` with integrity check), sample activity
- Editor: multiple choice (single/multiple, partial credit, per-choice feedback), true/false, fill in the blanks (`[answer | alternative]` syntax, case/punctuation/accent options, equivalences such as *do not = don't*), text blocks; points, skills, hints, explanations; validation before publishing
- Settings: attempts, feedback timing (immediate / on submit / on release), checks per item, answer reveal policy, hints, shuffling, target score
- Immutable published versions; teacher preview (answer key) and student preview
- Student player: autosave to IndexedDB + synchronous write-ahead journal, offline use, check/hint, submit, results, JSON/CSV report, print-to-PDF
- PWA (installable, offline app shell, update prompt), strict CSP in production, keyboard and screen-reader support

## Quick start
```bash
npm install
```
```bash
npm run dev
```
```bash
npm test && npm run test:e2e
```

## Design documents
1. [Feasibility](docs/01-feasibility.md) · 2. [Reuse H5P vs rebuild](docs/02-h5p-reuse-vs-rebuild.md) · 3–4. [Architecture & diagrams](docs/03-architecture.md) · 5. [Privacy & auth](docs/04-privacy-auth.md) · 6. [Data model](docs/05-data-model.md) · 7. [H5P parity matrix](docs/06-h5p-parity-matrix.md) · 8. [Roadmap](docs/07-roadmap.md) · 9. [Repo structure](docs/08-repo-structure.md) · 10. [Costs](docs/09-costs.md) · 11. [Dev setup & test coverage](docs/10-dev-setup.md)

## Licence
MIT. Uses only free/open-source dependencies (React, idb, zod, Vite, vite-plugin-pwa/Workbox; dev: Vitest, Testing Library, Playwright, axe-core). Use fictional data only until the privacy review in `docs/04-privacy-auth.md` is complete.
