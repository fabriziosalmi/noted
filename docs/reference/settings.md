# Settings

Settings are organized into seven tabs. This page documents each one. Open
Settings from the title bar, from **Quick Open → Settings**, or with the app menu
(**Noted → Preferences**, <kbd>⌘,</kbd>).

## AI

Configure the AI provider and retrieval. See [AI assistant](/guide/ai) for how
each feature behaves.

- **LLM provider** — the cloud services (OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, Mistral AI, DeepSeek, xAI,
  Together AI, Fireworks AI, Cerebras, Hugging Face, Perplexity), the ones on this computer (LM Studio, Ollama, Unsloth
  Studio, llama.cpp server, vLLM, Jan), or **OpenAI-compatible** with your own address. See [AI assistant](/guide/ai#providers).
- **Model** — the model name. **Detect models** lists what the service offers today (for a server on this computer, as soon
  as you choose it); no model is assumed for a cloud service.
- **Base URL** — shown for the OpenAI-compatible services; filled in when you choose one from the list.
- **LM Studio URL** — the endpoint for LM Studio (shown only for that provider).
- **API key** — for cloud services (and for a local server set up with one), with a reveal toggle. Stored with the macOS
  Keychain when available; a warning appears if OS encryption is unavailable.
- **Retrieval (RAG)** — **Top-K** notes to include (1–10, default 3),
  **Candidate notes per question** the word ranking looks into (5–100, default
  30), **Context characters** from the
  active note (1500–30000, default 8000), **Vault only** (answer from your notes,
  with citations; see [AI assistant](/guide/ai#vault-only)), and a **RAG debug**
  toggle that shows where each section ranked.
- **Smart tags** — suggest tags after substantial edits (off by default).

## Appearance

- **Theme** — Auto, Light, Dark, or Sepia.
- **Accent color** — eight presets plus a custom color picker.
- **Editor background** — the writing pane's background: theme default, a preset,
  or a custom color.
- **Language** — English, Italiano, Español, Português, Français, or Deutsch. The
  default is English; there is no automatic detection from your system locale. It
  applies to the whole app: the menu bar, the update dialogs and the file dialogs
  change with it. (The standard Edit and Window menus, and the system's own Open
  and Save panels, follow your operating system's language instead.)

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
- **Update links when renaming** — when a note is renamed or moved, rewrite the
  `[[links]]` to it in other notes: Always (default), Ask, or Never. See
  [Wikilinks](/guide/organizing-notes#renaming-and-moving-notes).
- **Images folder** — where pasted and dropped images are stored inside the vault
  (default `attachments`; one plain folder name). **Move embedded images out of
  notes…** converts images that older versions embedded in the note text. See
  [Images](/guide/editor).
- **Note format** — whether notes are stored as HTML (older vaults) or Markdown, with
  **Convert to Markdown…** and **Convert back to HTML…**. Always starts with a report and
  makes a backup first. See [Note format](/guide/editor#note-format).

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
- **Remote access (Streamable HTTP)** — a toggle and port (default 3000), the local
  `/mcp` URL, the authentication token header, and a switch to also serve the older,
  deprecated SSE endpoint. A `cloudflared` helper is included for
  exposing it over a tunnel.
- **Client snippets** — copy-paste configuration for Claude Code, Claude Desktop
  (with a one-click setup button), VS Code, and Codex.

## Integrations

- **Embeddings (Beta)** — enable dense/semantic retrieval and choose the provider
  (OpenAI, LM Studio, or Ollama) and model. A status line shows how many sections
  of the vault are indexed, and **Rebuild index** throws the vectors away and
  embeds the vault again.
- **Git** — enable [Git integration](/guide/git), then set the remote URL, GitHub
  token, default base branch, and auto-commit.

## Import

- **Obsidian / Markdown folder** — import an existing folder of Markdown notes.
- **Evernote** — import one or more `.enex` exports; see [Import from Evernote](/guide/import-evernote).
- **Apple Notes** — import your notes from Apple Notes.

Each importer has a run button and reports success or failure inline. The Evernote importer also says how many notes
have content that did not come across, and saves a report note.
