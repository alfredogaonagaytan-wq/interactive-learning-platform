# 8. Phased roadmap with acceptance criteria

Phases set the order of work; they do not reduce the final scope. "Done" means implemented **and** covered by automated tests.

## Phase 1 — Foundation ✅ (this commit)
| Acceptance criterion | Evidence |
|---|---|
| Versioned activity schema, item plugin system, migration framework | `packages/core`, `lifecycle.test.ts` |
| Deterministic grading for MC (single/multi, partial), T/F, fill-blanks (alternatives, equivalences, case/punctuation/accent options, mistake explanations) | `grading.test.ts`, `normalize.test.ts` (46 core tests) |
| Teacher can create, edit, duplicate, delete, preview (teacher & student), publish versions — no JSON | `editor.test.tsx`, e2e flow |
| Editing after publishing never changes earlier versions or attempts | `storage.test.ts` |
| Student autosave survives reload and tab-close; works offline | `player.test.tsx` (journal), e2e offline test |
| Import/export portable packages with integrity check | `lifecycle.test.ts`, `storage.test.ts` |
| Installable PWA (manifest, icons, service worker), update prompt never auto-reloads | e2e manifest test |
| Keyboard-operable; no serious/critical axe violations on main screens | `player.test.tsx`, e2e axe test |
| Local data deletion | `storage.test.ts` |

**Known gaps in Phase 1:** no media upload yet; per-blank hints are only in the accessible name/tooltip (not visible on touch devices); reports are JSON/CSV + browser print (no generated PDF); no real Safari/iOS device testing yet.

## Phase 2 — Core interactive activities ✅
| Acceptance criterion | Evidence |
|---|---|
| New types with editor + player + deterministic grading + validation: drag the words, dropdown cloze, matching (text/images), sequencing & paragraph sorting, mark the words, drag-and-drop (category boxes or zones on an image), find the hotspot | `phase2-items.test.ts` (core), `phase2.test.tsx` (UI) |
| Every drag interaction has a tested keyboard path and tap-to-place path; real pointer dragging tested in a browser | `phase2.test.tsx` (keyboard/tap), `e2e/phase2.spec.ts` (mouse drag on desktop, taps on emulated phones) |
| Hotspots usable without a mouse: arrow-key crosshair + optional “choose from a list” | `phase2.test.tsx` |
| Images: upload with signature-based type check (no SVG), content-addressed storage, required alt text unless decorative | `pools-packages.test.ts`, e2e upload test |
| Zip packages (`.ilp.zip`) round-trip activities with media; tampered media and missing manifests rejected; legacy `.ilp.json` still imports | `pools-packages.test.ts`, `phase2-storage.test.tsx`, e2e export→import |
| Question bank (save, search, insert copies) and question pools (random draw, stable per attempt, graded only on what was shown) | `pools-packages.test.ts`, `phase2.test.tsx`, `phase2-storage.test.tsx` |
| Schema v1 → v2 migration for stored activities, published versions and the Phase 1 IndexedDB | `pools-packages.test.ts`, `phase2-storage.test.tsx` |
| No serious/critical axe violations on the new editors and players (incl. “card picked up” and “checked” states) | `e2e/phase2.spec.ts` |

**Fixed during Phase 2:** the save indicator could re-wrap the activity header and shift content mid-drag; the update banner pushed content down (now a floating toast); keyboard focus could scroll under the sticky editor toolbar; per-gap hints are now visible after “Show hint”.

**Known gaps:** Single Choice Set and Summary moved to Phase 7 (each is a thin variant of existing types); images in packages are not resized/compressed (5 MB cap per image); unused images are not yet garbage-collected from device storage; no real iPhone/iPad/Android/Chromebook testing yet (emulated viewports only); drag-and-drop zone positions on images are authored in % and may need adjustment for very tall images on phones.

## Phase 3 — Language learning
Grammar engine (teacher-defined rules: accepted patterns, error-type tagging, separate meaning vs. accuracy scores, "needs review" fallback), sentence reconstruction, transformation, error correction; listening (multiple clips, speed, max plays, timestamps, transcripts); dictation; recording (MediaRecorder, permission flow, retention); pronunciation tiers A/B/C with feature detection.
**Accept when:** grammar fixtures cover every spec'd category; play limits enforced and survive reload; recording works in Chrome, Safari iOS, Android Chrome (manual device check recorded); ASR is opt-in with disclosure; no pronunciation "score" shown unless the experimental model is explicitly enabled and labelled.

## Phase 4 — Disciplinary literacy
Reading viewer with **byte-for-byte preserved source** (upload stored separately; extracted text must be teacher-approved before publish; hash of source recorded), highlights/annotations anchored to paragraph + offset, configurable observation symbols, Cornell notes + summary, paragraph prompts, CER/TCTAC/custom frameworks, rubrics, success criteria.
**Accept when:** source-integrity test proves the displayed text equals the approved source; annotations survive reload/offline; rubric scores flow into reports as teacher-assessed.

## Phase 5 — Google integration
GIS sign-in, `drive.file` folder trees, roster Sheet, broker template (Apps Script) + deploy guide, enrollment binding by `sub`, assignment links, student Drive save + broker submission, receipts, sync queue with retry/backoff, conflict detection, duplicate/revision handling.
**Accept when:** tests with **synthetic Workspace test accounts** show: enrolled student submits → teacher-owned file appears in correct folder; non-rostered and wrong-class accounts are refused; a student cannot submit as another number; resubmission with same attemptId is idempotent; a revised attempt supersedes visibly; interrupted upload resumes; both confirmations shown.

## Phase 6 — Reporting & analytics
Teacher dashboard (submission status, item analysis, skill heatmap, students needing support), score overrides with audit trail, feedback, release of results, CSV/PDF export (individual + class).
**Accept when:** class exports match per-student reports; overrides never alter original data; dashboards show student numbers by default.

## Phase 7 — Extended H5P coverage
Interactive video/audio, presentation, book, branching, dialog cards, flashcards, memory, word search, crossword, timeline, image types; `.h5p` importer with per-item conversion report; sandboxed fallback player.

## Phase 8 — Optional enhancements
Local AI adapters (WebGPU, opt-in), improved speech analysis, more languages/UI translations (Korean first), LTI 1.3 / Google Classroom add-on integration.
