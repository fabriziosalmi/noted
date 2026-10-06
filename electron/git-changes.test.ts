// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { classify, commitStaged, getFileVersions, getStatus, initRepo, stageFiles, unstageFiles } from './git-ops';

// Every test makes a real repository, and starting git is slow on some machines.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

// Real repositories in a temp dir: what the Git panel shows and does for each changed note (#64).
let dir: string;
const write = (name: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
  fs.writeFileSync(path.join(dir, name), text);
};
const commitAllNow = async (message = 'seed') => {
  const g = simpleGit(dir);
  await g.add('.');
  await g.commit(message);
};
const files = async () => (await getStatus(dir)).data!.files;
const byPath = async (p: string) => (await files()).find(f => f.path === p);

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-gitchg-'));
  expect((await initRepo(dir)).success).toBe(true);
  write('Plan.md', '# Plan\n\nWe ship Friday.\n');
  write('Work/Notes.md', 'notes\n');
  await commitAllNow();
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('classify', () => {
  it.each([
    ['?', '?', 'untracked', false, true],
    [' ', 'M', 'modified', false, true],
    ['M', ' ', 'modified', true, false],
    ['M', 'M', 'modified', true, true],
    ['A', ' ', 'added', true, false],
    [' ', 'D', 'deleted', false, true],
    ['D', ' ', 'deleted', true, false],
    ['R', ' ', 'renamed', true, false],
  ])('index %j, working tree %j -> %s (staged %s, unstaged %s)', (index, workingDir, state, staged, unstaged) => {
    expect(classify('a.md', index, workingDir)).toEqual({ path: 'a.md', state, staged, unstaged });
  });
});

describe('the list of changed notes', () => {
  it('lists changed notes only, with their state, and not hidden folders or other files', async () => {
    write('Plan.md', '# Plan\n\nWe ship Monday.\n');
    write('New.md', 'new\n');
    fs.rmSync(path.join(dir, 'Work/Notes.md'));
    write('.noted_history/Plan.md/2026-01-01.html', '<p>old</p>');
    write('readme.txt', 'x');
    const list = await files();
    expect(list.map(f => [f.path, f.state]).sort()).toEqual([['New.md', 'untracked'], ['Plan.md', 'modified'], ['Work/Notes.md', 'deleted']]);
    expect((await getStatus(dir)).data!.dirty).toBe(true);
  });

  it('says which changes are staged, and which are staged and changed again', async () => {
    write('Plan.md', '# Plan\n\nv2\n');
    write('New.md', 'new\n');
    expect(await stageFiles(dir, ['Plan.md'])).toEqual({ success: true });
    expect(await byPath('Plan.md')).toMatchObject({ staged: true, unstaged: false });
    expect(await byPath('New.md')).toMatchObject({ staged: false, unstaged: true });
    write('Plan.md', '# Plan\n\nv3\n');
    expect(await byPath('Plan.md')).toMatchObject({ staged: true, unstaged: true });
  });
});

describe('the two versions of a note', () => {
  it('gives the last commit and the file on disk, exactly (the final newline included)', async () => {
    write('Plan.md', '# Plan\n\nWe ship Monday.');
    const res = await getFileVersions(dir, 'Plan.md');
    expect(res).toEqual({ success: true, data: { before: '# Plan\n\nWe ship Friday.\n', after: '# Plan\n\nWe ship Monday.', state: 'modified' } });
  });

  it('a new note has no earlier version, a deleted one no current version', async () => {
    write('New.md', 'new\n');
    fs.rmSync(path.join(dir, 'Work/Notes.md'));
    expect((await getFileVersions(dir, 'New.md')).data).toEqual({ before: null, after: 'new\n', state: 'untracked' });
    expect((await getFileVersions(dir, 'Work/Notes.md')).data).toEqual({ before: 'notes\n', after: null, state: 'deleted' });
  });

  it('compares with the last commit even when the change is already staged', async () => {
    write('Plan.md', 'staged text\n');
    await stageFiles(dir, ['Plan.md']);
    expect((await getFileVersions(dir, 'Plan.md')).data!.before).toBe('# Plan\n\nWe ship Friday.\n');
  });

  it('refuses a note with no changes, and anything that is not a note in the vault', async () => {
    expect((await getFileVersions(dir, 'Plan.md')).success).toBe(false);
    for (const bad of ['../outside.md', '/etc/passwd', 'a/../b.md', 'readme.txt', '.noted/x.md', 'a/.hidden/x.md', '']) {
      expect((await getFileVersions(dir, bad)).success, bad).toBe(false);
      expect((await stageFiles(dir, [bad])).success, bad).toBe(false);
      expect((await unstageFiles(dir, [bad])).success, bad).toBe(false);
    }
  });
});

describe('notes in nested folders (#65)', () => {
  it('lists, compares, stages and commits a note at any depth, and still ignores hidden folders', async () => {
    write('Work/Q4/Deep/Goals.md', 'v1\n');
    write('Work/.hidden/Secret.md', 'x\n');
    expect((await files()).map(f => f.path)).toEqual(['Work/Q4/Deep/Goals.md']);
    expect((await getFileVersions(dir, 'Work/Q4/Deep/Goals.md')).data).toEqual({ before: null, after: 'v1\n', state: 'untracked' });
    expect((await stageFiles(dir, ['Work/Q4/Deep/Goals.md'])).success).toBe(true);
    expect(await byPath('Work/Q4/Deep/Goals.md')).toMatchObject({ state: 'added', staged: true });
    expect((await commitStaged(dir, 'deep')).success).toBe(true);
    write('Work/Q4/Deep/Goals.md', 'v2\n');
    expect((await getFileVersions(dir, 'Work/Q4/Deep/Goals.md')).data).toMatchObject({ before: 'v1\n', after: 'v2\n', state: 'modified' });
  });

  it('refuses hidden segments and traversal at depth', async () => {
    for (const bad of ['a/b/.noted/x.md', 'a/b/../../../etc/x.md']) expect((await stageFiles(dir, [bad])).success, bad).toBe(false);
  });
});

describe('stage, unstage, commit what is staged', () => {
  it('unstaging keeps the change in the working tree', async () => {
    write('Plan.md', 'v2\n');
    await stageFiles(dir, ['Plan.md']);
    expect((await unstageFiles(dir, ['Plan.md'])).success).toBe(true);
    expect(await byPath('Plan.md')).toMatchObject({ staged: false, unstaged: true });
    expect(fs.readFileSync(path.join(dir, 'Plan.md'), 'utf8')).toBe('v2\n');
  });

  it('stages a new note and a deleted one, and unstages them', async () => {
    write('New.md', 'new\n');
    fs.rmSync(path.join(dir, 'Work/Notes.md'));
    await stageFiles(dir, ['New.md', 'Work/Notes.md']);
    expect(await byPath('New.md')).toMatchObject({ state: 'added', staged: true });
    expect(await byPath('Work/Notes.md')).toMatchObject({ state: 'deleted', staged: true });
    await unstageFiles(dir, ['New.md', 'Work/Notes.md']);
    expect(await byPath('New.md')).toMatchObject({ state: 'untracked', staged: false });
    expect(await byPath('Work/Notes.md')).toMatchObject({ state: 'deleted', staged: false });
  });

  it('commits exactly the staged notes and leaves the others changed', async () => {
    write('Plan.md', 'v2\n');
    write('Work/Notes.md', 'notes v2\n');
    await stageFiles(dir, ['Plan.md']);
    const res = await commitStaged(dir, 'docs: plan');
    expect(res.success).toBe(true);
    const log = await simpleGit(dir).log();
    expect(log.latest!.message).toBe('docs: plan');
    expect((await simpleGit(dir).show(['--name-only', '--format=', 'HEAD'])).trim()).toBe('Plan.md');
    expect((await files()).map(f => f.path)).toEqual(['Work/Notes.md']);
  });

  it('commits the staged version of a note changed again afterwards', async () => {
    write('Plan.md', 'v2\n');
    await stageFiles(dir, ['Plan.md']);
    write('Plan.md', 'v3\n');
    await commitStaged(dir, 'v2 only');
    expect((await simpleGit(dir).show(['HEAD:Plan.md']))).toBe('v2\n');
    expect(await byPath('Plan.md')).toMatchObject({ staged: false, unstaged: true });
  });

  it('refuses when nothing is staged or the message is empty, and changes nothing', async () => {
    write('Plan.md', 'v2\n');
    const head = (await simpleGit(dir).revparse(['HEAD']));
    expect(await commitStaged(dir, 'msg')).toMatchObject({ success: false, error: 'Nothing is staged' });
    await stageFiles(dir, ['Plan.md']);
    expect(await commitStaged(dir, '   ')).toMatchObject({ success: false });
    expect(await simpleGit(dir).revparse(['HEAD'])).toBe(head);
  });
});

describe('initRepo on a machine with no git identity', () => {
  const saved = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_NOSYSTEM };
  afterEach(() => {
    for (const [key, value] of [['GIT_CONFIG_GLOBAL', saved.global], ['GIT_CONFIG_NOSYSTEM', saved.system]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('gives the repository an identity of its own, so the first commit works', async () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-gitbare-'));
    fs.writeFileSync(path.join(bare, 'gitconfig'), '[user]\n\tuseConfigOnly = true\n');
    process.env.GIT_CONFIG_GLOBAL = path.join(bare, 'gitconfig');
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    const fresh = path.join(bare, 'vault');
    fs.mkdirSync(fresh);
    try {
      expect(await initRepo(fresh)).toEqual({ success: true });
      expect((await simpleGit(fresh).raw(['config', 'user.email'])).trim()).toBe('noted@local');
      expect((await simpleGit(fresh).raw(['log', '--format=%an'])).trim()).toBe('Noted');
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });

  it('keeps the identity a person already has', async () => {
    const own = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-gitown-'));
    fs.writeFileSync(path.join(own, 'gitconfig'), '[user]\n\tname = Ada\n\temail = ada@example.com\n');
    process.env.GIT_CONFIG_GLOBAL = path.join(own, 'gitconfig');
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    const fresh = path.join(own, 'vault');
    fs.mkdirSync(fresh);
    try {
      expect((await initRepo(fresh)).success).toBe(true);
      expect((await simpleGit(fresh).raw(['log', '--format=%an <%ae>'])).trim()).toBe('Ada <ada@example.com>');
    } finally {
      fs.rmSync(own, { recursive: true, force: true });
    }
  });
});
