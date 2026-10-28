# Submission broker (Phase 5 — not implemented yet)

A small Google Apps Script web app that each teacher deploys into their own account ("Execute as: me", "Who has access: anyone"). It verifies a student's Google ID token, checks the teacher's private roster Sheet, re-grades raw responses with the bundled `@ilp/core` engine, writes a teacher-owned report into the class folder, and returns a receipt. See `docs/03-architecture.md` for the protocol and `docs/04-privacy-auth.md` for the security model.

Nothing in this folder runs yet. No mock stands in for it in the app: the UI says plainly that Drive submission is not available.
