# AI assistant

Noted's AI features work with a provider you choose and configure. Nothing is
sent anywhere until you set one up, and by default requests to cloud providers
are masked for personal data first (see [PII masking](#pii-masking)).

## Providers

Configure your provider in **Settings → AI**.

**Cloud services**

- OpenAI, Anthropic (Claude), Google Gemini and OpenRouter
- Groq, Mistral AI, DeepSeek, xAI (Grok), Together AI, Fireworks AI, Cerebras, Hugging Face and Perplexity

**On this computer**

- LM Studio (default `http://localhost:1234/v1`) and Ollama (default `http://localhost:11434`)
- Unsloth Studio (`http://localhost:8888/v1`), llama.cpp server (`http://localhost:8080/v1`), vLLM
  (`http://localhost:8000/v1`) and Jan (`http://localhost:1337/v1`)

**Other**

- **OpenAI-compatible (your own address)**: any service or server that speaks the OpenAI chat protocol, at the address you give.

Every service in the lists above except the first four, LM Studio and Ollama is an address on the OpenAI protocol: choosing
one fills in its address and you can change it (a different port, a server on another machine). Unsloth Studio asks for the
key you create in its **Settings → API**; put it in **API key**.

The list names no model, because models are replaced faster than any list: after you enter your key press **Detect models**
and pick from what the service offers today, or type a model name. A model is never assumed: with none chosen, a cloud service
says so instead of using a name that may have been retired. For a server on this computer the models are listed as soon as
you choose it, and leaving the model blank picks the first one (LM Studio and Ollama). Keys are stored with the macOS
Keychain via `safeStorage` when available.

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

### Reviewing a rewrite

A rewrite (**Expand**, **Shorten**, **Refine**, **Translate**, **Tone**,
**Bullets**, or a custom instruction on a selection) does not replace anything at
once. When the model answers, a review opens: the proposal compared with your
selection, line by line (a paragraph is a line), with the words that changed
marked. Each run of changed lines is one **change** that you **Keep** or **Drop**
on its own; **Keep all** and **Drop all** do it for every change. **Apply** puts in
place of the selection your text with the kept changes made; **Discard** leaves the
note exactly as it was. Nothing in the note moves while you read.

If the selected text changed while the model was working (you kept typing in it),
nothing is replaced and you are told, rather than putting the rewrite over
something else. Applying is one undo step.

Two limits. The selection is replaced as a whole, as rewrites always were, so
inline formatting inside it (bold, links) is not kept even for the parts you keep:
select just the paragraphs you want rewritten. And the grain is the line: a long
paragraph that the model changed in a few words is one change, with the words
marked. The review can be turned off with **Settings → AI → Review AI edits before
applying** (the rewrite then replaces the selection at once, as before).

## Chat

Open the **AI Assistant** tab in the right panel to chat with your notes as
context. The chat sends the active note (trimmed to a configurable size) plus the
most relevant notes from your vault, retrieved automatically. It keeps the last
ten turns and can be cleared at any time.

Answers appear as the model writes them, for every provider (OpenAI, Anthropic,
Gemini, OpenRouter, LM Studio, Ollama and OpenAI-compatible servers). **Stop**
cancels the request at the provider, which stops generating, and keeps the part
already written. If a provider fails half way, the part that arrived stays and
the error is shown after it. A stream that sends nothing for a minute is cut.

## Retrieval (RAG)

When you send a question, the assistant retrieves the most relevant **sections**
from **your whole vault** rather than sending everything — however many notes you
have, and however old the one you need is. A section is the text under one heading
(long ones are cut at paragraph ends, at about 1,500 characters), so a long note
contributes the part that matters instead of its first lines, and the assistant
sees where each piece comes from (`Note › Heading › Subheading`).

Two rankings are merged:

- **Words.** The app's search index (BM25, kept current as notes change, including
  edits made outside Noted) picks the best notes, and their sections are ranked
  against your question. Fast, fully local, and always on.
- **Meaning** (optional, **Settings → Integrations → Embeddings**, **Beta**). Every
  section of the vault has a vector made by OpenAI, LM Studio or Ollama; the
  question is embedded too, and the most similar sections are found even when they
  share no word with it ("car maintenance" finds a section about the oil change).

The two lists are combined by **reciprocal rank fusion**, which needs no tuning
between them: a section that both like comes first. If the question cannot be
embedded (provider down, no vectors yet) the answer uses the words alone.

### Sources and citations

What the assistant is shown is numbered: the open note is source 1 and the sections
found for your question follow. It is asked to put the number in brackets after
each statement that comes from a source, like `[2]`. In the chat those markers
become links, and the sources an answer cites are listed under it
(`Note › Heading`). Click a marker or a source: the note opens at that section and
the passage is marked for a few seconds (the mark is not a selection, so nothing
you type can replace it, and it does not change the file). If the note has changed
and the passage is gone, you land on the heading; if the heading is gone too, the
note just opens.

Numbers the model invents (a `[9]` with only four sources) are removed from the
answer, and citations are only as good as the model: a source it cites supports the
answer only as far as you check. Earlier answers are sent back without their
markers, since the numbers belonged to that turn's sources.

### Vault only

The book button in the chat header (and **Settings → AI → Vault only**) makes the
assistant answer from your notes and nothing else:

- the model is told to answer only from the numbered sources, and to say so, in a
  sentence, when they do not contain the answer;
- sections that merely resemble the question are not offered unless they hold up
  (they contain at least half of the question's significant words, or are close in
  meaning; the similarity cut-off of 0.3 is a heuristic, and models differ);
- when there is no open note and nothing in the vault bears on the question, the
  model is not asked at all: you get "I couldn't find anything about this in your
  notes";
- an answer that cites no source is marked "No source cited: this answer is not
  backed by your notes".

This reduces answers from the model's memory, it does not prove an answer is right:
a model can cite a source for something it does not say.

### The index

Vectors are kept in `.noted/embeddings/` inside the vault, one file per model, and
survive restarts. A section is identified by its text, so **only what changed is
embedded again**: editing one paragraph costs one section, moving a note to
another folder costs nothing, renaming a note re-embeds its sections (the title is
part of what is embedded). Sections are sent to the provider in batches, in the
background, a few seconds after notes change; **Settings → Integrations** shows how
far it has got and can rebuild it from scratch. For OpenAI, personal data is masked
before text is sent (see [PII masking](#pii-masking)). The `.noted/` folder is
never synced by Git.

The index of one model may use up to 512 MB of memory (about 100,000 sections of
1,536 dimensions); a vault beyond that keeps its first sections embedded and is
searched by words for the rest, and the settings say so.

Retrieval is tunable in **Settings → AI**: how many notes to send (Top-K,
default 3; the chat sends twice as many sections), how many **candidate notes**
the word ranking looks into (5–100, default 30), and how much of the active note
to include (default 8000 characters). A debug toggle shows, for each section, its
place in each ranking.

## PII masking

Masking is **on by default**. Before any request goes to a **cloud** provider,
Noted replaces detected personal data — emails, phone numbers, card numbers, and
similar patterns — with typed placeholders such as `[EMAIL_1]`. Requests to
**local** providers (LM Studio, Ollama and any OpenAI-compatible server at `localhost`) are sent verbatim, since they
never leave your machine.

The placeholders are turned back into the original values **on your machine**, in
the answer, as it arrives: what the model says about `[EMAIL_1]` reads as the
address, in the chat and in the text that an action or a slash command writes into
your note. A placeholder means the same value for the whole conversation.

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
