import { app, BrowserWindow, ipcMain, dialog, safeStorage, globalShortcut, nativeTheme, protocol, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { exec, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import TurndownService from 'turndown';
import { validateFileName, validateFolderName, stripUnsafeHtml, formatAppleNoteToMarkdown } from './ipc-utils.js';
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
  DEFAULT_NOTES_DIR = app.isPackaged
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
      targetDir
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
    await saveSnapshot(targetDir, fileName, content);
    // Atomic write: write to a tmp sibling, then rename. fs.renameSync is atomic
    // on POSIX, so a crash mid-write leaves either the old file intact or the
    // fully-written new file — never a half-written one.
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmpPath, content, 'utf-8');
    await fs.promises.rename(tmpPath, filePath);
    fullTextSearchIndex.upsertFromRaw(targetDir, fileName, content);
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
    const snapshotPath = path.join(targetDir, '.noted_history', fileName, snapshotName);
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

ipcMain.handle('export-markdown', async (_, markdownContent: string) => {
  try {
    if (typeof markdownContent !== 'string') throw new Error('Content must be a string');
    const { filePath } = await dialog.showSaveDialog({
      title: 'Esporta come Markdown',
      defaultPath: 'Nota.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (!filePath) return { success: false, error: 'Esportazione annullata' };
    fs.writeFileSync(filePath, markdownContent, 'utf-8');
    return { success: true, data: filePath };
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

ipcMain.handle('export-pdf', async (event, htmlContent: string) => {
  try {
    if (typeof htmlContent !== 'string') throw new Error('htmlContent must be a string');
    if (htmlContent.length > 5_000_000) throw new Error('Content too large for PDF export');
    // Show save dialog
    const { filePath } = await dialog.showSaveDialog({
      title: 'Esporta come PDF',
      defaultPath: 'Nota.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });

    if (!filePath) {
      return { success: false, error: 'Esportazione annullata' };
    }

    // Create a hidden browser window to render the HTML
    const pdfWin = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    try {
      const safeContent = stripUnsafeHtml(htmlContent);
      const styledHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 40px; line-height: 1.6; color: #333; }
              h1, h2, h3 { color: #111; }
              code { background-color: #f4f4f4; padding: 2px 4px; border-radius: 4px; font-family: monospace; }
              pre { background-color: #f4f4f4; padding: 16px; border-radius: 8px; overflow-x: auto; }
              blockquote { border-left: 4px solid #ddd; padding-left: 16px; color: #666; }
              img { max-width: 100%; height: auto; border-radius: 8px; }
            </style>
          </head>
          <body>
            ${safeContent}
          </body>
        </html>
      `;

      await pdfWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(styledHtml)}`);

      const pdfBuffer = await pdfWin.webContents.printToPDF({
        printBackground: true,
        margins: { marginType: 'printableArea' }
      });

      fs.writeFileSync(filePath, pdfBuffer);
      return { success: true, data: filePath };
    } finally {
      pdfWin.close();
    }
  } catch (error: unknown) {
    const err = error as Error;
    logEvent('error', 'export_pdf_failed', { error: err.message });
    return { success: false, error: err.message };
  }
});


ipcMain.handle('print-note', async (_event, htmlContent: string, title?: string) => {
  try {
    if (typeof htmlContent !== 'string') throw new Error('htmlContent must be a string');
    if (htmlContent.length > 5_000_000) throw new Error('Content too large to print');

    const printWin = new BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    try {
      const safeContent = stripUnsafeHtml(htmlContent);
      const safeTitle = (title ?? 'Nota').replace(/[<>]/g, '');
      const styledHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <title>${safeTitle}</title>
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 40px; line-height: 1.6; color: #222; }
              h1, h2, h3 { color: #111; }
              code { background-color: #f4f4f4; padding: 2px 4px; border-radius: 4px; font-family: monospace; }
              pre { background-color: #f4f4f4; padding: 16px; border-radius: 8px; overflow-x: auto; }
              blockquote { border-left: 4px solid #ddd; padding-left: 16px; color: #555; }
              img { max-width: 100%; height: auto; }
              table { border-collapse: collapse; }
              th, td { border: 1px solid #ccc; padding: 4px 8px; }
            </style>
          </head>
          <body>${safeContent}</body>
        </html>
      `;

      await printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(styledHtml)}`);

      await new Promise<void>((resolve, reject) => {
        printWin.webContents.print(
          { silent: false, printBackground: true },
          (success, failureReason) => {
            if (!success && failureReason && failureReason !== 'cancelled') {
              reject(new Error(failureReason));
            } else {
              resolve();
            }
          }
        );
      });

      return { success: true };
    } finally {
      printWin.close();
    }
  } catch (error: unknown) {
    const err = error as Error;
    logEvent('error', 'print_note_failed', { error: err.message });
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-native-theme', () => ({
  isDark: nativeTheme.shouldUseDarkColors,
}));

ipcMain.handle('export-html', async (_, htmlContent: string, noteTitle: string) => {
  try {
    if (typeof htmlContent !== 'string') throw new Error('htmlContent must be a string');
    const { filePath } = await dialog.showSaveDialog({
      title: 'Esporta come HTML',
      defaultPath: `${noteTitle || 'Nota'}.html`,
      filters: [{ name: 'HTML', extensions: ['html'] }],
    });
    if (!filePath) return { success: false, error: 'Esportazione annullata' };
    const safe = stripUnsafeHtml(htmlContent);
    const full = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${noteTitle}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; max-width: 800px; margin: 60px auto; padding: 0 24px; line-height: 1.7; color: #1a1a1a; }
    h1,h2,h3 { font-weight: 700; margin-top: 1.5em; }
    code { background: #f3f4f6; padding: 2px 5px; border-radius: 4px; font-family: monospace; }
    pre { background: #f3f4f6; padding: 1em; border-radius: 8px; overflow-x: auto; }
    img { max-width: 100%; border-radius: 8px; }
    blockquote { border-left: 4px solid #e5e7eb; padding-left: 1em; color: #6b7280; }
    table { border-collapse: collapse; width: 100%; }
    td,th { border: 1px solid #e5e7eb; padding: 8px 12px; }
    th { background: #f9fafb; font-weight: 600; }
  </style>
</head>
<body>${safe}</body>
</html>`;
    fs.writeFileSync(filePath, full, 'utf-8');
    return { success: true, data: filePath };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

function importVaultRecursive(srcRoot: string, srcDir: string, destRoot: string): number {
  let imported = 0;
  if (!fs.existsSync(srcDir)) return 0;
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    if (entry.name.startsWith('.')) continue; // ignore hidden folders

    if (entry.isDirectory()) {
      imported += importVaultRecursive(srcRoot, srcPath, destRoot);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      const isMarkdown = ext === '.md';
      const isMedia = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.pdf'].includes(ext);
      if (!isMarkdown && !isMedia) continue;

      const relPath = path.relative(srcRoot, srcPath);
      const dirName = path.dirname(relPath);
      
      let destPath: string;
      if (dirName === '.') {
        destPath = path.join(destRoot, entry.name);
      } else {
        // Flatten folder structure to 1-level of folder (e.g. "Folder-Subfolder")
        const flattenedFolder = dirName
          .replace(/[/\\]/g, '-')
          // eslint-disable-next-line no-control-regex
          .replace(/[\x00-\x1F\x7F\\/:*?"<>|;`$]/g, '')
          .trim();
        const folderPath = path.join(destRoot, flattenedFolder);
        if (!fs.existsSync(folderPath)) {
          fs.mkdirSync(folderPath, { recursive: true });
        }
        destPath = path.join(folderPath, entry.name);
      }

      if (!fs.existsSync(destPath)) {
        fs.copyFileSync(srcPath, destPath);
        imported++;
      }
    }
  }
  return imported;
}

ipcMain.handle('import-vault', async (_, targetDir?: string) => {
  const reqId = newRequestId('import-vault');
  try {
    const { filePaths, canceled } = await dialog.showOpenDialog({
      title: 'Importa vault (Obsidian / Bear / cartella Markdown)',
      properties: ['openDirectory'],
    });
    if (canceled || !filePaths.length) return { success: false, error: 'Annullato' };
    const srcDir = filePaths[0];
    const dest = targetDir && fs.existsSync(targetDir) ? targetDir : DEFAULT_NOTES_DIR;
    const importedCount = importVaultRecursive(srcDir, srcDir, dest);
    fullTextSearchIndex.markDirty(dest);
    logEvent('info', 'import_vault_completed', { reqId, importedCount, destDir: dest });
    return { success: true, data: importedCount };
  } catch (err) {
    logEvent('error', 'import_vault_failed', { reqId, error: (err as Error).message });
    return { success: false, error: (err as Error).message };
  }
});

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

ipcMain.handle('import-apple-notes', async (_, targetDir?: string) => {
  const reqId = newRequestId('import-apple');
  try {
    const dest = targetDir && fs.existsSync(targetDir) ? targetDir : DEFAULT_NOTES_DIR;
    
    // Execute JXA script to fetch notes
    const jxaScript = `
      const notesApp = Application("Notes");
      const results = [];
      const folders = notesApp.folders();
      for (let i = 0; i < folders.length; i++) {
        const folder = folders[i];
        const folderName = folder.name();
        if (folderName === "Recently Deleted") continue;
        const notes = folder.notes();
        for (let j = 0; j < notes.length; j++) {
          const note = notes[j];
          results.push({
            folder: folderName,
            title: note.name() || "Untitled Note",
            body: note.body() || "",
            creationDate: note.creationDate() ? note.creationDate().toISOString() : null,
            modificationDate: note.modificationDate() ? note.modificationDate().toISOString() : null
          });
        }
      }
      JSON.stringify(results);
    `;

    return new Promise((resolve) => {
      const child = exec('osascript -l JavaScript', { maxBuffer: 1024 * 1024 * 100 }, (error, stdout, stderr) => {
        if (error) {
          logEvent('error', 'import_apple_exec_failed', { reqId, error: error.message || stderr });
          resolve({ success: false, error: error.message || stderr });
          return;
        }

        try {
          const rawNotes = JSON.parse(stdout) as {
            folder: string;
            title: string;
            body: string;
            creationDate: string | null;
            modificationDate: string | null;
          }[];

          /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/prefer-for-of */
          const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

          // Add span rule to format rich text styles (bold, italic, strikethrough, underline)
          turndown.addRule('span', {
            filter: 'span',
            replacement: function (content, node: any) {
              let result = content;
              const style = node.getAttribute('style') || '';
              
              // Bold
              if (style.includes('font-weight: bold') || style.includes('font-weight:bold') || style.includes('font-weight: 700') || style.includes('font-weight:700')) {
                result = '**' + result + '**';
              }
              // Italic
              if (style.includes('font-style: italic') || style.includes('font-style:italic')) {
                result = '*' + result + '*';
              }
              // Strikethrough
              if (style.includes('text-decoration: line-through') || style.includes('text-decoration:line-through')) {
                result = '~~' + result + '~~';
              }
              // Underline
              if (style.includes('text-decoration: underline') || style.includes('text-decoration:underline')) {
                result = '<u>' + result + '</u>';
              }
              
              return result;
            }
          });

          // Add div rule to handle single line breaks instead of double newlines
          turndown.addRule('div', {
            filter: 'div',
            replacement: function (content, node: any) {
              // Avoid adding extra linebreaks inside list items, pre, code, blockquotes
              let parent = node.parentNode;
              while (parent) {
                const tag = parent.nodeName?.toLowerCase();
                if (tag === 'li' || tag === 'pre' || tag === 'code' || tag === 'blockquote') {
                  return content;
                }
                parent = parent.parentNode;
              }
              return '\n' + content + '\n';
            }
          });

          // Add table rules to support Markdown table imports
          turndown.addRule('table', {
            filter: 'table',
            replacement: function (content) {
              const cleanContent = content.split('\n').filter((line: string) => line.trim() !== '').join('\n');
              return '\n\n' + cleanContent + '\n\n';
            }
          });

          turndown.addRule('thead-tbody-tfoot', {
            filter: ['thead', 'tbody', 'tfoot'],
            replacement: function (content) {
              return content;
            }
          });

          turndown.addRule('tr', {
            filter: 'tr',
            replacement: function (content, node: any) {
              let tableNode = node;
              while (tableNode && tableNode.nodeName?.toUpperCase() !== 'TABLE') {
                tableNode = tableNode.parentNode;
              }
              
              function getTrElements(element: any) {
                const trs: any[] = [];
                function traverse(n: any) {
                  if (n.nodeName?.toUpperCase() === 'TR') {
                    trs.push(n);
                  } else if (n.childNodes) {
                    for (let i = 0; i < n.childNodes.length; i++) {
                      traverse(n.childNodes[i]);
                    }
                  }
                }
                traverse(element);
                return trs;
              }
              
              function hasThDirectChild(trNode: any) {
                if (!trNode.childNodes) return false;
                for (let i = 0; i < trNode.childNodes.length; i++) {
                  if (trNode.childNodes[i].nodeName?.toUpperCase() === 'TH') {
                    return true;
                  }
                }
                return false;
              }
              
              function getCellCount(trNode: any) {
                let count = 0;
                if (!trNode.childNodes) return 0;
                for (let i = 0; i < trNode.childNodes.length; i++) {
                  const name = trNode.childNodes[i].nodeName?.toUpperCase();
                  if (name === 'TH' || name === 'TD') {
                    count++;
                  }
                }
                return count;
              }

              const allRows = tableNode ? getTrElements(tableNode) : [];
              const isFirstRow = allRows[0] === node;
              const hasTh = hasThDirectChild(node);
              const isHeader = hasTh || (isFirstRow && !hasTh);

              let separator = '';
              if (isHeader) {
                const cellCount = getCellCount(node);
                separator = '\n|' + Array(cellCount).fill(' --- ').join('|') + '|';
              }
              return '\n|' + content + separator;
            }
          });

          turndown.addRule('td-or-th', {
            filter: ['td', 'th'],
            replacement: function (content) {
              const cleanContent = content.trim().replace(/\n/g, ' ').replace(/\|/g, '\\|');
              return ' ' + cleanContent + ' |';
            }
          });

          let imported = 0;

          for (const note of rawNotes) {
            // Clean up the note title for file name (aligning with validateFileName character set)
            let fileName = note.title
              .replace(/[\\/:*?"<>|;`$]/g, '-')
              // eslint-disable-next-line no-control-regex
              .replace(/[\x00-\x1F\x7F]/g, '')
              .trim();
            if (!fileName) fileName = 'Untitled Note';
            
            // Keep folder structure (1-level limit in Noted, aligning with validateFolderName character set)
            const folderName = note.folder
              .replace(/[\\/:*?"<>|;`$]/g, '-')
              // eslint-disable-next-line no-control-regex
              .replace(/[\x00-\x1F\x7F]/g, '')
              .trim();
            
            let destPath = '';
            if (folderName && folderName !== 'Notes') {
              const folderPath = path.join(dest, folderName);
              if (!fs.existsSync(folderPath)) {
                fs.mkdirSync(folderPath, { recursive: true });
              }
              destPath = path.join(folderPath, `${fileName}.md`);
            } else {
              destPath = path.join(dest, `${fileName}.md`);
            }

            // If file already exists, make filename unique (e.g. "Note_1.md")
            let finalDestPath = destPath;
            let counter = 1;
            const ext = '.md';
            const baseDir = path.dirname(destPath);
            const baseName = path.basename(destPath, ext);
            
            while (fs.existsSync(finalDestPath)) {
              finalDestPath = path.join(baseDir, `${baseName}_${counter}${ext}`);
              counter++;
            }

            const fm = formatAppleNoteToMarkdown(
              note.title,
              note.body,
              note.creationDate,
              note.modificationDate,
              turndown
            );

            fs.writeFileSync(finalDestPath, fm, 'utf-8');
            imported++;
          }
          /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/prefer-for-of */

          fullTextSearchIndex.markDirty(dest);
          logEvent('info', 'import_apple_completed', { reqId, imported, destDir: dest });
          resolve({ success: true, data: imported });
        } catch (err) {
          logEvent('error', 'import_apple_parse_failed', { reqId, error: (err as Error).message });
          resolve({ success: false, error: `Parse error: ${(err as Error).message}` });
        }
      });

      child.stdin?.write(jxaScript);
      child.stdin?.end();
    });
  } catch (err) {
    logEvent('error', 'import_apple_failed', { reqId, error: (err as Error).message });
    return { success: false, error: (err as Error).message };
  }
});

// ─── DOCX export ─────────────────────────────────────────────────────────────
ipcMain.handle('export-docx', async (_, htmlContent: string, noteTitle: string) => {
  try {
    if (typeof htmlContent !== 'string') throw new Error('htmlContent must be a string');
    const { filePath } = await dialog.showSaveDialog({
      title: 'Esporta come DOCX',
      defaultPath: `${noteTitle || 'Nota'}.docx`,
      filters: [{ name: 'Word Document', extensions: ['docx'] }],
    });
    if (!filePath) return { success: false, error: 'Esportazione annullata' };

    const safe = stripUnsafeHtml(htmlContent);
    // Dynamic import — html-to-docx is CJS
    const { default: HTMLtoDOCX } = await import('html-to-docx') as { default: (html: string, header: null, opts: object) => Promise<Buffer> };
    const buf = await HTMLtoDOCX(
      `<!DOCTYPE html><html><body>${safe}</body></html>`,
      null,
      { title: noteTitle, font: 'Helvetica Neue', fontSize: 24, table: { row: { cantSplit: true } } }
    );
    fs.writeFileSync(filePath, buf);
    return { success: true, data: filePath };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

// ─── Multi-folder / notebooks ─────────────────────────────────────────────────

async function scanNotesTree(targetDir: string) {
  interface TreeNoteEntry {
    name: string;
    path: string;
    stats: fs.Stats;
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
            folderNotes.push({ name: relName, path: p, stats: stat });
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
        return { type: 'rootNote', name: entry.name, path: p, stats: stat };
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
      rootNotes.push({ name: res.name, path: res.path, stats: res.stats });
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

ipcMain.handle('get-icloud-path', () => {
  try {
    const home = app.getPath('home');
    const icloudPath = path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Noted');
    if (!fs.existsSync(icloudPath)) fs.mkdirSync(icloudPath, { recursive: true });
    return { success: true, data: icloudPath };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

// ─── Cloud provider detection ────────────────────────────────────────────────

ipcMain.handle('detect-cloud-providers', () => {
  const home = app.getPath('home');
  const cloudStorageBase = path.join(home, 'Library', 'CloudStorage');

  function firstMatch(candidates: string[]): string | null {
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    // glob-style: check CloudStorage subdirs
    return null;
  }

  function findGoogleDrive(): string | null {
    if (!fs.existsSync(cloudStorageBase)) return null;
    const entries = fs.readdirSync(cloudStorageBase);
    const gdEntry = entries.find(e => e.startsWith('GoogleDrive-'));
    if (!gdEntry) return null;
    const myDrive = path.join(cloudStorageBase, gdEntry, 'My Drive');
    return fs.existsSync(myDrive) ? myDrive : path.join(cloudStorageBase, gdEntry);
  }

  function findOneDrive(): string | null {
    const candidates = [
      path.join(home, 'OneDrive'),
      path.join(home, 'OneDrive - Personal'),
      path.join(cloudStorageBase, 'OneDrive-Personal'),
    ];
    const direct = firstMatch(candidates);
    if (direct) return direct;
    if (!fs.existsSync(cloudStorageBase)) return null;
    const entries = fs.readdirSync(cloudStorageBase);
    const od = entries.find(e => e.startsWith('OneDrive-'));
    return od ? path.join(cloudStorageBase, od) : null;
  }

  const iCloudBase = path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
  const gdBase = findGoogleDrive();
  const dbBase = firstMatch([path.join(home, 'Dropbox')]);
  const odBase = findOneDrive();

  type ProviderId = 'icloud' | 'googledrive' | 'dropbox' | 'onedrive';
  const providers: { id: ProviderId; name: string; basePath: string; notedPath: string; available: boolean }[] = [
    {
      id: 'icloud',
      name: 'iCloud Drive',
      basePath: iCloudBase,
      notedPath: path.join(iCloudBase, 'Noted'),
      available: fs.existsSync(iCloudBase),
    },
    {
      id: 'googledrive',
      name: 'Google Drive',
      basePath: gdBase ?? '',
      notedPath: gdBase ? path.join(gdBase, 'Noted') : '',
      available: !!gdBase,
    },
    {
      id: 'dropbox',
      name: 'Dropbox',
      basePath: dbBase ?? '',
      notedPath: dbBase ? path.join(dbBase, 'Noted') : '',
      available: !!dbBase,
    },
    {
      id: 'onedrive',
      name: 'OneDrive',
      basePath: odBase ?? '',
      notedPath: odBase ? path.join(odBase, 'Noted') : '',
      available: !!odBase,
    },
  ];

  return { success: true, data: providers };
});

ipcMain.handle('activate-cloud-provider', (_, notedPath: string) => {
  try {
    if (!fs.existsSync(notedPath)) fs.mkdirSync(notedPath, { recursive: true });
    return { success: true, data: notedPath };
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

ipcMain.handle('llm-fetch', async (_, url: string, options: { method: string; headers: Record<string, string>; body: string }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_FETCH_TIMEOUT_MS);
  try {
    if (typeof url !== 'string' || !url.startsWith('http')) throw new Error('Invalid URL');
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
