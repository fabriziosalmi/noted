# Noted

Noted is an open-source macOS desktop app for taking notes in Markdown/HTML, with built-in AI, note links (wikilinks), global search, local history, and Git integration.

## What it offers today

- Rich TipTap-based editor (text, headings, code blocks, tables, formulas)
- Wikilinks, backlinks, and a per-note connections panel
- Fast note switcher + global full-text search
- Multi-provider AI:
  - OpenAI
  - Anthropic
  - Gemini
  - OpenRouter
  - LM Studio (local)
  - Ollama (local)
- Inline AI suggestions, slash commands, contextual chat
- Optional PII masking before AI calls
- Git integration (status, commit, push, PR)
- Local MCP server to read/write notes from compatible MCP clients
- File-first agent workflows via MCP (`create_agent_workflow`, `append_agent_event`)
- Export (HTML, Markdown, PDF, DOCX) and a quick-capture window

## Tech stack

- Electron + Vite + React + TypeScript
- Zustand for state management
- TipTap for the editor
- Vitest + Testing Library for tests
- ESLint flat config
- `esbuild` for the main/preload/MCP bundles

## Requirements

- Node.js 20+
- npm 10+
- macOS (primary target)

## Development setup

```bash
npm install
npm run dev
```

`npm run dev` starts the Vite renderer and uses the Electron bundles (`main` + `preload`) generated via `esbuild`.

## Useful scripts

```bash
npm run lint        # lint with cache
npm run lint:ci     # CI lint (no cache)
npm run test        # Vitest tests
npm run test:ci     # verbose CI tests
npm run test:coverage
npm run build       # build app + electron-builder
npm run build:dmg   # build macOS DMG
```

## Distribution build

```bash
npm run build
```

Primary output lands in `release/`.

## MCP server (Noted -> MCP tools)

Build the MCP server:

```bash
npm run build:mcp
```

Run it manually:

```bash
node dist-mcp/index.cjs --notes-dir /path/to/notes
```

If `--notes-dir` is not provided, the server tries Noted's standard macOS paths.

The MCP server also ships an MVP for using a Noted folder as an agentic
workspace: it creates flat notes for workflows, tasks/subtasks, runs, reviews,
and output checks. The schema and conventions live in
[docs/AGENT_WORKFLOW_MVP.md](./docs/AGENT_WORKFLOW_MVP.md).

## Repository structure (main)

- `src/` — React renderer
- `electron/` — main process + preload + git ops + ipc utils + services
- `mcp-server/` — standalone MCP server
- `shared/` — cross-process code (HTML sanitizer, frontmatter, search index, agent engine)
- `public/` — static assets
- `dist*` — intermediate build output
- `release/` — packaging artifacts

## Quality and local CI status

Baseline commands to run before a PR:

```bash
npm run lint:ci
npm run test:ci
```

The gates are currently green on blocking errors.

## Security (overview)

- IPC-side file/folder name validation
- Path-traversal defense (symlink-aware)
- HTML sanitization on input/output (shared DOMPurify policy across renderer, main, and MCP)
- API keys/tokens stored with Electron `safeStorage` (when available)
- `contextIsolation` on and `nodeIntegration` off in the renderer
- Navigation guards + SSRF filtering on the LLM proxy; the local MCP SSE server rejects non-local Host/Origin requests

## License

MIT — see [LICENSE](./LICENSE).
