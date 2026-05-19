# Noted — 30-Day Execution Roadmap (Current -> More Than SOTA)

## Objective
Portare Noted da app ricca di feature a piattaforma affidabile, misurabile e differenziata su AI + knowledge workflows, evitando lavoro "cosmetico".

## Timebox
- Start: Day 1
- End: Day 30
- Cadence: 4 weekly sprints + 2 days hardening/release

## Owners
- `@fab` Product + core implementation
- `@codex` Pair-engineering, hardening, test strategy, review automation

---

## Global KPIs (tracked weekly)
- CI pass rate (`lint`, `test`, `build`): target >= 95%
- Crash-free sessions: target >= 99.5%
- p95 note open/save latency: target <= 150ms local vault
- Core-flow regression count (create/open/save/rename/delete): target 0
- AI retrieval quality@3 (internal eval set): target +30% vs current baseline

---

## Sprint 1 (Days 1-7): Foundation and Signal Integrity

### Goals
- Ripristinare trust nella pipeline tecnica.
- Eliminare rumore operativo (lint/test inconsistenti).

### Backlog
1. `[P0]` Fix ESLint scope to ignore non-source worktrees and build artifacts  
Effort: `S`  
Risk: `Low`  
Owner: `@codex`  
Depends on: none  
DoD:
- `eslint.config.js` ignora `.claude/**`, `release/**`, app bundle outputs
- `npm run lint` esegue solo sul codice reale della repo

2. `[P0]` Stabilize test command and scripts  
Effort: `S`  
Risk: `Low`  
Owner: `@codex`  
Depends on: none  
DoD:
- `npm test` eseguibile senza flag incompatibili
- script README/package aggiornati con comandi veri

3. `[P0]` Replace README template with real product/architecture docs  
Effort: `M`  
Risk: `Low`  
Owner: `@fab`  
Depends on: none  
DoD:
- README descrive Noted, stack, AI providers, Git panel, MCP server, security basics
- setup dev/prod verificato

4. `[P1]` Add CI workflow quality gate  
Effort: `M`  
Risk: `Low`  
Owner: `@codex`  
Depends on: 1,2  
DoD:
- GitHub Actions con `lint`, `test`, `build:main/preload/mcp` su PR
- fail-fast e output chiaro

### Exit criteria Sprint 1
- Pipeline green su branch principale
- README allineato al prodotto

---

## Sprint 2 (Days 8-14): Core Reliability and Safety

### Goals
- Rendere i flussi di scrittura robusti contro regressioni.
- Formalizzare sicurezza IPC/file operations.

### Backlog
1. `[P0]` Core integration tests (renderer + electron bridge mocks)  
Effort: `L`  
Risk: `Medium`  
Owner: `@codex`  
Depends on: Sprint 1 complete  
DoD:
- test su create/open/save/rename/delete/move note
- test su folder ops e daily note

2. `[P0]` Autosave/recovery hardening tests  
Effort: `M`  
Risk: `Medium`  
Owner: `@fab`  
Depends on: 1  
DoD:
- validazione comportamento dopo crash/restart
- nessuna perdita contenuto su scenari comuni

3. `[P1]` Security audit pass on note IO and HTML sanitization  
Effort: `M`  
Risk: `Medium`  
Owner: `@codex`  
Depends on: none  
DoD:
- checklist threat model documentata
- test negativi su path traversal e payload HTML malevoli

4. `[P1]` Telemetry-lite local metrics (opt-in)  
Effort: `M`  
Risk: `Medium`  
Owner: `@fab`  
Depends on: none  
DoD:
- metriche locali su latency open/save e error counts
- nessun dato sensibile persistito

### Exit criteria Sprint 2
- 0 regressioni nei flussi core
- baseline numerica di affidabilita disponibile

---

## Sprint 3 (Days 15-21): AI Retrieval Upgrade (Real Differentiation)

### Goals
- Migliorare output AI tramite contesto migliore, non prompt più lunghi.

### Backlog
1. `[P0]` Build retrieval benchmark dataset  
Effort: `M`  
Risk: `Low`  
Owner: `@fab`  
Depends on: none  
DoD:
- set di query + expected notes (EN/IT mix)
- baseline attuale (TF-IDF) misurata

2. `[P0]` Implement hybrid retrieval v1 (BM25 + dense optional)  
Effort: `L`  
Risk: `High`  
Owner: `@codex`  
Depends on: 1  
DoD:
- nuova pipeline retrieval dietro feature flag
- fallback robusto a TF-IDF

3. `[P1]` Add reranking + context budget planner  
Effort: `M`  
Risk: `Medium`  
Owner: `@codex`  
Depends on: 2  
DoD:
- selezione chunks con budget token esplicito
- ordering per pertinenza + diversita

4. `[P1]` Source-grounded AI responses in UI  
Effort: `M`  
Risk: `Medium`  
Owner: `@fab`  
Depends on: 3  
DoD:
- citazioni note usate in output assistant
- UX minima per inspect delle fonti

### Exit criteria Sprint 3
- +30% quality@3 su benchmark interno
- AI answers più verificabili (meno hallucination risk)

---

## Sprint 4 (Days 22-28): Platformization and Moat

### Goals
- Preparare Noted come piattaforma estensibile, non solo app standalone.

### Backlog
1. `[P0]` Plugin system Phase 1 skeleton (manifest + loader + toggles)  
Effort: `L`  
Risk: `High`  
Owner: `@fab`  
Depends on: Sprint 2 stable  
DoD:
- loader base con enable/disable
- validazione manifest minima
- API plugin read-only iniziale

2. `[P1]` Permission model v1 + user consent UX  
Effort: `M`  
Risk: `High`  
Owner: `@codex`  
Depends on: 1  
DoD:
- permission prompts per capability sensibili
- deny-by-default per network/write advanced

3. `[P1]` MCP workflow recipes (project memory, daily digest)  
Effort: `M`  
Risk: `Medium`  
Owner: `@codex`  
Depends on: Sprint 3 outputs  
DoD:
- 2 workflow templates documentati e testati localmente
- esempi end-to-end con note reali

4. `[P2]` Graph intelligence MVP (orphan notes + link health)  
Effort: `M`  
Risk: `Medium`  
Owner: `@fab`  
Depends on: none  
DoD:
- indicatori semplici ma utili nel pannello graph
- no regressione performance editor

### Exit criteria Sprint 4
- plugin architecture bootstrap pronta per iterazioni
- primi workflow “agentic knowledge” disponibili

---

## Days 29-30: Hardening and Release Readiness

### Checklist
1. Freeze feature flags and enable only stable defaults
2. Full regression pass desktop flows
3. KPI report `before vs after` (week 1 vs week 4)
4. Release notes and known issues

### Final deliverables
- Updated docs:
  - `README.md`
  - `PLAN_PLUGINS.md` delta
  - `ROADMAP_30_DAYS.md` completed status
- CI green and reproducible
- Candidate tag for next public release

---

## Risk Register
1. Retrieval upgrade troppo ambizioso nel timebox  
Mitigazione: feature flag + fallback + benchmark gating
2. Plugin security complexity  
Mitigazione: read-only API first, write/network in phase 2
3. Scope creep (mobile/sync too early)  
Mitigazione: explicitly out-of-scope in these 30 days

## Explicit Out of Scope (this 30-day window)
- Full mobile app implementation
- CRDT sync server production rollout
- Marketplace pubblico completo

## Operating Rules
1. No merge if CI red.
2. Every new feature needs at least one regression test.
3. Every AI capability must have an evaluation check (even lightweight).
4. Security-impacting changes require checklist update.
