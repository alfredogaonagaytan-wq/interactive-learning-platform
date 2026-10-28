# Interactive Learning Platform

A free, open-source, local-first alternative to H5P for classrooms (EAL, ELA, Science, world languages). Teachers build interactive activities without code; students complete them on any device, online or offline. Deterministic grading, private-by-design reporting, and (from Phase 5) roster-verified submissions to Google Drive without a central student database.

**Status: Phases 1–5 built and tested — not production-ready.** Google sign-in, class rosters and Drive submissions are implemented and covered by automated tests with labelled Google test doubles; live testing with real accounts follows `docs/12-phase5-live-test.md`.

## What works now
- Teacher library: create, edit, duplicate, delete, import/export (`.ilp.zip` with images and integrity checks; `.ilp.json` still imports), two sample activities
- Question types: multiple choice, true/false, fill in the blanks, **drag the words, dropdown cloze, matching (text/images), sequencing & paragraph sorting, mark the words, drag-and-drop (categories or image labelling), find the hotspot**, text blocks
- Every drag interaction also works by tap-to-place and keyboard; hotspots by arrow-key crosshair or an accessible list
- Images (PNG/JPEG/GIF/WebP, checked by file signature, alt text required), question bank, random question pools
- Language learning: grammar sentence tasks graded by teacher patterns and common-mistake rules (unexpected answers go to teacher review), sentence builder, listening clips with play limits/speeds/transcripts and linked segments, dictation, speaking practice with recording, model audio or device voice, self-assessment and opt-in speech-to-text (never presented as a pronunciation score), recording retention controls
- Google integration: sign-in, private rosters in the teacher's Drive, assignments with links, a per-teacher submission service (Apps Script) that verifies identity, re-grades and stores teacher-owned reports, students' own copies in their Drive, offline-safe delivery with signed receipts
- Disciplinary literacy: Cornell-style Observation Notes on an exact, teacher-approved reading (paste, .docx, .pdf, .txt, .html; never AI-rewritten), highlight with configurable symbols by selection or keyboard form, paragraph questions, Cornell notes, CER / TCTAC / Toulmin / custom writing with sentence starters, cited evidence, structure checks and rubrics
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
1. [Feasibility](docs/01-feasibility.md) · 2. [Reuse H5P vs rebuild](docs/02-h5p-reuse-vs-rebuild.md) · 3–4. [Architecture & diagrams](docs/03-architecture.md) · 5. [Privacy & auth](docs/04-privacy-auth.md) · 6. [Data model](docs/05-data-model.md) · 7. [H5P parity matrix](docs/06-h5p-parity-matrix.md) · 8. [Roadmap](docs/07-roadmap.md) · 9. [Repo structure](docs/08-repo-structure.md) · 10. [Costs](docs/09-costs.md) · 11. [Dev setup & test coverage](docs/10-dev-setup.md) · [Google & hosting setup](docs/11-google-setup.md) · [Live test script](docs/12-phase5-live-test.md) · [IT review packet](docs/13-it-review-packet.md) · [Security audit](docs/14-security-audit.md)

## Licence
MIT. Uses only free/open-source dependencies (React, idb, zod, Vite, vite-plugin-pwa/Workbox; dev: Vitest, Testing Library, Playwright, axe-core). Use fictional data only until the privacy review in `docs/04-privacy-auth.md` is complete.
