# Search

Noted has two search surfaces: a fast switcher for jumping to a note by name, and
a full-text search across the whole vault.

## Quick Open

Press <kbd>⌘K</kbd> to open the switcher.

- With an empty query, it lists your 20 most recently modified notes.
- As you type, it fuzzy-matches note **names** and their **aliases** (the `aliases:` of a note's
  frontmatter; the alias that matched is shown beside the name) first, then appends **full-text
  content** matches below them, so a note whose body (but not title) mentions
  your query still shows up.
- Type `/` to switch to commands: **New note**, **Daily note**, **Settings**,
  **Templates**, and **Shortcuts**.
- If nothing matches, a **Create "…"** row lets you make a new note with that
  title on the spot.

Use the arrow keys to move, Enter to open, and Esc to close.

## Full-text search

Press <kbd>⌘⇧F</kbd> to search the content of every note. Results show the note
title, a highlighted snippet around the match, and the folder it lives in, and
are fully keyboard-navigable.

If your vault is large enough to exceed the index limits (below), a note tells
you the results were truncated.

## How the index works

Full-text search is backed by an in-memory **BM25 inverted index** built from a
scan of your vault. To stay fast and bounded, the scan visits files
newest-first and applies these limits:

| Limit | Value |
| --- | --- |
| Maximum files indexed | 20,000 |
| Maximum total content | 200 MB |
| Maximum size per file | 20 MB |

The index updates incrementally as you save notes and as new notes arrive from
Quick Capture, so results stay current without a full rescan.

::: info Search vs. AI retrieval
This full-text index powers Quick Open and full-text search. The
[AI assistant](/guide/ai) uses a **separate** retrieval system (RAG) to decide
which notes to send as context — the two are independent.
:::

## How fast it is

Measured on a 10,000-note vault of 25 MB (notes of about 350 words), on a laptop:

| | |
| --- | --- |
| Vault index (links, tags, headings, aliases), cold start | about 0.3 s |
| Full-text index, built on the first search | about 0.6 s |
| A search, 95th percentile | under 10 ms |
| Memory the two indexes take | about 75 MB |

Cost grows in line with the vault: 20,000 notes take about 1.5 s to index and 150 MB. Because that is quick, the
indexes are rebuilt in memory when the app starts rather than saved to disk: a saved copy would be one more thing to
keep in step with the notes. The benchmark (`npm run bench:index`) runs in CI against a budget of 2 s to index and
50 ms to search, and fails a change that makes either more than 20% slower.

## Next steps

- **[AI assistant](/guide/ai)** — completions, commands, chat, and retrieval.
