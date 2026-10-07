# Prompts

A **prompt** is a note: a reusable instruction for the AI, kept in your vault under
`prompts/` like anything else you write. You find it in the AI bar and after a `/`
in the editor, and external AI clients (Claude Desktop, Claude Code…) can use the
same prompts through MCP. Because it is a note, you can edit it, link to it, search
it, put it under Git, and share it.

## Writing one

Make a note in `prompts/` (the AI bar's **Prompts** menu has **New prompt**, which
makes one to start from). The properties at the top say what it is; the text is the
instruction:

```markdown
---
name: Make it formal
scope: selection
description: Rewrite in a formal tone
---
Rewrite the following text in a formal, professional tone. Keep its meaning and its
language. Return only the result.

{{selection}}
```

| Property | What it does |
|---|---|
| `name` | What the menus call it. Without it, the file name. |
| `scope` | What it works on: **`selection`** (needs selected text), **`note`** (the whole note), **`any`** (the selection if there is one, else the note). Without it, `any`. |
| `mode` | What happens to the answer: **`replace`** (in place of the selection, read first: see [Reviewing a rewrite](/guide/ai#reviewing-a-rewrite)), **`insert`** (at the caret), **`append`** (at the end of the note, under the prompt's name). Without it: replace when the prompt used a selection, otherwise insert. |
| `description` | A line shown under the name in the menus. |

### Variables

| Write | It becomes |
|---|---|
| `{{selection}}` | The selected text (for `scope: any` without a selection: the note; for `scope: note`: nothing). |
| `{{note}}` | The whole note as text. |
| `{{date}}` | Today, as `2026-10-07`. |

A variable is filled in once: if the selected text itself contains `{{note}}`, it
stays as it is. To write one of the three names literally, put a backslash before
it: `\{{selection}}`. Other `{{words}}` are left alone. A prompt that does not use
`{{selection}}` never replaces the selection, even if some text happens to be
selected.

The text is sent as written, Markdown included, so lists and examples in a prompt
work. In a vault that is still stored as HTML only the words of the instruction are
kept.

## Using one

- **In the AI bar** (turn it on with Settings → Editor → Show AI bar): the
  **Prompts** button lists every prompt. One that needs a selection waits for one.
- **After `/`** in the editor: your prompts follow the built-in commands, and what
  you type narrows the list by name (`/formal`). Only prompts that work without a
  selection are there, since a slash command has none.
- **From an AI client**, through MCP: see [MCP server](/reference/mcp-server#prompts).

[PII masking](/guide/ai#pii-masking) applies as to any request: a cloud model is
sent masked text, and the answer is restored on your machine.

## Limits

- A prompt note is read when it is used, so an edit applies at once. A note in
  `prompts/` that holds no instruction (only properties) is not offered.
- Prompts are found in `prompts/` at the top of the vault, at any depth below it.
- A prompt is one instruction with the three variables; there is no conditional or
  loop, and no way to chain prompts.
