# 12. Phase 5 live test script (real Google accounts)

Automated tests run the real app and the real broker code against labelled test doubles of Google's services. This script verifies the parts only real Google can: sign-in, Drive, Apps Script, and admin policies. Use **made-up names and numbers** only.

Accounts: **T** = your teacher account; **S1**, **S2** = test student accounts (all listed as test users in the Cloud console); **X** = a Google account *not* on the roster.

| # | Who | Steps | Expected |
|---|---|---|---|
| 1 | T | Open the Pages URL → Settings → Sign in with Google | Signed in as T; chip in the header |
| 2 | T | Classes → Set up the submission service; follow all steps; Connect | "Connected"; Drive has folder **Interactive Learning Platform** with a private sheet |
| 3 | T | Classes → create "Test 7A"; Roster: add S1 → `S01`, S2 → `S02` (made-up names optional) → Save | Saved; sheet "Roster" shows 2 rows; Drive has Classes/Test 7A (…) with sub-folders |
| 4 | T | Teacher → open a sample → Publish → Library → **Assign** → Test 7A, 2 attempts → Assign → Copy link | Link like `…/#/a/asg_…?b=…` |
| 5 | S1 | (other browser/profile or phone) open link → Sign in | "Assignment for student number **S01**"; activity loads |
| 6 | S1 | Answer some questions → turn on airplane mode → Submit | Results show; Delivery: teacher "Waiting to send", Drive pending; "safe on this device" |
| 7 | S1 | Airplane mode off (wait ≤30 s or press Retry) | Teacher: Done + receipt; Drive: first time asks for Drive permission → allow → Done; report Doc in S1's Drive › Interactive Learning Platform › My Submissions |
| 8 | T | Classes → Test 7A → Submissions | One row for S01 with verified score; JSON report in Drive › Classes › Test 7A › Student Reports › … (no names/emails inside) |
| 9 | X | Open the same link and sign in | "Your Google account is not on this class roster…" |
| 10 | S1 | Try again → submit a second and third attempt | 2nd accepted; 3rd refused: "You have used all 2 attempts" |
| 11 | T | Assign the same activity with **Hide answer keys** (MC / fill-in / T-F sample) | Students get no Check button; receipt shows the verified score |
| 12 | T | Close an assignment; S2 submits | Refused: "This assignment is closed" |
| 13 | S1 | iPhone/iPad Safari and an Android phone and a Chromebook: steps 5–7 | Same results; note any sign-in popup problems |
| 14 | T | Speaking activity with "students may choose a recording to submit"; S1 records and submits | Recording appears in Drive › Classes › … › Recordings |
| 15 | T | Editor → Audio clip → **From Google Drive…** → pick an audio file | Audio is copied into the activity; the Drive file stays private |

Please note: device, browser, step number, and any message shown. Screenshots help.

## Security checks (from the audit, doc 14)
Use the same synthetic accounts. **X2** = a second test account that deploys its *own* copy of the service (the "attacker").

| # | Who | Steps | Expected |
|---|---|---|---|
| S1 | T | Before pressing Connect, open the service URL in a browser | Only `{"ok":true,"service":"ilp-submission-broker","version":"0.5.1"}` |
| S2 | S1 | Before T has pressed Connect, open an assignment link for it (if you have one from an earlier setup) | "Your teacher has not finished connecting this submission service yet." |
| S3 | T | Connect | "Connected…" with no version warning |
| S4 | X2 | Deploy the service in X2's account and press Connect as X2. Make a link `<app>/#/a/asg_x?b=<X2's deployment id>`; T opens it while signed in | T sees an error from X2's service; T's own Classes page keeps working. (Whether a token X2 receives is refused by T's service is covered by the automated tests.) |
| S5 | T | Open the private sheet | Student numbers such as `007` are shown exactly; dates are text like `2026-11-02T09:00:00.000Z`; no cell is a formula |
| S6 | T | Create an assignment with a due date 2 minutes ahead and late work **off**; S1 submits after it | Refused: "The due date has passed…" |
| S7 | T | Drive → right-click the Interactive Learning Platform folder → Share | "Only you" has access (and nothing inside is shared) |
| S8 | S1 | Open two different teachers' assignment links (T's and X2's) one after the other | Both load; if one shows "Confirm your Google sign-in…", press the button and it continues |
| S9 | T | First run of `setup` | The consent screen lists: see/edit/create/delete all Drive files, Sheets, connect to an external service, see your email address — nothing else |
