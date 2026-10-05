# Architecture

Noted is an Electron app split into four bundles, with a strict boundary between
the renderer and the operating system, and a set of pure modules shared across
processes. This page is a map for contributors.

## Processes and bundles

| Bundle | Source | Output | Built by |
| --- | --- | --- | --- |
| Main | `electron/main.ts` | `dist-electron/main.cjs` | esbuild |
| Preload | `electron/preload.ts` | `dist-electron/preload.js` | esbuild |
| MCP server | `mcp-server/index.ts` | `dist-mcp/index.cjs` | esbuild |
| Renderer | `src/` (React) | `dist/` | Vite |

The **main process** owns everything privileged: window creation, the custom
protocol, the content-security policy, every filesystem/Git/LLM/MCP IPC handler,
the vault-root allowlist, the file watcher, and the lifecycle of the MCP SSE child
process. The **renderer** is a React 19 + TipTap + Zustand app that never touches
Node APIs directly.

## The renderer–main bridge

The renderer talks to the main process through a single preload bridge. All of it
is exposed as one `window.electronAPI` object via `contextBridge`, built from
request/response `invoke` calls plus a few event channels (refresh notes, theme
updates, menu commands, the flush-before-quit handshake, and external-change
notifications).

The typed surface lives in `src/types.d.ts`. A build-time test
(`electron/ipc-contract.test.ts`) parses both the preload script and the type
declarations and asserts the two method sets match exactly, so the bridge and the
renderer can never drift apart. Handlers return a discriminated
`{ success, data?, error? }` result rather than throwing across the IPC boundary,
and input is validated centrally in `electron/ipc-utils.ts`.

## Layout of the main process

`electron/main.ts` is only the bootstrap: early process setup, the app lifecycle,
and the calls that register everything else. The rest is split by responsibility:

| Folder / file | Holds |
| --- | --- |
| `electron/core/paths.ts` | vault root allowlist, `getTargetDir`, `safeResolve`, the active vault |
| `electron/core/services.ts` | the two long-lived read models: full-text index and vault index |
| `electron/core/note-io.ts` | durable atomic note writes and version-history snapshots |
| `electron/core/watcher.ts`, `app-writes.ts` | the vault file watcher and the record of the app's own writes |
| `electron/core/rewrite.ts` | link rewriting and the dependencies image operations share |
| `electron/core/windows.ts`, `protocol.ts` | windows, navigation guards, `app://` and the CSP |
| `electron/ipc/*.ts` | IPC handlers by area: `notes`, `folders`, `vault`, `attachments`, `git`, `llm`, `mcp`, `secrets`, `capture`, `app` |
| `electron/llm-guard.ts` | which hosts the LLM proxy may reach (SSRF guard) |
| `electron/updater.ts`, `menu.ts` | auto-update and the application menu |

Each `ipc/` module exports one `register…Handlers()` that `main.ts` calls; modules
under `core/` have no side effects on import. A handler never reaches into
another handler module: shared logic goes in `core/`.

Two tests keep the split honest. `electron/ipc-channels.test.ts` lists every IPC
channel and pushed event, so moving a handler can never drop, duplicate or rename
one, and checks that the preload and the main process agree on all of them.
`electron/hardening.test.ts` scans all of `electron/`, so every window keeps its
sandbox. `tsc -b` type-checks the whole folder under strict mode
(`tsconfig.electron.json`).

## The `app://` protocol

In production the renderer is served from a privileged custom protocol,
`app://`, rather than `file://`. This avoids ES-module load failures from inside
the packaged asar and lets the app run under a strict CSP. In development the
renderer loads from the Vite dev server instead.

## Extracted services

Several groups of handlers live under `electron/src/services/`, each registered
from the main process:

- **`cloud-detector.ts`** — detect and activate cloud vault locations (iCloud,
  Dropbox, and others).
- **`importer.ts`** — import an Obsidian/Markdown folder, or Apple Notes.
- **`exporter.ts`** — export to Markdown, PDF, HTML, and DOCX, and print. Every
  export path sanitizes HTML first.

## Storage

Notes are files in a **vault** folder. The vault location resolves from the
`NOTED_NOTES_DIR` override, else the packaged app's data directory
(`~/Library/Application Support/Noted/notes`), else a development folder.

- **Format.** Files are named `*.md`, but the bytes are sanitized HTML. The MCP
  server converts Markdown to HTML on write so both paths agree.
- **Frontmatter.** YAML frontmatter is preserved by encoding it as a
  `noted-frontmatter` HTML comment on the body and decoding it back on read, so
  it round-trips through the HTML editor.
- **Durable, atomic writes.** A save writes to a temporary sibling file, `fsync`s
  it, atomically renames it into place, and `fsync`s the directory — so a save
  survives power loss.
- **Quit handshake.** Before quitting, the main process asks the renderer to flush
  any debounced autosave and waits for acknowledgement, so nothing is lost on
  <kbd>⌘Q</kbd>.
- **History.** Each save can snapshot the note under `.noted_history/`, capped at
  20 versions per note.
- **Trash on delete.** Deleting in the app moves the file to the system Trash.
  The MCP `delete_note` tool, which cannot reach it, moves the file to
  `.noted/trash/` instead, with `restore_note` and a retention window — see
  [MCP server](/reference/mcp-server#note-tools).
- **External-change watcher.** The vault is watched; a foreign change to an open
  note is reloaded (or, if the user is typing, kept alongside the other version)
  instead of being silently overwritten.
- **Vault index.** The main process keeps one `VaultIndex` for the open vault: each
  note's `[[wikilinks]]` (with alias and heading), `#tags`, headings and
  frontmatter keys. It is built by a scan at startup and then updated
  incrementally — by the app's own save/rename/move/delete and by the file
  watcher, which re-checks a note's mtime and size, so edits from an MCP client,
  a Git pull or another device are picked up too. The renderer receives a
  snapshot and then deltas (each with a sequence number, so a delta that raced
  the snapshot is dropped) and derives backlinks, the tag filter and "Same
  project" from them. Nothing about links or tags is persisted in the renderer.

## Shared modules

Code that must behave identically across processes lives in `shared/`:

- **`security/htmlPolicy.ts`** — a runtime-agnostic HTML sanitization policy that
  imports nothing, with two thin entry points that inject a DOMPurify instance:
  `htmlPolicy.browser.ts` (renderer) and `htmlPolicy.node.ts` (main and MCP, via
  jsdom). The single policy means the sanitizer cannot drift between processes.
- **`markdown/frontmatter.ts`** — the frontmatter encode/decode helpers.
- **`vault/extract.ts`** — what counts as a wikilink, tag, heading or frontmatter
  key. The main-process index and the editor both use it.
- **`search/`** — a BM25 `InvertedIndex` class and a Unicode-aware tokenizer, used
  by both the app's full-text index and the MCP server.
- **`agent/`** — the [agent-workflow](/reference/agent-workflows) engine: types,
  state machine, gates, dependencies, and the metadata block reader/writer.

## Testing

Tests run on Vitest (jsdom) across `src/`, `electron/`, `mcp-server/`, and
`shared/`. Coverage includes the HTML sanitizer's bypass cases, MCP path-traversal
defenses, the full agent-workflow engine, Git operations, the search index, and
the React components and hooks. A **locale-parity** test fails the build if any of
the six shipped locales is missing or has stray keys, and a Playwright script
checks keyboard-shortcut behavior across locales. See
[Building &amp; releasing](/contributing/building) for how to run them.

### Vault-integrity suite

`electron/vault-integrity.test.ts` runs on a deterministic **500-note vault**
(`electron/test-support/vault-fixture.ts`: folders, every wikilink form, tags,
headings, frontmatter, names that need HTML escaping, links to notes that do not
exist). It performs what the app does to a vault — rename, move, rename or delete
a folder, delete and restore, edits made outside the app, a restart, and a long
random session — and after each step asserts two invariants:

1. the live `VaultIndex` equals an index rebuilt from scratch from the files;
2. renames and moves never leave a `[[link]]` dangling that was not dangling before.

`e2e/vault-integrity.e2e.ts` checks the same on the real application, through the
same IPC calls the UI makes, on all three operating systems in CI. Both run on
every pull request. When you add an operation that changes note names or
contents, add it to the suite.
