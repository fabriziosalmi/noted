import { test as base, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, type Launched } from './fixtures';

// A vault that is a git repository with a remote, and a second device ("b") that
// pushes edits to it. The sync engine and the merge view run for real.

interface GitVault {
  noted: Launched;
  /** Device b: commit this file content and push it to the shared remote. */
  pushFromOtherDevice: (file: string, content: string) => void;
  remote: string;
}

const test = base.extend<{ gv: GitVault }>({
  gv: async ({}, use, testInfo) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-e2e-git-'));
    const gitConfig = path.join(root, 'gitconfig');
    // No identity and no hostname guessing: the engine must cope with a bare machine.
    fs.writeFileSync(gitConfig, '[user]\n\tuseConfigOnly = true\n');
    const gitEnv = { GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1' };
    const git = (cwd: string, ...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=Dev', '-c', 'user.email=dev@example.com', ...args], {
        cwd, encoding: 'utf8', env: { ...process.env, ...gitEnv },
      }).trim();

    const remote = path.join(root, 'remote.git');
    const vault = path.join(root, 'vault');
    const other = path.join(root, 'other');
    const profile = path.join(root, 'profile');
    fs.mkdirSync(profile);
    git(root, 'init', '-q', '--bare', '-b', 'main', remote);
    git(root, 'init', '-q', '-b', 'main', vault);
    git(vault, 'remote', 'add', 'origin', remote);
    fs.writeFileSync(path.join(vault, 'Plan.md'), '<h1>Plan</h1><p>alpha</p><p>shared line</p><p>omega</p>');
    git(vault, 'add', '-A');
    git(vault, 'commit', '-q', '-m', 'init');
    git(vault, 'push', '-q', '-u', 'origin', 'main');
    git(root, 'clone', '-q', '-b', 'main', remote, other);

    let current!: Launched;
    await launch(vault, profile, l => { current = l; }, gitEnv);

    await use({
      noted: current,
      remote,
      pushFromOtherDevice: (file, content) => {
        git(other, 'pull', '-q', '--ff-only');
        fs.writeFileSync(path.join(other, file), content);
        git(other, 'add', '-A');
        git(other, 'commit', '-q', '-m', 'from the other device');
        git(other, 'push', '-q', 'origin', 'main');
      },
    });

    if (testInfo.status !== testInfo.expectedStatus) {
      const shot = await current.win.screenshot().catch(() => null);
      if (shot) await testInfo.attach('window-on-failure', { body: shot, contentType: 'image/png' });
      const appLog = current.appLog();
      await testInfo.attach('app-log', { body: appLog || '(empty)', contentType: 'text/plain' });
      // Also in the CI log itself, where it is read first.
      console.warn(`[app-log tail] ${testInfo.title}\n${appLog.slice(-3000)}`);
    }
    await current.app.close().catch(() => undefined);
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); // Windows holds a profile file open for a moment
  },
});

test.describe('git sync', () => {
  test('pauses on a conflict, and the merge view resolves it and pushes', async ({ gv }) => {
    const { win, vault } = gv.noted;
    const plan = path.join(vault, 'Plan.md');

    // Both devices change the same paragraph; the other one also adds a clean paragraph.
    gv.pushFromOtherDevice('Plan.md', '<h1>Plan</h1><p>alpha</p><p>shared line THEIRS</p><p>omega</p><p>from b only</p>');
    fs.writeFileSync(plan, '<h1>Plan</h1><p>alpha</p><p>shared line MINE</p><p>omega</p>');

    // Turn sync on (idle mode, so nothing else fires on its own), then reload to apply it.
    await win.evaluate(() => {
      const raw = localStorage.getItem('noted-storage');
      const j = raw ? JSON.parse(raw) : { state: { settings: {} }, version: 0 };
      j.state = j.state || {};
      j.state.settings = { ...(j.state.settings || {}), gitEnabled: true, gitSyncMode: 'idle', gitSyncIdleSec: 600, language: 'en' };
      localStorage.setItem('noted-storage', JSON.stringify(j));
    });
    await win.reload();

    await win.getByRole('button', { name: /^Git/ }).first().click();
    await win.getByRole('button', { name: 'Sync now' }).click();
    const resolve = win.getByRole('button', { name: 'Resolve conflicts…' });
    await expect(resolve).toBeVisible({ timeout: 30_000 });

    // Paused: the user's note is exactly as they left it, with no conflict markers.
    const onDisk = fs.readFileSync(plan, 'utf8');
    expect(onDisk).toContain('shared line MINE');
    expect(onDisk).not.toMatch(/^(<{7}|={7}|>{7})/m);

    await resolve.click();
    const dialog = win.getByRole('dialog', { name: 'Resolve sync conflicts' });
    await expect(dialog).toContainText('shared line MINE');
    await expect(dialog).toContainText('shared line THEIRS');
    const apply = dialog.getByRole('button', { name: 'Apply and sync' });
    await expect(apply).toBeDisabled(); // nothing decided yet

    await dialog.getByRole('button', { name: 'Use theirs' }).click();
    await expect(apply).toBeEnabled();
    await apply.click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    // Their edit won, their clean addition came along, and it reached the remote.
    await expect.poll(() => fs.readFileSync(plan, 'utf8'), { timeout: 15_000 }).toContain('shared line THEIRS');
    const merged = fs.readFileSync(plan, 'utf8');
    expect(merged).toContain('from b only');
    expect(merged).not.toContain('MINE');
    const remoteFile = execFileSync('git', ['show', 'main:Plan.md'], { cwd: gv.remote, encoding: 'utf8' });
    expect(remoteFile).toContain('shared line THEIRS');
    expect(remoteFile).toContain('from b only');
  });
});
