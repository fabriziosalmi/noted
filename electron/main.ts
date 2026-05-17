import { app, BrowserWindow, ipcMain, dialog, safeStorage, globalShortcut, nativeTheme } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateFileName, stripUnsafeHtml } from './ipc-utils.js';

// Disable hardware acceleration only in dev to avoid GPU process crashes in sandboxed environments.
// In production we need it for vibrancy/blur effects.
if (!app.isPackaged) {
  app.disableHardwareAcceleration();
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

let encryptedApiKey: Buffer | null = null;

process.env.DIST = path.join(__dirname, '../dist');
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public');

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
    win.loadFile(path.join(process.env.DIST, 'index.html'));
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
    : `file://${path.join(process.env.DIST!, 'capture.html')}`;
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

app.whenReady().then(() => {
  initNotesDir();
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
    const filePath = path.join(targetDir, fileName);
    const content = fs.readFileSync(filePath, 'utf-8');
    return { success: true, data: content };
  } catch (error: unknown) {
    const err = error as Error;
    return { success: false, error: err.message };
  }
});

const MAX_HISTORY_SNAPSHOTS = 20;

function saveSnapshot(targetDir: string, fileName: string, content: string) {
  try {
    const histDir = path.join(targetDir, '.noted_history', fileName);
    if (!fs.existsSync(histDir)) fs.mkdirSync(histDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(histDir, `${ts}.html`), content, 'utf-8');
    // Prune oldest beyond limit
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
    const filePath = path.join(targetDir, fileName);
    saveSnapshot(targetDir, fileName, content);
    fs.writeFileSync(filePath, content, 'utf-8');
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
    const oldPath = path.join(targetDir, oldName);
    const newPath = path.join(targetDir, newName);
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
    const filePath = path.join(targetDir, fileName);
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
    pdfWin.close();

    return { success: true, data: filePath };
  } catch (error: unknown) {
    const err = error as Error;
    console.error('PDF Export Error:', err);
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

// Proxy LLM HTTP requests from renderer — avoids CORS/CSP issues
ipcMain.handle('llm-fetch', async (_, url: string, options: { method: string; headers: Record<string, string>; body: string }) => {
  try {
    if (typeof url !== 'string' || !url.startsWith('http')) throw new Error('Invalid URL');
    const res = await fetch(url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (err: unknown) {
    return { ok: false, status: 0, text: (err as Error).message };
  }
});
