# Changelog

All notable changes to Noted are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Noted aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Citations in the chat, and a vault-only mode** (#74): the open note and the sections found for a question are numbered in what the model is shown, and it is asked to cite them as `[n]`. The markers become links and the cited sources are listed under the answer (`Note › Heading`); following one opens the note at that section and marks the passage for a few seconds (a marker, not a selection: typing cannot replace it). Numbers the model invents are removed. **Vault only** (book button in the chat header, and Settings → AI) tells the model to answer from the sources alone, offers only sections that share the question's words or are close in meaning, does not ask the model at all when nothing in the notes bears on the question, and marks an answer that cites nothing. Earlier answers are sent back without their markers.
- **Retrieval by section, with embeddings that are kept** (#75): the chat now gets the sections (text under a heading, with its place: `Note › Heading`)
  that best answer a question, from the whole vault, instead of the first 1,500 characters of whole notes. Words (BM25) and meaning (embeddings) are
  merged by reciprocal rank fusion; without vectors it is the words alone. Vectors live in `.noted/embeddings/` (one append-only file per model, not
  synced by Git), keyed by the hash of each section's text: editing a paragraph re-embeds that paragraph, moving a note re-embeds nothing, and nothing
  is embedded again after a restart. Sections go to the provider in batches (before: one request per note, every session), in the background, with a
  status line and **Rebuild index** in Settings. A model swapped under the same name (vectors of another size) is detected and starts over. **Candidate notes per question** now sets how many notes the word ranking looks into; the renderer's own per-note TF-IDF re-ranking is gone.
- **Answers stream in, with a Stop that stops the provider** (#73): the chat shows the answer as the model writes it, for OpenAI, Anthropic,
  Gemini, OpenRouter, LM Studio, Ollama and OpenAI-compatible servers (Server-Sent Events, or JSON lines for Ollama). **Stop** closes the request at
  the provider, not only the waiting, and keeps what had been written; an answer that fails half way keeps its part. The request is made by the
  main process as before, with a 60 s limit on silence instead of on the whole answer.

### Fixed

- **Masked values are restored in the answer.** Until now the model's reply could contain `[EMAIL_1]` and it stayed that way, in the chat and in
  the text written into your note by the AI actions and slash commands (a rewrite of a selection with an address in it left the placeholder in the
  note). One masker now serves a whole conversation (a placeholder means one value, and counts across messages: before, `[EMAIL_1]` in two messages
  could be two addresses) and the answer is restored locally, also when a placeholder is cut in two by the stream.

## [1.6.0] - 2026-10-07

### Added

- **A board for agent workflows** (#88): **Workflows** in the sidebar shows a workflow's tasks by state, which task waits for which (and for what that is missing, or looped), and the gates that wait for you, with Approve and Reject (the reason is recorded). It uses the same engine and notes as the Agent panel and the MCP tools, and refuses a decision made on a board that is out of date. See [Agent workflows](https://fabriziosalmi.github.io/noted/reference/agent-workflows#the-workflows-board).
- **A command line** (#87): `noted list | read | search | create | append | daily | tasks | tags | backlinks | properties`, with `--json` and clear exit codes. It runs the MCP tools' own handlers, so the access policy, the agent journal and staged changes apply to it as to an agent. Built by `npm run build:mcp` as `dist-mcp/noted-cli.cjs` (also the package `bin`); Settings → MCP shows a shell alias. It needs Node.js 20+: a single self-contained binary is not shipped (the app's `runAsNode` fuse stays off, and a Node single-executable build that was tried failed when creating a note). See [Command line](https://fabriziosalmi.github.io/noted/reference/cli).
- **MCP over Streamable HTTP** (#83): the remote transport is now Streamable HTTP at `/mcp` (the 2025-03-26 specification), with one session per
  connection, the same bearer token (now also as `Authorization: Bearer`), loopback binding and Host/Origin checks. The older `/sse`
  endpoint is off by default and kept for one release behind **Settings → MCP → Also serve the older SSE endpoint** (or `--legacy-sse`;
  `--transport sse` still works, with a deprecation warning). Fixes found on the way: concurrent SSE clients no longer take the server from
  each other, and `[::1]` is recognised as a local host.
- **MCP graph tools and resources** (#82): `get_backlinks`, `get_outgoing_links`, `list_tags`, `list_by_tag`, `get_properties` and `query_notes`
  (frontmatter queries with the same filters and sort as a table view), and every readable note as a resource at `noted://note/<path>`
  (list, template, read). They follow the app's link rules (aliases, bare names) and the agent access policy: a hidden note is neither
  linked from nor linked to, as far as an agent can tell.
- **Agent journal and Agent activity** (#84): every change an assistant makes through MCP (create, update, edit, delete, restore, the workflow
  tools, and the approval of a staged change) is recorded in `.noted/journal/` with who, when, which tool and note, and the hash and text of
  the note before and after; a write that cannot be recorded is not made. A new **Agent activity** page lists the changes by session,
  filterable by assistant, kind and note, with each difference, and can **undo** one change or a whole session (refused, with the note left
  alone, if the note has changed since the assistant left it; the version replaced is kept in history, and the undo is recorded too). Entries
  are hash-chained, so an edited, removed or forged entry is shown.
- **Staged writes: approve what an agent changes** (#85): a folder can be set to *staged* (Settings → MCP → Agent access). There an
  assistant can read, but `create_note`, `update_note`, `edit_note` and `delete_note` are held instead of made, and the agent is told
  they are staged, not applied. A badge in the title bar counts what waits; the review shows each change as a difference with Approve /
  Reject (and all at once). Approving makes the change (version before kept in history, deletion to the trash); a note changed since
  the agent saw it refuses the approval, so nothing is overwritten.
- **Per-folder MCP access** (#86): Settings → MCP → Agent access (and `.noted/mcp-policy.yaml`) gives assistants *hidden*, *read-only* or
  *read-write* access to the vault and to each folder, the most specific winning. Every MCP tool enforces it: hidden notes are not
  listed, searched (nor excerpted), counted among tasks or trash, and read or change as "not found", like a note that is not there;
  read-only notes cannot be written, deleted or restored over. It follows symbolic links to the real location, ignores case and
  Unicode form, applies to the next request, and an unreadable policy closes everything with a clear message instead of guessing.
- **Tasks across the vault** (#71): a **Tasks** page (top of the sidebar's Views section) lists every `- [ ]` / `- [x]` item of your
  Markdown notes, soonest due first (`📅 2026-10-10`, `due:: 2026-10-10`). Filter by status, due date (overdue, today, next 7 days,
  none), folder, tag and text; the list follows the notes live. Tick a task and it is ticked in its note (one character, the rest of
  the file untouched, version kept in history; refused if the line is no longer that task). The MCP server gets `list_tasks` with the
  same filters, returning each task's note and line.
- **MCP `edit_note` and optimistic concurrency** (#81): agents can change part of a note without overwriting it. `read_note` now returns an
  `etag` (a fingerprint of the stored text); `edit_note` needs it back (or the modified time) and, when the note has changed since,
  writes nothing and returns the current note with its new etag so the edit can be redone on it. Operations: replace exact text (unique
  match, or `replace_all`), replace the text under a heading (sub-sections kept unless asked), append to a section. The rest of the note
  stays byte for byte, and an edit that would break the frontmatter is refused. `update_note` accepts `expected_etag` as well; `create_note`
  and `update_note` return the new etag.
- **Views, documented** (#27): the Views page now says how views compare with Notion databases and what they deliberately do not do
  (relations, rollups, formulas, real-time collaboration, declared schemas, other layouts).
- **Properties panel** (#66): a **Properties** tab in the right panel for the open note: each frontmatter property in the editor for
  its type (text, number, date, checkbox, list, link), add (name suggested from the vault, with a type), edit and remove, written with
  the same byte-preserving writer as the views. A new **link** type for `"[[Note]]"` values: shown as the note's name, opens it, counts
  as a backlink, and follows when the note is renamed (Markdown vaults); views show links the same way. What is typed in the editor
  is saved before a property is written.
- **New notes from a view** (#25, Views): **New note** on a view, and **Add card** on a board column, make a note and open it for
  writing. It starts inside the view: in the view's folder, with its tag, with the property of every "is" filter and, on a board, the
  column's value, so it shows in the view straight away.
- **Board view** (#24 and the layout switch of #26, Views): the Table / Board buttons on a view. A board is a column for each value
  of a property (most used first, "No value" last; the columns you keep come first in your order, can be added, moved and removed when
  empty) and a card per note; a card opens its note. Dragging a card to another column, or picking the column from the card's menu
  (keyboard-friendly), rewrites that property in the note, and only that. Moving a card keeps the columns that were showing. Lists
  (tags) put a note in several columns, so their cards are not movable.
- **Edit a property in a view's table** (#23, Views): double-click a cell (or press Enter on it) and the property changes in the
  note's file; a checkbox toggles with a click; empty removes the property; numbers and lists are read as such. Only that one
  property is rewritten, in the note's own text: comments, quoting, order, spacing and every other byte stay exactly as they were
  (a property test over thousands of random edits pins it), and the version before is kept in the note's history. If the file has
  another value than the one shown, nothing is written and the cell shows the current value. Broken YAML or a property it cannot
  edit faithfully (an anchor, a nested mapping) is refused, never rewritten. Works in Markdown and HTML vaults.
- **Filter and sort for views** (#22, Views): a Filter & sort panel on every view. Filters offer the tests that fit the property's type
  (text, number, date, choice, checkbox, list) with the property's own values to pick from; a filter with no value yet hides nothing;
  several sort keys, each ascending or descending. The count on the view follows as you edit, and everything is saved in the view.
- **A Views section in the sidebar** (#26, Views): make a view, open it in place of the note (the note stays loaded behind it),
  rename, duplicate or delete it (deleting never touches a note), choose its source (all notes, a folder, a tag) and its columns, sort
  by clicking a header. Views are saved in `.noted-views.json`. The board layout and the filter builder follow. New docs page: Views.
- **The table view and the query behind it** (#21, Views): a view's rows are the notes of its source (all notes, a folder at any depth,
  or a tag), kept if they pass every filter (equals, contains, empty, greater/less, before/after a date, checked, list contains; a note
  with no value fails a positive test and passes a negative one; an unfinished filter lets everything through), ordered by any number
  of keys (numbers by size, text without caring about case, `item 9` before `item 10`, notes with no value always last). Shown as a
  table: the note's name first (it opens the note), then the chosen fields, typed cells (numbers aligned right, checkboxes, list items
  as chips), a click on a header sorts. Not reachable from the sidebar yet; the Views section comes next.
- **Field types for views** (#20, Views): from the frontmatter alone the app works out which fields exist and what each is: text,
  number, date (`2026-10-06`, with a real month and day), true/false, a list, or a choice (a few different words, or many that repeat),
  with the values in use and how many notes use each, most used first. Notes that disagree about a field (numbers and words, a date
  and "next week") make it text and are marked mixed, never an error. These drive the column pickers, cell editors, filters and
  board columns that come next.
- **Saved views: the model and where they live** (#19, Views): a view is a saved query over the notes' frontmatter (where its
  rows come from: all notes, a folder or a tag; filters; sort; a board's grouping field; table columns; table or board). Views are
  kept in `.noted-views.json` at the top of the vault, so they travel with the notes and sync through Git (the file is plain,
  stably ordered JSON, a small diff per change); a file edited by hand or damaged is read defensively and never stops the app.
  Create, rename, change, duplicate and delete are in place, saved in order; the screens come next.
- **Frontmatter field index** (#18, foundation of Views): the vault index now keeps each note's frontmatter as typed fields
  (text, number, true/false, empty, lists; a date stays the text it was written as) and the app holds them for the whole vault,
  kept current as notes are saved, renamed, deleted or changed on disk. Nothing to see yet: the table and board views build on it.
  Plain `key: value` blocks are read directly (indexing 10,000 notes with properties costs no measurable time), anything else by the
  YAML library, and a property test pins that both give the same answer.

## [1.5.0] - 2026-10-06

### Added

- **Renaming a heading updates the links to it** (#67, part 3): when a heading is renamed and the caret moves on, the
  `[[Note#Old heading]]` links in other notes (by name or alias, alias text kept) follow to the new text, under the same Always /
  Ask / Never setting as a note rename, each changed note with a history snapshot. Together with parts 1 and 2 this closes #67.
- **Embeds** (#67, part 2): `![[Note]]`, `![[Note#Heading]]`, `![[Note#^block-id]]` and `![[image.png|300]]` show what they point at,
  in place under the line, read-only (never saved into the note); a click opens the source at that place. A missing target says
  so. The embedded HTML is sanitized, and an embed inside an embedded note is not expanded, so a note that embeds itself cannot loop.
- **Heading and block links** (#67, part 1): after `[[Note#` the autocomplete lists the note's headings, and following
  `[[Note#Heading]]` or `[[Note#^block-id]]` opens the note with the caret on that heading or block, scrolled into view (also
  within the same note). Headings match whatever the case or spacing, `[[Note#Part#Detail]]` finds the heading under its parent.
- **Search that scales** (#72): measured on a 10,000-note vault (25 MB) the vault index builds in about 0.3 s, the full-text index in
  about 0.6 s, a search answers in under 10 ms, and the index takes about 75 MB; at 20,000 notes it is still under 1.5 s. The MCP
  server's search index had a far lower ceiling (1,500 notes, 50 MB), which left the oldest notes of a big vault unsearchable by an
  agent; it now has the app's own bounds (20,000 notes, 200 MB, 20 MB a note) and, after the first build, reads again only the notes
  whose modification time moved. `npm run bench:index` runs the benchmark; a CI check runs it on every change to the indexes, fails over
  the budgets (2 s cold start, 50 ms search p95) and fails when a measure is more than 20% slower than the code the change started from.
- **Unlinked mentions** (#69): the Connections panel lists notes that write this note's title or an alias as plain text without
  linking to it, with the line they appear in, and **Link** turns the mention into a `[[link]]` in one click (the note's earlier text goes
  to its history). Code, links, URLs, tags, math and front matter are never mentions. Found through the search index, so no note is read
  unless it is a candidate.
- **Outline panel** (#70): the right panel's new **Outline** tab lists the open note's headings, indented by level; click one to jump
  to it. The heading you are in is highlighted, following the cursor and the scroll.
- **Aliases** (#68): a note's frontmatter `aliases:` (Obsidian's) are other names it answers to. `[[Start]]` opens the note that has
  that alias and counts as one of its backlinks, and Quick Open matches aliases and shows the one that matched. A note's own name
  always wins over an alias.
- **Nested folders** (#65): folders to any depth (16 levels), shown as a tree in the sidebar: indented under their parent, collapsing hides
  everything under a folder, a search keeps the folders above a match. **New folder inside** a folder, and **drag a folder onto another**
  (or onto the empty list) to move it with everything in it; the links to the notes in it follow. Notes in deep folders of an Obsidian
  vault now show up. Deleting a folder keeps what is in it, moving it up one level.
- **Compare a changed note with its last version, and stage notes one by one** (Git panel → Changed notes). The comparison reads as text:
  changed lines with context, and the words that changed highlighted inside a rewritten line; notes stored as HTML are shown as Markdown so only
  the text differs. **Stage** / **Unstage** per note, and **Commit staged** commits exactly those.
- **Open an Obsidian vault where it is.** Point Noted at the folder (Settings → Sync → Choose custom folder): it is read as Markdown,
  `.obsidian/` and `.trash/` are ignored, nothing is rewritten, renamed or added by opening notes, and only a note you edit is written.
  Links resolve the way Obsidian resolves them (`[[Plan]]` finds `Work/Plan.md`, case does not matter), for backlinks, following a link and
  renames alike, and pasted images go to Obsidian's attachment folder when it names one. Notes in folders more than one level deep are not
  shown yet.
- **Convert your vault to Markdown** (Settings → Editor → Note format). Notes made by earlier versions are HTML inside `.md`
  files; this turns each into ordinary Markdown that Obsidian, VS Code and Git diffs read well. It shows a report first and
  changes nothing until you confirm, makes a zip copy of every note and keeps each note's old text in its history, rewrites the
  notes one by one (any failure puts everything back), and can be undone with **Convert back to HTML**. Nothing converts by itself.
- **The MCP server and the importers follow the vault's format.** In a Markdown vault an assistant's notes are stored as
  Markdown (HTML it sends is converted), appending leaves the existing text untouched, agent workflows keep their metadata in
  a `json` code block, and writes wait while the app is converting.

- **`read_note` returns structured content** (MCP): the parsed YAML frontmatter, the raw frontmatter block, and the body, with a
  `schemaVersion` (2). In a Markdown vault the note is returned once, as Markdown, instead of as plain text plus HTML, which is
  far fewer tokens for an agent. HTML vaults keep the previous text layout; the new fields are additive.

### Fixed

- **The update dialogs, the menu bar and the file dialogs now speak the app's language** (English, Italian, German, Spanish, French,
  Portuguese). They were English whatever the setting. The menu changes as soon as you change the language, and the next start shows
  it in that language straight away.
- **"Reveal in Finder" and the Claude Desktop hint are right on Windows and Linux**: "Show in Explorer" / "Show in file manager", and the
  configuration path of that OS.
- **Initializing a Git repository failed on a computer with no Git identity** (a fresh machine, or a new user). The fallback identity was never
  set because its check could not tell "not set" from "set". It is now set when missing, and an identity you already have is left alone.
- **Opening a note no longer saves it.** The editor used to write back the text it had just loaded, which changed the file's modification
  time and added a history snapshot for a note you had only looked at.
- **A link by bare name finds the note in a folder** (`[[Plan]]` for `Work/Plan.md`) instead of offering to create a new, empty `Plan`.

### Changed

- **Folders at any depth, and folder operations that keep what is in them** (#65, second part). The sidebar lists every folder by its path,
  empty ones too. Renaming a folder moves the notes under it at any depth and the links to them follow, and a folder can be moved under
  another. **Deleting a folder now moves everything in it up one level** (into the folder above, the top level for a top-level folder)
  instead of flattening it to the top; files that are not notes are moved too instead of being destroyed; a folder holding a hidden item
  that is not system litter is refused; and if a move fails half way, what already moved is put back. Imported folders keep their structure.
- **Internal: notes can sit in folders at any depth** (#65, first part: the foundations). One path rule now covers the app, the MCP server and Git
  (`.md`, up to 16 levels, nothing hidden, no traversal), one vault walk lists notes for the index, the search and the MCP server, and the
  MCP `list_notes`, `create_note`, trash and restore work at any depth. The sidebar still shows one level until the next parts land.
  Closes a hole that lifting the old depth limit would have opened: a symbolic link in a folder above a new deep note could have carried an
  MCP write out of the vault.
- **Internal: converting a vault between HTML and Markdown** (#60, second part): a dry-run report per note, a verified zip
  backup plus each note's old text in its history, notes written and read back one by one (any failure restores everything),
  the format marker changed last, resumable, and reversible. Typed `[[links]]` are now kept as links through the Markdown
  codec. Handlers and tests only: there is no button yet, so no vault is converted until the last part lands.
- **Internal: the app can read and write a vault stored as Markdown** (#60, first part). A vault carries its note format
  in `.noted-vault.json`; for one marked `markdown` the app opens notes as rich text, saves them back as Markdown
  (frontmatter untouched), indexes, searches and previews them, and writes quick captures in that format. No vault is
  marked yet, so nothing changes for anyone until the migration lands. The editor is now built from the same document model as
  the codec, so callouts, raw Markdown blocks, loose lists, table alignment and a code fence's full info string are part of it.
- **Internal: the Markdown codec** (`shared/markdown/`, #59), the converter between Markdown text and the editor's
  document chosen in ADR 0001. Not connected to the app yet, so notes are still stored as before. It covers
  CommonMark, GFM tables and task lists, fenced code, wikilinks and embeds, highlights, math, callouts, comments and
  raw HTML/footnotes, keeps frontmatter byte for byte, and is checked by 237 golden cases and by generated
  documents (100,000 per run) that must read back identical. A 1 MB note converts in about half a second.

## [1.4.0] - 2026-10-05

### Added

- **Automatic git sync** (off by default): Git panel → Sync. Every few minutes
  or after you stop typing, plus after launch and on window focus, Noted commits,
  pulls and pushes the notes repository. It never force-pushes, never puts
  conflict markers in your notes, and pauses when the same note changed on both
  sides; a three-way merge view (Git → Resolve conflicts…) lets you choose per
  part, or edit by hand. The title-bar Git badge shows the sync state.
- **Renaming a note keeps the links to it working.** Renaming or moving a note,
  and renaming or deleting a folder, now rewrites `[[Old]]`, `[[Old|alias]]` and
  `[[Old#Heading]]` in every other note on disk (atomic writes, and a history
  snapshot of each changed note so it can be undone). Retitling a note rewrites the
  links once, when you move on, not at every pause. New setting: Update links when
  renaming (Always / Ask / Never).
- **Pasted and dropped images are stored as files, not as base64 in the note.**
  They are saved to `attachments/` (configurable) under a content-hash name, and
  the note keeps a relative path, so notes stay small, under the full-text size
  limit, readable in Git diffs and light for MCP clients. The app serves them
  through `app://` under the same vault confinement as everything else. Settings →
  Editor → "Move embedded images out of notes…" migrates existing notes (report
  first, history snapshot per note). Deleting a note offers to remove the images
  only it used. PDF/HTML/Word/Markdown exports, printing and gists embed the images
  again so they stand alone, and "Export vault" now copies attachments too.
- **SBOM and provenance for every release**: publishing a release now attaches a
  CycloneDX SBOM, a cosign-signed `SHA256SUMS`, and GitHub artifact attestations
  for all installers. See "Verify your download" in the installation guide.
- **Electron E2E tests in CI on macOS, Windows and Linux** (Playwright
  `_electron`): open vault, edit, rename, search, quit-flush and the update
  check, with failure screenshots and traces as artifacts. `npm run test:e2e`.

### Changed

- **MCP `delete_note` is no longer permanent**: it moves the note to
  `.noted/trash/`, with new `list_trash` and `restore_note` tools and a retention
  setting (Settings → MCP, default 30 days). `.noted/` is ignored by the watcher
  and by Git sync.
- **The AI chat only saw the 100 most recent notes.** Retrieval now asks the
  main-process search index (BM25 over the whole vault, kept current by the app's
  own writes and the file watcher) for candidate notes when a question is sent,
  and re-ranks only those — lexically or, if enabled, with embeddings. Opening the
  chat panel no longer re-reads notes. The index itself now covers vaults of up to
  20,000 notes (it was 1,500, read all at once), counts text rather than embedded
  image bytes, and reads with bounded concurrency. The "Max notes" setting became
  "Candidate notes per question".
- **Tags, "Same project" and backlinks after a restart or an external edit**:
  links and tags now come from one index of the whole vault in the main process,
  built at startup and kept current by the app's own changes and the file watcher.
  Before, tags were only known for notes saved this session, links only for notes
  opened at least once (so backlinks were incomplete for imported vaults), and the
  link cache was dropped when localStorage filled up. `[[Note|alias]]` and
  `[[Note#Heading]]` now count as links to `Note`, and a link's `#Heading` is no
  longer read as a tag.
- **Internal: the main process is split into modules.** `electron/main.ts` went
  from 1,900 lines to a 130-line bootstrap; IPC handlers now live in
  `electron/ipc/` by area and shared state in `electron/core/`. No behaviour
  change: a new test pins every IPC channel, and the whole `electron/` folder is
  now type-checked in strict mode. The two PDF/print export windows now set
  `sandbox: true` explicitly (it was already the default).
- **Internal: translations are JSON files, loaded on demand.** Each language is
  `src/locales/<lang>.json`; English ships with the app and the other five are
  separate chunks fetched the first time they are needed (the saved language is
  loaded before the first paint). The main renderer bundle shrinks by about 160 KB
  (46 KB gzipped). The locale-parity test now also checks for empty values and
  that every translation keeps the `{placeholders}` of the English text.

### Fixed

- A note changed on disk while it was open (by a sync, an MCP client or another
  device) was only flagged, and the next autosave overwrote it with the stale
  editor text. It now reloads, or — if you were typing — keeps your text and
  saves the other version beside it.
- **The version in the sidebar showed Electron's, not Noted's, when run from source**
  (e.g. `v42.10.0`). It now reads the project's `package.json`
  when the app is not packaged; installed builds were never affected.
- **Linux: the app could freeze while git sync merged.** Node's recursive file
  watcher on Linux watched `.git` too and locked up the whole app when git
  created and removed its temporary worktree there. The vault is now watched
  folder by folder, skipping hidden folders (`.git`, `.noted`, `.noted_history`).
- CHANGELOG link references now exist for every version (they were missing for
  1.3.5 and 1.3.6, and `[Unreleased]` compared from v1.3.4), the missing
  1.3.1–1.3.3 sections were written from the commit history, and the package
  description no longer says macOS-only. `scripts/check-changelog.mjs` runs in CI
  and at the start of `release.sh` so they cannot drift again.

### Security

- The `app://` protocol handler decoded the request path after joining it to the
  bundle directory, so a percent-encoded slash (`..%2F..%2F`) could escape the
  bundle. Paths are now resolved first and must stay inside it.
- **Electron hardening**: `sandbox: true` is now set explicitly on every window,
  and the packaged app ships with the RunAsNode and NODE_OPTIONS fuses off and
  ASAR integrity validation plus load-only-from-ASAR on. The MCP remote-access
  server now runs as an Electron `utilityProcess` instead of a child spawned with
  `ELECTRON_RUN_AS_NODE`, which the RunAsNode fuse disables.

## [1.3.6] - 2026-09-29

### Fixed

- **"A JavaScript error occurred in the main process" (write EPIPE) during the
  update check**: electron-updater logged through bare `console`, and a
  `console.info` to a dead stdout throws EPIPE synchronously, killing the main
  process. Its chatter is now routed through the app logger behind a guard, a
  stdio EPIPE guard is installed first thing in the main process, and an app
  running straight from the mounted DMG (`/Volumes`, read-only) no longer
  attempts to self-update — a manual check explains to move Noted to
  Applications instead.

## [1.3.5] - 2026-09-29

### Fixed

- **Print with `⌘P` / `Ctrl+P` on all platforms**: the shortcut opened Quick
  Open instead of printing, so the system print dialog was unreachable by
  keyboard (notably on macOS, where `⌘P` is the universal Print shortcut).
  `⌘P` / `Ctrl+P` now prints the current note via the **File → Print…** menu
  entry (system dialog in Electron, `window.print()` fallback on web), and
  Quick Open moves to `⌘K` / `Ctrl+K`.

## [1.3.4] - 2026-09-16

### Fixed

- **List numbers and bullet markers visibility**: Restored missing list styles for ordered (`<ol>`) and unordered (`<ul>`) lists in the editor (`.ProseMirror`) and preview containers, resolving an issue where list markers were hidden due to CSS reset.
- **Enhanced list paste handling**: Automatically detect and parse plain-text markdown lists into native list blocks upon pasting.
- **Remote model endpoints** are no longer silently downgraded to plain `http`.
- **History modal** no longer fails when there is no active note.
- **Task list preservation**: Convert GFM task lists into interactive Tiptap checkboxes on note open, paste, and serialization back to Markdown via Turndown.

## [1.3.3] - 2026-08-03

### Fixed

- **Windows and Linux polish**: window controls and the default frame off macOS,
  case- and Windows-safe file names, macOS-only share actions hidden elsewhere,
  and a warning when the Git token cannot be stored encrypted.
- **Accessibility**: Ctrl/Shift shown instead of ⌘/⇧ in shortcut hints off
  macOS; labelled AI-setup fields in Settings, toolbar and inputs.
- **Embedding cache** is capped, and the history modal is sized sensibly.

### Changed

- Autosave no longer rescans the whole vault.

## [1.3.2] - 2026-08-03

### Fixed

- **macOS auto-update**: releases now ship the update `.zip` that Squirrel.Mac
  applies in place; with only the DMG, the in-app update failed.

## [1.3.1] - 2026-08-03

### Fixed

- **Release metadata**: `latest-mac.yml` is regenerated after the DMG is stapled,
  so its hashes match the shipped files; `release.sh --notarize-only` added.
- Pre-release audit fixes: contrast, toast timer, history modal, SSRF hardening
  and accessibility.

### Security

- Documented that Windows and Linux auto-updates are verified by checksum but not
  yet code-signed.

## [1.3.0] - 2026-07-29

The first cross-platform release, and the first that keeps itself up to date.

### Added

- **Windows and Linux builds.** In addition to the signed and notarized macOS
  DMGs, each release now ships a Windows NSIS installer and Linux `AppImage` and
  `.deb` packages (x64 and arm64), built in CI.
- **Automatic updates.** Noted checks for new releases on launch and offers a
  one-click update; downloads are opt-in and never happen silently. A manual
  **Check for Updates…** is available from the app menu (Help menu on Windows and
  Linux). Package-managed installs defer to the package manager.
- **Help menu** with links to the documentation, release notes, and issue
  tracker.
- Repository README now shows the editor, a demo video, and search / quick-open,
  generated from a deterministic, seeded demo harness.

### Changed

- Cloud-folder detection (iCloud, OneDrive, Google Drive, Dropbox), the MCP
  server's default vault location, and the Claude Desktop config path are now
  resolved per platform instead of assuming macOS.
- Documentation and the install guide now cover macOS, Windows, and Linux.

## [1.2.5] - 2026-07-28

- Honour the vault-root allowlist on import and cloud activation.
- Stop delete-folder from overwriting same-named root notes.
- Translate the main process out of Italian; register a single link extension.

## [1.2.3] - 2026-07-24

- Live sidebar refresh, honest embeddings, and editor + AI upgrades.

## [1.2.2] - 2026-07-20

- Stop bundling `jsdom` so the MCP server starts standalone.
- Keep the strict CSP scoped to production builds; add a shared privacy notice.

## [1.2.1] - 2026-07-19

- Notarize and staple the DMG itself, not just the `.app`.
- Native macOS application menu; ⌘P finds notes by content; clicking a wikilink
  to a missing note now creates it.

## [1.2.0] - 2026-07-19

- First public release: local-first Markdown/HTML notes with wikilinks,
  backlinks, full-text search, multi-provider AI, Git integration, export, quick
  capture, and a built-in MCP server.

[Unreleased]: https://github.com/fabriziosalmi/noted/compare/v1.6.0...HEAD
[1.6.0]: https://github.com/fabriziosalmi/noted/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/fabriziosalmi/noted/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/fabriziosalmi/noted/compare/v1.3.6...v1.4.0
[1.3.6]: https://github.com/fabriziosalmi/noted/compare/v1.3.5...v1.3.6
[1.3.5]: https://github.com/fabriziosalmi/noted/compare/v1.3.4...v1.3.5
[1.3.4]: https://github.com/fabriziosalmi/noted/compare/v1.3.3...v1.3.4
[1.3.3]: https://github.com/fabriziosalmi/noted/compare/v1.3.2...v1.3.3
[1.3.2]: https://github.com/fabriziosalmi/noted/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/fabriziosalmi/noted/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/fabriziosalmi/noted/compare/v1.2.5...v1.3.0
[1.2.5]: https://github.com/fabriziosalmi/noted/compare/v1.2.3...v1.2.5
[1.2.3]: https://github.com/fabriziosalmi/noted/compare/v1.2.2...v1.2.3
[1.2.2]: https://github.com/fabriziosalmi/noted/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/fabriziosalmi/noted/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/fabriziosalmi/noted/releases/tag/v1.2.0
