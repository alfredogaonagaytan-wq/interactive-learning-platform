# 9. Repository structure

```
interactive-learning-platform/
├─ package.json              npm workspaces, root scripts
├─ tsconfig.base.json
├─ vitest.config.ts          unit/component test projects (core: node, web: jsdom)
├─ playwright.config.ts      e2e (desktop + emulated phone viewports)
├─ packages/
│  └─ core/                  framework-free; shared with the broker
│     ├─ src/
│     │  ├─ schema/          common, activity, attempt, migrations
│     │  ├─ items/           one file per question type + registry + factory
│     │  ├─ grading/         normalize (matching), engine, types
│     │  ├─ report/          report builder + CSV
│     │  ├─ package/         .ilp.json import/export
│     │  ├─ policy.ts        feedback/answer visibility rules
│     │  ├─ publish.ts       immutable versions
│     │  ├─ hash.ts, ids.ts
│     └─ test/
├─ apps/
│  └─ web/                   React + Vite PWA
│     ├─ src/
│     │  ├─ app/             shell, router, settings, update banner
│     │  ├─ teacher/         library, editor, preview, sample content
│     │  ├─ student/         home, player, play page
│     │  ├─ plugins/<type>/  Editor + Player per question type
│     │  ├─ storage/         IndexedDB, journal, library ops
│     │  ├─ ui/              fields, dialog
│     │  └─ styles/
│     ├─ public/             icons
│     ├─ test/               component tests (jsdom + fake-indexeddb)
│     └─ e2e/                Playwright specs
├─ services/
│  └─ submission-broker/     Phase 5: Apps Script template (+ optional Worker variant)
└─ docs/                     these design documents
```
Planned additions: `apps/web/src/sync/` (Phase 5), `packages/h5p-import/` (Phase 7), `packages/speech/` (Phase 3).
