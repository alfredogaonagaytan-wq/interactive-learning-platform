# 6. Data model

All documents are JSON with `kind` and `schemaVersion`. IDs are random, prefixed and URL-safe (`act_…`, `itm_…`, `att_…`) and never derived from names. Source of truth for implemented types: `packages/core/src/schema/*.ts` (zod).

## Implemented (Phases 1–3)

### Activity (`ilp.activity`, schema 3) — the editable draft
| Field | Type | Notes |
|---|---|---|
| id, title, description, language (BCP 47), subject, gradeBand | string | |
| items | `Item[]` | discriminated union on `type` |
| pools | `Pool[]` | `{id, name, draw, itemIds[]}` — each attempt shows `draw` random questions from the pool (schema 2) |
| settings | `ActivitySettings` | maxAttempts, feedbackTiming, checksPerItem, answerReveal, showHints, shuffleItems, passingPercent |
| revision | int | increments on every saved edit |
| publishedVersion / publishedRevision | int \| null | detect unpublished changes |
| createdAt / updatedAt | ISO datetime | |

### Items (shared fields: `id`, `points`, `feedback{correct,incorrect,hint,explanation}`, `skills[]`)
- `content` — title, body (not scored)
- `multiple-choice` — prompt, mode single/multiple, choices[{id,text,correct,feedback}], shuffleChoices, scoring all-or-nothing/partial
- `true-false` — prompt, correct, custom labels
- `fill-blanks` — prompt, `segments[]` (text | blank{id, answers[], hint}), `match{caseSensitive, punctuationSensitive, accentSensitive, equivalences[][]}`, scoring per-blank/all-or-nothing
- `drag-words` — segments (gap's first answer becomes the token; others also accepted), distractors[]; response `{placements: gapId→tokenId}`
- `dropdown-cloze` — segments (first option correct, rest distractors; shuffled per attempt); response `{values: gapId→text}`
- `matching` — pairs[{id, left, leftImage, right}], distractors[]; response `{matches: pairId→cardId}`; identical card texts are interchangeable
- `sequencing` — display list/paragraph, steps[{id, text, image}] in correct order; response `{order: stepId[]}`; per-position or all-or-nothing
- `mark-words` — text with `*target*` markup (deterministic tokenizer in core); response `{selected: wordIndex[]}`; (right − wrong)/targets
- `drag-drop` — background ImageRef|null, zones[{id,label,showLabel,x,y,w,h (%),capacity}], draggables[{id,text,image,correctZoneIds[]}] (empty = distractor); response `{placements: draggableId→zoneId}`
- `hotspot` — image, hotspots[{id,label,shape rect/ellipse,x,y,w,h,correct,feedback}], allowListAlternative; response `{point:{x,y}|null, hotspotId|null}`

- `sentence-response` — task (transform/correct/combine/complete/answer), prompt, source, starter, accepted patterns[], errorRules[{pattern, errorType, feedback}], keywords[{forms[]}] + meaningWeight, match options, unmatched: review|incorrect
- `sentence-builder` — sentence (" / " chunks), alternatives[], distractors[], lowercaseCards; response `{order: cardId[]}`
- `audio` (not scored) — AudioRef, maxPlays, speeds[], transcript visibility
- `dictation` — AudioRef, text, alternatives[], maxPlays, slowSpeed, typoHalf; word-level alignment grading
- `speaking` — language (BCP 47 variety), targets[{text, focus, modelAudio}], ttsFallback, modelBeforeRecording, maxRecordings, maxSeconds, submission none/optional/required, selfAssessment, speechToText (opt-in), scoring completion/teacher-review/none; response per target `{recordings, selectedRecordingId, selfRating, heard}`

Every question type also has `audioCue: {audioItemId, start, end} | null` linking it to an audio block (schema 3).

`ImageRef = {assetId, alt, decorative}`. `AudioRef = {assetId, transcript}`. Assets are content-addressed: `assetId = "ast_" + first 40 hex of SHA-256(bytes)`; allowed types are detected from file signatures (PNG, JPEG, GIF, WebP; audio types reserved for Phase 3). SVG is excluded.

### PublishedVersion (`ilp.publishedVersion`) — immutable
`{activityId, version, publishedAt, contentHash: "sha256:…", activity}`. Attempts and reports reference `(activityId, version, contentHash)`, so editing a draft never changes completed work.

### Attempt (`ilp.attempt`)
`{id, activityId, version, contentHash, mode: student|preview, assignmentId, attemptNumber, status, presentedItemIds[] | null, responses{itemId→response}, checks{}, hintsUsed{}, startedAt, updatedAt, submittedAt, sync}`

`mediaPlays` counts plays per audio clip so limits survive reloads. `presentedItemIds` records exactly which questions (pools) in which order (shuffle) this attempt showed; grading and reports use only those. Selection is deterministic from the attempt id, so a broker can re-derive and verify it.

### ItemResult / ActivityResult
`status: correct|partial|incorrect|unanswered|needs-review|ungraded`, `score`, `maxScore`, `parts[{partId, correct, given, reason}]` where reason ∈ capitalization, punctuation, accents, no-match, blank, wrong-choice, missed-choice.

### Report (`ilp.report`, schema 1)
Assignment/class/student number, activity title+version+hash, attempt, timestamps, completion, totals, per-item (prompt, response, correct answers *only if disclosure allowed*, checks, hints, skills, mistakes), skill summary, proficient / needs-practice, next steps, and `integrity{generatedBy:'client', verified:false}`.

### Packages
- **`.ilp.zip` (format 2, default export):** `package.json` = `{kind, formatVersion: 2, exportedAt, generator, activities[], media[{id, mime, path, size}], integrity}` + `media/<assetId>.<ext>`. Digest covers activities + media manifest; every media file must hash to its id. Limits: 600 entries, 150 MB uncompressed, unknown paths ignored.
- **`.ilp.json` (format 1):** activities only; still imported.
Both are corruption/tamper *detection*, not signatures.

### Device storage (IndexedDB `ilp`, version 3)
`activities`, `versions` (immutable), `attempts`, `meta`, `assets` (content-addressed bytes), `recordings` (student audio, device-only, retention-controlled; v3), `bank` (question bank entries `{id, item, tags, sourceActivityTitle, savedAt}`), plus a localStorage write-ahead journal for in-progress attempts.

## Planned (Phase 5–6) — stored in teacher Drive, never in a central DB

```ts
Class        { id: 'cls_…', name, section, schoolYear, teacherSubs[], brokerUrl, createdAt }
RosterRow    { studentNumber, displayName?, email, googleSub?, classId, status: 'active'|'withdrawn', boundAt? }   // Sheet row
Assignment   { id: 'asg_…', classId, activityId, version, contentHash, gradingMode: 'client'|'server',
               opensAt?, dueAt?, latePolicy, maxAttempts, releaseState: 'hidden'|'released', submissionRequirements }
Submission   { id, assignmentId, attemptId (idempotency key), studentNumber, googleSub, receivedAt (server),
               responses, clientReport, serverResult, receiptHmac, supersedes?: submissionId }
Override     { submissionId, itemId?, newScore, comment, by: teacherSub, at }   // append-only audit trail
Rubric       { id, criteria[{id, label, levels[{points, descriptor}]}] }       // Phase 4
```
Users are not a stored entity: identity is the Google account; authorisation comes from the roster (students) and the broker's teacher allow-list.

## Migration strategy
- `schemaVersion` per document; forward-only migration steps in `schema/migrations.ts`; each step has a fixture test.
- Documents from a *newer* schema are rejected with a clear "update the app" message — never down-converted.
- Published versions are never rewritten; a migration produces a new in-memory view, and the stored `contentHash` continues to identify what the student saw.
- IndexedDB store changes use `openDB` upgrade callbacks (`oldVersion` guards).
