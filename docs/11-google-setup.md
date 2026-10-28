# 11. Google Cloud, GitHub Pages and the submission service — setup

## A. Google Cloud project (done once by the app owner)
Already done for this deployment: project **Interactive Learning Platform**, OAuth client
`964954121204-g9k3t57l2rvcgpgr32pv8g35sd4o4apu.apps.googleusercontent.com`, Picker API key (referrer-restricted).

Checklist (Google Cloud console → Google Auth Platform / APIs & Services):
1. APIs enabled: **Google Drive API**, **Google Picker API**.
2. Audience: **External**, publishing status **Testing**; every test account listed under **Test users** (up to 100).
3. Data access (scopes): `openid`, `…/auth/userinfo.email`, `…/auth/drive.file` only.
4. OAuth client (Web application) → **Authorized JavaScript origins**:
   - `https://alfredogaonagaytan-wq.github.io` ← required for the hosted app
   - `http://localhost:5173`, `http://localhost:4173` (local development)
5. API key → Application restrictions → **Websites**: `https://alfredogaonagaytan-wq.github.io/*`; API restrictions → **Google Picker API**.

Never create or share a **client secret**; the app does not use one.

## B. GitHub Pages (hosting)
1. Repository → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Repository → **Settings → Secrets and variables → Actions → Variables → New repository variable**: `GOOGLE_API_KEY` = the Picker key. (It is public by nature, but keeping it out of the code avoids automated "leaked key" alerts.)
3. Every push to `main` runs `.github/workflows/deploy.yml` (typecheck, tests, build, deploy). The app appears at
   `https://alfredogaonagaytan-wq.github.io/interactive-learning-platform/`.

## C. Each teacher's submission service (Apps Script, ~10 minutes) — version 0.6.0
In the app: **Classes → Set up the submission service** (or `#/setup-service`). The page has copy buttons for the three files and step-by-step instructions:
1. script.google.com → New project; Project Settings → show the manifest; paste `appsscript.json`, `Code.gs`, and a new file `GradingCore`.
2. Run `setup` once. Google asks for **two** permissions (doc 15 §4):
   - *See, edit, create, and delete only the specific Google Drive files you use with this app*
   - *Connect to an external service*
   (It says "unverified" because it is your own script → Advanced → continue.) Setup creates the folder
   **Interactive Learning Platform** at the top of your Drive, with a private sheet inside, and prints a **connection code**
   in the execution log.
3. Optional: run `checkPermissions`. It creates, reads, updates, lists and deletes a test file in the folder; paste the link of
   any other file of yours into `PROBE_FILE_LINK` first to confirm the script **cannot** see it.
4. Deploy → Web app → Execute as **Me**, Access **Anyone** → copy the URL → paste it **and the connection code** in the app → **Connect**.

**What the script can access:** only the folder and files it created (Google enforces this for `drive.file`). It uses the
Drive API v3 and Sheets API v4 directly, never `DriveApp`/`SpreadsheetApp` (which would need full access). It calls only
`oauth2.googleapis.com/tokeninfo`, `www.googleapis.com` (Drive) and `sheets.googleapis.com`. It never shares anything.
A school administrator may restrict Apps Script; in that case, ask IT (doc 13).

**Storage panel** (on the same page after connecting): folder name, *Open in Google Drive*, the private sheet, number of files
and size by kind, *Download backup* (roster, assignments, submissions as JSON; for everything including recordings use Drive's
Download on the folder), and *Disconnect this app* (forgets the service on this device; your data stays in Drive).

**Choosing where the folder lives:** move it in Google Drive into any folder. The service follows it by id. (Selecting an
*existing* folder with the Picker cannot give the script access — see doc 15 §2.) If you trash the folder, running `setup`
again creates a new, empty one; the old one stays in the trash.

**Updating the script later:** Deploy → Manage deployments → Edit → **New version** (same URL, existing assignment links keep working).

**Connect binds the service to its URL.** Until the code is used, the service accepts nobody; afterwards only sign-ins made for
its own URL, and you are pinned as the teacher by your Google account id. If you create a **new deployment** (a new URL)
instead of a new version, or want to hand the service to another account, run `resetConnection` (it prints a new code) and connect again.

**Integrity check.** On Connect the app checks that the service is version **0.6.0** and that `Code.gs` and `GradingCore`
come from the same build: `Code.gs` contains `var VERSION = '0.6.0'` and `var CORE_BUILD = "…"`; `GradingCore` starts with
`var ILP_CORE_BUILD = '…'` — the two values must be identical.

Never share the script project or the sheet: anyone who can edit the script can change what it does.
