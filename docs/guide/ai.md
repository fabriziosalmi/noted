# AI assistant

Noted's AI features work with a provider you choose and configure. Nothing is
sent anywhere until you set one up, and by default requests to cloud providers
are masked for personal data first (see [PII masking](#pii-masking)).

## Providers

Configure your provider in **Settings → AI**.

**Cloud**

- OpenAI
- Anthropic
- Google Gemini
- OpenRouter

**Local**

- LM Studio (OpenAI-compatible, default `http://localhost:1234/v1`)
- Ollama (default `http://localhost:11434`)

For local providers, if you leave the model blank Noted auto-detects one by
querying the running server; you can also press **Detect models** to pick from
the list. For cloud providers you enter an API key (stored with the macOS
Keychain via `safeStorage` when available) and a model name.

A provider counts as **configured** when a cloud provider has an API key, or a
local provider has a model available. Until then, the assistant shows a setup
prompt instead of running.

::: info No streaming
Responses are returned whole rather than token-by-token. Requests time out after
60 seconds and retry with backoff on transient errors; failures surface as clear,
localized messages (bad key, rate limit, model not found, provider unreachable,
and so on).
:::

## Inline suggestions (ghost text)

As you write, Noted can propose a faint continuation after your cursor. Press
<kbd>Tab</kbd> to accept it, <kbd>Esc</kbd> to dismiss it, or just keep typing to
clear it.

Choose the behavior in **Settings → Editor → AI suggestions**:

- **Off**
- **Manual** — trigger a suggestion on demand with <kbd>⌘L</kbd> (the default)
- **Auto while typing** — suggestions appear on their own after a brief pause

## Slash commands

Type `/` at the start of a block (or after a space) to open the AI command menu:

| Command | What it does |
| --- | --- |
| Continue | Continues the text for a few sentences |
| Expand | Expands and deepens the surrounding text |
| Summarize | Summarizes the whole note into a few bullets |
| Improve | Improves clarity and flow, keeping your meaning |
| Bullets | Rewrites the text as a bullet list |
| Translate | Translates between Italian and English (other languages to English) |

Navigate with the arrow keys, run with Enter or Tab, and press **Stop** to abort
a running command.

## AI actions bar

Enable the actions bar with **Settings → Editor → Show AI bar** (off by default).
It sits under the toolbar with two groups:

- **Transform** — **Continue** (appends), and **Expand**, **Shorten**, **Refine**
  (rewrite the selected text).
- **Analysis** — **Summarize**, **Review**, **Devil's advocate**, and **Q&A**,
  each appended below a divider.

Rewrite actions require a text selection, so they can never silently overwrite a
whole note; a badge shows when a selection is active. Any running action turns
into a **Stop** button.

## Chat

Open the **AI Assistant** tab in the right panel to chat with your notes as
context. The chat sends the active note (trimmed to a configurable size) plus the
most relevant notes from your vault, retrieved automatically. It keeps the last
ten turns and can be cleared at any time.

## Retrieval (RAG)

When it needs context, the assistant retrieves the most relevant notes from your
vault rather than sending everything.

- By default retrieval is **lexical** (TF-IDF over note chunks) — fast and fully
  local.
- Optionally, enable **dense embeddings** (**Settings → Integrations**, labeled
  **Beta**) for hybrid semantic retrieval, using OpenAI, LM Studio, or Ollama to
  compute embeddings.

Retrieval is tunable in **Settings → AI**: how many notes to send (Top-K,
default 3), how many notes to consider (default 100), and how much of the active
note to include (default 8000 characters). A debug toggle shows the per-note
relevance scores.

## PII masking

Masking is **on by default**. Before any request goes to a **cloud** provider,
Noted replaces detected personal data — emails, phone numbers, card numbers, and
similar patterns — with typed placeholders such as `[EMAIL_1]`. Requests to
**local** providers (LM Studio, Ollama) are sent verbatim, since they never leave
your machine.

You can toggle it under **Settings → Editor → PII masking**. The chat panel shows
a shield indicator and how many items were masked.

::: warning A hint, not a guarantee
PII masking is a best-effort filter over common patterns, not a security
boundary. Review sensitive content before sending it to a cloud provider.
:::

## Smart tag suggestions

Enable **smart tags** (**Settings → AI**, off by default) to have Noted suggest a
few tags after a substantial edit. Suggestions appear as a dismissible chip
picker; accepted tags are appended to the note.

## Next steps

- **[Git integration](/guide/git)** — version your vault and open pull requests.
