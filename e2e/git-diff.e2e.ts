import { test as base, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, type Launched } from './fixtures';

// The Git panel's per-note view (#64): each changed note compared with its last version as readable text,
// with the words that changed highlighted, and the choice of what the next commit holds. Real git, real app.
interface Repo {
  noted: Launched;
  git: (...args: string[]) => string;
  vault: string;
}

const test = base.extend<{ repo: Repo }>({
  repo: async ({}, use) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-e2e-gitdiff-'));
    const gitConfig = path.join(root, 'gitconfig');
    fs.writeFileSync(gitConfig, '[user]\n\tuseConfigOnly = true\n');
    const gitEnv = { GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1' };
    const vault = path.join(root, 'vault');
    const profile = path.join(root, 'profile');
    fs.mkdirSync(profile);
    fs.mkdirSync(vault);
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=Dev', '-c', 'user.email=dev@example.com', ...args], {
        cwd: vault, encoding: 'utf8', env: { ...process.env, ...gitEnv },
      }).trim();
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'Dev'); // a repository a person already uses has an identity; the app does not invent one
    git('config', 'user.email', 'dev@example.com');
    fs.writeFileSync(path.join(vault, '.noted-vault.json'), '{"format":"markdown"}\n');
    fs.writeFileSync(path.join(vault, 'Plan.md'), '# Plan\n\nWe ship **Friday** to the whole team.\n\nSecond paragraph stays.\n');
    fs.writeFileSync(path.join(vault, 'Other.md'), '# Other\n\nunchanged for now\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'init');

    let current!: Launched;
    await launch(vault, profile, l => { current = l; }, gitEnv);
    await use({ noted: current, git, vault });
    await current.app.close().catch(() => undefined);
    // Windows holds a profile file open for a moment; a temp folder left behind is harmless, a failed test is not.
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); } catch { /* left for the OS to clean */ }
  },
});

// Git is switched on in the page's stored settings at the very start of the next load, before the app reads them:
// writing them into a running app loses to the app writing its own state back a moment later.
async function enableGit(win: Launched['win']) {
  await win.addInitScript(() => {
    const raw = localStorage.getItem('noted-storage');
    const j = raw ? JSON.parse(raw) : { state: { settings: {} }, version: 0 };
    j.state = j.state || {};
    j.state.settings = { ...(j.state.settings || {}), gitEnabled: true, language: 'en' };
    localStorage.setItem('noted-storage', JSON.stringify(j));
  });
  await win.reload();
  await expect(win.getByRole('button', { name: /^Git/ }).first()).toBeVisible({ timeout: 20_000 });
}

const openGitPanel = (win: Launched['win']) => win.getByRole('button', { name: /^Git/ }).first().click();

test.describe('Git panel: changed notes', () => {
  test('compares a note with its last version word by word, and commits only what is staged', async ({ repo }) => {
    const { win } = repo.noted;
    await enableGit(win);
    fs.writeFileSync(path.join(repo.vault, 'Plan.md'), '# Plan\n\nWe ship **Monday** to the whole team.\n\nSecond paragraph stays.\n');
    fs.writeFileSync(path.join(repo.vault, 'Other.md'), '# Other\n\nchanged text\n');
    fs.writeFileSync(path.join(repo.vault, 'Fresh.md'), '# Fresh\n');
    await openGitPanel(win);

    const list = win.getByTestId('git-changes');
    await expect(list.locator('li')).toHaveCount(3, { timeout: 20_000 });
    await expect(list.locator('[data-path="Plan.md"]')).toBeVisible();

    // The comparison: the changed words, and only those, are highlighted
    await list.getByRole('button', { name: 'Plan', exact: true }).click();
    const dialog = win.getByRole('dialog', { name: 'Changes in Plan.md' });
    const diff = dialog.getByTestId('note-diff');
    await expect(diff).toContainText('We ship');
    await expect(diff.locator('mark')).toHaveText(['Friday', 'Monday']);
    await expect(diff.locator('[data-kind="del"]')).toHaveCount(1);
    await expect(diff.locator('[data-kind="add"]')).toHaveCount(1);

    // Stage it from the comparison; nothing is committed yet
    await dialog.getByRole('button', { name: 'Stage', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Unstage', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(list.locator('[data-path="Plan.md"]')).toContainText('staged');
    expect(repo.git('rev-list', '--count', 'HEAD')).toBe('1');

    // Commit what is staged: Plan only
    await win.getByRole('button', { name: 'Commit staged (1)' }).click();
    await expect.poll(() => repo.git('rev-list', '--count', 'HEAD'), { timeout: 15_000 }).toBe('2');
    expect(repo.git('show', '--name-only', '--format=', 'HEAD')).toBe('Plan.md');
    expect(repo.git('status', '--porcelain').split('\n').map(l => l.replace(/^\s*\S+\s+/, '')).sort()).toEqual(['Fresh.md', 'Other.md']);
    await expect(list.locator('li')).toHaveCount(2);
  });

  test('unstaging puts a note back, and a new note shows as new', async ({ repo }) => {
    const { win } = repo.noted;
    await enableGit(win);
    fs.writeFileSync(path.join(repo.vault, 'Fresh.md'), '# Fresh\n\nhello\n');
    await openGitPanel(win);
    const row = win.getByTestId('git-changes').locator('[data-path="Fresh.md"]');
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByRole('button', { name: 'Stage', exact: true }).click();
    await expect(row).toContainText('staged');
    expect(repo.git('diff', '--cached', '--name-only')).toBe('Fresh.md');
    await row.getByRole('button', { name: 'Unstage', exact: true }).click();
    await expect(row).not.toContainText('staged');
    expect(repo.git('diff', '--cached', '--name-only')).toBe('');

    await row.getByRole('button', { name: 'Fresh', exact: true }).click();
    await expect(win.getByRole('dialog', { name: 'Changes in Fresh.md' }).getByText('New note')).toBeVisible();
    expect(fs.readFileSync(path.join(repo.vault, 'Fresh.md'), 'utf8')).toBe('# Fresh\n\nhello\n'); // looking changed nothing
  });
});
