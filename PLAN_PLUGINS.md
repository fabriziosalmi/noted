# Noted — Plugin System Architecture

## Philosophy
- Zero mandatory runtime dependencies for core app
- Plugins are opt-in, sandboxed, and auditable
- Support multiple plugin types for different use cases
- Compatibility bridge for Obsidian plugins (high-value community)
- fabriziosalmi ecosystem first (aimp, newsgator, uglyfeed)

---

## Plugin Types

### Type 1 — JS Plugins (sandboxed Node.js VM)
**Use case**: transformations, AI providers, custom commands  
**Runtime**: Electron `vm.runInContext()` with restricted API  
**Location**: `~/.noted/plugins/<name>/index.js`  
**Manifest**: `~/.noted/plugins/<name>/plugin.json`

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "author": "fabriziosalmi",
  "permissions": ["vault.read", "vault.write", "commands.register", "ui.toolbar"],
  "main": "index.js"
}
```

API exposed to plugins:
```ts
interface PluginAPI {
  vault: {
    read(name: string): Promise<string>;
    write(name: string, content: string): Promise<void>;
    list(): Promise<string[]>;
    create(name: string, content?: string): Promise<void>;
    delete(name: string): Promise<void>;
  };
  workspace: {
    openNote(name: string): void;
    getActiveNote(): { name: string; content: string } | null;
    insertText(text: string): void;
    replaceSelection(text: string): void;
  };
  commands: {
    register(id: string, label: string, fn: () => void): void;
    registerSlash(id: string, label: string, fn: (context: string) => Promise<string>): void;
  };
  ui: {
    addToolbarButton(icon: string, label: string, fn: () => void): void;
    addSidebarPanel(id: string, label: string, component: () => HTMLElement): void;
    toast(message: string, type?: 'success' | 'error'): void;
  };
  settings: {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
    registerTab(label: string, fields: SettingsField[]): void;
  };
  http: {
    fetch(url: string, options?: RequestInit): Promise<{ status: number; text: string; json: unknown }>;
  };
}
```

### Type 2 — Shell / CLI Plugins
**Use case**: external tools (restic, rclone, git hooks, newsgator, uglyfeed)  
**Runtime**: `child_process.spawn` with restricted env  
**Location**: `~/.noted/plugins/<name>/run.sh` or `run.py` or any executable  
**Communication**: stdin/stdout JSON protocol

```json
// Command sent to plugin
{ "command": "process", "note": "content here", "args": {} }

// Response expected
{ "result": "transformed content", "error": null }
```

**fabriziosalmi/newsgator integration**:
```json
{
  "id": "newsgator",
  "type": "cli",
  "command": "python3 newsgator.py",
  "triggers": ["daily-note-create", "schedule:08:00"],
  "output": "append-to-note"
}
```

### Type 3 — HTTP / Webhook Plugins
**Use case**: remote services, self-hosted tools (Infisical, n8n, webhook.site)  
**Runtime**: HTTP calls from main process  
**Trigger**: note events → POST to configured endpoint  

```json
{
  "id": "infisical-sync",
  "type": "http",
  "webhook": "http://localhost:8080/noted-hook",
  "events": ["note.save", "note.delete", "vault.open"],
  "auth": { "type": "bearer", "tokenEnvVar": "INFISICAL_TOKEN" }
}
```

### Type 4 — Obsidian Compatibility Bridge
**Use case**: run existing Obsidian community plugins  
**Runtime**: Sandboxed iFrame with Obsidian-compatible API shim  
**Coverage goal**: ~60-70% of popular plugins (those not using private Obsidian APIs)

Shim maps:
```ts
// Obsidian API → Noted PluginAPI
app.vault.read(file)     → noted.vault.read(file.path)
app.vault.modify(f, data) → noted.vault.write(f.path, data)
app.workspace.getActiveFile() → noted.workspace.getActiveNote()
app.addCommand({ ... })   → noted.commands.register(...)
new Notice(msg)           → noted.ui.toast(msg)
```

**Not supportable** (Obsidian private/closed):
- Canvas (proprietary format)
- Sync (proprietary)
- Publish (proprietary)
- Electron main-process access

### Type 5 — WASM Plugins (future)
**Use case**: high-performance transforms, encryption, language processing  
**Runtime**: `WebAssembly.instantiate` in renderer  
**Language**: Rust → wasm-pack, Go → TinyGo, C++ → Emscripten  

---

## Secrets & Vault Integration

### Supported secret stores (transparent to plugin code):

| System | Integration | Status |
|--------|-------------|--------|
| **Noted safeStorage** | Electron safeStorage (current) | ✅ Done |
| **macOS Keychain** | `security` CLI + node-keytar | Easy |
| **HashiCorp Vault** | REST API + `VAULT_TOKEN` | Medium |
| **Infisical** | REST API + SDK | Medium |
| **Ansible Vault** | `ansible-vault decrypt --output -` subprocess | Easy |
| **1Password CLI** | `op read op://...` subprocess | Easy |
| **dotenv / .env files** | File read (already supported) | ✅ Implicit |
| **AWS Secrets Manager** | AWS SDK | Medium |

Plugin code accesses secrets via:
```ts
const apiKey = await noted.secrets.get('MY_PLUGIN_KEY');
// Noted resolves this from the configured secret store transparently
```

---

## Backup & Remote Storage Integration

### Backup systems:

| System | Method | Config |
|--------|--------|--------|
| **Restic** | CLI subprocess | `restic backup ~/.noted/notes` via shell plugin |
| **Borg** | CLI subprocess | Same pattern |
| **Time Machine** | Automatic (macOS, no config needed) | — |
| **rclone** | CLI subprocess | Config file at `~/.config/rclone/rclone.conf` |
| **Duplicati** | HTTP REST API | Via webhook plugin |

### Remote file transfer:

| Protocol | Library | Notes |
|----------|---------|-------|
| **SFTP** | `ssh2` npm | Auth: password or key file |
| **FTP** | `basic-ftp` npm | Active + passive |
| **WebDAV** | `webdav` npm | Nextcloud, ownCloud, Synology |
| **S3 / compatible** | `@aws-sdk/client-s3` npm | B2, MinIO, Wasabi, etc. |
| **SMB/CIFS** | `@marsaud/smb2` npm | NAS, Windows shares |

All remote protocols would be implemented as a unified "Remote Vault" abstraction:
```ts
interface RemoteVault {
  list(): Promise<RemoteFile[]>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  delete(path: string): Promise<void>;
  sync(direction: 'push' | 'pull' | 'both'): Promise<SyncResult>;
}
```

---

## Plugin Marketplace

### Architecture:
- Plugin registry: GitHub repo `fabriziosalmi/noted-plugins` (like Obsidian's)
- Manifest list: `registry.json` — `[{ id, name, repo, version, description, tags, downloads }]`
- Install: download release zip → extract to `~/.noted/plugins/<id>/`
- Update: check GitHub releases API, auto-update optional
- In-app: Settings → Plugins tab → Browse / Installed / Updates

### First-party plugins (ship with Noted, opt-in):

| Plugin | Type | Description |
|--------|------|-------------|
| `newsgator` | CLI | AI daily news digest → note (fabriziosalmi/newsgator) |
| `uglyfeed` | CLI | RSS/Atom feed aggregator with AI filtering (fabriziosalmi/uglyfeed) |
| `aimp` | JS | Multi-provider AI model picker (fabriziosalmi/aimp) |
| `restic-backup` | Shell | Automatic vault backup to local/remote |
| `sftp-sync` | JS | Sync vault to SFTP server |
| `webdav-sync` | JS | Nextcloud / ownCloud sync |
| `infisical` | HTTP | Secrets management via Infisical |
| `daily-news` | JS | Scheduled AI news fetch at configurable time |
| `pomodoro` | JS | Pomodoro timer + automatic session notes |
| `git-standup` | Shell | Generate daily standup from git logs across repos |

---

## Implementation Roadmap

### Phase 1 — Core Plugin Loader (2 weeks)
- [ ] `PluginManager` class in `electron/plugin-manager.ts`
- [ ] Load JS plugins from `~/.noted/plugins/` with `vm.createContext`
- [ ] Plugin manifest validation (JSON Schema)
- [ ] Sandboxed PluginAPI implementation
- [ ] Settings → Plugins tab: list installed, enable/disable
- [ ] IPC: `plugin-list`, `plugin-enable`, `plugin-disable`, `plugin-call-command`

### Phase 2 — CLI Plugin Support (1 week)
- [ ] Shell plugin runner with stdin/stdout JSON protocol
- [ ] `newsgator` and `uglyfeed` integration as first examples
- [ ] Trigger system: `vault.note.save`, `schedule:HH:MM`, `app.startup`
- [ ] Plugin output: `append`, `prepend`, `replace`, `new-note`, `toast`

### Phase 3 — Marketplace UI (1 week)
- [ ] `noted-plugins` registry repo + `registry.json`
- [ ] In-app browse panel (search, tags, install button)
- [ ] Auto-update check on startup (silent, notify only)

### Phase 4 — Obsidian Compat Bridge (3 weeks)
- [ ] Obsidian API shim (`src/plugins/obsidian-shim.ts`)
- [ ] Load Obsidian plugin `main.js` in sandboxed iframe
- [ ] Test with top 20 community plugins (Dataview, Calendar, Kanban, etc.)
- [ ] Compatibility report / badge system

### Phase 5 — Remote Vaults (2 weeks)
- [ ] `RemoteVault` abstraction in `electron/remote-vault.ts`
- [ ] SFTP implementation (`ssh2`)
- [ ] WebDAV implementation (`webdav`)
- [ ] S3-compatible implementation (`@aws-sdk/client-s3`)
- [ ] Settings → Sync → Remote Vaults section
- [ ] Sync on save + manual sync button

---

## Security Model

- JS plugins run in Node.js `vm.Context` — no `require`, no `process.exit`, no `fs` direct access
- All vault access goes through the sandboxed PluginAPI which validates paths
- CLI plugins run with limited env (`HOME`, `PATH` only), no network unless `permissions: ["network"]`
- HTTP plugins only receive note metadata, not content, unless `permissions: ["vault.content"]`
- User prompted on first install to review permissions
- Plugin code is never eval'd in renderer — always in main process sandbox
