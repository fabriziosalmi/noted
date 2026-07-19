# Organizing notes

Noted keeps structure lightweight: links between notes, tags, a project
namespace, one level of folders, and a few generators (daily notes, templates).
Everything is derived from the note files themselves.

## Wikilinks

Type `[[` to open an autocomplete of your existing notes. Pick one to insert a
link rendered as `[[Note name]]`.

- **Click** a wikilink to open it. If the target note does not exist yet, Noted
  **creates it on the spot** and opens it — dead links never lead to a dead end.
- With the cursor on a link, press <kbd>Mod+Enter</kbd> to follow it from the
  keyboard.

## Backlinks

When other notes link to the current one, a **Linked from** panel appears below
the editor listing each source as a chip. Click a chip to jump to that note.
Backlinks are computed automatically from the links in your vault.

## The connections panel

Open the **Connections** tab in the right panel to see how the current note
relates to the rest of your vault, in three sections:

- **Same project** — notes that share a `#project/<name>` tag with this one.
- **Linked from** — backlinks.
- **Links to** — the wikilinks this note points at.

When a note has no connections yet, the panel invites you to add a `[[wikilink]]`
or a `#project/name` tag.

## Tags

Write `#tag` anywhere in a note. Typing `#` opens a tag autocomplete. Tags accept
one optional namespace segment — `#project/website` is a single tag, while a
second slash is not part of it.

The sidebar has a tag filter: click the tag icon to reveal your tags as chips and
filter the note list to a single tag.

## Projects

A project is just the `#project/<name>` tag, with one convenience on top. When
you give several notes the same title, Noted notices and offers to group them:
a banner appears above the editor —

> *N notes are named "…" — group them into a project?*

Accepting adds the `#project/<name>` tag to the current note and to every
matching note at once. From then on they show up together under **Same project**
in the connections panel and under the sidebar's tag filter.

## Folders

The sidebar supports one level of subfolders:

- Drag notes between folders and the root, and reorder notes and folders (which
  switches sorting to **Custom**).
- Double-click a folder header to rename it; each folder has its own "new note
  here" and delete actions.
- **Pin** a note (star) to keep it at the top.
- Cycle the sort order between **Date**, **Name**, **Size**, and **Custom**.

Sidebar rows are two lines: the title with a relative timestamp, and a short
preview of the body.

## Daily notes

Open today's daily note from the sidebar's calendar action, the empty-state
button, Quick Open, or the **File** menu. The file is named `YYYY-MM-DD.md`. If
it already exists it opens; otherwise Noted creates it with a localized long-form
date heading and three sections: **Notes**, **To-do**, and **Ideas**.

## Templates

Noted ships five built-in templates, each localized: **Meeting**, **Project**,
**Research**, **Journal**, and **Brainstorm**. Open the template picker from the
title bar or Quick Open to start a new note from one.

You can also **save the current note as a custom template** and reuse or delete
it later.

## Version history

Every save can snapshot the note. Open **History** from the title bar to browse
previous versions and **Restore** one. Snapshots are stored per note (in a
`.noted_history` folder inside your vault), captured when the content changed
enough or enough time passed, and capped at the 20 most recent per note.

## Note advisor

A small badge in the title bar surfaces suggestions about the current note, such
as:

- a possible **secret** in the text (API tokens, keys, credentials),
- a **generic title** worth renaming,
- a **long note** that might be worth splitting, or one **without headings**,
- a **stale** note untouched for a long time,
- a **duplicate topic** shared with other notes, with an option to merge them.

Each suggestion comes with a one-click action. Merging concatenates the notes and
removes the sources, so treat it as a deliberate action.

## Next steps

- **[Search](/guide/search)** — find anything across the vault.
