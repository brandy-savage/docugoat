# Contract Reviewer (docugoat monorepo app)

Original author: see git history of the upstream project; imported into the docugoat monorepo with its `docx`, `rules` and `review` modules split into `packages/`.

A browser-only contract review and redlining workbench, built as a static
site for GitHub Pages. Documents never leave the browser.

**Live (docugoat Pages):** https://redcloudinfosec.com/docugoat/review/

This covers **Phase 1** (the DOCX import → edit → export pipeline) and
**Phase 2** (the rules engine, findings and approved-language redlines).

```
npm install
npm run dev        # local app
npm test           # unit, round-trip, edit and randomized tests (Vitest)
npm run test:e2e   # full browser flow in Chromium (Playwright)
npm run build      # static site in dist/
```

## How it works: patch, don't regenerate

The original `.docx` is stored unchanged. Edits are stored separately as
operations against it (`replaceText`, `insertParagraph`, `deleteParagraph`),
each anchored to a paragraph index **and** a hash of that paragraph's source.

Export never rebuilds the document from a model. It:

1. copies every package part it doesn't need to change byte-for-byte;
2. in `word/document.xml`, splices new XML over **only the edited paragraphs**,
   using source offsets from an offset-preserving XML parser;
3. inside an edited paragraph, word-diffs the old and new text and rewrites
   **only the runs the change touches**, as `w:ins`/`w:del` tracked changes
   (or applied directly in "clean" mode).

Edits that can't be made safely are refused with a reason rather than
silently corrupting the file: text inside fields (cross-references, page
numbers), tracked moves, or non-text content. Stale edits (paragraph hash
mismatch) are refused too. Editing text inside another reviewer's tracked
insertion is supported: the whole insertion is replaced, with our deletion
nested inside it.

| Module | Role |
|---|---|
| `src/docx/xml.ts` | Offset-preserving XML parser |
| `src/docx/package.ts` | Zip read/write with size limits |
| `src/docx/paragraphs.ts` | Paragraph/run index, edit-safety rules, accept/reject views |
| `src/docx/diff.ts` | Word-level diff → character hunks |
| `src/docx/edits.ts` | Applies edits as tracked or clean changes |
| `src/docx/document.ts` | `openDocx` / `exportDocx` |
| `src/rules/engine.ts` | Rule evaluation, scopes, exclusions, search, rule tests |
| `src/rules/normalize.ts` | Case/quote/dash/whitespace folding with a source map; sentence splitting |
| `src/rules/extract.ts` | Durations, money and percentages for threshold rules |
| `src/rules/validate.ts` | Rulepack validation with path-based errors |
| `src/rules/playbook.ts` | Template variables and planned changes |
| `src/rules/sample-pack.json` | Sample rules and clause templates |
| `src/review/bridge.ts` | Document ⇄ engine: scan blocks, and edits from playbook changes |
| `src/storage/store.ts` | IndexedDB: originals, versions, draft, review decisions, rulepack |
| `src/ui/` | Review UI (plain TypeScript + DOM) |

## Rules engine

The engine is independent of DOCX and the UI: it takes blocks of text and
JSON rules and returns findings with source offsets. It runs on the
document **as edited**, so findings update after every change, and finding
fingerprints stay stable so review decisions survive rescans.

```jsonc
{
  "id": "RESTRICT-NONCOMPETE-001",
  "type": "presence",              // presence | absence | threshold
  "severity": "high",
  "appliesTo": { "documentTypes": ["msa", "sow"], "reviewPerspective": ["service_provider"] },
  "match": {
    "scope": "sentence",           // sentence | paragraph | section | document
    "all": [
      { "any": [{ "phrase": "shall not" }, { "phrase": "agrees not to" }] },
      { "phrase": "provid* services" },          // word* = prefix
      { "near": [{ "phrase": "competitor*" }, { "phrase": "customer" }], "within": 6 }
    ],
    "exclude": { "scope": "matched_sentence", "phrase": "nothing herein shall restrict" }
  },
  "review": { "title": "Potential non-compete", "message": "…", "templateIds": ["NONCOMPETE-FALLBACK"] },
  "tests": { "shouldMatch": ["…"], "shouldNotMatch": ["…"] }
}
```

Operators: `phrase`, `regex` (over lower-cased normalized text), `any`, `all`,
`not`, `near` (+`within` words), `ordered`, `count` (+`min`/`max`).
Matching ignores case, curly vs straight quotes, dash variants, hyphenation
("non-compete" = "noncompete"), whitespace, and Word formatting runs.
`absence` rules report *not located* or *possibly incomplete* (via `partial`);
`threshold` rules extract `duration_days`, `money`, `percent` or `number`
and compare (`{{value}}` is available in the message).

Every rule carries its own `tests`. The app's **Rules** dialog runs them,
lets you toggle rules, try them on pasted text, edit the pack as validated
JSON, and import/export it. The test suite runs them too.

**Approved language** lives in the same pack as `templates`, separate from
the rules that reference them. A template can replace or delete the flagged
sentence or paragraph, append to it, or insert a new paragraph. Missing
clauses go before the signature block. `{{VARIABLES}}` are filled from the
review profile (party names are guessed from the contract's defined terms)
or asked for once and remembered. Applied language is a normal tracked
change, including when it rewrites the counterparty's own tracked insertion:
our deletion nests inside theirs, as Word does.

The sample pack's clause text is marked `"sample": true` and shown as
*Sample text*. Replace it with your approved language before relying on it.
Because the site is public, keep the company's real pack out of the repo
and import it in the browser instead.

## Comparing drafts

**Compare with…** (above the document) shows the open document side by side
with another draft: another document in the library (for example the
counterparty's revised version), a saved version of this document, or a
`.docx` imported from the dialog. Paragraphs are matched across the two
drafts, and changed passages are shown as a word-level redline. Curly versus
straight quotes, spacing and empty paragraphs don't count as differences;
wording, case, numbers and punctuation do.

For each difference, choose **Keep this** (the open document's text) or
**Use this** (the other draft's), by clicking either side or with the
keyboard (`J`/`K` to move, `1`/`2` to choose). Undecided differences keep the
open document's text. Bulk buttons decide the rest either way.

Choices are not a separate merge step: each "use the other draft" becomes an
ordinary edit against the open document's original, so the merged result
exports as a tracked-change redline (or a clean copy) like any other edit,
and the originals are never modified. A difference that can't be applied
safely (text inside a field, for example) is flagged and keeps the open
document's text. The comparison is saved as it goes and resumes when the
document is reopened. **Finish** keeps the merged changes; **Cancel
comparison** restores the document as it was.

| Module | Role |
|---|---|
| `src/compare/compare.ts` | Paragraph alignment, and picks → edits |
| `src/ui/compare-view.ts` | Side-by-side view and the Compare dialog |

## What the tests guarantee

**Exact recreation** (`tests/roundtrip.test.ts`): for every fixture, exporting
with no edits, or with "edits" that leave the text unchanged, reproduces
every part byte-for-byte, including BOMs, CRLFs, CDATA, entity spellings and
single-quoted attributes. Exports are deterministic and re-export identically.

**Recreation with edits** (`tests/edits.test.ts`, `tests/property.test.ts`):
every export satisfies

- *accept all changes* → exactly the intended text;
- *reject all changes* → exactly the original text;
- only edited paragraphs differ; every other part is byte-identical;
- well-formed XML; new revision ids are unique and don't collide with existing ones.

The randomized suite applies about 1,600 random edits per mode across 300 exports.

**Rules** (`tests/rules.test.ts`): every operator, scope, exclusion,
normalization case, threshold extraction and the validator, plus every
sample rule's embedded tests.

**Review loop** (`tests/review-flow.test.ts`): scan the sample, apply seven
approved-language templates (one over the counterparty's own revision),
confirm those findings clear on rescan, and export with the invariants intact.

**Browser flow** (`e2e/`): drag-drop import, edit, refused edit, save version,
reload, restore, and tracked/clean/original export. Also findings and
highlights, applying templates, dismissing, search, and the rules dialog,
all verified by opening the downloaded files.

**Corpus** (`tests/corpus.test.ts`): every `.docx` in `tests/fixtures/corpus/`
plus the built-in fixtures gets exact recreation, a clean scan, and 120 rounds
of random replacements, deletions and insertions per mode with all
invariants checked. The corpus has two python-docx documents (a different
producer, built on Word's own template). The "kitchen sink" fixture has
emoji, nested tables, text boxes, tracked moves, a field inside a hyperlink,
footnotes, math, bidi text and counterparty paragraph-mark changes. **Drop
real contracts into the corpus folder to test against them.**

**Comparison** (`tests/compare.test.ts`, `e2e/compare.spec.ts`): alignment
ignores quote style, spacing and empty paragraphs; taking every difference
from the other draft reproduces its text; keeping every difference leaves
the edits unchanged; merges work on top of existing proposed changes; edits
that touch fields are refused per difference; and 200 random document pairs
with random picks export with the invariants intact. In the browser: pick
by click and keyboard, resume after reload, download the merged redline,
finish, cancel, and an axe audit in light and dark.

**Hostile input** (`tests/hostile.test.ts`): entity-expansion bombs, 50,000-deep
nesting, truncated and oversized archives, non-Word zips, unsupported
namespace prefixes, invalid UTF-8, catastrophic-backtracking regexes, and a
3,000-paragraph scan-time budget.

**Browsers** (`e2e/`, Chromium, Firefox and WebKit): the flows above plus
multi-file import, deleting the open document, search after edits,
abandoned inserts, persistence across reloads, rulepack import, an XSS
attempt, keyboard-only editing, phone width, and a 1,500-paragraph
performance check. `e2e/a11y.spec.ts` runs axe-core (WCAG 2.1 AA) on every
main screen in light and dark mode.

The sample contract (`tests/fixtures/docx-builder.ts`, also served at
`public/samples/sample-msa.docx`) deliberately includes runs split
mid-word, a REF field, bookmarks, comments, a hyperlink, a table, a content
control, an image, a header PAGE field and existing counterparty revisions.

## Known limits (Phase 1)

- Only the main document body is editable or scanned; headers, footers and
  footnotes are copied through unchanged.
- Agreement sets (reviewing an SOW against its MSA) and cross-document rules
  are not built yet. The engine's block model is ready for them.
- Comparison matches whole paragraphs, then diffs words inside changed ones;
  it doesn't detect moved paragraphs (a move shows as a deletion plus an
  insertion) or formatting-only changes.
- Scans run on the main thread. That's fast for typical contracts; move the
  engine into a Web Worker if very large documents feel slow.
- The page view shows structure and emphasis, not exact Word layout; numbering
  is shown as indentation rather than computed numbers.
- No automated check in Microsoft Word or LibreOffice yet. **Open a few real
  exports in Word** before relying on them.
- PDF import, the rules engine and playbooks are later phases.

## Deploying

`.github/workflows/deploy.yml` tests, builds and deploys to GitHub Pages on
push to `main`. Pull requests run the tests but don't deploy.

- Pages must be set to **Settings → Pages → Source: GitHub Actions**. With
  "Deploy from a branch" Pages serves the raw `index.html`, which points at
  unbuilt TypeScript, and the app is blank.
- The custom domain lives in `public/CNAME`, so it ships with every build.
- Asset paths are relative (`base: './'` in `vite.config.ts`), so the build
  also works from a `user.github.io/repo/` sub-path.

The site
is public, so **don't commit the company's rulepacks or approved clauses**;
those should be imported by users into their own browser.
