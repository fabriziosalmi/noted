import { app, BrowserWindow, ipcMain, dialog, safeStorage, globalShortcut, nativeTheme, protocol, shell, session } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { validateFileName, validateFolderName, stripUnsafeHtml } from './ipc-utils.js';
import { registerCloudDetectorHandlers } from './src/services/cloud-detector.js';
import { registerImporterHandlers } from './src/services/importer.js';
import { registerExporterHandlers } from './src/services/exporter.js';
import * as gitOps from './git-ops.js';
import { sanitizeGitError } from './git-ops.js';
import { FullTextSearchReadModel } from './fulltext-index.js';
import { logEvent, newRequestId } from './structured-log.js';

// Disable hardware acceleration only in dev to avoid GPU process crashes in sandboxed environments.
// In production we need it for vibrancy/blur effects.
if (!app.isPackaged) {
  app.disableHardwareAcceleration();
}

// __dirname is provided by CommonJS (esbuild --format=cjs)

// In dev: keep userData/notes local to the project so we don't pollute ~/Library.
// In production (packaged): userData is already ~/Library/Application Support/Noted — write there.
if (!app.isPackaged) {
  app.setPath('userData', path.join(__dirname, '../.electron_data'));
  app.setPath('sessionData', path.join(__dirname, '../.electron_session'));
}

// Resolved inside app.whenReady() to ensure app paths are available.
let DEFAULT_NOTES_DIR: string;

function initNotesDir() {
  // NOTED_NOTES_DIR overrides the vault location — used by the demo harness and
  // integration runs to point at a throwaway directory instead of real notes.
  DEFAULT_NOTES_DIR = process.env.NOTED_NOTES_DIR
    ? process.env.NOTED_NOTES_DIR
    : app.isPackaged
    ? path.join(app.getPath('userData'), 'notes')
    : path.join(__dirname, '../notes_dev');
  if (!fs.existsSync(DEFAULT_NOTES_DIR)) {
    fs.mkdirSync(DEFAULT_NOTES_DIR, { recursive: true });
  }
}

const getTargetDir = (customDir?: string) => {
  if (customDir && fs.existsSync(customDir)) {
    return customDir;
  }
  return DEFAULT_NOTES_DIR;
};

/**
 * Resolve `path.join(targetDir, relName)` and ensure the resulting path stays
 * inside `targetDir` after symlinks are followed. Prevents a malicious symlink
 * planted inside the syncDir from being used to escape to /etc/passwd etc.
 *
 * The fileName argument is assumed to already have passed `validateFileName`
 * (no `..`, no absolute paths) — this is the second line of defence.
 */
function safeResolve(targetDir: string, relName: string): string {
  const targetReal = fs.realpathSync(targetDir);
  const candidate = path.join(targetDir, relName);
  // The candidate may not exist yet (create flow). Resolve as far as possible:
  // walk up until an existing ancestor is found, realpath it, then re-append
  // the un-resolved tail.
  let ancestor = candidate;
  const unresolved: string[] = [];
  while (!fs.existsSync(ancestor)) {
    unresolved.unshift(path.basename(ancestor));
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break; // hit filesystem root
    ancestor = parent;
  }
  const ancestorReal = fs.realpathSync(ancestor);
  const finalReal = unresolved.length ? path.join(ancestorReal, ...unresolved) : ancestorReal;
  // Match against the real target with a trailing separator to avoid prefix
  // collisions (e.g. /vault matching /vault2).
  const targetWithSep = targetReal.endsWith(path.sep) ? targetReal : targetReal + path.sep;
  if (finalReal !== targetReal && !finalReal.startsWith(targetWithSep)) {
    throw new Error('Path escapes vault directory');
  }
  return finalReal;
}

let encryptedApiKey: Buffer | null = null;
let encryptedGhToken: Buffer | null = null;

// Cache the warning state so we print it exactly once per process — on Linux
// without a secret service (libsecret), Electron's safeStorage silently falls
// back to in-memory plaintext. The renderer can query `safe-storage-status`
// to surface this in the UI.
let safeStorageWarned = false;
function checkSafeStorageOnce() {
  if (safeStorageWarned) return;
  safeStorageWarned = true;
  if (!safeStorage.isEncryptionAvailable()) {
    logEvent('warn', 'safe_storage_encryption_unavailable', {
      platform: process.platform,
      message:
        'OS encryption unavailable; tokens remain in-memory only. On Linux install libsecret/gnome-keyring.',
    });
  }
}

const fullTextSearchIndex = new FullTextSearchReadModel();

process.env.DIST = path.join(__dirname, '../dist');
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public');

// Register a custom 'app://' scheme as standard+secure BEFORE app.whenReady().
// This avoids file:// + ES-module + asar quirks (silent JS bundle loading failures
// when index.html is loaded from inside app.asar with <script type="module" crossorigin>).
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true } },
]);

let win: BrowserWindow | null;
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];

// Navigation hardening: keep the renderer locked to app:// (and the Vite dev
// server in dev), and route external links to the OS browser instead of letting
// the page navigate away or spawn in-app windows. Backstops any link/redirect
// that slips past HTML sanitization.
function applyNavigationGuards(w: BrowserWindow) {
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (event, url) => {
    const isApp = url.startsWith('app://');
    const isDev = !!VITE_DEV_SERVER_URL && url.startsWith(VITE_DEV_SERVER_URL);
    if (!isApp && !isDev) event.preventDefault();
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 500,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 13 },
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    icon: path.join(process.env.VITE_PUBLIC, 'icon.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    // Use custom app:// scheme — bypasses ES-module-from-file:// issues inside asar
    win.loadURL('app://./index.html');
  }
  applyNavigationGuards(win);
}

// Forward native theme changes to renderer
nativeTheme.on('updated', () => {
  if (win && !win.isDestroyed()) {
    win.webContents.send('native-theme-updated', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
  }
});

// ==========================================
// Quick Capture window
// ==========================================

let captureWin: BrowserWindow | null = null;

function openCaptureWindow() {
  if (captureWin && !captureWin.isDestroyed()) {
    captureWin.focus();
    return;
  }
  captureWin = new BrowserWindow({
    width: 480,
    height: 180,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  captureWin.on('closed', () => { captureWin = null; });
  const captureUrl = VITE_DEV_SERVER_URL
    ? `${VITE_DEV_SERVER_URL}capture.html`
    : 'app://./capture.html';
  captureWin.loadURL(captureUrl);
  applyNavigationGuards(captureWin);
}

ipcMain.handle('save-capture', (_, text: string) => {
  try {
    if (typeof text !== 'string' || !text.trim()) return { success: false };
    const pad = (n: number) => String(n).padStart(2, '0');
    const now = new Date();
    const fileName = `Capture_${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}.md`;
    const sanitizedText = stripUnsafeHtml(text);
    const content = `<p>${sanitizedText.replace(/\n/g, '</p><p>')}</p>`;
    fs.writeFileSync(path.join(DEFAULT_NOTES_DIR, fileName), content, 'utf-8');
    captureWin?.close();
    win?.webContents.send('refresh-notes');
    return { success: true, fileName };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle('close-capture', () => { captureWin?.close(); });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

function createWelcomeNote() {
  const flagPath = path.join(app.getPath('userData'), '.noted_welcomed');
  if (fs.existsSync(flagPath)) return;
  const welcomePath = path.join(DEFAULT_NOTES_DIR, 'Benvenuto in Noted.md');
  if (!fs.existsSync(welcomePath)) {
    fs.writeFileSync(welcomePath, [
      '<h1>Benvenuto in Noted 👋</h1>',
      '<p>Noted è il tuo spazio di scrittura personale — veloce, pulito, e potente.</p>',
      '<h2>Per iniziare</h2>',
      '<ul>',
      '<li>Premi <strong>⌘P</strong> per aprire una nota o cercarne una</li>',
      '<li>Digita <strong>/</strong> per i comandi AI (espandi, riassumi, traduci…)</li>',
      '<li>Il <strong>Tab</strong> accetta i suggerimenti AI inline mentre scrivi</li>',
      '<li>Premi <strong>?</strong> per vedere tutte le scorciatoie</li>',
      '</ul>',
      '<h2>AI — configurazione</h2>',
      '<p>Apri <strong>Impostazioni → AI</strong> e inserisci la tua API key (OpenAI, Anthropic, Gemini, OpenRouter) oppure punta a LM Studio / Ollama per un modello locale gratuito.</p>',
      '<h2>Buona scrittura ✨</h2>',
    ].join('\n'), 'utf8');
  }
  fs.writeFileSync(flagPath, '1', 'utf8');
}

app.whenReady().then(() => {
  // Serve renderer assets via app:// — bypasses ES-module-from-file:// issues inside asar
  protocol.handle('app', async (request) => {
    try {
      const url = new URL(request.url);
      const relPath = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      const filePath = path.join(process.env.DIST!, relPath);
      const data = await fs.promises.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mimeMap: Record<string, string> = {
        '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
        '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
        '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2',
        '.ttf': 'font/ttf', '.ico': 'image/x-icon',
      };
      const mime = mimeMap[ext] ?? 'application/octet-stream';
      return new Response(new Uint8Array(data), { headers: { 'Content-Type': mime } });
    } catch {
      return new Response('Not Found', { status: 404 });
    }
  });
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' app:; " +
          "script-src 'self' 'unsafe-inline' app:; " +
          "style-src 'self' 'unsafe-inline' app:; " +
          "img-src 'self' data: https: app:; " +
          "connect-src 'self' http://127.0.0.1:* http://localhost:* https: app: ws: wss:; " +
          "font-src 'self' data: app:;"
        ]
      }
    });
  });
  initNotesDir();
  createWelcomeNote();
  createWindow();
  globalShortcut.register('CommandOrControl+Shift+Space', openCaptureWindow);
});

app.on('will-quit', () => {
  stopMcpSseServer();
  globalShortcut.unregisterAll();
});

// Example IPC handler for the magical stuff
ipcMain.handle('ping', () => 'pong');
ipcMain.handle('get-app-version', () => app.getVersion());

registerCloudDetectorHandlers();
registerImporterHandlers(fullTextSearchIndex, () => DEFAULT_NOTES_DIR);
registerExporterHandlers();

function getMcpServerPathInternal(): string {
  let candidate = path.join(__dirname, '..', 'dist-mcp', 'index.cjs');
  const asarSeg = `${path.sep}app.asar${path.sep}`;
  if (app.isPackaged && candidate.includes(asarSeg)) {
    candidate = candidate.replace(asarSeg, `${path.sep}app.asar.unpacked${path.sep}`);
  }
  return candidate;
}

let mcpSseChild: ChildProcess | null = null;
let currentMcpPort: number | null = null;
let currentMcpSyncDir: string | null = null;

function stopMcpSseServer() {
  if (mcpSseChild) {
    logEvent('info', 'mcp_sse_stopping', {
      port: currentMcpPort ?? undefined,
      syncDir: currentMcpSyncDir ?? undefined,
    });
    mcpSseChild.kill('SIGTERM');
    mcpSseChild = null;
    currentMcpPort = null;
    currentMcpSyncDir = null;
  }
}

// A stable per-install token that authenticates the local SSE handshake. Kept
// in userData so a saved client config keeps working across restarts; the SSE
// server refuses connections that don't present it.
let mcpSseToken: string | null = null;
function getMcpSseToken(): string {
  if (mcpSseToken) return mcpSseToken;
  const tokenPath = path.join(app.getPath('userData'), 'mcp-sse-token');
  try {
    if (fs.existsSync(tokenPath)) {
      const saved = fs.readFileSync(tokenPath, 'utf8').trim();
      if (saved) return (mcpSseToken = saved);
    }
  } catch { /* regenerate below */ }
  const token = crypto.randomBytes(24).toString('hex');
  try {
    fs.writeFileSync(tokenPath, token, { mode: 0o600 });
  } catch { /* fall back to an in-memory token for this session */ }
  return (mcpSseToken = token);
}

function startMcpSseServer(port: number, syncDir?: string) {
  stopMcpSseServer();
  const reqId = newRequestId('mcp-sse');

  const mcpPath = getMcpServerPathInternal();
  if (!fs.existsSync(mcpPath)) {
    logEvent('error', 'mcp_sse_binary_missing', { reqId, mcpPath });
    return;
  }

  const targetDir = getTargetDir(syncDir);
  logEvent('info', 'mcp_sse_starting', { reqId, port, notesDir: targetDir });

  try {
    mcpSseChild = spawn('node', [
      mcpPath,
      '--transport',
      'sse',
      '--port',
      String(port),
      '--notes-dir',
      targetDir,
      '--auth-token',
      getMcpSseToken()
    ], {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    currentMcpPort = port;
    currentMcpSyncDir = targetDir;

    mcpSseChild.stdout?.on('data', data => {
      const message = data.toString().trim();
      if (!message) return;
      logEvent('info', 'mcp_sse_child_stdout', { reqId, message });
    });

    mcpSseChild.stderr?.on('data', data => {
      const message = data.toString().trim();
      if (!message) return;
      logEvent('error', 'mcp_sse_child_stderr', { reqId, message });
    });

    mcpSseChild.on('close', code => {
      logEvent('info', 'mcp_sse_child_exited', { reqId, code: code ?? null });
      if (mcpSseChild) {
        mcpSseChild = null;
      }
    });

    mcpSseChild.on('error', err => {
      logEvent('error', 'mcp_sse_child_spawn_error', { reqId, error: err.message });
    });
  } catch (err) {
    logEvent('error', 'mcp_sse_spawn_failed', { reqId, error: (err as Error).message });
  }
}

// MCP server location — resolved relative to dist-electron/main.cjs so it works
// both in dev (cloned repo) and in packaged builds that ship dist-mcp/.
// Used by Settings → MCP tab to populate accurate copy-paste client configs.
ipcMain.handle('get-mcp-server-path', () => {
  const candidate = getMcpServerPathInternal();
  return { path: candidate, exists: fs.existsSync(candidate) };
});

// The SSE auth token, so Settings can render a ready-to-paste authenticated URL.
ipcMain.handle('get-mcp-sse-token', () => getMcpSseToken());

ipcMain.handle('update-mcp-sse-config', (_, config: { enabled: boolean; port: number; syncDir?: string }) => {
  const reqId = newRequestId('mcp-sse-config');
  try {
    const { enabled, port, syncDir } = config;
    const targetDir = getTargetDir(syncDir);

    if (!enabled) {
      stopMcpSseServer();
      return { success: true };
    }

    if (mcpSseChild && currentMcpPort === port && currentMcpSyncDir === targetDir) {
      return { success: true };
    }

    startMcpSseServer(port, syncDir);
    return { success: true };
  } catch (err) {
    logEvent('error', 'mcp_sse_config_update_failed', { reqId, error: (err as Error).message });
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle('reveal-in-finder', (_, fsPath: string) => {
  if (typeof fsPath !== 'string') return { success: false };
  shell.showItemInFolder(fsPath);
  return { success: true };
});

// FS IPC Handlers
ipcMain.handle('get-notes-list', async (_, syncDir?: string) => {
  try {
    if (syncDir !== undefined && typeof syncDir !== 'string') throw new Error('syncDir must be a string');
    const targetDir = getTargetDir(syncDir);
    const filenames = await fs.promises.readdir(targetDir);
    const files: { name: string; path: string; stats: fs.Stats }[] = [];
    for (const f of filenames) {
      if (!f.endsWith('.md')) continue;
      try {
        validateFileName(f);
      } catch {
        continue;
      }
      try {
        const p = path.join(targetDir, f);
        const stat = await fs.promises.stat(p);
        files.push({
          name: f,
          path: p,
          stats: stat
        });
      } catch {
        // Skip unreadable entries and continue
      }
    }
    files.sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs); // Sort by modified time
    return { success: true, data: files };
  } catch (error: unknown) {
    const err = error as Error;
    return { success: false, error: err.message };
  }
});

ipcMain.handle('read-note', async (_, fileName: string, syncDir?: string) => {
  try {
    validateFileName(fileName);
    const targetDir = getTargetDir(syncDir);
    const filePath = safeResolve(targetDir, fileName);
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return { success: true, data: content };
  } catch (error: unknown) {
    const err = error as Error;
    return { success: false, error: err.message };
  }
});

const MAX_HISTORY_SNAPSHOTS = 20;
// Don't snapshot every autosave — a 200 KB note × 6000 saves/day is silly.
// Only snapshot if the content has changed by at least this many chars vs the
// most recent snapshot, OR if enough time has passed since the last one.
const SNAPSHOT_MIN_DIFF_CHARS = 200;
const SNAPSHOT_MIN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

async function saveSnapshot(targetDir: string, fileName: string, content: string): Promise<void> {
  try {
    const histDir = path.join(targetDir, '.noted_history', fileName);
    await fs.promises.mkdir(histDir, { recursive: true });

    // Compare against the most recent snapshot; skip the write if the delta is
    // small AND we snapshot-ed recently.
    const existing = (await fs.promises.readdir(histDir)).filter(f => f.endsWith('.html')).sort();
    if (existing.length > 0) {
      const latest = existing[existing.length - 1];
      const latestPath = path.join(histDir, latest);
      let prevContent = '';
      try { prevContent = await fs.promises.readFile(latestPath, 'utf-8'); } catch { /* ignore */ }
      const diff = Math.abs(prevContent.length - content.length);
      let ageMs = Infinity;
      try {
        const stat = await fs.promises.stat(latestPath);
        ageMs = Date.now() - stat.mtimeMs;
      } catch { /* ignore */ }
      if (diff < SNAPSHOT_MIN_DIFF_CHARS && ageMs < SNAPSHOT_MIN_INTERVAL_MS) {
        return; // not worth a new snapshot
      }
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    await fs.promises.writeFile(path.join(histDir, `${ts}.html`), content, 'utf-8');
    // Prune oldest beyond limit (re-list since we may have just added one).
    const snapshots = (await fs.promises.readdir(histDir)).filter(f => f.endsWith('.html')).sort();
    for (const old of snapshots.slice(0, Math.max(0, snapshots.length - MAX_HISTORY_SNAPSHOTS))) {
      try {
        await fs.promises.unlink(path.join(histDir, old));
      } catch {
        // best effort
      }
    }
  } catch { /* history is best-effort */ }
}

ipcMain.handle('save-note', async (_, fileName: string, content: string, syncDir?: string) => {
  try {
    validateFileName(fileName);
    if (typeof content !== 'string') throw new Error('Content must be a string');
    const targetDir = getTargetDir(syncDir);
    const filePath = safeResolve(targetDir, fileName);
    const isNewNote = !fs.existsSync(filePath);
    await saveSnapshot(targetDir, fileName, content);
    // Atomic write: write to a tmp sibling, then rename. fs.renameSync is atomic
    // on POSIX, so a crash mid-write leaves either the old file intact or the
    // fully-written new file — never a half-written one.
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmpPath, content, 'utf-8');
    await fs.promises.rename(tmpPath, filePath);
    fullTextSearchIndex.upsertFromRaw(targetDir, fileName, content);
    if (isNewNote) {
      win?.webContents.send('refresh-notes');
    }
    return { success: true };
  } catch (error: unknown) {
    const err = error as Error;
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-note-history', async (_, fileName: string, syncDir?: string) => {
  try {
    validateFileName(fileName);
    const targetDir = getTargetDir(syncDir);
    const histDir = path.join(targetDir, '.noted_history', fileName);
    try {
      await fs.promises.access(histDir);
    } catch {
      return { success: true, data: [] };
    }
    const snapshots = (await fs.promises.readdir(histDir))
      .filter(f => f.endsWith('.html'))
      .sort()
      .reverse()
      .map(f => ({ name: f, ts: f.replace('.html', '').replace(/T/, ' ').replace(/-(\d{2})-(\d{2})-(\d{3})Z$/, '.$1.$2').replace('T', ' ') }));
    return { success: true, data: snapshots };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('read-note-snapshot', async (_, fileName: string, snapshotName: string, syncDir?: string) => {
  try {
    validateFileName(fileName);
    if (!/^[\w\-:.]+\.html$/.test(snapshotName)) throw new Error('Invalid snapshot name');
    const targetDir = getTargetDir(syncDir);
    const snapshotPath = safeResolve(targetDir, path.join('.noted_history', fileName, snapshotName));
    const content = await fs.promises.readFile(snapshotPath, 'utf-8');
    return { success: true, data: content };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('rename-note', (_, oldName: string, newName: string, syncDir?: string) => {
  try {
    validateFileName(oldName);
    validateFileName(newName);
    const targetDir = getTargetDir(syncDir);
    const oldPath = safeResolve(targetDir, oldName);
    const newPath = safeResolve(targetDir, newName);
    if (fs.existsSync(newPath)) throw new Error(`Una nota con il nome "${newName}" esiste già`);
    fs.renameSync(oldPath, newPath);
    fullTextSearchIndex.renameDoc(targetDir, oldName, newName);
    return { success: true };
  } catch (error: unknown) {
    const err = error as Error;
    return { success: false, error: err.message };
  }
});

ipcMain.handle('delete-note', (_, fileName: string, syncDir?: string) => {
  try {
    validateFileName(fileName);
    const targetDir = getTargetDir(syncDir);
    const filePath = safeResolve(targetDir, fileName);
    fs.unlinkSync(filePath);
    fullTextSearchIndex.deleteDoc(targetDir, fileName);
    return { success: true };
  } catch (error: unknown) {
    const err = error as Error;
    return { success: false, error: err.message };
  }
});

ipcMain.handle('wipe-all-notes', (_, syncDir?: string) => {
  try {
    if (syncDir !== undefined && typeof syncDir !== 'string') throw new Error('syncDir must be a string');
    const targetDir = getTargetDir(syncDir);
    
    // Delete all note files (.md) and subfolders (directories that don't start with '.')
    const entries = fs.readdirSync(targetDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(targetDir, entry.name);
      if (entry.isDirectory()) {
        fs.rmSync(fullPath, { recursive: true, force: true });
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (ext === '.md' || ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.pdf'].includes(ext)) {
          fs.unlinkSync(fullPath);
        }
      }
    }

    // Delete the history folder if it exists
    const histDir = path.join(targetDir, '.noted_history');
    if (fs.existsSync(histDir)) {
      fs.rmSync(histDir, { recursive: true, force: true });
    }

    fullTextSearchIndex.clearDir(targetDir);
    return { success: true };
  } catch (error: unknown) {
    const err = error as Error;
    return { success: false, error: err.message };
  }
});

ipcMain.handle('store-api-key', (_, plaintext: string) => {
  try {
    if (typeof plaintext !== 'string') throw new Error('API key must be a string');
    checkSafeStorageOnce();
    if (safeStorage.isEncryptionAvailable()) {
      encryptedApiKey = safeStorage.encryptString(plaintext);
    } else {
      encryptedApiKey = Buffer.from(plaintext, 'utf-8');
    }
    return { success: true };
  } catch (error: unknown) {
    const err = error as Error;
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-api-key', () => {
  try {
    if (!encryptedApiKey) return { success: true, data: '' };
    const plaintext = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(encryptedApiKey)
      : encryptedApiKey.toString('utf-8');
    return { success: true, data: plaintext };
  } catch (error: unknown) {
    const err = error as Error;
    return { success: false, error: err.message };
  }
});

ipcMain.handle('select-sync-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { success: false };
  }
  return { success: true, data: result.filePaths[0] };
});

ipcMain.handle('get-native-theme', () => ({
  isDark: nativeTheme.shouldUseDarkColors,
}));




ipcMain.handle('setup-claude-mcp', async () => {
  try {
    const homeDir = process.env.HOME || '';
    if (!homeDir) throw new Error('Impossibile determinare la cartella utente HOME');
    const claudeConfigDir = path.join(homeDir, 'Library/Application Support/Claude');
    const configPath = path.join(claudeConfigDir, 'claude_desktop_config.json');

    // Get the actual MCP server path
    const mcpPath = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'dist-mcp', 'index.cjs')
      : path.join(__dirname, '../dist-mcp/index.cjs');

    if (!fs.existsSync(mcpPath)) {
      throw new Error(`Server MCP non trovato al path: ${mcpPath}. Esegui prima il build.`);
    }

    if (!fs.existsSync(claudeConfigDir)) {
      fs.mkdirSync(claudeConfigDir, { recursive: true });
    }

    let config: { mcpServers?: Record<string, unknown> } & Record<string, unknown> = { mcpServers: {} };
    if (fs.existsSync(configPath)) {
      try {
        const raw = fs.readFileSync(configPath, 'utf-8');
        config = JSON.parse(raw);
      } catch {
        // if file is corrupted, preserve empty structure
        config = { mcpServers: {} };
      }
    }

    if (!config.mcpServers) {
      config.mcpServers = {};
    }

    config.mcpServers.noted = {
      command: 'node',
      args: [mcpPath]
    };

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

// ─── Multi-folder / notebooks ─────────────────────────────────────────────────

// Read a short body preview (Apple Notes-style) from the first few KB of a
// note, skipping the frontmatter comment and the title heading.
async function readNotePreview(filePath: string): Promise<string> {
  try {
    const fh = await fs.promises.open(filePath, 'r');
    try {
      const buf = Buffer.alloc(4096);
      const { bytesRead } = await fh.read(buf, 0, 4096, 0);
      const stripped = buf.toString('utf8', 0, bytesRead)
        .replace(/^\s*<!--noted-frontmatter:[\s\S]*?-->/i, '')  // frontmatter comment
        .replace(/^\s*#{1,6}\s+[^\n]*\n?/, '')                   // leading markdown heading
        .replace(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/i, '');        // leading HTML heading (the title)
      return stripped
        .replace(/<\/(p|div|li|h[1-6])>|<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
    } finally {
      await fh.close();
    }
  } catch {
    return '';
  }
}

async function scanNotesTree(targetDir: string) {
  interface TreeNoteEntry {
    name: string;
    path: string;
    stats: fs.Stats;
    preview: string;
  }
  interface TreeFolderResult {
    type: 'folder';
    name: string;
    notes: TreeNoteEntry[];
  }
  interface TreeRootResult {
    type: 'rootNote';
    name: string;
    path: string;
    stats: fs.Stats;
    preview: string;
  }

  const rootNotes: TreeNoteEntry[] = [];
  const folders: { name: string; notes: TreeNoteEntry[] }[] = [];

  const entries = await fs.promises.readdir(targetDir, { withFileTypes: true });
  
  const results = await Promise.all<(TreeFolderResult | TreeRootResult | null)>(entries.map(async (entry) => {
    if (entry.name.startsWith('.')) return null;
    if (entry.isDirectory()) {
      const folderPath = path.join(targetDir, entry.name);
      try {
        const files = await fs.promises.readdir(folderPath);
        const mdFiles = files.filter(f => f.endsWith('.md'));
        const folderNotes: TreeNoteEntry[] = [];
        for (const f of mdFiles) {
          const relName = `${entry.name}/${f}`;
          try {
            validateFileName(relName);
          } catch {
            continue;
          }
          try {
            const p = path.join(folderPath, f);
            const stat = await fs.promises.stat(p);
            const preview = await readNotePreview(p);
            folderNotes.push({ name: relName, path: p, stats: stat, preview });
          } catch {
            // Skip unreadable entries and continue
          }
        }
        
        folderNotes.sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs);
        return { type: 'folder', name: entry.name, notes: folderNotes };
      } catch {
        return null;
      }
    } else if (entry.name.endsWith('.md')) {
      try {
        validateFileName(entry.name);
      } catch {
        return null;
      }
      const p = path.join(targetDir, entry.name);
      try {
        const stat = await fs.promises.stat(p);
        const preview = await readNotePreview(p);
        return { type: 'rootNote', name: entry.name, path: p, stats: stat, preview };
      } catch {
        return null;
      }
    }
    return null;
  }));

  for (const res of results) {
    if (!res) continue;
    if (res.type === 'folder') {
      folders.push({ name: res.name, notes: res.notes });
    } else if (res.type === 'rootNote') {
      rootNotes.push({ name: res.name, path: res.path, stats: res.stats, preview: res.preview });
    }
  }

  rootNotes.sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs);
  return { rootNotes, folders };
}

ipcMain.handle('get-notes-tree', async (_, syncDir?: string) => {
  try {
    if (syncDir !== undefined && typeof syncDir !== 'string') throw new Error('syncDir must be a string');
    const targetDir = getTargetDir(syncDir);
    const data = await scanNotesTree(targetDir);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle('create-folder', (_, folderName: string, syncDir?: string) => {
  try {
    validateFolderName(folderName);
    const targetDir = getTargetDir(syncDir);
    const folderPath = safeResolve(targetDir, folderName);
    if (fs.existsSync(folderPath)) throw new Error(`La cartella "${folderName}" esiste già`);
    fs.mkdirSync(folderPath);
    fullTextSearchIndex.markDirty(targetDir);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle('rename-folder', (_, oldName: string, newName: string, syncDir?: string) => {
  try {
    validateFolderName(oldName);
    validateFolderName(newName);
    const targetDir = getTargetDir(syncDir);
    const oldPath = safeResolve(targetDir, oldName);
    const newPath = safeResolve(targetDir, newName);
    if (!fs.existsSync(oldPath)) throw new Error(`Cartella "${oldName}" non trovata`);
    if (fs.existsSync(newPath)) throw new Error(`Cartella "${newName}" esiste già`);
    fs.renameSync(oldPath, newPath);
    fullTextSearchIndex.markDirty(targetDir);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle('delete-folder', (_, folderName: string, syncDir?: string) => {
  try {
    validateFolderName(folderName);
    const targetDir = getTargetDir(syncDir);
    const folderPath = safeResolve(targetDir, folderName);
    if (!fs.existsSync(folderPath)) throw new Error(`Cartella "${folderName}" non trovata`);
    // Move notes to root before deleting folder
    for (const f of fs.readdirSync(folderPath).filter(f => f.endsWith('.md'))) {
      fs.renameSync(path.join(folderPath, f), safeResolve(targetDir, f));
    }
    fs.rmdirSync(folderPath);
    fullTextSearchIndex.markDirty(targetDir);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle('move-note', (_, fileName: string, toFolder: string, syncDir?: string) => {
  try {
    validateFileName(fileName);
    if (toFolder !== '') validateFolderName(toFolder);
    const targetDir = getTargetDir(syncDir);
    // fileName may already include a folder prefix
    const baseName = path.basename(fileName);
    const srcPath = safeResolve(targetDir, fileName);
    const destPath = toFolder
      ? safeResolve(targetDir, `${toFolder}/${baseName}`)
      : safeResolve(targetDir, baseName);
    if (!fs.existsSync(srcPath)) throw new Error(`Nota "${fileName}" non trovata`);
    if (fs.existsSync(destPath)) throw new Error(`Esiste già una nota "${baseName}" nella destinazione`);
    if (toFolder) {
      const folderPath = safeResolve(targetDir, toFolder);
      if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath);
    }
    fs.renameSync(srcPath, destPath);
    const movedRelPath = toFolder ? `${toFolder}/${baseName}` : baseName;
    fullTextSearchIndex.renameDoc(targetDir, fileName, movedRelPath);
    return { success: true, data: movedRelPath };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});


// ─── Export vault / Share note ───────────────────────────────────────────────

ipcMain.handle('copy-vault-to-folder', async (_, args: { destDir?: string; syncDir?: string }) => {
  try {
    const srcDir = getTargetDir(args?.syncDir);
    let destDir: string = args?.destDir ?? '';
    if (!destDir) {
      const { filePaths, canceled } = await dialog.showOpenDialog({
        title: 'Export vault to folder',
        properties: ['openDirectory', 'createDirectory'],
        buttonLabel: 'Export here',
      });
      if (canceled || !filePaths.length) return { success: false, canceled: true };
      destDir = filePaths[0];
    }
    let copied = 0;
    function copyDir(src: string, dest: string) {
      if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
      for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          copyDir(path.join(src, entry.name), path.join(dest, entry.name));
        } else if (entry.name.endsWith('.md')) {
          fs.copyFileSync(path.join(src, entry.name), path.join(dest, entry.name));
          copied++;
        }
      }
    }
    copyDir(srcDir, destDir);
    return { success: true, data: { copied, destDir } };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle('share-note-macos', async (_, args: { content: string; title: string }) => {
  try {
    const { exec } = await import('node:child_process');
    const os = await import('node:os');
    const safeName = (args.title || 'note').replace(/[^a-zA-Z0-9\-_ ]/g, '_');
    const tempFile = path.join(os.tmpdir(), `${safeName}.md`);
    fs.writeFileSync(tempFile, args.content ?? '', 'utf-8');

    const script = [
      'use framework "AppKit"',
      'use scripting additions',
      `set theURL to current application's NSURL's fileURLWithPath:"${tempFile.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
      "set picker to current application's NSSharingServicePicker's alloc()'s initWithItems:{theURL}",
      "set v to current application's NSApp's keyWindow()'s contentView()",
      "picker's showRelativeTo:(current application's NSMakeRect(0, 0, 1, 1)) ofView:v preferredEdge:2",
    ].join('\n');

    const scriptFile = path.join(os.tmpdir(), 'noted-share.applescript');
    fs.writeFileSync(scriptFile, script, 'utf-8');

    return new Promise<{ success: boolean; fallback?: boolean; error?: string }>((resolve) => {
      exec(`osascript "${scriptFile}"`, (err) => {
        if (err) {
          shell.showItemInFolder(tempFile);
          resolve({ success: true, fallback: true });
        } else {
          resolve({ success: true });
        }
      });
    });
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

// Proxy LLM HTTP requests from renderer — avoids CORS/CSP issues.
// Hard timeout in main so a slow/hung provider can't hang the renderer.
const LLM_FETCH_TIMEOUT_MS = 60_000;
const LLM_FETCH_MAX_BODY_BYTES = 10 * 1024 * 1024; // cap response size at 10 MB

// SSRF guard: enforce http(s) via URL parsing and block the classic exfil
// targets (cloud metadata + link-local). Public provider APIs and localhost/LAN
// LLM endpoints (LM Studio / Ollama) stay allowed, so real setups keep working.
function assertFetchAllowed(rawUrl: string): void {
  let u: URL;
  try { u = new URL(rawUrl); } catch { throw new Error('Invalid URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http(s) URLs are allowed');
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === '169.254.169.254' ||          // AWS/GCP/Azure IMDS
    host === 'metadata.google.internal' ||
    host === 'metadata' ||
    host === 'fd00:ec2::254' ||             // AWS IMDSv2 (IPv6)
    host.startsWith('169.254.') ||          // IPv4 link-local
    host.startsWith('fe80:')                // IPv6 link-local
  ) {
    throw new Error('Blocked host (link-local / cloud metadata)');
  }
}

ipcMain.handle('llm-fetch', async (_, url: string, options: { method: string; headers: Record<string, string>; body: string }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_FETCH_TIMEOUT_MS);
  try {
    if (typeof url !== 'string') throw new Error('Invalid URL');
    assertFetchAllowed(url);
    const isGet = options.method.toUpperCase() === 'GET';
    const res = await fetch(url, {
      method: options.method,
      headers: options.headers,
      body: isGet ? undefined : (options.body || undefined),
      signal: controller.signal,
    });
    // Stream-decode but cap total bytes to avoid OOM if a provider returns
    // an unbounded response (e.g. infinite SSE).
    const reader = res.body?.getReader();
    let text = '';
    if (reader) {
      const decoder = new TextDecoder('utf-8');
      let total = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > LLM_FETCH_MAX_BODY_BYTES) {
          await reader.cancel();
          throw new Error('Response exceeded 10 MB cap');
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } else {
      text = await res.text();
    }
    return { ok: res.ok, status: res.status, text };
  } catch (err: unknown) {
    const e = err as Error & { name?: string };
    const msg = e.name === 'AbortError' ? `Timeout dopo ${LLM_FETCH_TIMEOUT_MS / 1000}s` : e.message;
    return { ok: false, status: 0, text: msg };
  } finally {
    clearTimeout(timer);
  }
});

ipcMain.handle('set-note-title', (_, noteName: string) => {
  if (!win) return;
  const title = noteName ? `${noteName.replace(/\.md$/, '')} — Noted` : 'Noted';
  win.setTitle(title);
});

ipcMain.handle('safe-storage-status', () => {
  return { encrypted: safeStorage.isEncryptionAvailable() };
});

ipcMain.handle('git-store-token', (_, plaintext: string) => {
  try {
    checkSafeStorageOnce();
    if (safeStorage.isEncryptionAvailable()) {
      encryptedGhToken = safeStorage.encryptString(plaintext);
    } else {
      encryptedGhToken = Buffer.from(plaintext, 'utf-8');
    }
    return { success: true };
  } catch (err) { return { success: false, error: (err as Error).message }; }
});

ipcMain.handle('git-get-token', () => {
  try {
    if (!encryptedGhToken) return { success: true, data: '' };
    const plaintext = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(encryptedGhToken)
      : encryptedGhToken.toString('utf-8');
    return { success: true, data: plaintext };
  } catch (err) { return { success: false, error: (err as Error).message }; }
});

// ─── Full-text search ─────────────────────────────────────────────────────────

ipcMain.handle('search-notes-fulltext', async (_, query: string, syncDir?: string) => {
  const reqId = newRequestId('search-ft');
  if (!query || query.trim().length < 2) return { success: true, data: [] };
  const dir = getTargetDir(syncDir);
  const { results, truncated } = await fullTextSearchIndex.search(dir, query, (name) => validateFileName(name));
  logEvent('info', 'search_fulltext_completed', {
    reqId,
    queryLen: query.length,
    resultCount: results.length,
    truncated,
  });
  return { success: true, data: results, truncated };
});

// ─── Git IPC ──────────────────────────────────────────────────────────────────

ipcMain.handle('git-status', async (_, syncDir?: string) => {
  const dir = getTargetDir(syncDir);
  return gitOps.getStatus(dir);
});

ipcMain.handle('git-init', async (_, syncDir?: string) => {
  const dir = getTargetDir(syncDir);
  return gitOps.initRepo(dir);
});

ipcMain.handle('git-commit-note', async (_, noteName: string, message: string | undefined, syncDir?: string) => {
  if (!noteName || typeof noteName !== 'string') return { success: false, error: 'Note name required' };
  try { validateFileName(noteName); } catch (e) { return { success: false, error: (e as Error).message }; }
  const dir = getTargetDir(syncDir);
  return gitOps.commitNote(dir, noteName, message);
});

ipcMain.handle('git-commit-all', async (_, message: string, syncDir?: string) => {
  if (!message || typeof message !== 'string') return { success: false, error: 'Commit message required' };
  const dir = getTargetDir(syncDir);
  return gitOps.commitAll(dir, message);
});

ipcMain.handle('git-prepare-pr-branch', async (_, noteName: string, commitMessage: string | undefined, syncDir?: string) => {
  if (!noteName || typeof noteName !== 'string') return { success: false, error: 'Note name required' };
  try { validateFileName(noteName); } catch (e) { return { success: false, error: (e as Error).message }; }
  const dir = getTargetDir(syncDir);
  return gitOps.preparePrBranch(dir, noteName, commitMessage);
});

ipcMain.handle('git-push-branch', async (_, branch: string, remoteUrl: string, syncDir?: string) => {
  if (!branch || !remoteUrl) return { success: false, error: 'branch and remoteUrl required' };
  const dir = getTargetDir(syncDir);
  return gitOps.pushBranch(dir, branch, remoteUrl);
});

ipcMain.handle('git-log', async (_, noteName: string | undefined, syncDir?: string) => {
  const dir = getTargetDir(syncDir);
  return gitOps.getLog(dir, noteName);
});

ipcMain.handle('git-create-pr', async (_, params: {
  remoteUrl: string; token: string; branch: string; base: string; title: string; body: string;
}) => {
  const reqId = newRequestId('git-pr');
  if (!params || typeof params !== 'object') return { success: false, error: 'Invalid params' };
  const res = await gitOps.createGitHubPr(params);
  logEvent('info', 'git_create_pr_completed', {
    reqId,
    success: !!res.success,
    branch: params.branch,
    base: params.base,
  });
  return res;
});

ipcMain.handle('git-save-as-gist', async (_, params: {
  fileName: string; content: string; isPublic: boolean; token: string;
}) => {
  if (!params?.token) return { success: false, error: 'GitHub token required' };
  if (!params.content) return { success: false, error: 'Content required' };
  const safeName = path.basename(params.fileName || 'note.md');
  const body = JSON.stringify({
    description: safeName.replace(/\.md$/, ''),
    public: !!params.isPublic,
    files: { [safeName]: { content: params.content } },
  });
  try {
    const res = await fetch('https://api.github.com/gists', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${params.token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body,
    });
    const json = await res.json() as { html_url?: string; message?: string };
    if (!res.ok) return { success: false, error: sanitizeGitError(json.message ?? `HTTP ${res.status}`) };
    return { success: true, data: json.html_url };
  } catch (e) {
    return { success: false, error: sanitizeGitError((e as Error).message) };
  }
});
