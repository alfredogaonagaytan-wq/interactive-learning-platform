# 14. Security audit — submission service (Phase 5), 2026-10-28

Scope: `services/submission-broker` (the Apps Script source `src/Code.js`, the generated
`dist/Code.gs`, `dist/GradingCore.gs`, `dist/appsscript.json`, and the generator `build.mjs`),
the shared core it bundles (`packages/core/src/classroom/*`), and the parts of the web app that talk to the
service (`apps/web/src/google/*`, `student/AssignmentPage.tsx`, `teacher/ServiceSetup.tsx`) and serve the files
(`apps/web/vite.config.ts`, `.github/workflows/deploy.yml`).

Audited version: commit `89ac28c` (service 0.5.0). Fixed version: service **0.5.1**.

**This is not a certification.** It is an engineering review done by inspecting the code and running automated attacks
against the real service code with labelled stand-ins for Google's services. Part of the security depends on how real
Google services behave; that part is listed under [Requires live verification](#requires-live-verification) and has not
been tested.

## How it was tested

| Method | What it covers | Limits |
|---|---|---|
| Line-by-line code inspection | `Code.js` (all 15 actions), `build.mjs`, manifest, core roster/assignment code, app token handling | Human review; can miss things |
| Automated attack tests: `services/submission-broker/test/security.test.ts` (31 tests) | Forged/foreign/expired/replayed tokens, cross-service token replay, teacher impersonation, roster claims, data separation, Drive isolation, fabricated scores, replays, deadlines, receipts, recordings, formula injection, hidden keys, error leakage, code integrity | Run against **test doubles** of Google services (below) |
| App-side attack tests: `apps/web/test/phase5.test.tsx` (6 new) | Token routing between services, malicious-service responses (fake media, invalid activity) | jsdom browser, GIS test double |
| Mutation checks | The fixes were temporarily removed to confirm the attack tests then fail (3 cross-service tests, 2 media tests, 1 routing test failed as expected) | One test (invalid activity) also passes without its fix, because the app fails safely later; it is a weak test |
| Re-running the whole suite 6× | Flakiness; it exposed a real race (finding L-8) | — |
| Build determinism | Two builds produce byte-identical files | The deployed GitHub Pages copy could **not** be downloaded from this environment (network policy) |

The test doubles (`services/submission-broker/test/fakeAppsScript.ts`) were made **more pessimistic** for this audit:
JWT-shaped tokens whose validity is decided by a tokeninfo stand-in (standing in for Google's signature check), and a
Sheets model that converts typed values the way Sheets does ("=…" → formula, "007" → 7, ISO dates → date values).
The earlier doubles stored values unchanged, which hid two real bugs (H-3, M-2). **Earlier passing tests did not show
the service was secure**: 15 of the new attack tests failed against version 0.5.0.

## Summary of findings

| ID | Severity | Finding | Status |
|---|---|---|---|
| C-1 | **Critical** | A teacher's sign-in could be replayed by any other Apps Script service: one click on a crafted link gave an attacker the teacher role for up to an hour (full roster with names and emails, all reports, roster and assignment changes) | **Fixed** (0.5.1) |
| H-1 | High | Same replay for students: a captured student sign-in could submit work as that student and use up their attempts | **Fixed** |
| H-2 | High | Before the teacher's first use, any valid sign-in could reach the service (it had no notion of "connected") | **Fixed** |
| H-3 | High | Due dates were not enforced with real Sheets: dates read back as date values and the string comparison never found work late, so "no late work" could be bypassed | **Fixed** (confirm live) |
| M-1 | Medium | Spreadsheet formula injection: activity titles, class names and roster names were written as formulas (e.g. `=IMPORTXML(…)` could send roster data to another site when the teacher opens the sheet) | **Fixed** |
| M-2 | Medium | Student numbers were changed by Sheets ("007" → 7), breaking identity matching and letting "07"/"7" collide | **Fixed** |
| M-3 | Medium | Recordings were stored without checks: any file type, any item, any size up to the request limit, under official-looking names in the teacher's Drive | **Fixed** |
| M-4 | Medium | The app trusted a service's declared media type and did not validate the activity it received; a malicious service could deliver HTML labelled as audio | **Fixed** |
| M-5 | Medium | The service has full Drive and Sheets access in the teacher's account (broader than it needs) | Open — see [Scopes](#oauth-scopes) |
| M-6 | Medium | No deletion/retention procedure for student data | Open — procedure below; tool planned for Phase 6 |
| L-1 | Low | Hidden-answer mode kept "correct/incorrect/explanation" feedback on speaking, writing and other types | **Fixed** |
| L-2 | Low | Unexpected errors returned internal messages (e.g. Drive ids) to the caller | **Fixed** |
| L-3 | Low | A busy lock became a permanent "not accepted" instead of a retry | **Fixed** |
| L-4 | Low | Junk tokens each cost a call to Google (quota exhaustion by anyone on the internet) | **Fixed** (local pre-check) |
| L-5 | Low | Teacher role was by email only; an address reassigned to another Google account would inherit it | **Fixed** (pinned to account id) |
| L-6 | Low | No size limit on answers; invalid due dates accepted from the teacher client | **Fixed** |
| L-7 | Low | Students choose the attempt id, which seeds random question selection from pools, so they can search for a favourable draw offline | Open — Phase 6 (service-issued seeds) |
| L-8 | Low | App race: each new sign-in restarted the assignment download, which could fail with "version already exists" | **Fixed** |
| L-9 | Low | Hints and checks used are reported by the device; a modified app could under-report them | Open — accepted; use hidden mode for assessments |
| I-1 | Info | In "client" grading mode the device has the answer keys — by design, for instant feedback. Use **Hide answer keys** for anything that counts | Documented |
| I-2 | Info | Receipts can be verified only by the teacher (who holds the key); there is no verify endpoint | Documented |

No finding allowed reading, changing or deleting unrelated Drive files (tested; see 2c).

## 1. Authentication and authorization

**1a. ID token verification** (code inspection + tests). Every request goes through `verifyCaller_` before any action:
- local pre-check (new): the token must be JWT-shaped, for this app's client id, and not expired — otherwise refused without calling Google;
- verification by Google's `oauth2.googleapis.com/tokeninfo` endpoint, which checks the signature (only this URL is ever fetched — tested);
- `aud` = this app's OAuth client, `iss` = `accounts.google.com` / `https://accounts.google.com`, `exp` in the future (re-checked on cached results), `email_verified` = true, `sub` present, optional school domain (`hd`);
- **new: `nonce` must name this service** (see C-1). Verified claims are cached for at most 5 minutes, keyed by the SHA-256 of the token.

Tested: forged token with a fake signature claiming to be the teacher; wrong audience, issuer, expiry, unverified email; junk tokens; cached tokens.

**C-1 / H-1 — cross-service replay (fixed).** All teachers' services accept tokens for the same OAuth client. Before 0.5.1 a
token sent to *any* service was valid at *every* service. Anyone can deploy an Apps Script web app, and the teacher's
service id is in every assignment link students receive. An attacker (for example a student) could send the teacher a link
`…#/a/x?b=<attacker's service>`; the app would send the teacher's token there, and the attacker could replay it to the
teacher's real service for up to an hour.

Fix: the app now asks Google for a separate ID token **per service**, with the nonce `ilp-b.<service id>`, and sends it
only to that service. The service records its own id the first time its owner signs in (Connect), refuses everything
before that (H-2), and from then on refuses tokens minted for any other service. Tests:
`a teacher token captured by a malicious service cannot be replayed…`, `a student token captured…`,
`rejects tokens without a service nonce`, `before the teacher connects…`; in the app, `each service only ever receives
tokens minted for itself` and `a token captured by a malicious service is refused by the real one`.

**1b. Teacher impersonation.** The teacher is the script owner (email recorded by `setup()`; fallback: effective user), now
pinned to the Google account id on first use. A student cannot become teacher: role comes only from the verified email
and account id. Tested: all 9 teacher actions refused for students; same email with another account id refused.

**1c. Claiming another student's number.** Not possible in the tests. The number comes only from the private roster, by the
verified account: first sign-in binds the roster row (by email) to the Google account id (`sub`); afterwards only that
account matches. Any `studentNumber` sent by the client is ignored (tested). A second account cannot take a bound row
(tested). The teacher can re-assign a row by changing its email (binding is reset).
Residual: the first sign-in with the email on the roster wins, so a typo in a roster email gives that person the number.

**1d. Other students' submissions / 1e. rosters.** Students can call only 4 actions (`student.*`) plus `whoami`, all scoped to
the roster row resolved from their own verified account. Tested: a second student's responses contain no other student's
number, name, email, attempt id or account id; their receipts list is empty.

## 2. Google Drive security

**2a. `USER_DEPLOYING` + `ANYONE_ANONYMOUS`.** Needed: students sign in to *this app*, not to the teacher's script, and may be
in other domains, so the web app must accept requests without a Google session ("Anyone") and must run as the teacher
to write to the teacher's Drive ("Me"). This is safe **only because every request is authenticated by the ID token
inside the request**, which 0.5.1 enforces for every action. Residual risks: the URL is public (anyone can send requests;
they are refused, but they count against the teacher's Apps Script quotas — an availability risk, not a data risk), and
the script runs with the teacher's full permissions, so the code you paste must be exactly the generated code.

**2b. Independent authorization per operation.** Yes: `verifyCaller_` runs for every POST; each teacher action calls
`requireTeacher_`; each student action resolves the roster row first. `doGet` returns only the service name and version (tested).

**2c. Reading/modifying/deleting unrelated files.** No Drive file or folder id is ever taken from a request: ids come from the
script's own properties and its private sheet. Asset names are validated (`ast_` + 40 hex) and looked up only inside the
assignment's own `media` folder. The script never deletes or shares files. Tested: an unrelated file's id was passed in
every id-like field of every action, by teacher and student — its contents never appeared in any response and it was
not changed or moved.

### OAuth scopes
| Scope | Used for | Can it be narrowed? |
|---|---|---|
| `drive` | `DriveApp` (folders, reports, recordings) | Not with `DriveApp`. As far as I know `DriveApp` requires the full Drive scope (I could not open Google's documentation from this environment to confirm). Narrowing to `drive.file` means rewriting storage with the Advanced Drive service (Drive API v3) — planned hardening; must be tested live |
| `spreadsheets` | The private roster/submissions sheet | Same — needs the Sheets API with `drive.file` |
| `script.external_request` | Only `oauth2.googleapis.com/tokeninfo` | No (alternative: verify signatures in-script with Google's public keys — more code, more risk) |
| `userinfo.email` | Recording the owner's email | Could be removed by asking the teacher to type their email in `setup()`; small gain |

Until then (M-5), the main control is: **run the service in an account whose Drive holds nothing else** (a dedicated
teacher/test account), never share the script project or the sheet, and paste only the generated files.

## 3. Assignment submissions

- **Fabricated scores:** ignored. The service re-grades from the raw responses with the same engine; the client's score is
  stored only to flag a mismatch. Extra fields (`score`, `totals`) are ignored. Tested.
- **Question selection:** re-derived from the attempt id (L-7 remains: the student chooses that id).
- **Checks:** assignment id → the assignment row in the sheet; class membership via the roster of *that assignment's class*;
  attempt limits, closing and due dates enforced under the script lock; ownership = roster row from the verified account.
  Tested, including deadlines with Sheets' date conversion (H-3, fixed by comparing times, not strings).
- **Forgery and replay:** a request needs a valid, unexpired token for this service and this student. Re-sending the same
  attempt returns the original receipt and cannot overwrite it; another student re-using the attempt id gets their own
  record. Tested. Residual: an ID token is a bearer credential for up to an hour — if a student's device or browser is
  compromised, that is outside what this design can prevent.
- **Receipts:** HMAC-SHA-256 over fixed fields, with a 244-bit random secret created by `setup()` and kept in script
  properties; the secret never appears in any response (tested). Field values cannot contain `&`/`=` (ids and student
  numbers are restricted), so the signed string is unambiguous. Only the teacher can verify a receipt (I-2).

## 4. Student privacy

- **Names and emails:** stored only in the teacher's private sheet; never returned to students (tested). Reports and
  recording file names use the student number only (tested).
- **Pseudonymization:** reports are pseudonymous, not anonymous — the teacher can re-identify them, so they remain personal information.
- **Recordings:** stay on the student's device unless the speaking question allows submission; then only real audio (checked
  by its bytes), at most one per phrase, ≤ 20 MB, for a presented speaking question (M-3, tested). Stored privately in the
  teacher's Drive (Drive's default; confirm live).
- **Logging / transmission:** the service calls only Google's tokeninfo. Logs: `setup()` logs folder/sheet links; unexpected
  errors log a reference and a stack trace (no request bodies) to the teacher's own execution log. Verified claims (incl.
  email) sit in the script cache for ≤ 5 minutes. The app sends a student's token only to the service in their link.
  Recordings and answers travel over HTTPS to Google.
- **Deletion (M-6, open):** there is no deletion tool yet. Manual procedure:
  1. Student leaves: set their roster status to `withdrawn` (blocks access), or remove the row and Save.
  2. Delete their files: search Drive for the student number inside `Interactive Learning Platform/Classes/…/Student Reports` and `…/Recordings`; delete; empty Drive trash.
  3. Delete their rows in the `Submissions` sheet tab.
  4. Their own copies are in *their* Drive (`My Submissions`) and on their device (Settings → delete local data).
  5. End of year: delete the class folder and its sheet rows; to remove everything, delete the `Interactive Learning Platform` folder, the sheet, and the Apps Script project, and revoke its access in the Google account's security settings.

## 5. Code integrity

- `Code.gs`, `GradingCore.gs`, `appsscript.json`: reviewed (section 1–4). The generator (`build.mjs`) bundles the shared core
  with esbuild, injects the client id, and (new) a build fingerprint shared by both files.
- **Does the setup page serve the repository's code?** The page's files are generated during the GitHub Actions build from
  the same commit (`vite.config.ts` → `build.mjs` → `public/broker/`), and the build is deterministic (two builds
  byte-identical). I could **not** download the deployed copy from this environment, so this is not verified
  end-to-end. New check: on **Connect**, the app compares the service version (must be 0.5.1) and the fingerprint
  shared by Code.gs and GradingCore.gs, and warns if they do not match.
- Generated files contain the real client id and no placeholders, API keys or secrets (tested).
- File names in the Apps Script editor do not matter (`gradingcore.gs` is fine); file order does not matter either.

## Requires live verification
These depend on real Google behaviour and are **not** covered by the automated tests:
1. `tokeninfo` returns the `nonce` claim, and Google Identity Services applies a new `nonce` when re-initialised (core of C-1).
2. Silent sign-in for a second service works or falls back to the "Confirm sign-in" banner (FedCM may wait ~10 minutes between automatic sign-ins).
3. `Session.getEffectiveUser()` and `setup()` record the owner's email; Connect succeeds only for the owner.
4. Sheets keeps apostrophe-prefixed text exactly (numbers like `007`, ISO dates, `=…`); confirm by looking at the sheet.
5. Files and folders the script creates are private ("Only you") in Drive.
6. Requests from students in other Google domains reach the "Anyone" web app; school Workspace policies may block it.
7. Recordings from iPhone/iPad (MP4) and Chrome/Android (WebM) are accepted.
8. Quotas: a class submitting at the same time (script lock, 30 simultaneous executions, URL fetch quota).
9. The consent screen lists exactly the four scopes above.

Steps for these are in `docs/12-phase5-live-test.md` (section "Security checks").

## Before real students (additional requirements)
1. School/IT approval (doc 13) and the privacy notice/consent your school requires (PIPA: under-14 consent where consent is the legal basis).
2. The live verification above, passed.
3. Use **Hide answer keys** for anything graded.
4. A deletion and retention procedure agreed with the school (M-6), ideally the Phase 6 deletion tool.
5. Decide the scope question (M-5) with IT: dedicated account, or the `drive.file` rewrite.
6. Set `ALLOWED_DOMAIN` to the school domain.
7. Publishing the OAuth app beyond "Testing" (Google verification), when IT approves.
8. An independent review of this audit and of the live results.
