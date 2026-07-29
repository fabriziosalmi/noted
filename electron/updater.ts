// Auto-update, wired to the GitHub Releases provider configured in
// package.json → build.publish.
//
// Two deliberate choices, both because Noted is a local-first app that promises
// not to do things behind your back:
//
//   1. `autoDownload = false` — an update is announced, never fetched silently.
//      The user opts in before megabytes move.
//   2. The startup check is *silent unless there is news*. Only a manual check
//      ("Check for Updates…") reports "you're up to date" or an error, because
//      only a manual check implies someone is waiting for an answer.
//
// Auto-update needs the `latest-*.yml` metadata that electron-builder emits
// next to the installers; `scripts/release.sh` uploads it with the release.

import { app, dialog, shell, type BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { logEvent } from './structured-log.js';

const RELEASES_URL = 'https://github.com/fabriziosalmi/noted/releases/latest';

// Long enough that the check never competes with first paint or the initial
// vault scan.
const STARTUP_CHECK_DELAY_MS = 8_000;

/**
 * Can this install actually replace itself in place?
 *
 * A `.deb`/`.rpm` is owned by the system package manager and an unpacked dev
 * tree has nothing to replace, so in both cases electron-updater would throw.
 * Detect it up front and send those users to the releases page instead.
 */
export function canSelfUpdate(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  // On Linux only the AppImage carries the metadata needed to swap itself out;
  // APPIMAGE is set by the AppImage runtime.
  if (platform === 'linux') return Boolean(env.APPIMAGE);
  return platform === 'darwin' || platform === 'win32';
}

let wiredUp = false;
// A manual check must answer ("up to date" / an error); the automatic startup
// check must stay silent. The autoUpdater singleton fires its result events
// globally, so the manual-ness of the check that triggered them can't ride
// along on the event — it lives here instead.
//
// Because those events are global, two overlapping checks (the 8s startup check
// still awaiting the network when the user picks "Check for Updates…") would
// clobber each other's intent. So checks are serialised: at most one runs at a
// time, and a manual request arriving mid-flight upgrades the running check to
// manual rather than starting a second one.
let checkIsManual = false;
let inFlightCheck: Promise<void> | null = null;

function reportManualOnly(title: string, message: string): void {
  if (!checkIsManual) return;
  void dialog.showMessageBox({ type: 'info', title, message, buttons: ['OK'] });
}

function wireListeners(getWindow: () => BrowserWindow | undefined): void {
  if (wiredUp) return;
  wiredUp = true;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', async info => {
    logEvent('info', 'update_available', { version: info.version });
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'Update available',
      message: `Noted ${info.version} is available.`,
      detail: `You are on ${app.getVersion()}. Download it now?`,
      buttons: ['Download', 'Release notes', 'Later'],
      defaultId: 0,
      cancelId: 2,
    });
    if (response === 0) {
      void autoUpdater.downloadUpdate().catch((err: Error) => {
        logEvent('error', 'update_download_failed', { error: err.message });
        void dialog.showMessageBox({
          type: 'error',
          title: 'Download failed',
          message: 'Could not download the update.',
          detail: err.message,
        });
      });
    } else if (response === 1) {
      void shell.openExternal(RELEASES_URL);
    }
  });

  autoUpdater.on('update-not-available', () => {
    logEvent('info', 'update_not_available', { version: app.getVersion() });
    reportManualOnly('You are up to date', `Noted ${app.getVersion()} is the latest version.`);
  });

  autoUpdater.on('error', (err: Error) => {
    logEvent('error', 'update_check_failed', { error: err.message });
    reportManualOnly('Update check failed', err.message);
  });

  // Progress goes to the window if it wants to show it; no dialog, since the
  // download was already opted into.
  autoUpdater.on('download-progress', p => {
    getWindow()?.webContents.send('update-download-progress', Math.round(p.percent));
  });

  autoUpdater.on('update-downloaded', async info => {
    logEvent('info', 'update_downloaded', { version: info.version });
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'Update ready',
      message: `Noted ${info.version} is ready to install.`,
      detail: 'Restart now, or it will be installed the next time you quit.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) {
      // Give the renderer a beat to flush any in-flight autosave before the
      // installer takes the app down.
      getWindow()?.webContents.send('app-will-quit-for-update');
      setTimeout(() => autoUpdater.quitAndInstall(), 400);
    }
  });
}

/**
 * Run an update check. `manual` drives whether a no-news result is reported.
 *
 * Safe to call in dev and from unsupported install types — it degrades to a
 * message (manual) or a no-op (automatic) rather than throwing.
 */
export async function checkForUpdates(
  getWindow: () => BrowserWindow | undefined,
  manual = false,
): Promise<void> {
  if (!app.isPackaged) {
    if (manual) reportManualDialog('Updates unavailable', 'Update checks only run in a packaged build.');
    return;
  }
  if (!canSelfUpdate()) {
    // A package-managed install can still be *told* about a new version — it
    // just can't install it itself.
    if (manual) {
      const { response } = await dialog.showMessageBox({
        type: 'info',
        title: 'Check for updates',
        message: 'This install updates through your package manager.',
        detail: 'Open the releases page to see the latest version.',
        buttons: ['Open releases', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) void shell.openExternal(RELEASES_URL);
    }
    return;
  }

  wireListeners(getWindow);

  // Coalesce onto the running check rather than starting a second one. A manual
  // request always wins the intent: an automatic check already in flight is
  // upgraded so it will report its result.
  if (inFlightCheck) {
    if (manual) checkIsManual = true;
    return inFlightCheck;
  }

  checkIsManual = manual;
  inFlightCheck = autoUpdater.checkForUpdates()
    .then(() => undefined)
    .catch((err: Error) => {
      // The 'error' listener already reported it; this only stops the rejection
      // from escaping as an unhandled promise.
      logEvent('warn', 'update_check_threw', { error: err.message });
    })
    .finally(() => { inFlightCheck = null; });
  return inFlightCheck;
}

// A plain info dialog, shown regardless of manual/automatic intent. Used for the
// pre-check "can't even try" cases, which only ever run for a manual request.
function reportManualDialog(title: string, message: string): void {
  void dialog.showMessageBox({ type: 'info', title, message, buttons: ['OK'] });
}

/** Kick off the one-shot startup check, well after the window has settled. */
export function scheduleStartupUpdateCheck(getWindow: () => BrowserWindow | undefined): void {
  if (!app.isPackaged) return;
  setTimeout(() => {
    void checkForUpdates(getWindow, false);
  }, STARTUP_CHECK_DELAY_MS);
}
