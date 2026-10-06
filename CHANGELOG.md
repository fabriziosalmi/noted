# Changelog

All notable changes to Noted are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Noted aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

- **Opening a note no longer saves it.** The editor used to write back the text it had just loaded, which changed the file's modification
  time and added a history snapshot for a note you had only looked at.
- **A link by bare name finds the note in a folder** (`[[Plan]]` for `Work/Plan.md`) instead of offering to create a new, empty `Plan`.

### Changed

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

[Unreleased]: https://github.com/fabriziosalmi/noted/compare/v1.4.0...HEAD
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
