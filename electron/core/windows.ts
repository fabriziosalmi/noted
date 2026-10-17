import { BrowserWindow, app, nativeTheme, screen, shell } from 'electron';
import path from 'node:path';
import { tr } from './language';
import { attachContextMenu } from './contextMenu';
import { MIN_SIZE, readPlacementFile, restorePlacement, writePlacementFile } from './windowState';
import { afterRendererGone } from './rendererCrash';
import { logEvent } from '../structured-log';

let win: BrowserWindow | null;
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];

// Navigation hardening: keep the renderer locked to app:// (and the Vite dev
// server in dev), and route external links to the OS browser instead of letting
// the page navigate away or spawn in-app windows. Backstops any link/redirect
// that slips past HTML sanitization.
export function applyNavigationGuards(w: BrowserWindow) {
  w.webContents.setWindowOpenHandler(({ url }) => {
    // Web links in the browser, mailto: in the mail app (a ⌘-clicked mailto: link used to do nothing).
    if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (event, url) => {
    const isApp = url.startsWith('app://');
    const isDev = !!VITE_DEV_SERVER_URL && url.startsWith(VITE_DEV_SERVER_URL);
    if (!isApp && !isDev) event.preventDefault();
  });
}

const placementFile = () => path.join(app.getPath('userData'), 'window-state.json');

export function createWindow() {
  const isMac = process.platform === 'darwin';
  // As the window was left (size, place, maximized, full screen), when that still fits the screens there are now.
  const placement = restorePlacement(readPlacementFile(placementFile()), screen.getAllDisplays().map(d => d.workArea));
  win = new BrowserWindow({
    width: placement.width,
    height: placement.height,
    ...(placement.x !== undefined && placement.y !== undefined ? { x: placement.x, y: placement.y } : {}),
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
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
  attachContextMenu(win);
  rememberPlacement(win, placement);
  recoverFromRendererCrash(win);
}

/** A renderer that crashed leaves a blank window: say why in the log, and load it again (see afterRendererGone). */
function recoverFromRendererCrash(w: BrowserWindow): void {
  let lastReloadAt: number | null = null;
  w.webContents.on('render-process-gone', (_event, details) => {
    logEvent('error', 'renderer_gone', { reason: details.reason, exitCode: details.exitCode });
    if (w.isDestroyed() || afterRendererGone(details.reason, lastReloadAt, Date.now()) !== 'reload') return;
    lastReloadAt = Date.now();
    w.webContents.reload();
  });
  w.webContents.on('did-finish-load', () => logEvent('info', 'renderer_loaded', {}));
  w.webContents.on('did-fail-load', (_event, code, description) => logEvent('error', 'renderer_load_failed', { code, description }));
  w.webContents.on('unresponsive', () => logEvent('warn', 'renderer_unresponsive', {}));
  w.webContents.on('responsive', () => logEvent('info', 'renderer_responsive', {}));
}

/** Restores maximized / full screen, and saves the window's place when it closes and, shortly after, when it moves or is resized. */
function rememberPlacement(w: BrowserWindow, placement: { maximized: boolean; fullScreen: boolean }): void {
  if (placement.maximized) w.maximize();
  if (placement.fullScreen) w.setFullScreen(true);
  const save = () => {
    if (w.isDestroyed()) return;
    writePlacementFile(placementFile(), { bounds: w.getNormalBounds(), maximized: w.isMaximized(), fullScreen: w.isFullScreen() });
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const later = () => { clearTimeout(timer); timer = setTimeout(save, 500); };
  w.on('resize', later);
  w.on('move', later);
  w.on('maximize', later);
  w.on('unmaximize', later);
  w.on('enter-full-screen', later);
  w.on('leave-full-screen', later);
  w.on('close', () => { clearTimeout(timer); save(); });
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
  const w = new BrowserWindow({
    width: 480,
    height: 210,
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
  captureWin = w;
  // Forgotten as soon as it starts closing, not when it is gone: in between it is not destroyed yet, and a Quick Capture asked for
  // in that moment (Escape, then the shortcut again) only focused the window that was going away. A window only forgets itself, so
  // one still closing cannot clear the reference to a new one.
  const forget = () => { if (captureWin === w) captureWin = null; };
  w.on('close', forget);
  w.on('closed', forget);
  // The window has no frame, so its own page is the only way to close it. Escape is also answered here, in the main process, so a page
  // that fails to run its script (as it did when a content-security policy refused it) can never leave a window that cannot be closed.
  w.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); w.close(); }
  });
  // The page is static and has no store, so what it says reaches it in the address: in the language of the app.
  const labels = encodeURIComponent(JSON.stringify({
    title: tr('menuQuickCapture'), target: tr('captureTargetLabel'), placeholder: tr('capturePlaceholder'), save: tr('captureSave'),
    hint: tr('captureHint', { shortcut: process.platform === 'darwin' ? '⌘↩' : 'Ctrl+Enter' }),
    targets: { new: tr('captureTargetNew'), daily: tr('captureTargetDaily'), inbox: tr('captureTargetInbox') },
  }));
  const captureUrl = VITE_DEV_SERVER_URL
    ? `${VITE_DEV_SERVER_URL}capture.html?l=${labels}`
    : `app://./capture.html?l=${labels}`;
  w.loadURL(captureUrl);
  applyNavigationGuards(w);
  attachContextMenu(w);
}

/** The main window, or null before it exists / after it is closed. */
export function getMainWindow(): BrowserWindow | null {
  // Null once the window is gone. On macOS the app outlives its window; a caller (the vault watcher, the updater,
  // a menu command) that still got it would send to a destroyed object, an uncaught exception in the main process
  // that also showed an error dialog and held up quitting.
  return win && !win.isDestroyed() && !win.webContents.isDestroyed() ? win : null;
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
