# Noted

Noted è un'app desktop macOS open-source per prendere note in Markdown/HTML con AI integrata, collegamenti tra note (wikilink), ricerca globale, history locale e integrazione Git.

## Cosa offre oggi

- Editor ricco basato su TipTap (testo, heading, code block, tabelle, formule)
- Wikilink, backlink e pannello grafo note
- Ricerca veloce note + ricerca globale sul contenuto
- AI multi-provider:
  - OpenAI
  - Anthropic
  - Gemini
  - OpenRouter
  - LM Studio (locale)
  - Ollama (locale)
- Suggerimenti AI inline, slash commands, chat contestuale
- Mascheramento PII opzionale prima delle chiamate AI
- Integrazione Git (status, commit, push, PR)
- MCP server locale per leggere/scrivere note da client MCP compatibili
- Workflow agentici file-first via MCP (`create_agent_workflow`, `append_agent_event`)
- Export (HTML, Markdown, PDF, DOCX) e quick capture window

## Stack tecnico

- Electron + Vite + React + TypeScript
- Zustand per state management
- TipTap per editor
- Vitest + Testing Library per test
- ESLint flat config
- `esbuild` per main/preload/MCP bundle

## Requisiti

- Node.js 20+
- npm 10+
- macOS (target principale)

## Setup sviluppo

```bash
npm install
npm run dev
```

`npm run dev` avvia Vite renderer e usa i bundle Electron (`main` + `preload`) generati via `esbuild`.

## Script utili

```bash
npm run lint        # lint con cache
npm run lint:ci     # lint CI (senza cache)
npm run test        # test Vitest
npm run test:ci     # test verbose CI
npm run test:coverage
npm run build       # build app + electron-builder
npm run build:dmg   # build DMG macOS
```

## Build distribuzione

```bash
npm run build
```

Output principale in `release/`.

## MCP server (Noted -> strumenti MCP)

Build server MCP:

```bash
npm run build:mcp
```

Avvio manuale:

```bash
node dist-mcp/index.cjs --notes-dir /percorso/note
```

Se `--notes-dir` non è specificato, il server prova path standard macOS di Noted.

Il server MCP include anche un MVP per usare un folder Noted come workspace
agentico: crea note flat per workflow, task/subtask, run, review e output check.
Schema e convenzioni sono in [docs/AGENT_WORKFLOW_MVP.md](./docs/AGENT_WORKFLOW_MVP.md).

## Struttura repository (principale)

- `src/` renderer React
- `electron/` main process + preload + git ops + ipc utils
- `mcp-server/` server MCP standalone
- `public/` asset statici
- `dist*` output build intermedi
- `release/` artefatti packaging

## Qualità e stato CI locale

Comandi baseline da eseguire prima di una PR:

```bash
npm run lint:ci
npm run test:ci
```

Attualmente i gate sono verdi sugli errori bloccanti; restano warning a11y non critici in alcune modali/overlay.

## Sicurezza (overview)

- Validazione nomi file/cartelle lato IPC
- Difesa contro path traversal
- Sanitizzazione HTML in input/output
- API key/tokens con storage protetto via Electron `safeStorage` (quando disponibile)
- `contextIsolation` attivo e `nodeIntegration` disabilitato nel renderer

## Roadmap

- [ROADMAP_30_DAYS.md](./ROADMAP_30_DAYS.md)
- [PLAN_PLUGINS.md](./PLAN_PLUGINS.md)
- [PLAN_MOBILE.md](./PLAN_MOBILE.md)

## Licenza

MIT — vedi [LICENSE](./LICENSE).
