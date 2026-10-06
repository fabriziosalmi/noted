# ADR 0001: Markdown as the canonical on-disk format

- **Status:** Accepted (2026-10-06).
- **Issue:** [#58](https://github.com/fabriziosalmi/noted/issues/58), the first step of the *Markdown-native (v2.0.0)* milestone.
- **Spike:** [`spikes/markdown-roundtrip`](https://github.com/fabriziosalmi/noted/tree/main/spikes/markdown-roundtrip) (64 golden snippets, four pipelines; run it with `npm run spike` there).

## Context

Notes are `.md` files whose content is **HTML**, written by the editor (`editor.getHTML()`), with
frontmatter hidden in a `<!--noted-frontmatter:…-->` comment so that it survives the HTML editor.
That choice made the editor simple and has costs that grow with every feature:

- **Agents pay for it.** `read_note` returns raw HTML; an agent cannot make a targeted edit in it.
- **Git diffs are noise.** A one-word change reflows tags and attributes.
- **Nothing else can read the vault.** Obsidian, any text editor, `grep` and static-site tools see HTML in a `.md`.
- **Every consumer re-implements parsing of HTML.** Link/tag extraction, full-text, the exporters, the
  importers (`marked` + `turndown`), the sanitizer policy and the MCP server all go through HTML.

The milestone has already decided *that* the canonical format becomes Markdown. This ADR decides
**how text and the editor's document are converted**, because that choice sets how much of a user's
writing survives a save, how quiet the diffs are, and how much code we own.

### What the converter must do

1. **Never change what the user wrote without telling them.** Anything that is not byte-identical must be
   a normalisation we chose on purpose and can list; a silent change of meaning is a bug.
2. **Carry the constructs people use in an Obsidian-style vault**: GFM (tables, task lists, strikethrough),
   fenced code, KaTeX math, wikilinks with alias/heading/block, embeds, `==highlights==`, callouts, `%%comments%%`.
3. **Produce deterministic, diff-friendly output**: no reflow, stable markers, no re-padding of a table when
   one cell changes.
4. **Keep what it does not understand** (raw HTML, footnotes, anything new) as raw blocks, never drop it.
5. **Run without a DOM** (the MCP server and the importers parse Markdown in Node) and be fast enough to run on every autosave.
6. **Keep the editor we have** (TipTap/ProseMirror: node views, bubble menu, ghost text, wikilink decorations).

## Options

**A. `@tiptap/markdown`** (the official extension; `marked` parser, serializer inside TipTap).
**B. A remark / mdast bridge**: parse with remark, write our own mdast ⇄ ProseMirror converter, serialize with remark-stringify.
**C. CodeMirror 6 live preview**: the source *is* the Markdown; drop TipTap.
**D. `prosemirror-markdown` + `markdown-it`** on the existing TipTap schema, with our own rules for the extensions.

## Evidence

The spike feeds 64 golden snippets (47 CommonMark, GFM and document-level cases, 17 Obsidian-style extensions) through each pipeline and compares the result with the original. *Exact* is byte-identical;
*stable* means a second pass changes nothing; *same meaning* means the output parses to the same
Markdown tree as the input; *extensions kept* counts the 17 snippets whose wikilink/embed/highlight/math/callout/comment/tag text
came back verbatim. Block-joining blank lines are not counted as damage.

| Pipeline | exact | stable | same meaning | extensions kept | custom code |
| --- | --- | --- | --- | --- | --- |
| `remark` alone (ceiling of option B, no editor) | 46/64 | 64/64 | 64/64 | **6/17** | none |
| A: `@tiptap/markdown`, stock | 38/64 | 60/64 | 44/64 | 8/17 | none |
| A: `@tiptap/markdown` + our extensions | 49/64 | 61/64 | 55/64 | 17/17 | ~120 lines |
| **D: `prosemirror-markdown` + `markdown-it`** | **59/64** | **64/64** | **63/64** | **17/17** | ~400 lines |
| C: CodeMirror 6 | 64/64 by construction (the text is the document) | | | | rewrite of the editor |

What the numbers hide:

- **A silently damages ordinary Markdown.** With our extensions added, the remaining failures are not cosmetic:
  `\*not italic\*` becomes plain text (the asterisks the user escaped are gone), `&copy;` becomes `&amp;copy;`,
  inline HTML (`<kbd>`) is dropped, a table cell containing `\|` gains a column, a loose list is made tight, a four-backtick fence is flattened to three
  (the snippet inside it ends the block early), and ``` ``a `tick` b`` ``` loses a backtick. Each is fixable, each is
  ours to fix and test, and the extension is young (TipTap 3.7+) so more will surface.
- **B's ceiling is high on CommonMark, low on our vault.** `remark-stringify` escapes `[[wikilinks]]`, `![[embeds]]`
  and `> [!callouts]` (it does not know them), so even before an editor is involved 11 of 17 extension
  snippets are damaged; it needs micromark extensions for each. And the mdast ⇄ ProseMirror converter
  (both directions, every node and mark) is entirely ours: it is D's job plus an extra layer.
- **D gets the hard escaping and structure right because that is what its serializer is for**: escaping text,
  code-span backtick counting, fence length, tight/loose lists, hard breaks, autolinks. We write the *syntax* we
  add (wikilinks, embeds, callouts, comments, highlight, math, tasks, raw HTML) and decide the style of
  tables and lists. Its remaining differences are four normalisations (below) and one real loss.
- **C is perfect on fidelity and wrong on cost.** Tables, images, task lists, math, callouts, code-block node views, the
  bubble menu, wikilink decorations and ghost text are all ProseMirror features we would rebuild as CodeMirror
  widgets. It is a rewrite of the product's centre; fidelity alone does not justify it. It stays interesting as a
  **source-mode toggle** later, on top of whatever we choose now.

### Speed

Parse + serialize of a synthetic note made of the corpus repeated (`spikes/markdown-roundtrip/bench.mjs`):

| Size | `@tiptap/markdown` | `prosemirror-markdown` |
| --- | --- | --- |
| 24 KB | ~90 ms | ~12 ms |
| 240 KB | ~5.7 s | ~0.8 s |

Both degrade faster than linearly on this list- and table-heavy input (a real note of 240 KB is rare, but our
index limit is far higher): D is about 8 times faster at both sizes and fine for ordinary notes, but the large-note
behaviour has to be profiled and bounded (see *Risks*) before the editor depends on it for autosave.

## Decision

**Adopt option D: `prosemirror-markdown` with `markdown-it`, operating on the TipTap schema, with our own
rules for the extensions.** The rest of the editor does not change.

Specifics the implementation (#59) follows:

1. **Frontmatter is outside the editor.** The leading `---` block is split off before parsing and glued back
   after serializing, as the exact bytes the user had. Editing it (properties panel, #66) uses a YAML library that
   preserves comments and unknown keys; the editor never sees it. This also retires the HTML-comment encoding (#61).
2. **Unsupported constructs become raw nodes** (`rawBlock`, `rawInline`), stored and written back verbatim:
   HTML blocks and inline HTML, footnote references and definitions, link reference definitions. A raw node is
   rendered read-only in the editor with a visible "raw" affordance. Nothing is dropped.
3. **Output style is fixed and documented**: `-` bullets, `1.` ordered lists, ATX headings, `*italic*` and `**bold**`,
   fenced code with the shortest fence that cannot be closed by its content, `\` hard breaks, **tables without column
   padding** (editing one cell changes one line), alignment kept (`:---`, `---:`, `:---:`). Tight/loose is stored on the list.
4. **Wikilinks stay what they are today**: literal `[[target#heading|alias]]` text carrying the `wikilink` mark (not
   an atom node), so Markdown, the index and `extract.ts` all see the same characters.
5. **Round-trip is a tested contract.** The corpus moves into the repo as the golden suite, grows to 200+ snippets
   (#59), and a property test asserts that `serialize(parse(serialize(doc)))` equals `serialize(doc)` for generated documents.
   A test also fails when a schema node or mark has no parser or serializer entry, so adding a TipTap extension
   cannot silently lose data.
6. **The parser is shared.** `markdown-it` with the same rules runs in Node, so the MCP server (#63), importers
   and index (`shared/vault/extract.ts`, which today regex-scans HTML) use one implementation.

### Normalisations we accept (listed so they are never a surprise)

| Written | Becomes | Meaning |
| --- | --- | --- |
| `1986\.` | `1986.` | same (the backslash was unnecessary) |
| `&amp;`, `&copy;` | `&`, `©` | same character |
| indented code block | fenced code block | same code |
| ``` ``a `tick` b`` ``` | ``` `` a `tick` b `` ``` | same code (padding spaces ignored by the spec) |

### Known loss (to be closed in #59)

- **Reference-style links** (`[text][ref]`) become inline links `[text](url)`; the `[ref]: url` definition line is kept
  as a raw block, so nothing is lost but the form changes. Closing it needs a `reference` attribute on the link mark.

## Consequences

**Good.** Notes are readable by agents and other tools; diffs show what changed; the vault opens in Obsidian; one parser
for the app, MCP and importers; the converter is small enough to read, and its hard parts are someone else's tested code.

**Costs.** We own ~400 lines of markdown-it rules and serializer entries (the spike's, schema scaffolding included; it also hand-writes tables, task lists and tight/loose lists, which TipTap's extension ships ready-made), and they must keep pace with the schema
(guarded by the test in rule 5). The editor stores HTML-only features nowhere: pasted rich HTML is converted
on paste (through the existing sanitizer) and what Markdown cannot express is raw or dropped, which we must say so in the UI.
`DOMPurify` leaves the storage path (it stays for paste and for exports).

### Risks and how we watch them

| Risk | Mitigation |
| --- | --- |
| Large notes parse slowly (superlinear in the spike) | Profile real 100 to 500 KB notes in #59; if needed, parse per top-level block and cache, and save from the ProseMirror transaction instead of re-serializing everything. Decide before turning the flag on. |
| A markdown-it rule disagrees with Obsidian on an edge case | The golden suite includes Obsidian's own documented examples; disagreements are tests, not guesses. |
| Rich HTML in old notes does not fit the schema | The migration (#60) reports it per note and keeps it as raw blocks; nothing is converted without a dry run. |
| `prosemirror-markdown` or markdown-it stop being maintained | Both are small, widely used, and we vendor nothing exotic; swapping the parser behind the same tests is a bounded task. |

## Migration and rollback

1. **Serializer module and golden suite** (#59), behind no user-visible change.
2. **Dual read.** The app opens HTML and Markdown notes; the vault carries `format` in `.noted/config.json`
   (`html` today, `markdown` after migration), so the format is a property of the vault, not a guess per file. A Markdown
   vault opened from outside (Obsidian, #62) is `markdown` from the start and is never rewritten on open.
3. **Migration** (#60): dry-run report per note (convertible / partly / kept raw), backup first (a git commit if the vault is a
   repository, else a zip in `.noted/backups/`), idempotent and resumable, each rewritten note gets a history snapshot.
4. **MCP and properties** (#63, #61, #66) follow once notes are Markdown; the MCP server keeps accepting HTML for one minor version.

**Rollback.** Until step 3 runs, flipping the flag back costs nothing. After it: the backup restores the vault byte for byte;
and because the editor can still produce HTML from the same document, an export back to HTML is the same code path the
app uses today. Each migrated note also keeps its pre-migration HTML in `.noted_history/`.

## Implementation notes (#59)

The codec lives in `shared/markdown/` (`schema.ts`, `parser.ts`, `serializer.ts`, `codec.ts`) and is not yet connected to
the editor or to storage: that is the migration (#60). What building it taught, so the next change does not rediscover it:

- **Evidence.** 237 golden cases (`golden.ts`) must come back as written or as a listed normalisation, and be stable;
  generated documents must read back as the same document and generated text must reach a fixed point
  (`roundtrip.property.test.ts`, 100,000 documents and 400,000 texts per run with `FC_RUNS=100000`). Every escaping rule
  below exists because that test found the hole.
- **Escaping is done in one place** (`markSyntax`): prosemirror-markdown's own escaper leaves `__a__` as emphasis, ignores a
  lone `+`, `1)`, `===`, `<div` at a line start, and knows nothing of `==`, `%%`, `$`. Our extra escapes are
  decided per block, not per text node, because a pair can straddle a bold boundary.
- **Three upstream behaviours are worked around**, each pinned by a test: whitespace before a line break inside a marked run
  drops the rest of the text (we strip it first); `atBlank()` rescans the whole output for every block (quadratic: 14 s for
  1 MB, so top-level blocks are serialized separately); and adjacent lists merge on re-read (the second uses `*` or `)`).
- **Speed** is linear: a 1 MB note, 37,000 blocks, parses in ~0.3 s and serializes in ~0.2 s (`performance.test.ts` fails
  above 5 s). The earlier worry about large notes is closed.
- **More normalisations than the four listed above**, all invisible to a reader: `_x_`/`__x__` become `*x*`/`**x**`, `*`/`+` bullets
  and `1)` markers become `-` and `1.`, setext headings become ATX, a heading is one line, spaces at line edges and
  a BOM are dropped, line endings become LF, one blank line follows the frontmatter, an empty paragraph has no
  Markdown form, a hard break is written `\`, and the marker of a *second* adjacent list changes so it stays a second list.
- **Known limits.** A task list that mixes plain and `[ ]` items is written with the `[ ]` escaped (the schema has
  no mixed list); a table cell holding several blocks is written with `<br>`; an image that shares a line with text is kept as a raw inline.

## Open questions, resolved

1. **Normalisations and the reference-link loss: accepted.** The four normalisations do not change what a reader
   sees, and byte-for-byte preservation of them would mean raw nodes for ordinary text, which is a worse trade. The
   reference-link form is closed later (a `reference` attribute on the link mark) if real vaults show it matters.
2. **Wikilinks are marked text** (`[[target#heading|alias]]` literal, carrying the existing `wikilink` mark), not atom
   nodes: the editor already works this way, and Markdown, the index and `extract.ts` all then read the same characters.
   Alias editing is done by a command that rewrites the text, as insertion does today.
3. **Existing vaults migrate on an explicit prompt**, never silently: the dry-run report is shown first, the answer is
   remembered per vault, and "not now" keeps the vault on HTML with dual read. A vault opened from outside is never rewritten on open.
4. **A CodeMirror source mode is not part of this decision.** It can be added on top of the same document later;
   it is tracked separately if wanted.
