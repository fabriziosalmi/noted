# Changelog

All notable changes to Noted are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Noted aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- CHANGELOG link references now exist for every version (they were missing for
  1.3.5 and 1.3.6, and `[Unreleased]` compared from v1.3.4), the missing
  1.3.1–1.3.3 sections were written from the commit history, and the package
  description no longer says macOS-only. `scripts/check-changelog.mjs` runs in CI
  and at the start of `release.sh` so they cannot drift again.

### Added

- **SBOM and provenance for every release**: publishing a release now attaches a
  CycloneDX SBOM, a cosign-signed `SHA256SUMS`, and GitHub artifact attestations
  for all installers. See "Verify your download" in the installation guide.
- **Electron E2E tests in CI on macOS, Windows and Linux** (Playwright
  `_electron`): open vault, edit, rename, search, quit-flush and the update
  check, with failure screenshots and traces as artifacts. `npm run test:e2e`.
- **Automatic git sync** (off by default): Git panel → Sync. Every few minutes
  or after you stop typing, plus after launch and on window focus, Noted commits,
  pulls and pushes the notes repository. It never force-pushes, never puts
  conflict markers in your notes, and pauses when the same note changed on both
  sides; a three-way merge view (Git → Resolve conflicts…) lets you choose per
  part, or edit by hand. The title-bar Git badge shows the sync state.

### Fixed

- **MCP `delete_note` is no longer permanent**: it moves the note to
  `.noted/trash/`, with new `list_trash` and `restore_note` tools and a retention
  setting (Settings → MCP, default 30 days). `.noted/` is ignored by the watcher
  and by Git sync.
- **Renaming a note no longer breaks the links to it.** Renaming or moving a note,
  and renaming or deleting a folder, now rewrites `[[Old]]`, `[[Old|alias]]` and
  `[[Old#Heading]]` in every other note on disk (atomic writes, and a history
  snapshot of each changed note so it can be undone). Retitling a note rewrites the
  links once, when you move on, not at every pause. New setting: Update links when
  renaming (Always / Ask / Never).
- **Pasted and dropped images are no longer stored inside the note as base64.**
  They are saved to `attachments/` (configurable) under a content-hash name, and
  the note keeps a relative path, so notes stay small, under the full-text size
  limit, readable in Git diffs and light for MCP clients. The app serves them
  through `app://` under the same vault confinement as everything else. Settings →
  Editor → "Move embedded images out of notes…" migrates existing notes (report
  first, history snapshot per note). Deleting a note offers to remove the images
  only it used. PDF/HTML/Word/Markdown exports, printing and gists embed the images
  again so they stand alone, and "Export vault" now copies attachments too.
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
- A note changed on disk while it was open (by a sync, an MCP client or another
  device) was only flagged, and the next autosave overwrote it with the stale
  editor text. It now reloads, or — if you were typing — keeps your text and
  saves the other version beside it.

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

[Unreleased]: https://github.com/fabriziosalmi/noted/compare/v1.3.6...HEAD
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
