import { BrowserWindow, nativeTheme, shell } from 'electron';
import path from 'node:path';

let win: BrowserWindow | null;
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];

// Navigation hardening: keep the renderer locked to app:// (and the Vite dev
// server in dev), and route external links to the OS browser instead of letting
// the page navigate away or spawn in-app windows. Backstops any link/redirect
// that slips past HTML sanitization.
export function applyNavigationGuards(w: BrowserWindow) {
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

export function createWindow() {
  const isMac = process.platform === 'darwin';
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 500,
    // macOS-only chrome: hidden-inset title bar + vibrancy filling a transparent
    // background. On Windows/Linux these are ignored, and a transparent window
    // with no titleBarOverlay leaves the user *no* native caption controls — so
    // off-mac use the default frame with an opaque background instead.
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 16, y: 13 },
          vibrancy: 'under-window' as const,
          visualEffectState: 'active' as const,
          backgroundColor: '#00000000',
        }
      : { backgroundColor: '#0a0a0c' }),
    // No `icon`: nativeImage can't decode SVG (it logged a load failure on every
    // launch) and macOS takes the window icon from the app bundle regardless.
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
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

// ==========================================
// Quick Capture window
// ==========================================

let captureWin: BrowserWindow | null = null;

export function openCaptureWindow() {
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
      sandbox: true,
    },
  });
  captureWin.on('closed', () => { captureWin = null; });
  const captureUrl = VITE_DEV_SERVER_URL
    ? `${VITE_DEV_SERVER_URL}capture.html`
    : 'app://./capture.html';
  captureWin.loadURL(captureUrl);
  applyNavigationGuards(captureWin);
}

/** The main window, or null before it exists / after it is closed. */
export function getMainWindow(): BrowserWindow | null {
  return win;
}

/** Close the quick-capture window if it is open. */
export function closeCaptureWindow(): void {
  captureWin?.close();
}

// Forward native theme changes to renderer
export function registerThemeForwarding(): void {
  nativeTheme.on('updated', () => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('native-theme-updated', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
    }
  });
}
