# Command line

`noted` is the vault from a terminal: list, read, search, create and append to notes, today's daily note, tasks, tags, backlinks and properties. It runs the same code as the [MCP server's tools](./mcp-server), so it follows the same rules: the [per-folder access policy](./mcp-server#per-folder-access), the [agent journal](./mcp-server) (what the command changed can be undone from **Agent activity**) and [staged changes](./mcp-server) (a change in a folder that needs approval is held, and the output says so).

## Setting it up

The command is built with the MCP server:

```bash
npm run build:mcp   # produces dist-mcp/noted-cli.cjs
```

It needs **Node.js 20 or later** on your `PATH`. **Settings → MCP → Command line** shows a ready-made shell alias for your install; add it to your shell profile, or run `npm link` in a checkout to get a `noted` command.

::: info Not a single binary
The Electron runtime that ships with Noted has `runAsNode` switched off on purpose (it is one of the app's hardening fuses), so the app itself cannot be used as the command. A self-contained executable (a Node single-executable build) was tried; it started, but creating a note failed in it, so none is shipped. Node 20+ is the one requirement.
:::

## Commands

```text
noted [--vault <dir>] [--json] <command> [arguments]

list [folder]                  List notes, newest first
read <note>                    Print a note (--json for its parts and etag)
search <query> [--limit n]     Full-text search
create <note> [text]           Make a note (the text, or standard input)
append <note> [text]           Add to the end of a note (made if it does not exist)
daily [text]                   Today's note (YYYY-MM-DD.md); with text, add it to the end
tasks [filters]                --status open|done|all, --folder, --tag, --due-from, --due-to,
                               --overdue, --no-due, --text, --limit
tags                           Every #tag with its count
backlinks <note>               The notes that link to a note
properties <note>              A note's frontmatter properties
```

The vault is `--vault`, then `$NOTED_VAULT`, then the current folder if it is a vault, then Noted's own vault.

## Scripting

`--json` prints one JSON document, `{ "ok": true, … }` or `{ "ok": false, "error": "…" }`. Exit status: `0` done, `1` refused or failed (a hidden or read-only note, a conflict, no such note), `2` wrong usage.

```bash
echo "call the plumber" | noted append Inbox
noted tasks --overdue --json | jq '.tasks[].text'
```
