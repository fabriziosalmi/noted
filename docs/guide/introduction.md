# Introduction

Noted is a local-first note-taking app for macOS. It stores everything as plain
Markdown and HTML files in a folder you choose, and layers a modern editor,
full-text search, note linking, multi-provider AI, Git integration, and a
built-in MCP server on top of those files.

There is no account, no sync service, and no telemetry. Your notes never leave
your machine unless you explicitly ask an AI provider or a Git remote to receive
them.

## Why local-first

Most note apps keep your notes in a proprietary database behind a login. Noted
takes the opposite stance:

- **Your files, your folder.** Each note is a real `.md`/`.html` file on disk.
  You can read, back up, `grep`, and version them with any other tool.
- **Works offline.** The editor, search, wikilinks, backlinks, export, and Git
  all work with no network connection. AI is the only feature that reaches out,
  and only to the provider you configure.
- **No lock-in.** Because the vault is just Markdown, you can leave at any time
  and take everything with you.
- **Private by default.** No account, no analytics, no background phone-home.
  API keys are stored with the macOS Keychain (via Electron `safeStorage`) when
  available.

## What's inside

- A rich editor built on TipTap — headings, lists, tables, code blocks with
  syntax highlighting, math, images, and typography.
- `[[Wikilinks]]`, backlinks, and a per-note connections panel.
- A fast note switcher and global full-text search.
- Multi-provider AI (OpenAI, Anthropic, Gemini, OpenRouter, LM Studio, Ollama)
  with inline suggestions, slash commands, an actions bar, and a chat panel —
  plus optional PII masking before any request leaves your machine.
- Git integration for status, commit, push, and pull-request flows.
- Export to HTML, Markdown, PDF, and DOCX, and a quick-capture window.
- A local [MCP server](/reference/mcp-server) so compatible AI clients can read
  and write your notes, and drive [file-first agent workflows](/reference/agent-workflows).

## How this documentation is organized

- **[Guide](/guide/installation)** — install Noted and learn each feature in the
  order you'd meet it: the editor, organizing notes, search, AI, Git, and export.
- **[Reference](/reference/settings)** — exhaustive detail: every setting, every
  keyboard shortcut, the MCP server's tools, and the agent-workflow protocol.
- **[Contributing](/contributing/architecture)** — the architecture, security
  model, and how to build and release the app.

## Where to go next

- **[Installation](/guide/installation)** — download the signed build or build
  from source.
- **[First run](/guide/first-run)** — create your vault and your first note.
- **[The editor](/guide/editor)** — a tour of everything you can type.
