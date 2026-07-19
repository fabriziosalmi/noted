# Search

Noted has two search surfaces: a fast switcher for jumping to a note by name, and
a full-text search across the whole vault.

## Quick Open

Press <kbd>⌘P</kbd> to open the switcher.

- With an empty query, it lists your 20 most recently modified notes.
- As you type, it fuzzy-matches note **names** first, then appends **full-text
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
| Maximum files indexed | 1,500 |
| Maximum total content | 50 MB |
| Maximum size per file | 2 MB |

The index updates incrementally as you save notes and as new notes arrive from
Quick Capture, so results stay current without a full rescan.

::: info Search vs. AI retrieval
This full-text index powers Quick Open and full-text search. The
[AI assistant](/guide/ai) uses a **separate** retrieval system (RAG) to decide
which notes to send as context — the two are independent.
:::

## Next steps

- **[AI assistant](/guide/ai)** — completions, commands, chat, and retrieval.
