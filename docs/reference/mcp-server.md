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
| `read_note` | Return a note's plain text and its stored text (Markdown in a Markdown vault, HTML in an HTML one) | `name` |
| `create_note` | Create a note (send Markdown; HTML is still accepted and converted); fails if it exists | `name`, `content` |
| `update_note` | Overwrite a note, or append to it | `name`, `content`, `append` (optional) |
| `search_notes` | Full-text (BM25) search with excerpts | `query`, `max_results` (optional, default 10, max 50) |
| `delete_note` | Move a note to the trash | `name` |
| `list_trash` | List trashed notes, newest first, with deletion ids | — |
| `restore_note` | Put a trashed note back at its original path | `name`, `id` (optional) |

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

Note names are validated the same way as in the app: `.md` files only, at most
one subfolder deep, no path traversal, and the path is resolved through symlinks
and confined to the vault root.

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
