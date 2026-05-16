import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// Fix GPU Process crashing in dev mode
app.disableHardwareAcceleration();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Setup default notes directory (local to project for dev to avoid MacOS EPERM)
app.setPath('userData', path.join(__dirname, '../.electron_data'));
app.setPath('sessionData', path.join(__dirname, '../.electron_session')); // Fix for cache directory errors
const DEFAULT_NOTES_DIR = path.join(__dirname, '../notes_dev');
if (!fs.existsSync(DEFAULT_NOTES_DIR)) {
  fs.mkdirSync(DEFAULT_NOTES_DIR, { recursive: true });
}

const getTargetDir = (customDir?: string) => {
  if (customDir && fs.existsSync(customDir)) {
    return customDir;
  }
  return DEFAULT_NOTES_DIR;
};

process.env.DIST = path.join(__dirname, '../dist');
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public');

let win: BrowserWindow | null;
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    titleBarStyle: 'hiddenInset', // Native Apple look
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
    win.loadFile(path.join(process.env.DIST, 'index.html'));
  }
}

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

app.whenReady().then(createWindow);

// Example IPC handler for the magical stuff
ipcMain.handle('ping', () => 'pong');

// FS IPC Handlers
ipcMain.handle('get-notes-list', (_, syncDir?: string) => {
  try {
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
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('read-note', (_, fileName: string, syncDir?: string) => {
  try {
    const targetDir = getTargetDir(syncDir);
    const filePath = path.join(targetDir, fileName);
    const content = fs.readFileSync(filePath, 'utf-8');
    return { success: true, data: content };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-note', (_, fileName: string, content: string, syncDir?: string) => {
  try {
    const targetDir = getTargetDir(syncDir);
    const filePath = path.join(targetDir, fileName);
    fs.writeFileSync(filePath, content, 'utf-8');
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-note', (_, fileName: string, syncDir?: string) => {
  try {
    const targetDir = getTargetDir(syncDir);
    const filePath = path.join(targetDir, fileName);
    fs.unlinkSync(filePath);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
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

    // Load basic styling for the PDF
    const styledHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
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
          ${htmlContent}
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
  } catch (error: any) {
    console.error('PDF Export Error:', error);
    return { success: false, error: error.message };
  }
});

