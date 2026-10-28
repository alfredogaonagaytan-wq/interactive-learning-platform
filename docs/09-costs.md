# 10. Estimated recurring costs

Assumptions: Google Workspace for Education (Fundamentals is free for qualifying schools); per-teacher Apps Script broker; ~1 class = 25–30 students; each student submits ~10 activities/week; voice submissions only when required (~250 KB per 30 s AAC/Opus clip). **Verify current Google and host quotas/prices before relying on them.**

| | 30 students | 300 students | 3,000 students |
|---|---|---|---|
| Static hosting (GitHub Pages / Cloudflare Pages) | $0 | $0 | $0 |
| Google Cloud project, OAuth client, Drive API, Picker API | $0 | $0 | $0 |
| Apps Script broker (runs in each teacher's account) | $0 | $0 | $0 |
| Broker load per teacher (≈150 students) | ~300 req/week | same per teacher | same per teacher |
| Drive storage (reports ≈ 20 KB each; audio if required) | <1 GB | ~2–5 GB | ~20–50 GB in pooled school storage |
| Custom domain (optional) | ~$12/yr | ~$12/yr | ~$12/yr |
| OAuth verification (non-sensitive scopes only) | $0 | $0 | $0 |
| **Total** | **≈ $0–1/month** | **≈ $0–1/month** | **≈ $0–1/month** |

### Optional central broker (Cloudflare Worker instead of Apps Script)
Free tier ≈ 100k requests/day. 3,000 students × ~5 requests/submission × 10/week ≈ 21k/day peak — inside free tier; the paid plan (≈ $5/month) is the safety margin. KV/D1 storage for bindings is tiny (< 1 MB).

### Costs that are *not* zero
- **Restricted Drive scopes** (`drive`, `drive.readonly`) would trigger an annual third-party security assessment (thousands of USD) for a public app — avoided by design.
- **Local AI / phoneme models**: no server cost, but large downloads (100 MB–1 GB) per device.
- **People time**: per-teacher broker setup (~10 min), admin allow-listing, privacy review.
