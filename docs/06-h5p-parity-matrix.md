# 7. Feature-parity matrix vs. the H5P catalog

⚠️ h5p.org was blocked from the build environment. This list is compiled from the published catalog as known up to 2026 and **must be re-verified** against https://h5p.org/content-types-and-applications.

Legend — **Native**: implement in our schema. **Reuse**: MIT H5P code/format can be adapted or played via `h5p-standalone`. **Import**: approximate conversion from `.h5p` planned. Phase = our roadmap phase.

| H5P content type | Our approach | Import | Phase | Status |
|---|---|---|---|---|
| Multiple Choice | Native `multiple-choice` | Yes | 1 | ✅ Done |
| True/False Question | Native `true-false` | Yes | 1 | ✅ Done |
| Fill in the Blanks | Native `fill-blanks` | Yes | 1 | ✅ Done |
| Single Choice Set | Native (MC set mode) | Yes | 7 | Planned (moved from 2) |
| Drag the Words | Native `drag-words` (+ keyboard/tap mode) | Yes | 2 | ✅ Done |
| Drag and Drop (text & images) | Native `drag-drop` with zones | Partial | 2 | ✅ Done |
| Image Pairing / matching | Native `matching` | Yes | 2 | ✅ Done |
| Image Sequencing / ordering | Native `sequencing` | Yes | 2 | ✅ Done |
| Sort the Paragraphs | Native `sequencing` (paragraph mode) | Yes | 2 | ✅ Done |
| Mark the Words | Native `mark-words` | Yes | 2 | ✅ Done |
| Question Set (Quiz) | Native — every activity is a multi-item set | Yes | 1 | ✅ (activity = set) |
| Summary | Native `summary` (select correct statements) | Yes | 7 | Planned (moved from 2) |
| Essay | Native `extended-response` (rule checks + teacher review) | Partial | 4 | Planned |
| Dictation | Native `dictation` | Yes | 3 | Planned |
| Speak the Words / Set | Native `speaking` (record + optional ASR, opt-in) | Partial | 3 | Planned |
| Audio / Audio Recorder | Native media + recorder | Yes | 3 | Planned |
| Find the Hotspot / Multiple Hotspots | Native `hotspot` (single answer; multiple-hotspot mode in 7) | Yes | 2 | ✅ Done |
| Image Hotspots (info) | Native `interactive-image` | Yes | 7 | Planned |
| Image labeling | Native `drag-drop` (label mode) | Partial | 2 | ✅ Done |
| Dialog Cards | Native `dialog-cards` | Yes | 7 | Planned |
| Flashcards | Native `flashcards` | Yes | 7 | Planned |
| Memory Game | Native `memory` | Yes | 7 | Planned |
| Find the Words (word search) | Native `word-search` | Yes | 7 | Planned |
| Crossword | Native `crossword` | Yes | 7 | Planned |
| Arithmetic Quiz | Native (generator) | No | 8 | Backlog |
| Interactive Video | Native `interactive-video` (file/YouTube) | Partial | 7 | Planned |
| Course Presentation | Native `presentation` | Partial | 7 | Planned |
| Interactive Book | Native `book` (chapters of activities) | Partial | 7 | Planned |
| Branching Scenario | Native `branching` (graph) | Partial | 7 | Planned |
| Timeline | Native `timeline` | Yes | 7 | Planned |
| Accordion / Column / Collage / Chart | Native layout/content blocks | Yes | 7 | Planned |
| Agamotto / Image Juxtaposition / Image Slider | Native image blocks | Yes | 7 | Planned |
| Documentation Tool | Native guided-writing (CER/TCTAC frameworks) | Partial | 4 | Planned |
| Cornell Notes | Native Cornell Observation Notes module | Partial | 4 | Planned |
| Guess the Answer / Information Wall / Personality Quiz / Questionnaire | Native | Partial | 8 | Backlog |
| Virtual Tour (360) / Game Map / AR Scavenger | Fallback player (`h5p-standalone`, sandboxed, ungraded) | Play only | 7–8 | Backlog |
| Iframe Embedder / KewAr Code / Twitter feed (deprecated) | Not planned (security / obsolete) | — | — | Won't do |

Also done in Phase 2: **Dropdown cloze** (native `dropdown-cloze`) and **question banks / random pools**.

## Beyond H5P (spec requirements)
Grammar engine (Phase 3), sentence reconstruction / transformation (3), listening with play limits (3), pronunciation practice with honest feedback tiers (3), Cornell Observation Notes with preserved source text (4), CER/TCTAC/rubrics (4), roster-verified Drive submissions (5), analytics (6).
