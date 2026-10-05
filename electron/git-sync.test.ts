// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  syncNow,
  parseConflictResolutions,
  resolveConflicts,
  getSyncState,
  setSyncListener,
  _resetSyncCachesForTest,
} from './git-sync';

// Real git against throwaway repositories: a bare "remote", the vault under test
// (a) and a second device (b). Global/system git config is neutralised so the
// machine's own identity and hooks never leak into (or out of) the tests.

// Each case runs dozens of real git processes.
vi.setConfig({ testTimeout: 30_000 });

let root: string;
let emptyConfig: string;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-sync-test-'));
  emptyConfig = path.join(root, 'empty.gitconfig');
  // useConfigOnly: git must not guess an identity from the hostname. CI runners
  // can't, and machines that can would hide a missing-identity bug.
  fs.writeFileSync(emptyConfig, '[user]\n\tuseConfigOnly = true\n');
  for (const k of ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']) {
    savedEnv[k] = process.env[k];
  }
  process.env.GIT_CONFIG_GLOBAL = emptyConfig;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  delete process.env.GIT_AUTHOR_NAME;
  delete process.env.GIT_AUTHOR_EMAIL;
  delete process.env.GIT_COMMITTER_NAME;
  delete process.env.GIT_COMMITTER_EMAIL;
});

afterAll(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const ID = ['-c', 'user.name=Dev', '-c', 'user.email=dev@example.com'];
const commitAs = (cwd: string, msg: string) => git(cwd, ...ID, 'commit', '-m', msg);
const write = (dir: string, name: string, content: string | Buffer) => fs.writeFileSync(path.join(dir, name), content);
const read = (dir: string, name: string) => fs.readFileSync(path.join(dir, name), 'utf8');
const commits = (dir: string, ref = 'HEAD') => Number(git(dir, 'rev-list', '--count', ref));

interface Scenario { remote: string; a: string; b: string }

/** remote ← a (vault under test, NO local identity) and b (other device), both on `main` with one.md/two.md. */
let n = 0;
function scenario(): Scenario {
  const base = path.join(root, `s${n++}`);
  const remote = path.join(base, 'remote.git');
  const a = path.join(base, 'a');
  const b = path.join(base, 'b');
  fs.mkdirSync(base, { recursive: true });
  git(base, 'init', '--bare', '-b', 'main', remote);
  git(base, 'init', '-b', 'main', a);
  git(a, 'remote', 'add', 'origin', remote);
  write(a, 'one.md', '<p>one</p>\n');
  write(a, 'two.md', '<p>two</p>\n');
  git(a, 'add', '-A');
  commitAs(a, 'init');
  git(a, 'push', '-u', 'origin', 'main');
  git(base, 'clone', '-b', 'main', remote, b);
  return { remote, a, b };
}

/** Make a commit on the other device and push it. */
function pushFromB(s: Scenario, file: string, content: string, msg = 'from b') {
  git(s.b, 'pull', '--ff-only', '-q');
  write(s.b, file, content);
  git(s.b, 'add', '-A');
  commitAs(s.b, msg);
  git(s.b, 'push', '-q', 'origin', 'main');
}

const remoteHead = (s: Scenario) => git(s.remote, 'rev-parse', 'main');
const worktrees = (dir: string) => git(dir, 'worktree', 'list').split('\n').length;
const hasMarkers = (dir: string) =>
  fs.readdirSync(dir).filter(f => f.endsWith('.md')).some(f => /^(<{7}|={7}|>{7})/m.test(read(dir, f)));

beforeEach(() => {
  _resetSyncCachesForTest();
  setSyncListener(null);
});

describe('preconditions', () => {
  it('reports a folder that is not a repository as unconfigured', async () => {
    const dir = fs.mkdtempSync(path.join(root, 'plain-'));
    const st = await syncNow(dir);
    expect(st.phase).toBe('unconfigured');
    expect(st.message).toMatch(/not a Git repository/i);
  });

  it('reports a branch with no upstream as unconfigured and changes nothing', async () => {
    const s = scenario();
    git(s.a, 'branch', '--unset-upstream');
    write(s.a, 'one.md', '<p>edited</p>\n');
    const before = commits(s.a);
    const st = await syncNow(s.a);
    expect(st.phase).toBe('unconfigured');
    expect(st.message).toMatch(/no upstream/i);
    expect(commits(s.a)).toBe(before); // never even commits without somewhere to sync to
  });

  it('refuses a detached HEAD', async () => {
    const s = scenario();
    git(s.a, 'checkout', '-q', '--detach');
    const st = await syncNow(s.a);
    expect(st.phase).toBe('error');
    expect(st.message).toMatch(/detached/i);
  });

  it('refuses to run over a merge already in progress', async () => {
    const s = scenario();
    pushFromB(s, 'one.md', '<p>remote</p>\n');
    write(s.a, 'one.md', '<p>local</p>\n');
    git(s.a, 'add', '-A');
    commitAs(s.a, 'local');
    git(s.a, 'fetch', '-q');
    try { git(s.a, ...ID, 'merge', '--no-commit', 'origin/main'); } catch { /* conflicts expected */ }
    const st = await syncNow(s.a);
    expect(st.phase).toBe('error');
    expect(st.message).toMatch(/merge or rebase is already in progress/i);
  });
});

describe('plain cycles', () => {
  it('does nothing — and makes no empty commit — when already in sync', async () => {
    const s = scenario();
    const before = commits(s.a);
    const st = await syncNow(s.a);
    expect(st.phase).toBe('idle');
    expect(st.lastSyncAt).toEqual(expect.any(Number));
    expect(st.upstream).toBe('origin/main');
    expect(commits(s.a)).toBe(before);
    expect(remoteHead(s)).toBe(git(s.a, 'rev-parse', 'HEAD'));
  });

  it('commits local edits and pushes them', async () => {
    const s = scenario();
    write(s.a, 'one.md', '<p>edited locally</p>\n');
    write(s.a, 'new.md', '<p>new</p>\n');
    const st = await syncNow(s.a);
    expect(st.phase).toBe('idle');
    expect(git(s.a, 'status', '--porcelain')).toBe('');
    expect(remoteHead(s)).toBe(git(s.a, 'rev-parse', 'HEAD'));
    expect(git(s.remote, 'show', 'main:one.md')).toBe('<p>edited locally</p>');
    expect(git(s.remote, 'show', 'main:new.md')).toBe('<p>new</p>');
    expect(git(s.remote, 'log', '-1', '--format=%s')).toMatch(/^sync: /);
  });

  it('works with no git identity configured anywhere (falls back to a local one)', async () => {
    const s = scenario();
    expect(() => git(s.a, 'config', 'user.email')).toThrow(); // truly none
    write(s.a, 'one.md', '<p>x</p>\n');
    expect((await syncNow(s.a)).phase).toBe('idle');
    expect(git(s.a, 'log', '-1', '--format=%an')).toBe('Noted');
  });

  it('fast-forwards remote-only changes without attempting any push (the remote may be read-only)', async () => {
    const s = scenario();
    pushFromB(s, 'two.md', '<p>from b</p>\n');
    // Fetching still works, but any push attempt would fail.
    git(s.a, 'config', 'remote.origin.pushurl', path.join(root, 'no-such-remote.git'));
    const before = commits(s.a);
    const st = await syncNow(s.a);
    expect(st.phase).toBe('idle');
    expect(st.message).toBeNull();
    expect(read(s.a, 'two.md')).toBe('<p>from b</p>\n');
    expect(commits(s.a)).toBe(before + 1); // linear, no merge commit
  });

  it('does attempt the push when there is something to send (control for the test above)', async () => {
    const s = scenario();
    git(s.a, 'config', 'remote.origin.pushurl', path.join(root, 'no-such-remote.git'));
    write(s.a, 'one.md', '<p>local change</p>\n');
    const st = await syncNow(s.a);
    expect(st.phase).toBe('error');
  });

  it('merges non-overlapping changes from both sides and pushes the merge', async () => {
    const s = scenario();
    pushFromB(s, 'two.md', '<p>two from b</p>\n');
    write(s.a, 'one.md', '<p>one from a</p>\n');
    const st = await syncNow(s.a);
    expect(st.phase).toBe('idle');
    expect(read(s.a, 'one.md')).toBe('<p>one from a</p>\n');
    expect(read(s.a, 'two.md')).toBe('<p>two from b</p>\n');
    expect(hasMarkers(s.a)).toBe(false);
    expect(git(s.a, 'rev-list', '--parents', '-1', 'HEAD').split(' ').length).toBe(3); // a merge commit
    expect(remoteHead(s)).toBe(git(s.a, 'rev-parse', 'HEAD'));
    expect(worktrees(s.a)).toBe(1); // temp worktree cleaned up
  });

  it('serialises concurrent syncs of the same vault', async () => {
    const s = scenario();
    write(s.a, 'one.md', '<p>x</p>\n');
    const states = await Promise.all([syncNow(s.a), syncNow(s.a), syncNow(s.a)]);
    expect(states.map(x => x.phase)).toEqual(['idle', 'idle', 'idle']);
    expect(remoteHead(s)).toBe(git(s.a, 'rev-parse', 'HEAD'));
  });

  it('publishes state changes to the listener', async () => {
    const s = scenario();
    const seen: string[] = [];
    setSyncListener((_dir, st) => seen.push(st.phase));
    await syncNow(s.a);
    expect(seen[0]).toBe('syncing');
    expect(seen[seen.length - 1]).toBe('idle');
  });
});

describe('failure handling', () => {
  it('reports an unreachable remote as an error without throwing, and keeps local work committed', async () => {
    const s = scenario();
    git(s.a, 'remote', 'set-url', 'origin', path.join(root, 'does-not-exist.git'));
    write(s.a, 'one.md', '<p>offline edit</p>\n');
    const st = await syncNow(s.a);
    expect(st.phase).toBe('error');
    expect(st.message).toBeTruthy();
    expect(git(s.a, 'status', '--porcelain')).toBe(''); // the edit was committed locally
    expect(git(s.a, 'log', '-1', '--format=%s')).toMatch(/^sync: /);
  });

  it('never echoes credentials from a remote URL into the error message', async () => {
    const s = scenario();
    git(s.a, 'remote', 'set-url', 'origin', 'https://someuser:hunter2secret@127.0.0.1:1/x.git');
    const st = await syncNow(s.a);
    expect(st.phase).toBe('error');
    expect(st.message).not.toContain('hunter2secret');
  });

  it.skipIf(process.platform === 'win32')(
    'recovers when the remote moves between fetch and push (refetch, re-merge, retry)',
    async () => {
      const s = scenario();
      // A pre-push hook that, once, lands another commit on the remote first —
      // so the real push is rejected. (git also rejects this race for a forced
      // push, so this proves the retry; the no-force guarantee is the static test below.)
      const marker = path.join(root, `hook-fired-${n}`);
      const hook = path.join(s.a, '.git', 'hooks', 'pre-push');
      fs.writeFileSync(
        hook,
        `#!/bin/sh
[ -e "${marker}" ] && exit 0
touch "${marker}"
cd "${s.b}" && git pull -q --ff-only && echo racing > race.md && git add -A \
  && git -c user.name=B -c user.email=b@example.com commit -q -m race && git push -q origin main
exit 0
`,
        { mode: 0o755 },
      );
      write(s.a, 'one.md', '<p>mine</p>\n');
      const st = await syncNow(s.a);
      expect(fs.existsSync(marker)).toBe(true);
      expect(st.phase).toBe('idle');
      // Both the racing commit and ours survive on the remote: history was merged, not overwritten.
      expect(git(s.remote, 'show', 'main:race.md')).toBe('racing');
      expect(git(s.remote, 'show', 'main:one.md')).toBe('<p>mine</p>');
      expect(remoteHead(s)).toBe(git(s.a, 'rev-parse', 'HEAD'));
    },
  );

  it('never builds a forced push', () => {
    const src = fs.readFileSync(path.join(__dirname, 'git-sync.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const pushCalls = code.split('\n').filter(l => /'push'/.test(l));
    expect(pushCalls.length).toBeGreaterThan(0);
    for (const line of pushCalls) expect(line).not.toMatch(/force|'-f'|\+refs|\+\$\{/i);
    // A forced refspec ("+src:dst") can only come from the one place refspecs are built.
    expect(code).toMatch(/const pushRef = `refs\/heads\/\$\{t\.branch\}:\$\{t\.mergeRef\}`;/);
  });
});

describe('conflicts', () => {
  async function conflicted() {
    const s = scenario();
    write(s.a, 'one.md', '<p>one from a</p>\n');
    pushFromB(s, 'one.md', '<p>one from b</p>\n');
    const st = await syncNow(s.a);
    return { s, st };
  }

  it('pauses on a real conflict, reports all three sides, and leaves the vault untouched', async () => {
    const { s, st } = await conflicted();
    expect(st.phase).toBe('conflict');
    expect(st.conflicts).toHaveLength(1);
    const c = st.conflicts[0];
    expect(c).toMatchObject({
      path: 'one.md', kind: 'both-modified', binary: false,
      base: '<p>one</p>\n', ours: '<p>one from a</p>\n', theirs: '<p>one from b</p>\n',
    });
    expect(c.oursSha).toBeTruthy();
    expect(c.theirsSha).toBeTruthy();
    // The user's notes never contain conflict markers, and the repo is not mid-merge.
    expect(read(s.a, 'one.md')).toBe('<p>one from a</p>\n');
    expect(hasMarkers(s.a)).toBe(false);
    expect(git(s.a, 'status', '--porcelain')).toBe('');
    expect(fs.existsSync(path.join(s.a, '.git', 'MERGE_HEAD'))).toBe(false);
    expect(worktrees(s.a)).toBe(1);
    // Nothing reached the remote.
    expect(git(s.remote, 'show', 'main:one.md')).toBe('<p>one from b</p>');
  });

  it('stays paused on later cycles without redoing work, but still commits new local edits', async () => {
    const { s } = await conflicted();
    const remoteBefore = remoteHead(s);
    const again = await syncNow(s.a);
    expect(again.phase).toBe('conflict');
    expect(again.conflicts).toHaveLength(1);

    write(s.a, 'two.md', '<p>typed while paused</p>\n');
    const afterEdit = await syncNow(s.a);
    expect(afterEdit.phase).toBe('conflict');
    expect(git(s.a, 'status', '--porcelain')).toBe(''); // the edit is safely committed...
    expect(git(s.a, 'log', '-1', '--format=%s')).toMatch(/^sync: /);
    expect(remoteHead(s)).toBe(remoteBefore); // ...but nothing is pushed while paused
  });

  it('resolves with hand-edited content: merge commit, pushed, vault clean', async () => {
    const { s, st } = await conflicted();
    const c = st.conflicts[0];
    const res = await resolveConflicts(s.a, [
      { path: c.path, oursSha: c.oursSha, theirsSha: c.theirsSha, choice: 'content', content: '<p>one from a and b</p>\n' },
    ]);
    expect(res.success).toBe(true);
    expect(res.data?.phase).toBe('idle');
    expect(read(s.a, 'one.md')).toBe('<p>one from a and b</p>\n');
    expect(hasMarkers(s.a)).toBe(false);
    expect(git(s.a, 'status', '--porcelain')).toBe('');
    expect(git(s.a, 'rev-list', '--parents', '-1', 'HEAD').split(' ').length).toBe(3);
    expect(git(s.remote, 'show', 'main:one.md')).toBe('<p>one from a and b</p>');
    expect(remoteHead(s)).toBe(git(s.a, 'rev-parse', 'HEAD'));
    expect(getSyncState(s.a).conflicts).toEqual([]);
    expect(worktrees(s.a)).toBe(1);
  });

  it.each([
    ['ours', '<p>one from a</p>'],
    ['theirs', '<p>one from b</p>'],
  ] as const)('resolves by taking %s', async (choice, expected) => {
    const { s, st } = await conflicted();
    const c = st.conflicts[0];
    const res = await resolveConflicts(s.a, [{ path: c.path, oursSha: c.oursSha, theirsSha: c.theirsSha, choice }]);
    expect(res.success).toBe(true);
    expect(git(s.remote, 'show', 'main:one.md')).toBe(expected);
    expect(read(s.a, 'one.md').trim()).toBe(expected);
  });

  it('rejects a resolution that does not cover every conflict, writing nothing', async () => {
    const s = scenario();
    write(s.a, 'one.md', '<p>a1</p>\n');
    write(s.a, 'two.md', '<p>a2</p>\n');
    pushFromB(s, 'one.md', '<p>b1</p>\n', 'b1');
    pushFromB(s, 'two.md', '<p>b2</p>\n', 'b2');
    const st = await syncNow(s.a);
    expect(st.conflicts.map(c => c.path)).toEqual(['one.md', 'two.md']);
    const [c1] = st.conflicts;
    const headBefore = git(s.a, 'rev-parse', 'HEAD');
    const res = await resolveConflicts(s.a, [{ path: c1.path, oursSha: c1.oursSha, theirsSha: c1.theirsSha, choice: 'ours' }]);
    expect(res.success).toBe(false);
    expect(git(s.a, 'rev-parse', 'HEAD')).toBe(headBefore);
    expect(git(s.remote, 'show', 'main:one.md')).toBe('<p>b1</p>');
  });

  it('rejects a stale review: the remote changed the note again after the user looked', async () => {
    const { s, st } = await conflicted();
    const c = st.conflicts[0];
    pushFromB(s, 'one.md', '<p>one from b, revised</p>\n', 'b revised');
    const headBefore = git(s.a, 'rev-parse', 'HEAD');
    const res = await resolveConflicts(s.a, [
      { path: c.path, oursSha: c.oursSha, theirsSha: c.theirsSha, choice: 'content', content: '<p>stale decision</p>\n' },
    ]);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/changed since you reviewed/i);
    expect(git(s.a, 'rev-parse', 'HEAD')).toBe(headBefore);
    expect(read(s.a, 'one.md')).toBe('<p>one from a</p>\n');
    expect(git(s.remote, 'show', 'main:one.md')).toBe('<p>one from b, revised</p>');
    // The next ordinary sync surfaces the fresh conflict instead.
    const next = await syncNow(s.a);
    expect(next.phase).toBe('conflict');
    expect(next.conflicts[0].theirs).toBe('<p>one from b, revised</p>\n');
  });

  it('reports delete-vs-modify conflicts and can resolve them either way', async () => {
    const s = scenario();
    write(s.a, 'one.md', '<p>a edited</p>\n');
    git(s.b, 'rm', '-q', 'one.md');
    commitAs(s.b, 'b deleted');
    git(s.b, 'push', '-q', 'origin', 'main');
    const st = await syncNow(s.a);
    expect(st.phase).toBe('conflict');
    const c = st.conflicts[0];
    expect(c.kind).toBe('deleted-by-them');
    expect(c.theirs).toBeNull();
    expect(c.theirsSha).toBeNull();

    const res = await resolveConflicts(s.a, [{ path: c.path, oursSha: c.oursSha, theirsSha: c.theirsSha, choice: 'theirs' }]);
    expect(res.success).toBe(true);
    expect(fs.existsSync(path.join(s.a, 'one.md'))).toBe(false); // taking "theirs" = their deletion
    expect(() => git(s.remote, 'show', 'main:one.md')).toThrow();
  });

  it('treats a binary conflict as choose-a-side only', async () => {
    const s = scenario();
    write(s.a, 'img.bin', Buffer.from([0, 1, 2, 3]));
    git(s.a, 'add', '-A');
    commitAs(s.a, 'bin');
    git(s.a, 'push', '-q', 'origin', 'main');
    git(s.b, 'pull', '-q', '--ff-only');
    write(s.a, 'img.bin', Buffer.from([0, 9, 9, 9]));
    write(s.b, 'img.bin', Buffer.from([0, 7, 7, 7]));
    git(s.b, 'add', '-A');
    commitAs(s.b, 'bin b');
    git(s.b, 'push', '-q', 'origin', 'main');
    const st = await syncNow(s.a);
    expect(st.phase).toBe('conflict');
    const c = st.conflicts[0];
    expect(c.binary).toBe(true);
    expect(c.ours).toBeNull();
    expect(c.theirs).toBeNull();
    const res = await resolveConflicts(s.a, [{ path: c.path, oursSha: c.oursSha, theirsSha: c.theirsSha, choice: 'ours' }]);
    expect(res.success).toBe(true);
    expect([...fs.readFileSync(path.join(s.a, 'img.bin'))]).toEqual([0, 9, 9, 9]);
  });
});

describe('parseConflictResolutions (untrusted IPC input)', () => {
  const sha = 'a'.repeat(40);
  const ok = { path: 'one.md', oursSha: sha, theirsSha: sha, choice: 'ours' };

  it('accepts well-formed input, including absent sides', () => {
    expect(parseConflictResolutions([ok])).toEqual([ok]);
    expect(parseConflictResolutions([{ ...ok, theirsSha: null, choice: 'content', content: 'x' }])).toHaveLength(1);
  });

  it.each([
    ['not an array', 'x'],
    ['empty', []],
    ['non-object entry', [1]],
    ['empty path', [{ ...ok, path: '' }]],
    ['NUL in path', [{ ...ok, path: 'a\0b' }]],
    ['duplicate path', [ok, ok]],
    ['bad sha', [{ ...ok, oursSha: 'not-a-sha' }]],
    ['undefined sha', [{ path: 'a', choice: 'ours' }]],
    ['unknown choice', [{ ...ok, choice: 'rm -rf' }]],
    ['content choice without content', [{ ...ok, choice: 'content' }]],
    ['non-string content', [{ ...ok, choice: 'content', content: 5 }]],
  ])('rejects %s', (_label, input) => {
    expect(parseConflictResolutions(input)).toBeNull();
  });

  it('drops unexpected fields instead of passing them through', () => {
    const [r] = parseConflictResolutions([{ ...ok, evil: 'x' }])!;
    expect(r).not.toHaveProperty('evil');
  });
});
