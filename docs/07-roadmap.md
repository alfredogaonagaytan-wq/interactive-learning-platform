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

## Phase 3 — Language learning ✅
| Acceptance criterion | Evidence |
|---|---|
| Grammar engine: teacher patterns (`{a|b}`, optional words), common-mistake rules tagged with an error type, separate meaning (required words) and accuracy credit, unmatched answers sent to teacher review by default (never guessed) | `phase3.test.ts` (core), `phase3.test.tsx` |
| Sentence tasks: transform, correct the error, combine, complete, short answer — one type with templates; teachers can test answers in the editor before publishing | `phase3.test.tsx` (editor tester) |
| Sentence reconstruction (word order) with chunks, alternatives, distractors, optional lower-case cards; tap, drag and arrow-key reordering | core + `phase3.test.tsx`, e2e |
| Listening: audio clips (upload or teacher-recorded narration), play limits that survive reloads, speed choices, transcripts (after submit / on request / always / never), questions linked to a clip or a time segment sharing the play limit | `phase3.test.tsx`, e2e (real playback) |
| Dictation with word-level alignment (missing / extra / wrong / half-mistake typos); expected words hidden until answers may be revealed | core + `phase3.test.tsx` |
| Recording: permission requested only on Record; blocked/no-microphone/unsupported explained with an upload fallback; microphone released after each take | `phase3.test.tsx`, e2e (Chromium simulated microphone, real MediaRecorder) |
| Pronunciation tiers: A recording + model (file or device voice) + self-assessment; B browser speech-to-text only when the teacher enables it and the student agrees, labelled “what the computer heard”, on-device mode detected; C phoneme scoring not provided — stated in the UI | `phase3.test.tsx`, Settings capability panel |
| Retention: practice takes not chosen for submission deleted on submit (default), recordings older than N days purged at start-up, “delete all recordings” | `phase3.test.tsx` |
| Schema v3 + IndexedDB v3 migrations | core + `phase2-storage.test.tsx` |

**Not done in Phase 3 (moved):** audio from Google Drive (needs sign-in → Phase 5); recordings sent to the teacher (Phase 5); reusable grammar-rule library across activities (questions with their rules can already be reused through the question bank; a separate rule library is Phase 6); listening cloze uses fill-in-the-blanks + an audio link rather than a separate type; phoneme-level pronunciation analysis remains research-grade (Phase 8, opt-in, labelled experimental if ever added).

**Device notes:** recording was tested in Chromium only (simulated microphone). Safari/iOS records MP4/AAC; this must be checked on a real iPhone/iPad. Device voices for the “Listen” button differ by device and may be missing on some Chromebooks.

## Phase 4 — Disciplinary literacy ✅
| Acceptance criterion | Evidence |
|---|---|
| Reading import without AI: paste (rich or plain), .txt, .html, .docx (mammoth), .pdf (pdf.js, page markers kept), scanned page images. Text is copied character for character; HTML is sanitised (DOMPurify), external images never fetched | `phase4.test.tsx` (HTML/.docx), e2e (real PDF) |
| Original file stored separately (content-addressed asset) and openable for comparison — never rendered as HTML | ReadingEditor; `media` sniffing tests |
| Teacher approval required before publishing; any change invalidates it (SHA-256 over exactly what students see) | core `phase4.test.ts`, `phase4.test.tsx`, e2e |
| Source-text integrity: rendered text equals stored text, including whitespace, symbols and line breaks, with and without highlights | `phase4.test.tsx`, e2e |
| Preserved structure: headings, numbered paragraphs (toggle per paragraph), quotations, lists, tables with captions, figures with captions, page breaks, bold/italic/underline/super/subscript | core + component tests |
| Annotation by selecting text (mouse/touch) **or** an accessible form (paragraph + exact words); configurable observation symbols (code + colour, never colour alone), presets for Science (CER) and ELA (argument/Toulmin) | `phase4.test.tsx`, e2e (real mouse selection, phone) |
| Paragraph questions, Cornell notes (cues, notes, summary), observation list with notes | component tests |
| Writing frameworks: CER, TCTAC, Toulmin, custom; sentence starters; insert cited evidence from notes; deterministic checks (words, ¶ citations, required terms) shown separately from teacher-assessed quality; success criteria; rubric with optional student self-rating | core + component tests |
| Stand-alone structured writing item (CER after a lab etc.) | core tests |
| Schema v4 migration | core |

**Not done / limits:** PDF text extraction can mis-order multi-column layouts and keeps headers/footers — the teacher reviews and edits before approving (the original PDF is kept for students to open). Scanned images are not OCR'd (no AI/OCR by design; the teacher pastes text if students must annotate it). Teacher rubric scoring of submissions arrives with Phase 6 review tools. The Flint reference pages were not reachable, so the layout follows the spec rather than those examples.

## Phase 5 — Google integration ✅ (live verification pending)
| Acceptance criterion | Evidence |
|---|---|
| Google sign-in (GIS ID token) and separate `drive.file` access token; tokens in memory only | `gis.ts`; Phase 5 flow tests (GIS test double) |
| Per-teacher submission service (Apps Script) built from the same grading engine; guided setup page with copy buttons | `services/submission-broker`, `#/setup-service` |
| Token verification (audience, issuer, expiry, verified email, optional school domain), teacher vs student roles | broker tests (19) |
| Private roster in the teacher's Drive sheet; CSV import; Google-account binding by `sub`; students cannot claim another number | core + broker tests |
| Classes and assignments (due date, late policy, attempts, close, show score); assignment links; cross-class isolation | broker tests, Classes UI |
| Hidden answer keys mode (supported types) | core + broker + flow tests |
| Submission: server re-grade, teacher-owned report JSON in class folder, recordings, HMAC receipt, tamper flag, idempotency, attempt limits, late/closed | broker tests |
| Student copy saved to the student's own Drive (JSON + readable Google Doc) | flow tests (Drive test double) |
| Offline-safe delivery queue with retries; two separate delivery statuses shown; Drive permission recovery | flow tests |
| Drive Picker for teacher audio (copied into the activity, Drive file stays private) | manual (doc 12, step 15) |
| GitHub Pages deployment workflow | `.github/workflows/deploy.yml` |

**Must still be verified live** (doc 12): real Google sign-in on iOS/Android/Chromebook, Apps Script deployment and quotas, Drive uploads, school admin policies.
**Bug fixed during Phase 5:** Chrome's on-device speech check (`SpeechRecognition.available`) crashed the browser tab in testing; the app no longer calls it.

## Phase 6 — Reporting & analytics
Teacher dashboard (submission status, item analysis, skill heatmap, students needing support), score overrides with audit trail, feedback, release of results, CSV/PDF export (individual + class).
**Accept when:** class exports match per-student reports; overrides never alter original data; dashboards show student numbers by default.

## Phase 7 — Extended H5P coverage
Interactive video/audio, presentation, book, branching, dialog cards, flashcards, memory, word search, crossword, timeline, image types; `.h5p` importer with per-item conversion report; sandboxed fallback player.

## Phase 8 — Optional enhancements
Local AI adapters (WebGPU, opt-in), improved speech analysis, more languages/UI translations (Korean first), LTI 1.3 / Google Classroom add-on integration.
