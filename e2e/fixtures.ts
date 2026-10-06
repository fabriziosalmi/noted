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
      await app.close().catch(() => undefined);
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
    await current.app.close().catch(() => undefined);
    // On Windows the browser keeps a file in the profile (DIPS) open for a moment after the app has closed.
    fs.rmSync(base, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  },
});

export { expect } from '@playwright/test';
