# Changelog

All notable changes to Noted are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Noted aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/fabriziosalmi/noted/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/fabriziosalmi/noted/compare/v1.2.5...v1.3.0
[1.2.5]: https://github.com/fabriziosalmi/noted/compare/v1.2.3...v1.2.5
[1.2.3]: https://github.com/fabriziosalmi/noted/compare/v1.2.2...v1.2.3
[1.2.2]: https://github.com/fabriziosalmi/noted/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/fabriziosalmi/noted/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/fabriziosalmi/noted/releases/tag/v1.2.0
