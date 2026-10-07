import { test as base, _electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

// Notes are stored as HTML inside .md files — Noted's on-disk format.
export const SEED_NOTES: [string, string][] = [
  ['Alpha plan.md', '<h1>Alpha plan</h1><p>Ship the zebra milestone.</p>'],
  ['Beta notes.md', '<h1>Beta notes</h1><p>Weekly sync about onboarding.</p>'],
  ['Gamma ideas.md', '<h1>Gamma ideas</h1><p>Brainstorm: lighthouse keeper.</p>'],
];

export interface Launched {
  app: ElectronApplication;
  win: Page;
  vault: string;
  /** Everything the app wrote to stdout/stderr so far (structured JSON log lines). */
  appLog: () => string;
  /** Read every .md file in the vault, keyed by file name. */
  readVault: () => Record<string, string>;
  /** Quit and relaunch against the same vault and profile. */
  relaunch: () => Promise<Launched>;
}

/**
 * Closes the app, and if it has not gone after `graceMs` ends the process. A shutdown that never finishes (seen on Windows runners,
 * right after launch) used to cost the whole test timeout and fail whichever test happened to be running; the test is about the
 * app's behaviour, not about how fast the process exits, so it must not depend on that. A kill is noted in the log.
 */
export async function closeApp(app: ElectronApplication, graceMs = 20_000): Promise<void> {
  let proc: ReturnType<ElectronApplication['process']>;
  try { proc = app.process(); } catch { return; } // already closed (a test that relaunches again from an earlier handle)
  const exited = new Promise<void>(resolve => { proc.once('exit', () => resolve()); });
  const outcome = await Promise.race([
    app.close().then(() => 'closed' as const, () => 'closed' as const),
    new Promise<'late'>(resolve => setTimeout(() => resolve('late'), graceMs)),
  ]);
  if (outcome === 'late') {
    console.warn(`[e2e] the app had not exited ${graceMs / 1000}s after being asked to: ending it`);
    proc.kill();
    await Promise.race([exited, new Promise<void>(resolve => setTimeout(resolve, 10_000))]);
  }
}

export async function launch(
  vault: string,
  profile: string,
  track: (l: Launched) => void,
  extraEnv: Record<string, string> = {},
): Promise<Launched> {
  // ELECTRON_RUN_AS_NODE leaks in from some hosts (e.g. VS Code terminals) and
  // turns the Electron binary into plain Node.
  const env = { ...process.env, ...extraEnv, NOTED_NOTES_DIR: vault, NOTED_USER_DATA_DIR: profile } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;

  const args = ['dist-electron/main.cjs'];
  // CI Linux runners have no SUID chrome-sandbox helper for the node_modules
  // Electron binary, so Chromium's own process sandbox must be off there.
  if (process.platform === 'linux') args.push('--no-sandbox');

  const app = await _electron.launch({ args, cwd: ROOT, env, timeout: 45_000 });
  const win = await app.firstWindow({ timeout: 30_000 });
  await win.waitForLoadState('domcontentloaded');
  await win.waitForLoadState('load'); // not yet closed or driven while the page is still being put together

  const logChunks: string[] = [];
  app.process().stdout?.on('data', d => logChunks.push(String(d)));
  app.process().stderr?.on('data', d => logChunks.push(String(d)));

  const readVault = () =>
    Object.fromEntries(
      fs.readdirSync(vault).filter(f => f.endsWith('.md')).map(f => [f, fs.readFileSync(path.join(vault, f), 'utf8')]),
    );
  const launched: Launched = {
    app, win, vault, readVault, appLog: () => logChunks.join(''),
    relaunch: async () => {
      await closeApp(app);
      return launch(vault, profile, track, extraEnv);
    },
  };
  track(launched);
  return launched;
}

export const test = base.extend<{ noted: Launched }>({
  noted: async ({}, use, testInfo) => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-e2e-'));
    const vault = path.join(base, 'vault');
    const profile = path.join(base, 'profile');
    fs.mkdirSync(vault);
    fs.mkdirSync(profile);
    for (const [name, html] of SEED_NOTES) fs.writeFileSync(path.join(vault, name), html, 'utf8');

    // Teardown must close and screenshot whichever instance is current, which
    // changes when a test relaunches.
    let current!: Launched;
    await launch(vault, profile, l => { current = l; });

    await use(current);

    if (testInfo.status !== testInfo.expectedStatus) {
      // Screenshot of whatever is on screen when a test fails, attached to the report.
      const shot = await current.win.screenshot().catch(() => null);
      if (shot) await testInfo.attach('window-on-failure', { body: shot, contentType: 'image/png' });
      const appLog = current.appLog();
      await testInfo.attach('app-log', { body: appLog || '(empty)', contentType: 'text/plain' });
      // Also in the CI log itself, where it is read first.
      console.warn(`[app-log tail] ${testInfo.title}\n${appLog.slice(-3000)}`);
    }
    await closeApp(current.app);
    // On Windows the browser keeps a file in the profile (DIPS) open for a moment after the app has closed. A temp
    // folder left behind is harmless; failing a test that passed over it is not.
    try { fs.rmSync(base, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); } catch { /* left for the OS to clean */ }
  },
});

export { expect } from '@playwright/test';
