# MCP server

Noted ships a standalone [Model Context Protocol](https://modelcontextprotocol.io/)
server that exposes your vault to compatible AI clients — Claude Code, Claude
Desktop, VS Code, Codex, and others — so they can read, search, and write your
notes.

## Building the server

The server is bundled separately from the app:

```bash
npm run build:mcp
```

This produces `dist-mcp/index.cjs`. In a packaged app the bundle ships alongside
the app and is used automatically; **Settings → MCP** shows its path and whether
it is built.

## Running it

The server speaks two transports.

**stdio (default)** — the client launches the server as a child process and talks
over standard input/output. This is how desktop AI clients connect, and it needs
no port and no network:

```bash
node dist-mcp/index.cjs --notes-dir /path/to/your/vault
```

If `--notes-dir` is omitted, the server falls back to Noted's standard macOS vault
locations.

**SSE (optional)** — an HTTP server for clients that connect over the network:

```bash
node dist-mcp/index.cjs --transport sse --port 3000 --notes-dir /path/to/vault
```

The SSE server binds to `127.0.0.1` only. You can enable and configure it from
**Settings → MCP → Remote access**, which also provides a `cloudflared` helper if
you need to reach it through a tunnel.

## Note tools

| Tool | Purpose | Parameters |
| --- | --- | --- |
| `list_notes` | List notes, newest first | `folder` (optional) |
| `read_note` | Read a note: parsed frontmatter and Markdown body (Markdown vault), or plain text and raw HTML (HTML vault); also returns a versioned `structuredContent` | `name` |
| `create_note` | Create a note (send Markdown; HTML is still accepted and converted); fails if it exists | `name`, `content` |
| `update_note` | Overwrite a note, or append to it | `name`, `content`, `append` (optional), `expected_etag` (optional) |
| `edit_note` | Change part of a note: replace exact text, or replace / append to the section under a heading; refused if the note changed since it was read | `name`, `operation`, `expected_etag` (or `expected_modified`), and `old_text`/`new_text`/`replace_all` or `heading`/`content`/`occurrence`/`whole` |
| `list_tasks` | The `- [ ]` / `- [x]` tasks across the vault, soonest due first, with note and line (Markdown vaults) | `status`, `folder`, `tag`, `due_from`, `due_to`, `overdue`, `no_due`, `text`, `limit` (all optional) |
| `get_backlinks` | The notes that link to a note, with how many links each has | `name` |
| `get_outgoing_links` | The `[[links]]` in a note, each with the note it points to (`null` if none), heading and alias | `name` |
| `list_tags` | Every `#tag` with the number of notes that have it | `limit` (optional) |
| `list_by_tag` | The notes that carry a tag, newest first | `tag`, `limit` (optional) |
| `get_properties` | A note's frontmatter properties, typed | `name` |
| `query_notes` | Find notes by property like a table view: folder or tag, filters, sort, columns | `folder`, `tag`, `filters`, `sort`, `columns`, `limit` (all optional) |
| `search_notes` | Full-text (BM25) search with excerpts | `query`, `max_results` (optional, default 10, max 50) |
| `delete_note` | Move a note to the trash | `name` |
| `list_trash` | List trashed notes, newest first, with deletion ids | — |
| `restore_note` | Put a trashed note back at its original path | `name`, `id` (optional) |

### What `read_note` returns

Every result carries `structuredContent` (schema version **2**):

| Field | Meaning |
| --- | --- |
| `schemaVersion` | `2`. Additive changes keep it; a breaking change raises it. |
| `format` | `markdown` or `html`: how the vault stores notes. |
| `frontmatter` | The YAML frontmatter, parsed (`null` if there is none or it does not parse, `{}` if empty). |
| `frontmatterRaw` | The frontmatter block exactly as stored, delimiters included. |
| `frontmatterError` | Present when the block could not be parsed; the raw text is still returned so it can be fixed. |
| `body` | The note without its frontmatter: Markdown, or HTML in an HTML vault. |
| `etag` | A fingerprint of the stored text. Pass it back as `expected_etag` to `edit_note` (or `update_note`). |
| `modified`, `sizeBytes` | Last change (ISO 8601) and size. |

In a Markdown vault the text result holds the parsed frontmatter and the Markdown body once each
(no second plain-text copy), and `frontmatterRaw + body` is exactly what `update_note` accepts back.
An HTML vault keeps the text layout earlier clients were written against (plain text, then raw HTML),
so existing clients keep working; the new fields are additive. HTML sent to `create_note` and
`update_note` is still accepted for at least one more minor version.

### Controlling what agents can reach

By default an assistant connected through MCP can read and write every note. **Settings → MCP → Agent access** narrows that,
for the vault as a whole and per folder. It is a small file, `.noted/mcp-policy.yaml`, that you can also edit by hand:

```yaml
default: read-only      # hidden | read-only | read-write (open access when there is no file)
folders:
  private: hidden       # as if it were not there
  inbox: read-write
  inbox/locked: read-only
  drafts: staged        # readable; changes wait for your approval
```

| Access | What the assistant can do |
| --- | --- |
| `read-write` | Everything the tools allow. |
| `read-only` | List, read, search and list tasks. Writing is refused with a message that says the note is read-only for agents (vault policy). |
| `staged` | Read, list, search like `read-only`; a **change** (create, update, edit, delete) is not made but held for you to approve (see below). |
| `hidden` | Nothing, and it cannot tell the note exists: it is not listed, not found by `search_notes` (no excerpt either), not in `list_tasks`, not in `list_trash`, and reading or changing it answers "Note not found", exactly as for a note that does not exist. Creating or restoring a note there is refused. |

The most specific folder wins (`inbox/locked` over `inbox`); case, `\` vs `/` and Unicode form do not matter, so `Private/` and
`private/` are the same folder. The rules are checked by **every** tool, on the note's real location too: a symbolic link in an
open folder that points into a hidden one is still hidden, and one cannot be used to write out of a scope. The file is read on every
request, so a change applies at once, even to a search index built a moment before.

A policy file that cannot be read or understood (a typo such as `hiden`, an unknown key) is **not** guessed at: until it is fixed
or deleted, every tool answers with what is wrong, so a mistake closes the vault rather than opening a folder. The policy limits
assistants only; it does not change what you see in the app, and it is kept in `.noted/`, so it is not synced by Git.

#### Approving what an agent proposes (`staged`)

In a `staged` folder, `create_note`, `update_note`, `edit_note` and `delete_note` do not change anything. The server keeps the change
in `.noted/pending/` and answers the agent that it was **staged, not applied** and is waiting for you (with the change's id, and
`structuredContent: { staged: true, pendingId, note, kind }`), so a well-behaved agent does not assume the note changed. An edit is
worked out at that moment, against the etag the agent gave, so a stale edit is still refused as a conflict rather than staged.

In the app, a badge with the number of waiting changes appears in the title bar. It opens a review: each change as a difference
(the words that changed marked), who asked (the name the client gave itself; nothing verifies it), and **Approve** or **Reject**,
or **Approve all** / **Reject all**. Approving makes the change in the note (the version before is kept in its history; a deletion
goes to the trash); rejecting drops it. If the note was changed since the agent saw it (by you, a sync or another agent), approving
is refused and says so, and nothing is overwritten: reject it and let the agent ask again. Up to 200 changes can wait; after that,
and for a change over 5 MB, the agent is told it could not be staged. `restore_note` and the agent-workflow tools cannot be staged
and are refused in these folders. Policy is per folder, not per client: an MCP client names itself and nothing can check that name,
so a rule keyed on it would protect nothing.

### Links, tags, properties and resources

`get_backlinks`, `get_outgoing_links`, `list_tags`, `list_by_tag`, `get_properties` and `query_notes` answer from the notes as the app
sees them: `[[links]]` follow Obsidian's rules (case does not matter, a bare name finds a note in any folder, aliases count), tags are
read from the whole note, and properties are the typed values of the frontmatter. `query_notes` takes the same filters as a table view
(`equals`, `contains`, `is-empty`, `gt`/`lt`, `before`/`after`, `has`…, on any property and on `$name` and `$modified`) and sorts like
one; a filter or sort it cannot understand is refused rather than answered with a wider result. All of them return text and a
`structuredContent`. They respect the access policy: a hidden note links to nothing and is linked from nothing as far as an agent can
tell (a link to it does not even resolve), and its tags and properties are not in any list.

Every readable note is also an MCP **resource**, `noted://note/<path>` (each part of the path URL-encoded; `resources/list`, the
template `noted://note/{path}` and `resources/read`), with the stored text as `text/markdown` (`text/html` in an HTML vault), so a
client that attaches resources can pick notes without calling a tool. A hidden note is not listed and reads as not found.

### The agent journal

Every change an assistant makes to a note through MCP is written to a journal in `.noted/journal/` (one file a day, JSON lines), and
an approved staged change is recorded when you approve it. An entry says **who** (the name the client gave itself), **when**, which
tool, which note, whether it created, changed or deleted it, and the **SHA-256 of the note before and after**; the text of both
versions is kept beside it by hash (a version that is both the "after" of one change and the "before" of the next is stored once).
Reading, searching and listing are not recorded, and neither is a write that changes nothing. **A change that cannot be recorded is
not made**: the journal is written before the note, and the assistant is told why.

The sidebar shows **Agent activity** as soon as an assistant has changed something. The page lists the changes by
session (one run of an MCP server), newest first, filterable by assistant, kind and note, each with its difference on demand.
**Undo** puts a change back; **Undo this session** puts the whole session back, newest change first. An undo is refused, and the
note left alone, when the note is no longer exactly what the assistant left (you, a sync or another assistant changed it since); a
change cannot be undone twice, an undo cannot be undone, and a change whose text was over 5 MB is recorded by hash only. The version
an undo replaces is kept in the note's history, a creation is undone by moving the note to the trash, and every undo is itself in
the journal.

**Tamper evidence.** Each entry holds the hash of the one before it and a hash of everything it says, so changing, removing,
reordering or forging an entry breaks the chain from there, and the page says so ("the journal was changed after it was written:
entry N"). This shows that something changed; it does not prevent it, since anyone who can edit your files can edit the journal and
its content. The journal is not Git-synced (it lives in `.noted/`) and is never pruned by the app.

### Editing without overwriting each other

`update_note` replaces a whole note, so an agent that read a note a minute ago can erase what you typed since. `edit_note`
is made to avoid that:

1. `read_note` returns an **`etag`** (a fingerprint of the text, not a timestamp, so a sync that rewrites the same text is no change).
2. `edit_note` must be given it as `expected_etag` (or the `modified` time as `expected_modified`). If the note is no longer that
   version, **nothing is written**; the result is an error that carries the current note and its new etag, so the agent can redo the
   edit on what is there now.
3. On success it returns the new etag, ready for the next edit.

Operations:

- **`replace`**: `old_text` is found exactly (case, spaces and line breaks count) and swapped for `new_text`. It must match in
  exactly one place, or `replace_all` must be set; otherwise it is refused and says how many places matched. An empty `new_text`
  deletes.
- **`replace_section`**: replaces the text under a heading (`Risks` for any level, `## Risks` for that level). Its sub-sections are
  kept unless `whole` is true. When several headings read the same, say which with `occurrence`.
- **`append_to_section`**: adds `content` at the end of that section, after a blank line.

The rest of the note is left byte for byte as it was (the note is not re-parsed or re-formatted), and an edit that would leave
the YAML frontmatter unreadable is refused. Section operations need a Markdown vault. A note that is open in the app when it is
edited is reloaded by the app, or, if you have unsaved typing in it, kept beside the other version, as for any change made from
outside. `update_note` accepts `expected_etag` too, to get the same protection for a whole-note rewrite.

::: tip The vault decides the format
The server stores notes the way the vault does. In a vault converted to Markdown
(**Settings → Editor → Note format**), `create_note` and `update_note` write Markdown, and with
`append` the existing text is left exactly as it is: only the new part is added, after a
horizontal rule. HTML sent by a client is sanitized and converted. Agent workflow notes keep
their metadata in a fenced `json` block. While the app is converting a vault, write tools
answer that the vault is busy; try again in a minute.
:::

::: tip `delete_note` is recoverable
Deleting inside the app moves a note to the system Trash. An MCP server runs
headless and cannot reach it, so `delete_note` moves the file to
`<vault>/.noted/trash/<time>/<original path>` instead. Use `list_trash` to see
what is there and `restore_note` to bring a note back; without `id` it restores
the most recent deletion of that name, and it refuses to overwrite a note that
exists again. Each deletion is kept separately.

Trashed notes are removed for good after **30 days** by default. Change this in
**Settings → MCP → Keep deleted notes for**, where `0` keeps them until you remove
them by hand. The app writes the value to `<vault>/.noted/config.json`, which the
MCP server reads, so it applies to assistants that launch the server themselves
over stdio too. (`--trash-retention-days N` or the
`NOTED_MCP_TRASH_RETENTION_DAYS` environment variable override it.)

The `.noted/` folder is never listed, searched or committed by Git sync.
:::

Note names are validated the same way as in the app: `.md` files only, folders
nested up to 16 levels, no path traversal, no hidden folder (a name with a segment
starting with `.`), and the path is resolved through symlinks (from the nearest part
that exists) and confined to the vault root. `list_notes` with a folder lists
everything under it, sub-folders included.

## Agent-workflow tools

The server also exposes five tools for driving file-first agent workflows —
`create_agent_workflow`, `append_agent_event`, `advance_agent_state`,
`approve_agent_gate`, and `reject_agent_gate`. These are an advanced feature for
AI-agent orchestration; see [Agent workflows](/reference/agent-workflows).

## Security

The stdio transport inherits the trust of the process that launched it. The SSE
transport is hardened for local-only use:

- **Local-only Host and Origin.** A request whose `Host` is not local, or whose
  `Origin` is cross-site, is rejected — a defense against DNS-rebinding.
- **A bearer token on every request.** Both the SSE handshake and each message
  must present the token, as an `X-MCP-Token` header (or `?token=` on the
  handshake), compared in constant time. A leaked session id alone is not enough.
- **The token** is taken from the `NOTED_MCP_AUTH_TOKEN` environment variable
  (preferred over a command-line argument, which would be visible in the process
  list). When Noted starts the server it generates a random token, stores it with
  owner-only permissions, and passes it to the server through the environment.
- **CORS** reflects only the trusted local origin — never a wildcard.

## Connecting a client

**Settings → MCP** generates ready-to-paste configuration for each supported
client. For Claude Code, for example:

```bash
claude mcp add noted -- node /path/to/dist-mcp/index.cjs --notes-dir /path/to/vault
```

For Claude Desktop, Noted can write the entry into
`claude_desktop_config.json` for you with a single click.
