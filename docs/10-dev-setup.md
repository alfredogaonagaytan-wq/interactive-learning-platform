# 11. Local development and testing

Requirements: Node 22+, npm 10+ (npm 11 recommended — npm 10.9 hit an install bug with this workspace), Chromium for e2e (Playwright).

```bash
npm install
```
```bash
npm run dev            # http://localhost:5173 (no service worker in dev)
```
```bash
npm test               # core + web unit/component tests (vitest)
```
```bash
npm run typecheck
```
```bash
npm run test:e2e       # production build + Playwright (desktop, Pixel 7, iPhone-size viewport)
```
```bash
npm run build && npm run preview   # http://localhost:4173 with service worker (test install/offline here)
```

Deploy to GitHub Pages project site: `BASE_PATH=/<repo>/ npm run build`, publish `apps/web/dist`.

## Test data policy
Tests and samples use fictional content only. Phase 5 tests must use **synthetic Google Workspace test accounts** in a test OU — never real student accounts — until the privacy review in doc 04 is complete.

## Spec test list → current coverage
| # | Spec test | Status |
|---|---|---|
| 1 | Correct/incorrect grammar answers | ✅ core grading tests (verb forms, capitalization) |
| 2 | Multiple acceptable answers | ✅ |
| 3 | Drag-and-drop | ✅ pointer drag (e2e desktop), tap-to-place (e2e phones), keyboard (component tests) |
| 4 | Keyboard interactions | ✅ player + editor tests, incl. every Phase 2 type and the hotspot crosshair |
| 5 | Sentence reconstruction | Phase 3 |
| 6 | Autosave & reload | ✅ unit + e2e + journal |
| 7 | Interrupted connection | ✅ offline (local); upload interruption in Phase 5 |
| 8 | Multi-device usability | ⚠️ emulated phone viewports on Chromium only |
| 9–13 | Roster auth, unauthorised access, Drive files, teacher receipt, duplicate submissions | Phase 5 (local duplicate-version immutability ✅) |
| 14 | Source-text integrity | Phase 4 (package + media integrity ✅) |
| 15–16 | Recording permissions, pronunciation fallback | Phase 3 |
| 17 | Accessible interaction | ✅ axe (WCAG 2.2 AA tags) + keyboard tests; manual screen-reader testing pending |
| 18 | Data deletion | ✅ |
