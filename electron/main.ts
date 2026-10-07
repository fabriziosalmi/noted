import { app, BrowserWindow, ipcMain, globalShortcut, protocol } from 'electron';
import path from 'node:path';
import { registerCloudDetectorHandlers } from './src/services/cloud-detector';
import { registerImporterHandlers } from './src/services/importer';
import { registerExporterHandlers } from './src/services/exporter';
import { logEvent } from './structured-log';
import { scheduleStartupUpdateCheck } from './updater';
import { installStdioEpipeGuard } from './stdio-guard';
import { initNotesDir, getTargetDir, blessVaultRoot } from './core/paths';
import { fullTextSearchIndex } from './core/services';
import { startVaultWatch } from './core/watcher';
import { createWindow, openCaptureWindow, getMainWindow, registerThemeForwarding } from './core/windows';
import { registerAppProtocol, installContentSecurityPolicy } from './core/protocol';
import { buildAppMenu } from './menu';
import { initLanguage, onLanguageChange } from './core/language';
import { stopMcpSseServer, registerMcpHandlers } from './ipc/mcp';
import { registerAppHandlers } from './ipc/app';
import { registerAttachmentsHandlers } from './ipc/attachments';
import { registerCaptureHandlers } from './ipc/capture';
import { registerGitHandlers } from './ipc/git';
import { registerLlmHandlers } from './ipc/llm';
import { registerEmbeddingHandlers } from './ipc/embeddings';
import { registerIngestHandlers } from './ipc/ingest';
import { registerNotesHandlers } from './ipc/notes';
import { registerFoldersHandlers } from './ipc/folders';
import { registerSecretsHandlers } from './ipc/secrets';
import { registerVaultHandlers } from './ipc/vault';
import { registerMentionHandlers } from './ipc/mentions';
import { registerMigrationHandlers } from './ipc/migration';

// First thing: a closed stdout pipe (Finder/DMG launch) must never kill the
// main process with EPIPE — see stdio-guard.ts.
installStdioEpipeGuard();

// Disable hardware acceleration only in dev to avoid GPU process crashes in sandboxed environments.
// In production we need it for vibrancy/blur effects.
if (!app.isPackaged) {
  app.disableHardwareAcceleration();
}

// __dirname is provided by CommonJS (esbuild --format=cjs)

// In dev: keep userData/notes local to the project so we don't pollute ~/Library.
// In production (packaged): userData is already ~/Library/Application Support/Noted — write there.
// NOTED_USER_DATA_DIR points a run (the E2E suite) at its own throwaway profile
// instead of the shared dev one.
if (!app.isPackaged) {
  const userDataDir = process.env.NOTED_USER_DATA_DIR;
  app.setPath('userData', userDataDir ?? path.join(__dirname, '../.electron_data'));
  app.setPath('sessionData', userDataDir ? path.join(userDataDir, 'session') : path.join(__dirname, '../.electron_session'));
}

process.env.DIST = path.join(__dirname, '../dist');
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public');

// Register a custom 'app://' scheme as standard+secure BEFORE app.whenReady().
// This avoids file:// + ES-module + asar quirks (silent JS bundle loading failures
// when index.html is loaded from inside app.asar with <script type="module" crossorigin>).
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true } },
]);

registerThemeForwarding();

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

app.whenReady().then(async () => {
  registerAppProtocol();
  installContentSecurityPolicy();
  initNotesDir();
  await initLanguage(); // before anything is shown: the menu and the dialogs speak the language of the last run
  createWindow();
  buildAppMenu();
  onLanguageChange(() => buildAppMenu());
  startVaultWatch();
  // Ctrl+Shift+Space is collision-prone on Windows/Linux (IMEs, other apps); if
  // another process owns it, registration fails silently — surface it in the log.
  if (!globalShortcut.register('CommandOrControl+Shift+Space', openCaptureWindow)) {
    logEvent('warn', 'quick_capture_shortcut_unavailable', {});
  }
  scheduleStartupUpdateCheck(() => getMainWindow());
});

// Give the renderer a chance to flush pending autosaves before the app exits,
// so a ⌘Q within the autosave debounce window never loses edits. We prevent the
// first quit, ask the renderer to flush, and quit once it acknowledges (or after
// a short safety timeout if there's no renderer to answer).
let allowQuit = false;
app.on('before-quit', (e) => {
  if (allowQuit) return;
  const win = BrowserWindow.getAllWindows().find(w => !w.webContents.isDestroyed());
  if (!win) return;
  e.preventDefault();
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    allowQuit = true;
    ipcMain.removeListener('renderer-flushed', finish);
    app.quit();
  };
  ipcMain.once('renderer-flushed', finish);
  win.webContents.send('flush-before-quit');
  setTimeout(finish, 1500);
});

app.on('will-quit', () => {
  stopMcpSseServer();
  globalShortcut.unregisterAll();
});

// IPC: one module per area (see electron/ipc/).
registerAppHandlers();
registerCaptureHandlers();
registerNotesHandlers();
registerFoldersHandlers();
registerVaultHandlers();
registerMentionHandlers();
registerMigrationHandlers();
registerAttachmentsHandlers();
registerGitHandlers();
registerLlmHandlers();
registerEmbeddingHandlers();
registerIngestHandlers();
registerMcpHandlers();
registerSecretsHandlers();

registerCloudDetectorHandlers(blessVaultRoot);
registerImporterHandlers(fullTextSearchIndex, getTargetDir);
registerExporterHandlers();
