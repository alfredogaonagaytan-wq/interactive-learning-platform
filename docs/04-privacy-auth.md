# 5. Privacy and authentication design

> This is an engineering design, not legal advice. Items marked **⚖ review** need school/district approval or a lawyer.

## Data inventory

| Data | Where it lives | Who can read it | Retention |
|---|---|---|---|
| Activities, answer keys | Teacher device; teacher Drive | Teacher (and co-teachers they share with) | Teacher-controlled |
| Roster (student #, optional name, Google email, class, status, bound `sub`) | **Teacher Drive Sheet only** | Teacher / admin | Teacher-controlled; delete at year end |
| Student responses (in progress) | Student device (IndexedDB + journal) | Student | Until submitted + configurable cleanup |
| Student report copy | Student Drive (`My Submissions/`) | Student | Student-controlled |
| Teacher-owned submission | Teacher Drive (`Student Reports/`) | Teacher | Teacher-controlled; bulk delete per class |
| Audio recordings | Device by default; uploaded **only** if the assignment requires it | Student; teacher if submitted | Default auto-delete local after submit; teacher-set retention |
| Our servers | **None** (static files). Optional central worker: encrypted refresh tokens + hashed bindings only | — | — |

No analytics, no advertising, no third-party fonts or CDNs at runtime, no telemetry.

## Identity

- **Google Identity Services** (GIS) for everyone. The PWA requests `openid email` (ID token) and, incrementally, `https://www.googleapis.com/auth/drive.file`.
- **Stable identifier:** Google's `sub` claim. The roster is keyed by teacher-assigned student number + authorised email; on a student's **first verified** request the broker binds `sub` to that row. Afterwards the `sub` is authoritative; an email change is flagged for the teacher, not silently accepted.
- **Students cannot choose their number.** The broker derives it from the verified token. There is no "type your student number" field anywhere.
- **Teacher authentication** to the broker uses the same ID-token check against a teacher allow-list held in the script properties.
- **Tokens:** access tokens live in memory only (GIS token model, ~1 h); no refresh tokens in the browser; nothing in localStorage. ID tokens are sent only to the teacher's broker over HTTPS.
- **Cross-class isolation:** each broker serves one teacher; every request is checked against the roster row's class and the assignment's class.

## Pseudonymisation
Reports show student numbers by default; names appear only in the teacher's roster view. **Pseudonymous data is still personal data** because the teacher can re-identify it — every obligation below still applies.

## Microphone
Requested only when a student presses "Record", never on load. Recordings stay on device unless the assignment explicitly requires submission. Browser speech recognition that may send audio to a vendor is **off by default**, can only be enabled by the teacher in assignment settings with an explicit disclosure, and should be enabled only where the school has approved it.

## Answer keys
Client-graded mode: keys are on the device (documented limitation; we prevent accidental display only). Server-graded mode: keys stay in teacher Drive; the broker strips them before sending the activity.

## South Korea ⚖ review
- **Personal Information Protection Act (PIPA)**: collection needs a lawful basis and notice; for children **under 14**, consent of a legal representative is required where consent is the basis. Processing on behalf of a school may be structured as outsourced processing (the school as controller) — confirm with the school.
- **Cross-border transfer:** Google Workspace stores data outside Korea; PIPA's overseas-transfer rules apply. Schools already using Google Workspace for Education usually have this covered in their Google agreement and privacy notice — verify, and confirm this app adds no new recipient (by design it adds none when the per-teacher broker is used).
- **Ministry of Education / regional Office of Education guidance** on selecting learning-support software (school-level review of edtech tools and their privacy terms) — the school's IT/privacy officer should review the app before use.
- International schools in Korea may additionally follow the policies of their accrediting body or home country (e.g. FERPA/COPPA for US-affiliated schools, GDPR/UK GDPR for EU/UK students).

## Other jurisdictions (summary) ⚖ review
- **US:** FERPA (school controls education records; app acts under "school official" exception via agreement), COPPA (under-13; school may consent for educational use only), state student-privacy laws (e.g. SOPIPA in California).
- **EU/UK:** GDPR — school is controller; a DPIA is advisable for children's data and voice recordings; data-processing terms needed if any central component is used.

## Phase 5 implementation notes
- **App OAuth scopes:** `openid`, `userinfo.email`, `drive.file` (non-sensitive). ID and access tokens are kept in memory only, never in IndexedDB or localStorage.
- **Teacher's Apps Script scopes (0.6.0):** `drive.file` and `script.external_request` only. The script can use only the folder and files it creates (Google-enforced); it no longer has full Drive, full Sheets or email access. Teacher identity is established with a one-time connection code. 0.5.1 used `drive`, `spreadsheets`, `script.external_request` and `userinfo.email`. See doc 15.
- **Google's sign-in script** is loaded only on devices where someone has signed in with Google before (0.6.0); a device used only offline or in Simulation mode never contacts Google.
- **Simulation mode** uses fictional people and simulated services in separate local databases; nothing is sent anywhere.
- **Binding:** a roster row is linked to the Google `sub` the first time a student signs in with the matching email. After that, a different account cannot claim that row.
- **Reports** hold the student number but no name or email. Names stay in the teacher's private sheet.
- **Development data:** use fictional names and numbers and test accounts only, until the IT and privacy review (doc 13) is complete.

## Requires approval before real student use
1. Workspace admin allow-listing of the OAuth client (and Apps Script for the broker).
2. School privacy review / DPIA, parental notice or consent as applicable.
3. Retention schedule (default suggestion: delete class folders 1 year after course end).
4. Decision on whether browser speech recognition is ever allowed.

## Deletion
- Device: Settings → "Delete all local data" (implemented + tested).
- Student-submitted audio and reports: teacher bulk-delete per assignment/class (Phase 6).
- Roster: deleting the Sheet removes all bindings; broker holds no other copy.
