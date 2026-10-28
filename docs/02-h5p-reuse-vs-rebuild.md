# 2. Reuse open-source H5P vs. rebuild

## Licences (verified 2026-10-28 from the H5P GitHub repositories)

| Component | Licence | Implication |
|---|---|---|
| `h5p-php-library` (core framework) | **GPL-3.0** | Linking it makes the combined server work GPL. |
| `h5p-editor-php-library` (editor) | **GPL-3.0** | Same. |
| Content-type libraries checked (`H5P.MultiChoice`, `H5P.InteractiveVideo`, `H5P.DragQuestion`, `H5P.SpeakTheWords`, …) | **MIT** (per `library.json` / LICENSE) | Can be reused or studied freely; must keep copyright notices. Each library must still be checked individually — a few third-party types differ. |
| `@lumieducation/h5p-server`, `h5p-webcomponents` (Node/TS reimplementation) | **GPL-3.0-or-later** | Usable in a GPL project. |
| `h5p-standalone` (player only, no editor) | **MIT** | Can render existing `.h5p` packages client-side; no authoring, no xAPI persistence of its own. |

h5p.org could not be reached from the build environment (network policy), so the catalog list in doc 06 is compiled from knowledge of the published catalog and must be re-checked against the live page.

## Options

| | A. Embed H5P (Lumi server + editor) | B. Use `h5p-standalone` player for imports only | C. Rebuild natively (chosen) + H5P converter |
|---|---|---|---|
| Feature parity day 1 | Highest (all ~50 types) | Playback of existing packages only | Grows phase by phase |
| Needs a server | Yes (Node + storage for libraries/content) | No | No (broker optional) |
| Offline PWA | Hard (libraries loaded dynamically, jQuery-era code) | Possible but heavy | Designed for it |
| Unified grading/reporting schema | No — xAPI statements per type, heterogeneous | No | Yes — one `ItemResult` model |
| Answer-key protection / broker grading | No (all client-side JS) | No | Yes (same engine runs in broker) |
| Accessibility control | Varies by content type | Varies | Owned by us, tested with axe |
| Custom modules (Cornell/CER/TCTAC, grammar engine, pronunciation) | Must be written as H5P libraries anyway | — | Native |
| Licence | Whole server GPL-3.0 | MIT | MIT (ours); MIT H5P code may be adapted with attribution |
| Maintenance | Two ecosystems (PHP/Node + H5P libs) | Small | One codebase |

## Recommendation

**Rebuild natively (C)** with a shared schema, and add two compatibility layers:

1. **H5P importer (Phase 7):** parse `.h5p` zips (`h5p.json` + `content/content.json`) for common MIT-licensed types (MultiChoice, TrueFalse, Blanks, DragText, MarkTheWords, Dialogcards, Flashcards, QuestionSet, Summary, SingleChoiceSet, SortParagraphs, Dictation) and convert them to native items. This is **approximate conversion**, reported per item ("converted", "converted with differences", "not supported").
2. **Optional fallback player:** for unsupported types, render the original package with `h5p-standalone` in a sandboxed iframe, clearly marked "H5P compatibility mode — not included in reports/grading".

We do **not** promise native `.h5p` export in early phases: emitting valid packages requires bundling the exact library versions (MIT, so legally fine) and is planned only after native types stabilise.
