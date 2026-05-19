import { app, BrowserWindow, ipcMain, dialog, safeStorage, globalShortcut, nativeTheme, protocol, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { validateFileName, validateFolderName, stripUnsafeHtml } from './ipc-utils.js';
import * as gitOps from './git-ops.js';
import { sanitizeGitError } from './git-ops.js';

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
    console.warn(
      '[safeStorage] OS encryption not available — API keys and Git tokens ' +
      'will be held in process memory only (not persisted across restarts). ' +
      'On Linux, install libsecret/gnome-keyring to enable encrypted storage.'
    );
  }
}

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

  // Forward native theme changes to renderer
  nativeTheme.on('updated', () => {
    win?.webContents.send('native-theme-updated', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    // Use custom app:// scheme — bypasses ES-module-from-file:// issues inside asar
    win.loadURL('app://./index.html');
  }
}

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
    const content = `<p>${text.replace(/\n/g, '</p><p>')}</p>`;
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
  globalShortcut.unregisterAll();
});

// Example IPC handler for the magical stuff
ipcMain.handle('ping', () => 'pong');

// FS IPC Handlers
ipcMain.handle('get-notes-list', (_, syncDir?: string) => {
  try {
    if (syncDir !== undefined && typeof syncDir !== 'string') throw new Error('syncDir must be a string');
    const targetDir = getTargetDir(syncDir);
    const files = fs.readdirSync(targetDir)
      .filter(f => f.endsWith('.md'))
      .map(f => ({
        name: f,
        path: path.join(targetDir, f),
        stats: fs.statSync(path.join(targetDir, f))
      }))
      .sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs); // Sort by modified time
    return { success: true, data: files };
  } catch (error: unknown) {
    const err = error as Error;
    return { success: false, error: err.message };
  }
});

ipcMain.handle('read-note', (_, fileName: string, syncDir?: string) => {
  try {
    validateFileName(fileName);
    const targetDir = getTargetDir(syncDir);
    const filePath = safeResolve(targetDir, fileName);
    const content = fs.readFileSync(filePath, 'utf-8');
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

function saveSnapshot(targetDir: string, fileName: string, content: string) {
  try {
    const histDir = path.join(targetDir, '.noted_history', fileName);
    if (!fs.existsSync(histDir)) fs.mkdirSync(histDir, { recursive: true });

    // Compare against the most recent snapshot; skip the write if the delta is
    // small AND we snapshot-ed recently.
    const existing = fs.readdirSync(histDir).filter(f => f.endsWith('.html')).sort();
    if (existing.length > 0) {
      const latest = existing[existing.length - 1];
      const latestPath = path.join(histDir, latest);
      let prevContent = '';
      try { prevContent = fs.readFileSync(latestPath, 'utf-8'); } catch { /* ignore */ }
      const diff = Math.abs(prevContent.length - content.length);
      let ageMs = Infinity;
      try { ageMs = Date.now() - fs.statSync(latestPath).mtimeMs; } catch { /* ignore */ }
      if (diff < SNAPSHOT_MIN_DIFF_CHARS && ageMs < SNAPSHOT_MIN_INTERVAL_MS) {
        return; // not worth a new snapshot
      }
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(histDir, `${ts}.html`), content, 'utf-8');
    // Prune oldest beyond limit (re-list since we may have just added one).
    const snapshots = fs.readdirSync(histDir).filter(f => f.endsWith('.html')).sort();
    for (const old of snapshots.slice(0, Math.max(0, snapshots.length - MAX_HISTORY_SNAPSHOTS))) {
      fs.unlinkSync(path.join(histDir, old));
    }
  } catch { /* history is best-effort */ }
}

ipcMain.handle('save-note', (_, fileName: string, content: string, syncDir?: string) => {
  try {
    validateFileName(fileName);
    if (typeof content !== 'string') throw new Error('Content must be a string');
    const targetDir = getTargetDir(syncDir);
    const filePath = safeResolve(targetDir, fileName);
    saveSnapshot(targetDir, fileName, content);
    // Atomic write: write to a tmp sibling, then rename. fs.renameSync is atomic
    // on POSIX, so a crash mid-write leaves either the old file intact or the
    // fully-written new file — never a half-written one.
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, filePath);
    return { success: true };
  } catch (error: unknown) {
    const err = error as Error;
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-note-history', (_, fileName: string, syncDir?: string) => {
  try {
    validateFileName(fileName);
    const targetDir = getTargetDir(syncDir);
    const histDir = path.join(targetDir, '.noted_history', fileName);
    if (!fs.existsSync(histDir)) return { success: true, data: [] };
    const snapshots = fs.readdirSync(histDir)
      .filter(f => f.endsWith('.html'))
      .sort()
      .reverse()
      .map(f => ({ name: f, ts: f.replace('.html', '').replace(/T/, ' ').replace(/-(\d{2})-(\d{2})-(\d{3})Z$/, '.$1.$2').replace('T', ' ') }));
    return { success: true, data: snapshots };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('read-note-snapshot', (_, fileName: string, snapshotName: string, syncDir?: string) => {
  try {
    validateFileName(fileName);
    if (!/^[\w\-:.]+\.html$/.test(snapshotName)) throw new Error('Invalid snapshot name');
    const targetDir = getTargetDir(syncDir);
    const snapshotPath = path.join(targetDir, '.noted_history', fileName, snapshotName);
    const content = fs.readFileSync(snapshotPath, 'utf-8');
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
    console.error('PDF Export Error:', err);
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
    console.error('Print Error:', err);
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

ipcMain.handle('import-vault', async (_, targetDir?: string) => {
  try {
    const { filePaths, canceled } = await dialog.showOpenDialog({
      title: 'Importa vault (Obsidian / Bear / cartella Markdown)',
      properties: ['openDirectory'],
    });
    if (canceled || !filePaths.length) return { success: false, error: 'Annullato' };
    const srcDir = filePaths[0];
    const dest = targetDir && fs.existsSync(targetDir) ? targetDir : DEFAULT_NOTES_DIR;
    const mdFiles = fs.readdirSync(srcDir).filter(f => f.endsWith('.md'));
    let imported = 0;
    for (const f of mdFiles) {
      const destPath = path.join(dest, f);
      if (!fs.existsSync(destPath)) {
        fs.copyFileSync(path.join(srcDir, f), destPath);
        imported++;
      }
    }
    return { success: true, data: imported };
  } catch (err) {
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

function scanNotesTree(targetDir: string) {
  const rootNotes: object[] = [];
  const folders: { name: string; notes: object[] }[] = [];

  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) {
      const folderPath = path.join(targetDir, entry.name);
      const folderNotes = fs.readdirSync(folderPath)
        .filter(f => f.endsWith('.md'))
        .map(f => {
          const p = path.join(folderPath, f);
          return { name: `${entry.name}/${f}`, path: p, stats: fs.statSync(p) };
        })
        .sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs);
      folders.push({ name: entry.name, notes: folderNotes });
    } else if (entry.name.endsWith('.md')) {
      const p = path.join(targetDir, entry.name);
      rootNotes.push({ name: entry.name, path: p, stats: fs.statSync(p) });
    }
  }
  rootNotes.sort((a: { stats: { mtimeMs: number } }, b: { stats: { mtimeMs: number } }) => b.stats.mtimeMs - a.stats.mtimeMs);
  return { rootNotes, folders };
}

ipcMain.handle('get-notes-tree', (_, syncDir?: string) => {
  try {
    if (syncDir !== undefined && typeof syncDir !== 'string') throw new Error('syncDir must be a string');
    const targetDir = getTargetDir(syncDir);
    return { success: true, data: scanNotesTree(targetDir) };
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
    return { success: true, data: toFolder ? `${toFolder}/${baseName}` : baseName };
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

function stripHtmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?(p|h[1-6]|li|div|blockquote)[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

interface FtSearchResult {
  relPath: string;
  title: string;
  snippet: string;
  score: number;
  terms: string[];
}

// Caps to prevent OOM / freezes on very large vaults. The full-text search
// path is intentionally simple (no index), so each query re-reads files. We
// trade exhaustive search for predictability: at most FT_MAX_FILES files and
// FT_MAX_TOTAL_BYTES of content read per query.
const FT_MAX_FILES = 1500;
const FT_MAX_TOTAL_BYTES = 50 * 1024 * 1024; // 50 MB
const FT_MAX_FILE_BYTES = 2 * 1024 * 1024;   // 2 MB per file

ipcMain.handle('search-notes-fulltext', (_, query: string, syncDir?: string) => {
  if (!query || query.trim().length < 2) return { success: true, data: [] };

  const dir = getTargetDir(syncDir);
  const rawTerms = query.trim().toLowerCase().split(/\s+/).filter(t => t.length >= 2);
  if (rawTerms.length === 0) return { success: true, data: [] };

  // Collect all .md files (root + one level of subfolders). Bail out early
  // once we hit FT_MAX_FILES so a 50k-note vault doesn't blow up the renderer.
  const mdFiles: { filePath: string; relPath: string; size: number }[] = [];
  let truncated = false;
  try {
    outer: for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const sub = path.join(dir, entry.name);
        for (const f of fs.readdirSync(sub, { withFileTypes: true })) {
          if (!f.isDirectory() && f.name.endsWith('.md')) {
            try {
              const fp = path.join(sub, f.name);
              const size = fs.statSync(fp).size;
              mdFiles.push({ filePath: fp, relPath: `${entry.name}/${f.name}`, size });
            } catch { /* skip unreadable */ }
            if (mdFiles.length >= FT_MAX_FILES) { truncated = true; break outer; }
          }
        }
      } else if (!entry.isDirectory() && entry.name.endsWith('.md')) {
        try {
          const fp = path.join(dir, entry.name);
          const size = fs.statSync(fp).size;
          mdFiles.push({ filePath: fp, relPath: entry.name, size });
        } catch { /* skip unreadable */ }
        if (mdFiles.length >= FT_MAX_FILES) { truncated = true; break outer; }
      }
    }
  } catch { return { success: true, data: [] }; }

  // Prefer recent and smaller files: searching them first means a query that
  // hits the soft byte cap still returns useful results from the working set.
  mdFiles.sort((a, b) => {
    try { return fs.statSync(b.filePath).mtimeMs - fs.statSync(a.filePath).mtimeMs; }
    catch { return 0; }
  });

  const results: FtSearchResult[] = [];
  let bytesRead = 0;

  for (const { filePath, relPath, size } of mdFiles) {
    if (size > FT_MAX_FILE_BYTES) continue; // skip pathologically large files
    if (bytesRead + size > FT_MAX_TOTAL_BYTES) { truncated = true; break; }
    let raw: string;
    try { raw = fs.readFileSync(filePath, 'utf-8'); bytesRead += raw.length; } catch { continue; }

    const plain = stripHtmlToText(raw);
    const lower = plain.toLowerCase();
    const title = relPath.split('/').pop()!.replace(/\.md$/, '').replace(/_/g, ' ');
    const titleLower = title.toLowerCase();

    let score = 0;
    let firstMatchIdx = -1;
    const matchedTerms: string[] = [];

    for (const term of rawTerms) {
      let idx = 0;
      let termCount = 0;
      while ((idx = lower.indexOf(term, idx)) !== -1) {
        if (firstMatchIdx === -1 || idx < firstMatchIdx) firstMatchIdx = idx;
        termCount++;
        idx += term.length;
      }
      if (termCount > 0) {
        matchedTerms.push(term);
        score += termCount;
        if (titleLower.includes(term)) score += 10;
      }
    }

    if (score === 0 || firstMatchIdx === -1) continue;
    if (matchedTerms.length === rawTerms.length) score += 5;

    const CTX = 90;
    const start = Math.max(0, firstMatchIdx - CTX);
    const end = Math.min(plain.length, firstMatchIdx + CTX * 2);
    let snippet = plain.slice(start, end).replace(/\s+/g, ' ').trim();
    if (start > 0) snippet = '…' + snippet;
    if (end < plain.length) snippet += '…';

    results.push({ relPath, title, snippet, score, terms: matchedTerms });
  }

  results.sort((a, b) => b.score - a.score);
  return { success: true, data: results.slice(0, 25), truncated };
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
  if (!params || typeof params !== 'object') return { success: false, error: 'Invalid params' };
  return gitOps.createGitHubPr(params);
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
