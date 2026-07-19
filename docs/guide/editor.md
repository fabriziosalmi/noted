# The editor

Noted's editor is built on [TipTap](https://tiptap.dev/). You write in a rich
surface, but everything is saved as sanitized HTML inside a `.md` file, so your
notes stay portable.

## Title-first writing

The first line of every note is its title. When a note is empty, the first block
shows the placeholder **"Title"**; the next block shows **"Start writing…"**.
Press Enter after the title to drop into the body — the same muscle memory as
Apple Notes.

The title is not metadata you fill in separately. It is simply the first line,
styled as a heading.

## Autosave and save status

Noted saves as you type. Edits are written after a short debounce (about 600 ms),
and a status pill shows the current state:

- **Saving** — a write is in flight
- **Saved** — everything is on disk
- **Save failed** — the last write did not succeed

Press <kbd>⌘S</kbd> to force an immediate save. Writes are atomic and flushed to
disk (`fsync`), and a quit is held until the last autosave has flushed, so
<kbd>⌘Q</kbd> never drops an in-progress edit.

## The title becomes the filename

By default, the note's filename follows its title. A moment after you stop typing
in the title (about 900 ms), Noted renames the underlying `.md` file to match —
collision-safely, and without reloading the editor or moving your cursor. This
keeps the vault readable from any other Markdown tool.

You can turn this off with **Settings → Editor → "Title follows filename"**. A
manual rename in the sidebar also pauses auto-sync for that note.

## Formatting

Three ways to format text:

- **Toolbar** — headings (H1/H2/H3), bold, italic, strikethrough, inline code,
  bullet and ordered lists, blockquote, insert table, find-in-note, search all
  notes, and an AI toggle. Hide it with **Settings → Editor → Show toolbar**.
- **Bubble menu** — select text and a small menu appears with bold, italic,
  strikethrough, and inline code.
- **Keyboard** — the shortcuts below.

| Shortcut | Action |
| --- | --- |
| <kbd>⌘B</kbd> | Bold |
| <kbd>⌘I</kbd> | Italic |
| <kbd>⌘E</kbd> | Inline code |
| <kbd>⌘⌥1</kbd> / <kbd>⌘⌥2</kbd> / <kbd>⌘⌥3</kbd> | Heading 1 / 2 / 3 |
| <kbd>⌘Z</kbd> / <kbd>⌘⇧Z</kbd> | Undo / Redo |

## Blocks and rich content

- **Headings, lists, blockquotes, horizontal rules** — the standard structure.
- **Tables** — insert a 3×3 table from the toolbar; columns are resizable.
- **Code blocks** — with syntax highlighting for the common languages (powered
  by lowlight).
- **Math** — LaTeX math is rendered with KaTeX.
- **Images** — paste or drag an image into the editor and it is embedded inline
  as a base64 data URL, so the note stays self-contained.
- **Typography** — smart quotes, dashes, and similar substitutions are applied
  as you type.

## Find in a note

Press <kbd>⌘F</kbd> to open the find bar. It shows the current match position
(`3/12`), and you can step through matches with Enter and Shift-Enter.

## Focus and typewriter modes

- **Focus mode** (<kbd>⌘\\</kbd>) hides the surrounding chrome so only your note
  remains.
- **Typewriter mode** (enable in **Settings → Editor**) keeps the current line
  vertically centered as you write.

A live **word count** is shown in the corner of the editor.

## AI while you write

The editor also hosts Noted's inline AI: ghost-text completions, the `/` slash
menu, and the AI actions bar. Those are covered in
[AI assistant](/guide/ai).

## Next steps

- **[Organizing notes](/guide/organizing-notes)** — links, tags, projects,
  folders, and daily notes.
