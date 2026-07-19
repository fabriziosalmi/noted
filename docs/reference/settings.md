# Settings

Settings are organized into seven tabs. This page documents each one. Open
Settings from the title bar, from **Quick Open → Settings**, or with the app menu
(**Noted → Preferences**, <kbd>⌘,</kbd>).

## AI

Configure the AI provider and retrieval. See [AI assistant](/guide/ai) for how
each feature behaves.

- **LLM provider** — OpenAI, Anthropic, Google Gemini, OpenRouter, LM Studio
  (local), or Ollama (local).
- **Model** — the model name. For local providers, a **Detect models** button
  lists what the server offers; leaving it blank auto-selects one.
- **LM Studio URL** — the endpoint for LM Studio (shown only for that provider).
- **API key** — for cloud providers, with a reveal toggle. Stored with the macOS
  Keychain when available; a warning appears if OS encryption is unavailable.
- **Retrieval (RAG)** — **Top-K** notes to include (1–10, default 3), **Max
  notes** to consider (10–500, default 100), **Context characters** from the
  active note (1500–30000, default 8000), and a **RAG debug** toggle that shows
  relevance scores.
- **Smart tags** — suggest tags after substantial edits (off by default).

## Appearance

- **Theme** — Auto, Light, Dark, or Sepia.
- **Accent color** — eight presets plus a custom color picker.
- **Editor background** — the writing pane's background: theme default, a preset,
  or a custom color.
- **Language** — English, Italiano, Español, Português, Français, or Deutsch. The
  default is English; there is no automatic detection from your system locale.

## Editor

- **Editor font** — System, Serif, or Mono.
- **Font size** — Small, Normal, Large, or XL.
- **Editor width** — Narrow, Normal, Wide, or Full.
- **AI suggestions** — ghost text: Off, Manual (<kbd>⌘L</kbd>), or Auto while
  typing.
- **Show toolbar** — the formatting toolbar above the editor.
- **Show AI bar** — the AI actions bar (off by default).
- **Typewriter mode** — keep the current line vertically centered.
- **PII masking** — mask personal data before cloud AI calls (on by default).
- **Show hints** — inline onboarding hints (on by default).
- **Title follows filename** — rename the `.md` file to match the note's title
  (on by default).

## Sync

Choose where your vault lives and manage it.

- **Cloud providers** — detected services (iCloud Drive, Dropbox, and others)
  offered as one-click vault locations.
- **Local only** — a local folder (`~/Documents/Noted`).
- **Choose custom folder** — any folder you pick.
- **Current path** — the active vault location.
- **Import vault** — bring in an existing folder of notes.
- **Danger zone** — **Wipe all notes**, behind a confirmation dialog.

## MCP

Manage the built-in [MCP server](/reference/mcp-server) so compatible AI clients
can read and write your notes.

- **Status** — whether the server bundle is built, with the `npm run build:mcp`
  command if not.
- **Server path** and **vault path**, each with a reveal-in-Finder action.
- **Remote access (HTTP/SSE)** — a toggle and port (default 3000), the local SSE
  URL, and an authentication token header. A `cloudflared` helper is included for
  exposing it over a tunnel.
- **Client snippets** — copy-paste configuration for Claude Code, Claude Desktop
  (with a one-click setup button), VS Code, and Codex.

## Integrations

- **Embeddings (Beta)** — enable dense/semantic retrieval and choose the provider
  (OpenAI, LM Studio, or Ollama) and model.
- **Git** — enable [Git integration](/guide/git), then set the remote URL, GitHub
  token, default base branch, and auto-commit.

## Import

- **Obsidian / Markdown folder** — import an existing folder of Markdown notes.
- **Apple Notes** — import your notes from Apple Notes.

Each importer has a run button and reports success or failure inline.
