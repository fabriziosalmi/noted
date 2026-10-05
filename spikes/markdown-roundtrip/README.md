# Markdown round-trip spike (ADR 0001)

Evidence for [ADR 0001](../../docs/contributing/adr/0001-markdown-canonical-format.md): which way of converting
between Markdown text and the editor's document keeps what the user wrote.

Not part of the app: own `package.json`, own dependencies, never bundled or shipped.

```sh
cd spikes/markdown-roundtrip
npm install
npm run spike     # writes REPORT.md and results.json
node bench.mjs    # rough parse+serialize timings
```

| File | What |
| --- | --- |
| `corpus.mjs` | 64 golden snippets (`ext: true` marks the Obsidian-style constructs) |
| `pipelines.mjs` | `remark`, `tiptap-stock`, `tiptap-custom` (the `@tiptap/markdown` extension, stock and with our additions) |
| `pm-markdown.mjs` | `prosemirror-md`: `prosemirror-markdown` + `markdown-it` on the app's TipTap schema |
| `run.mjs` | runs every snippet through every pipeline: exact / stable / same meaning / extensions kept |
| `REPORT.md` | the last run, with a diff for every snippet that is not byte-identical |

CodeMirror 6 (option C) is not run: its document *is* the text, so it round-trips by construction; its cost is the
editor rewrite, not fidelity.
