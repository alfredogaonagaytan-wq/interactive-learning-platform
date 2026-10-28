# 6. Data model

All documents are JSON with `kind` and `schemaVersion`. IDs are random, prefixed and URL-safe (`act_…`, `itm_…`, `att_…`) and never derived from names. Source of truth for implemented types: `packages/core/src/schema/*.ts` (zod).

## Implemented (Phase 1)

### Activity (`ilp.activity`, schema 1) — the editable draft
| Field | Type | Notes |
|---|---|---|
| id, title, description, language (BCP 47), subject, gradeBand | string | |
| items | `Item[]` | discriminated union on `type` |
| settings | `ActivitySettings` | maxAttempts, feedbackTiming, checksPerItem, answerReveal, showHints, shuffleItems, passingPercent |
| revision | int | increments on every saved edit |
| publishedVersion / publishedRevision | int \| null | detect unpublished changes |
| createdAt / updatedAt | ISO datetime | |

### Items (shared fields: `id`, `points`, `feedback{correct,incorrect,hint,explanation}`, `skills[]`)
- `content` — title, body (not scored)
- `multiple-choice` — prompt, mode single/multiple, choices[{id,text,correct,feedback}], shuffleChoices, scoring all-or-nothing/partial
- `true-false` — prompt, correct, custom labels
- `fill-blanks` — prompt, `segments[]` (text | blank{id, answers[], hint}), `match{caseSensitive, punctuationSensitive, accentSensitive, equivalences[][]}`, scoring per-blank/all-or-nothing

### PublishedVersion (`ilp.publishedVersion`) — immutable
`{activityId, version, publishedAt, contentHash: "sha256:…", activity}`. Attempts and reports reference `(activityId, version, contentHash)`, so editing a draft never changes completed work.

### Attempt (`ilp.attempt`)
`{id, activityId, version, contentHash, mode: student|preview, assignmentId, attemptNumber, status, responses{itemId→response}, checks{}, hintsUsed{}, startedAt, updatedAt, submittedAt, sync}`

### ItemResult / ActivityResult
`status: correct|partial|incorrect|unanswered|needs-review|ungraded`, `score`, `maxScore`, `parts[{partId, correct, given, reason}]` where reason ∈ capitalization, punctuation, accents, no-match, blank, wrong-choice, missed-choice.

### Report (`ilp.report`, schema 1)
Assignment/class/student number, activity title+version+hash, attempt, timestamps, completion, totals, per-item (prompt, response, correct answers *only if disclosure allowed*, checks, hints, skills, mistakes), skill summary, proficient / needs-practice, next steps, and `integrity{generatedBy:'client', verified:false}`.

### Package (`ilp.package`, format 1)
`{exportedAt, generator, activities[], integrity{SHA-256 digest of canonical JSON}}` — corruption detection, not a signature.

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
