# 15. Narrow Google permissions (`drive.file`) and Simulation mode — feasibility and design (service 0.6.0)

Branch: `drive-file-storage`. **Not deployed.** The live app and the setup page on `main` still serve service 0.5.1.

## 1. Sources and how sure we are
This environment cannot open `developers.google.com` (network policy). The statements below come from Google's
documentation as quoted in web-search results, from the API behaviour the code is written against, and from my own
knowledge. Each is marked **[doc]** (quoted from Google's documentation via search), **[known]** (standard, well-documented
API behaviour I could not re-read here) or **[verify live]** (must be confirmed with a real account, see doc 12 §N).

- [doc] `drive.file`: *"See, edit, create, and delete only the specific Google Drive files you use with this app"*; recommended,
  non-sensitive; the broad `drive` scope is *restricted*. ([Choose Google Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth))
- [doc] Picker with `drive.file`: `setAppId` takes *"the Cloud project number"*, is *"required for the drive.file scope"*, and
  *"the same Google Cloud project must contain both the client ID and the app ID as it's used to authorize access to a user's
  files."* ([PickerBuilder.setAppId](https://developers.google.com/workspace/drive/picker/reference/picker.pickerbuilder.setappid),
  [Picker for web apps](https://developers.google.com/workspace/drive/picker/guides/web-picker))
- [doc] Whether picking a *folder* exposes the files inside it is not stated in the documentation found; community reports
  disagree. Treat it as **not recursive**. ([community thread](https://community.latenode.com/t/how-to-enable-backend-access-to-selected-google-drive-directory-using-google-picker-api/26441))
- [known] `DriveApp` and `SpreadsheetApp` require the full `drive` / `spreadsheets` scopes; the Drive API v3 and Sheets API v4
  accept `drive.file` for files the app created ([Advanced Drive service](https://developers.google.com/apps-script/advanced/drive),
  [Sheets API scopes](https://developers.google.com/workspace/sheets/api/scopes)).
- [known] Each Apps Script project has its own default Cloud project; `ScriptApp.getOAuthToken()` carries the scopes in its manifest.
- [verify live] Declaring the Drive v3 / Sheets v4 advanced services in `appsscript.json` turns those APIs on for the script's
  default Cloud project, so REST calls with the script's token succeed.

## 2. The essential question
> Does selecting a folder through Google Picker, combined with `drive.file`, support everything the application needs?

**Not for the teacher's submission service.** A `drive.file` grant belongs to **one app = one Cloud project** [doc]. The
Picker in this web app grants access to *the web app's* project (964954121204). Each teacher's Apps Script runs under *its
own* default Cloud project, so a folder picked in the web app gives the script **no access at all** (modelled and tested:
`a folder picked in the WEB APP gives the teacher's service no access at all`). Making the script share the web app's
project would require every teacher to be added to that Cloud project — not workable for "a teacher at any school".
Running a Picker *inside* the script (HtmlService) would need a per-teacher standard Cloud project and API key, and on
an "Anyone" web app it would expose the teacher's token to any visitor — rejected.

Even with the right project, picking a folder is treated as granting **that folder only, not its contents** [doc gap → assume
not recursive]. Files the app *creates inside* a folder it may use are accessible because the app created them.

**What does work, entirely under `drive.file`:**
1. **The service creates its own storage folder** "Interactive Learning Platform" (in `setup`) and everything inside it: class
   folders, the private roster/submissions sheet, assignment files, media, student submissions, recordings, reports. Create,
   read, update, list and delete of these files are all allowed [doc: "see, edit, create, and delete only the specific files"].
2. **Choosing the location = moving that folder** anywhere in Drive (Drive web UI). Access is per file, not per location,
   so the service keeps working after the move [known; verify live — `checkPermissions` and doc 12 N3]. This gives the same
   end result as "select an existing folder": the storage lives where the teacher wants it.
3. **Existing materials** are imported file by file through the web app's Picker ("From Google Drive…" in the editor: audio,
   images, readings incl. Google Docs exported as .docx). The app copies the bytes into the activity; on Assign the copy is
   stored in the service's folder. The original is not changed and no other file becomes visible.

So **option 1 of the request ("create a new folder") is implemented; option 2 ("select an existing folder with Picker") is not
possible for the service under `drive.file`** and is replaced by "move the created folder there".

## 3. What changed in the service (0.5.1 → 0.6.0)
| Operation | 0.5.1 | 0.6.0 |
|---|---|---|
| Create folders, files | `DriveApp.createFolder/createFile` (needs `drive`) | Drive API v3 `files.create` + media upload, parent = a folder the script created |
| Read reports, assignments, media | `DriveApp.getFileById` | `files.get?alt=media` by stored id (404 if not the script's) |
| Find sub-folders | `getFoldersByName` | `files.list` with `'<id>' in parents and name = …` (returns only the script's files) |
| Roster, assignments, submissions log | `SpreadsheetApp.openById` (needs `spreadsheets`) | Sheets API v4 `values.get/update/append/clear`, **`valueInputOption=RAW`** |
| Spreadsheet creation | `SpreadsheetApp.create` | `files.create` with the Sheets MIME type inside the folder, tabs via `batchUpdate` |
| Media lookup | by file name in a folder | by file id stored in `assignment.json` |
| Teacher identity | owner email via `Session.getEffectiveUser()` (needs `userinfo.email`) | **one-time connection code** printed by `setup`, then pinned to the Google account id |
| Storage summary / backup | — | `storage.info` (lists only the script's files), `storage.export` (sheet data) |
| Self-check | — | `checkPermissions()` in the editor: create/read/update/list/delete + optional probe of an unrelated file |

All 0.5.1 protections are unchanged: token checks (audience, issuer, expiry, verified email, domain), service-bound nonce,
teacher pinning, roster binding, server-side re-grading, attempts/deadlines/closing, idempotent replay, HMAC receipts,
recording checks, size limits, generic errors, hidden answer keys. Formula injection is now prevented by RAW writes
(the apostrophe trick is no longer needed).

## 4. Exactly what a teacher authorises
`appsscript.json` (0.6.0):
```json
"oauthScopes": [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/script.external_request"
]
```
Expected Google consent lines (wording to confirm at the first `setup` run — doc 12 N1):
1. **See, edit, create, and delete only the specific Google Drive files you use with this app** — the service's own folder and files.
2. **Connect to an external service** — Google's token check (`oauth2.googleapis.com`) and the Drive/Sheets APIs (`www.googleapis.com`, `sheets.googleapis.com`); the code calls no other host (tested).

Removed: full Drive (*"See, edit, create, and delete all of your Google Drive files"*), full Sheets (*"…all your Google Sheets
spreadsheets"*), and *"See your primary Google Account email address"*.

## 5. Permissions by role
| Who | Permission (OAuth client) | Why | Sees other files? |
|---|---|---|---|
| A. Teacher using the app | `openid`, `email` (sign-in, ID token only); `drive.file` only when they use "From Google Drive…" or save a report | Identify them to their own service; import a file they pick | No |
| B. Teacher installing the service | `drive.file`, `script.external_request` (the script's own project, §4) | Store classes, roster, submissions, recordings in the folder it creates; verify sign-ins | No |
| C. Student signing in | `openid`, `email` | Prove who they are to the teacher's service, which maps them to a roster number | — (no Drive access) |
| D. Student saving their own copy | `drive.file` (web app) | Create *My Submissions* in their Drive and save their report there | No — only files the app created for them |

Students never get access to the teacher's folder: they talk to the service, which reads and writes on the teacher's behalf
and returns only their own number, activity and receipts (tested). Nothing is ever shared — the code never calls Drive's
sharing API (tested).

## 6. Options compared
| | A. Apps Script, broad scopes (0.5.1) | **B. Apps Script, `drive.file` + APIs (0.6.0)** | C. Small serverless backend | D. Local-only + optional sync |
|---|---|---|---|---|
| Access to unrelated files | Technically all of the teacher's Drive and Sheets | **None** (Google-enforced) | None if it uses `drive.file` with the web app's project; but it holds tokens for many teachers | None |
| Who runs it / holds data | Each teacher, in their account | Each teacher, in their account | The project (a server holding refresh tokens for every teacher → central breach target, needs ops) | Each device |
| Google verification for wide use | `drive` is **restricted**: security assessment for public use | `drive.file` is non-sensitive; the script is the teacher's own | Restricted/sensitive review depending on scopes; privacy policy, domain | None for local |
| Set-up per teacher | ~10 min | ~10 min + paste a code | None for teachers; ongoing hosting for us | None |
| Cost | Free | Free | Hosting + monitoring; not free at scale | Free |
| Maintenance | Low | Low (REST code, more lines) | High (security patches, uptime, keys) | Low |
| Student submissions while teacher offline | Yes | Yes | Yes | No (needs manual export/import) |
| Fit for a free open-source school tool | Works, but asks for too much | **Best balance** | Only with a funded maintainer | Good for practice; not for collected work |

**Recommendation: B.** It removes access to unrelated files and spreadsheets without adding a server, cost or a central
data store. D already exists as the app's default (everything works locally; Simulation mode adds a full classroom without Google).

## 7. Simulation mode (development and testing without Google)
Settings → Simulation mode, or `#/simulation`.
- Fictional teachers (each with a **simulated submission service**: the same service code, built into the app, running in the
  browser against a labelled Google emulator that enforces the same `drive.file` rules as the tests) and fictional students.
- Build, publish and assign activities; act as a student and complete them (grammar, listening, dictation, speaking with the real
  microphone, reading/notes, writing); see the teacher's submissions, storage summary and backup.
- Data is kept in separate browser databases (`ilp-simulation`, `ilp-simulation-google`); real work is not visible or changed.
- Safeguards (tested): no request reaches any Google host; simulated services have ids starting `SIMULATED` and refuse real
  sign-ins; real services are never contacted while simulating; simulated sign-ins are unsigned and for an invalid client id, so a
  real service rejects them without even asking Google; everything is labelled SIMULATED (banner, receipts, downloads).

Not simulated: real Google sign-in, consent screens, Drive/Sheets quotas, school admin policies, mobile sign-in pop-ups.

## 8. Tests
- Service: 31 attack tests from the audit (one updated by design: the expected scope list), 20 new `drive.file` tests
  (`test/drive-file.test.ts`): unrelated files invisible by id and by listing (even inside the service's folder), control test with
  the broad scope, folder moved by the teacher, trashed storage, web-app Picker grants not usable by the service, picked folder not
  recursive, RAW writes with a USER_ENTERED control, hand-typed due dates, connection code (single use, hash only, lockout, reset).
- Mutation checks: writing USER_ENTERED makes the formula and "007" tests fail; putting back the `drive` scope makes 5 tests fail.
- App: simulation flow (unit + real-browser end to end, with accessibility scans), real/simulated separation guards.
- The emulator is not Google. Live checks: doc 12, section "Narrow permissions".
