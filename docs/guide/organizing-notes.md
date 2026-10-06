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
- A link can carry an alias and a heading: `[[Note|shown text]]`,
  `[[Note#Heading]]`, or both. They all count as links to `Note`.

### Renaming and moving notes

Rename or move a note, or rename or delete a folder, and the links that pointed
at it are **rewritten in the other notes** (`[[Old]]`, `[[Old|alias]]` and
`[[Old#Heading]]` all become `[[New…]]`), so nothing is left dangling. Every note
that changes keeps a snapshot of its previous text in its
[history](/guide/editor), so the change can be undone.

When the name comes from the note's title, Noted does not rewrite links on every
pause while you retype it: it waits until you stop, switch to another note, leave
the window, or quit, and then rewrites them once, from the original name to the
final one.

The **Update links when renaming** setting (Settings → Editor) picks **Always**
(default), **Ask** (a prompt tells you how many links in how many notes would
change) or **Never**. With **Ask**, a held-back title rename asks when it settles,
and not at all on quit.

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

## Opening an Obsidian vault

Point Noted at an Obsidian vault with **Settings → Sync → Choose custom folder** and it is used
where it is: no copy, no conversion, and **nothing in it is rewritten just because you opened it**.
A note is written only when you edit it, and then only that note.

- A folder with a `.obsidian/` folder is read as Markdown. `.obsidian/`, `.trash/` and every other
  dot-folder are ignored.
- **Links follow Obsidian's rules.** Case does not matter; `[[Plan]]` finds `Work/Plan.md` wherever it
  sits; `[[Work/Plan]]` means that note; when two notes share a name the one next to the note holding
  the link wins, then the shortest path. Backlinks, following a link and renaming all use the same rule,
  and renaming a note rewrites only the links that would no longer find it.
- **Images** go to the folder named in Obsidian's *Default location for new attachments* when that is one
  folder at the vault's root. Other choices (next to the note, a subfolder of it) are not supported, and
  Noted's own **Images folder** setting applies.
- **File names stay yours.** *Title follows filename* does not rename notes in an Obsidian vault.
- A note's formatting is kept as you wrote it until you edit that note; saving it then writes it the way
  Noted does (see [Note format](/guide/editor#note-format)). Frontmatter is never reformatted.
- Noted keeps what it needs (a note's earlier versions) in hidden folders inside the vault; Obsidian ignores them.

::: warning Folders deeper than one level
Noted shows notes at the vault's top level and one folder down. Notes in deeper folders are not listed
yet (nested folders are planned). They are not touched either.
:::

