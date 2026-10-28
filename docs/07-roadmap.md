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

## Phase 2 — Core interactive activities
Drag the words, drag-and-drop (text/image zones), matching, sequencing/paragraph sorting, mark the words, dropdown cloze, single-choice set, summary, hotspot; media (image/audio) in packages (zip container).
**Accept when:** each type has editor + player + grading + validation tests; every drag interaction has a tested keyboard and tap-to-place alternative; zip packages round-trip with media; question bank + random draw from pools.

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
