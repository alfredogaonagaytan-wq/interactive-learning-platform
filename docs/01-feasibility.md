# 1. Feasibility assessment

Status labels: ✅ feasible at zero cost · ⚠️ feasible with caveats/limits · ❌ not possible as literally specified.

## Summary verdict

The platform is feasible as a **free, static, local-first PWA** with **no central database**, **provided** one small trusted component exists for high-integrity submissions. The recommended trusted component is a **per-teacher Google Apps Script "submission broker"** that runs inside each teacher's own Google account (zero cost, no server we operate, data stays in the teacher's Drive). A central Cloudflare Worker is the fallback for schools that block Apps Script.

A **completely serverless (client-only) design is viable only for low-stakes practice.** It cannot provide: tamper-resistant scores, hidden answer keys, server-verified roster binding, or teacher-owned copies created at submission time.

## Requirement-by-requirement

| Requirement | Verdict | Notes |
|---|---|---|
| Free for teachers/students, minimal hosting cost | ✅ | Static hosting (GitHub Pages / Cloudflare Pages) is free. Google APIs used here have no per-call charge within quota. |
| Mac/Windows/Chromebook/iPhone/Android, installable PWA | ✅ / ⚠️ | iOS installs via "Add to Home Screen" only; iOS may evict storage for sites unused for ~7 days unless installed. |
| Teachers author without code/JSON | ✅ | Implemented in Phase 1 (form-based editor, bracket syntax for blanks). |
| Automatic deterministic grading | ✅ | Implemented in `@ilp/core`; same engine can run in the broker. |
| Save locally + sync to Google Drive | ✅ | Local autosave implemented. Drive sync needs connectivity (Phase 5). |
| No central database of students | ✅ | Per-teacher Apps Script broker stores roster/bindings in the teacher's own Sheet. |
| Secure enrollment & roster binding | ⚠️ | Needs a trusted component (broker). Client-only cannot stop a student from claiming another student number. |
| Student report saved to student Drive (`drive.file`) | ✅ | App-created files are accessible with `drive.file`. |
| Teacher access to submissions | ⚠️ | Sharing a student file with the teacher does **not** put it in the teacher's Drive, and the teacher's app instance cannot list it with `drive.file` (it would need the Picker or a restricted scope). A broker running as the teacher creates **teacher-owned copies** in organised folders — this is the recommended path. |
| Tamper-resistant reports | ⚠️ | Only if the broker re-grades raw responses with a server-held key and stamps server time. Client-generated reports are advisory. |
| Hide answer keys from students | ⚠️ / ❌ | Client-graded activities necessarily ship the key to the device; we prevent *accidental* exposure only. True secrecy requires broker-side grading (keys never leave teacher's Drive). |
| Offline completion | ✅ | Implemented (service worker + IndexedDB + write-ahead journal). Sign-in and Drive sync are online-only. |
| Recording & playback | ✅ | MediaRecorder works in current Chrome, Edge, Firefox, Safari (iOS 14.3+). Format differs (WebM/Opus vs MP4/AAC). |
| Speech-to-text (browser) | ⚠️ | Web Speech API: Chrome historically sends audio to Google servers; on-device mode exists only in recent Chrome versions/languages; Firefox lacks it. Must be opt-in and disclosed. |
| Phoneme-level pronunciation scoring | ⚠️ (research grade) | Possible locally with open wav2vec2 phoneme models via ONNX Runtime Web (~300 MB+, slow on Chromebooks). Not a validated assessment; must be labelled experimental. Never presented as an objective score. |
| Interactive video with YouTube | ⚠️ | YouTube IFrame API is fine online; YouTube content cannot be cached for offline use (ToS). |
| Audio from teacher's private Drive | ⚠️ | Students cannot stream a private Drive file via a plain URL. Options: package audio into the activity, broker streams it to roster-verified students, or share with a class Google Group + Picker. |
| H5P package import | ⚠️ | Conversion of common content types is feasible (MIT-licensed `content.json` formats). Running arbitrary H5P libraries natively means embedding the H5P runtime (see doc 02). |
| Open-ended grammar grading without AI | ⚠️ | Rule-based (teacher-approved answers/patterns) only; anything else becomes **needs teacher review**, never a guessed score. |
| Local AI (later) | ⚠️ | WebGPU models run on newer laptops; most Chromebooks/phones are too weak for useful LLM inference. Optional only. |
| Free consumer AI accounts as APIs | ❌ | Not permitted by their terms and not reliable; excluded by design. |

## Key risks

1. **Google OAuth app verification.** `drive.file`, `openid`, `email` are non-sensitive scopes → light verification (brand/domain). Requesting `drive` or `drive.readonly` would be *restricted* and require a paid third-party security assessment for public apps — so we avoid those scopes in the PWA.
2. **Workspace admin policies.** Many school domains block third-party OAuth apps or Apps Script for students by default. An admin must allow-list the app's OAuth client ID (Admin console → Security → API controls). This is a deployment prerequisite, not something the app can work around.
3. **Under-14 students and consent** (see doc 04). Legal review required before real student data.
4. **Apps Script quotas** (per teacher account, verify current values): ~20k URL-fetch calls/day consumer, higher on Workspace; 6 min/execution; limited simultaneous executions per user (~30). A class of 30 submitting at the same moment is within limits; the client retries with backoff.
