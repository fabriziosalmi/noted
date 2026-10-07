# Export &amp; capture

Noted reads and writes plain files, so getting content out is straightforward —
and getting a quick thought in takes one shortcut.

## Sharing and export

Open the **Share** menu from the toolbar. For the current note you can:

- **Export as Markdown** — convert the note to Markdown and save it.
- **Export as PDF** — render a styled PDF.
- **Export as HTML** — save a styled, standalone HTML document.
- **Export as DOCX** — save a Word document.
- **Print** — send the note to the system print dialog.
- **Share / AirDrop** — hand the note to the macOS share sheet.
- **Save as Gist** — create a public or private GitHub gist (requires a
  [GitHub token](/guide/git#enabling-git)) and copy the URL.

For the whole vault:

- **Copy to iCloud Drive** — copy your notes into iCloud.
- **Export vault to folder** — copy the vault to a folder you pick.

All note HTML is sanitized before it is exported, so exports never carry active
content.

## Quick Capture

Quick Capture is a small, always-on-top window for jotting something down without
switching to the app.

- Open it with the global shortcut <kbd>⌘⇧Space</kbd> — it works even when Noted
  is not focused — or from **File → Quick Capture**.
- Type your note, choose where it goes under **Save to**, press <kbd>⌘↩</kbd> (<kbd>Ctrl+Enter</kbd> on
  Windows and Linux) to save, or <kbd>Esc</kbd> to close.

| Save to | What happens |
| --- | --- |
| **A new note** | A note of its own in your vault root, with a timestamped name like `Capture_2026-07-19_14-30-00.md`. |
| **Today's daily note** | A line, led by the time (**14:30**), at the end of the first section (Notes) of today's [daily note](/guide/organizing-notes#daily-notes). If there is no daily note yet, it is made first, with the same sections as when you open it yourself. |
| **Inbox note** | A line, led by the time, at the end of `Inbox.md` in your vault root, made the first time. |

The window opens on the last choice you made. Whatever you pick, the text is saved in your vault's own format
(Markdown or HTML) and is immediately available to search.

If the note you add to is open in the editor, it picks the new line up (the same way it does for a change from
another app), so the next autosave cannot erase it. The version before the capture is kept in the note's history.

## Daily notes

For a running log rather than a quick jot, use a
[daily note](/guide/organizing-notes#daily-notes) — one note per day, prefilled
with Notes, To-do, and Ideas sections.

## Next steps

- **[Settings reference](/reference/settings)** — every option, tab by tab.
