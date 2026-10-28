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
