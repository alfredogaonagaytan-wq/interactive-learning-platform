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

## C. Each teacher's submission service (Apps Script, ~10 minutes)
In the app: **Classes → Set up the submission service** (or `#/setup-service`). The page has copy buttons for the three files and step-by-step instructions:
1. script.google.com → New project; show the manifest; paste `appsscript.json`, `Code.gs`, and a new file `GradingCore`.
2. Run `setup` once and allow the permissions (Google says "unverified" because it is your own script → Advanced → continue).
3. Deploy → Web app → Execute as **Me**, Access **Anyone** → copy the URL → paste it in the app → **Connect**.

What the script can access: it runs as the teacher and its manifest requests Drive, Sheets, external requests (only `oauth2.googleapis.com/tokeninfo` is called) and the teacher's email. It creates and uses only the folder "Interactive Learning Platform" and one private sheet. A school administrator may restrict Apps Script; in that case, ask IT (see doc 13).

Updating the script later: Deploy → Manage deployments → Edit → **New version** (keeps the same URL, so existing assignment links keep working).

**Connect binds the service to its URL (since 0.5.1).** The first time the script's owner presses **Connect**, the
service records its own web-app id and from then on accepts only sign-ins made for that id; before that it accepts
nobody. If you ever create a **new deployment** (a new URL) instead of a new version, run `resetConnection` once in
the editor and press Connect again.

**Integrity check.** On Connect the app checks that the service is version **0.5.1** and that `Code.gs` and
`GradingCore` come from the same build. If it warns, copy all three files again. The first lines of the files show the
build: `Code.gs` contains `var VERSION = '0.5.1'` and `var CORE_BUILD = "…"`; `GradingCore` starts with
`var ILP_CORE_BUILD = '…'` — the two values must be identical.

**Use an account whose Drive holds nothing else.** The script has full Drive access in the account it runs in
(see doc 14, M-5). Never share the script project or the sheet.
