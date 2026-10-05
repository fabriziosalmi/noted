/**
 * git-sync.ts — unattended pull → commit → push for the notes repository.
 *
 * Guarantees this module is built around:
 *  - It NEVER force-pushes. Pushes are plain fast-forward pushes; a rejection
 *    triggers one fetch + re-merge + retry, then an error until the next cycle.
 *  - It NEVER leaves conflict markers in the user's notes. A diverged history is
 *    merged inside a throwaway worktree OUTSIDE the vault; only a finished,
 *    conflict-free merge commit is fast-forwarded into the real branch. When the
 *    merge conflicts, sync PAUSES and reports the conflicts; the vault is
 *    untouched until the user resolves them.
 *  - Local edits are always committed first, even while paused, so nothing the
 *    user typed is ever only in the working tree.
 *  - It never prompts: no terminal credential prompt, and every git call has a
 *    timeout, so a bad credential cannot hang the app.
 *  - It only syncs when the current branch already has an upstream. It does not
 *    invent remotes or branches.
 *
 * All public functions return a SyncState (or GitResult) and never throw.
 */

import simpleGit, { type SimpleGit } from 'simple-git';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { sanitizeGitError, type GitResult } from './git-ops';
import { withRepoLock } from './repo-lock';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SyncPhase = 'idle' | 'syncing' | 'conflict' | 'error' | 'unconfigured';

export type ConflictKind =
  | 'both-modified'
  | 'both-added'
  | 'deleted-by-us'
  | 'deleted-by-them';

export interface SyncConflict {
  path: string;
  kind: ConflictKind;
  /** Binary or oversized: no text sides are provided; only ours/theirs can be chosen. */
  binary: boolean;
  /** Merge-base, local ("ours") and remote ("theirs") text. null = absent on that side. */
  base: string | null;
  ours: string | null;
  theirs: string | null;
  /** Blob ids of each side, echoed back on resolve so a stale view is rejected. */
  oursSha: string | null;
  theirsSha: string | null;
}

export interface SyncState {
  phase: SyncPhase;
  branch: string | null;
  upstream: string | null;
  /** Epoch ms of the last fully successful cycle. */
  lastSyncAt: number | null;
  /** Human-readable reason for 'error' / 'unconfigured'. */
  message: string | null;
  conflicts: SyncConflict[];
}

export type ResolutionChoice = 'ours' | 'theirs' | 'content' | 'delete';

export interface ConflictResolution {
  path: string;
  /** The oursSha/theirsSha the user was looking at (from SyncConflict). */
  oursSha: string | null;
  theirsSha: string | null;
  choice: ResolutionChoice;
  /** Required when choice === 'content'. */
  content?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const GIT_TIMEOUT_MS = 120_000;
/** Text sides larger than this are not shipped to the renderer. */
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_ATTEMPTS = 2;

// ─── Git plumbing ─────────────────────────────────────────────────────────────

/**
 * Unattended git must fail instead of asking. These are inherited by every git
 * child process. We set them on this process rather than passing an `env` to
 * simple-git: that replaces the child's whole environment and makes simple-git
 * reject common user variables (GIT_EDITOR, GIT_ASKPASS, GIT_SSH_COMMAND, ...).
 * Respect an explicit choice the user already made.
 */
function forbidPrompts(): void {
  process.env.GIT_TERMINAL_PROMPT ??= '0';
  process.env.GCM_INTERACTIVE ??= 'never';
}

function gitFor(dir: string, trimmed = true): SimpleGit {
  forbidPrompts();
  return simpleGit(dir, {
    binary: 'git',
    maxConcurrentProcesses: 1,
    trimmed,
    timeout: { block: GIT_TIMEOUT_MS },
  });
}

/** `git <args>` that tolerates a non-zero exit with no stderr (e.g. `rev-parse -q`). */
async function tryRaw(g: SimpleGit, args: string[]): Promise<string> {
  try {
    return await g.raw(args);
  } catch {
    return '';
  }
}

let identityCache = new Map<string, string[]>();

/**
 * `-c user.*` flags, only when the repo has no identity of its own configured.
 * Needed on EVERY command that updates a ref (commit, merge, worktree add, ...):
 * git refuses with "Committer identity unknown" when it cannot guess one, which
 * is the normal case on CI runners and fresh Linux/Windows installs.
 */
async function identityArgs(g: SimpleGit, dir: string): Promise<string[]> {
  const cached = identityCache.get(dir);
  if (cached) return cached;
  const email = await tryRaw(g, ['config', 'user.email']);
  const args = email ? [] : ['-c', 'user.name=Noted', '-c', 'user.email=noted@local'];
  identityCache.set(dir, args);
  return args;
}

/** Test hook: identity detection is cached per directory. */
export function _resetSyncCachesForTest(): void {
  identityCache = new Map();
  states.clear();
  pausedAt.clear();
}

// ─── State ────────────────────────────────────────────────────────────────────

const states = new Map<string, SyncState>();
/** HEAD/upstream pair the conflict list was computed for; avoids redoing the merge every cycle. */
const pausedAt = new Map<string, string>();
let listener: ((dir: string, state: SyncState) => void) | null = null;

const initialState = (): SyncState => ({
  phase: 'idle',
  branch: null,
  upstream: null,
  lastSyncAt: null,
  message: null,
  conflicts: [],
});

export function getSyncState(dir: string): SyncState {
  return states.get(path.resolve(dir)) ?? initialState();
}

/** Subscribe to every state change (main process forwards these to the renderer). */
export function setSyncListener(fn: ((dir: string, state: SyncState) => void) | null): void {
  listener = fn;
}

function setState(dir: string, patch: Partial<SyncState>): SyncState {
  const key = path.resolve(dir);
  const next = { ...(states.get(key) ?? initialState()), ...patch };
  states.set(key, next);
  try { listener?.(dir, next); } catch { /* a broken listener must not break sync */ }
  return next;
}

// ─── Repository inspection ────────────────────────────────────────────────────

interface Tracking {
  branch: string;
  remote: string;
  /** Full ref on the remote, e.g. refs/heads/main. */
  mergeRef: string;
}

class SyncBlocked extends Error {
  constructor(public phase: 'error' | 'unconfigured', message: string) {
    super(message);
  }
}

async function inspectTracking(g: SimpleGit, dir: string): Promise<Tracking> {
  if (!fs.existsSync(path.join(dir, '.git'))) {
    throw new SyncBlocked('unconfigured', 'The notes folder is not a Git repository.');
  }
  const gitDir = (await tryRaw(g, ['rev-parse', '--absolute-git-dir'])).trim();
  if (!gitDir) throw new SyncBlocked('error', 'Could not read the Git directory.');
  for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply']) {
    if (fs.existsSync(path.join(gitDir, marker))) {
      throw new SyncBlocked(
        'error',
        'A merge or rebase is already in progress in the notes repository. Finish or abort it, then sync again.',
      );
    }
  }
  const branch = (await tryRaw(g, ['symbolic-ref', '--short', '-q', 'HEAD'])).trim();
  if (!branch) {
    throw new SyncBlocked('error', 'The notes repository is on a detached HEAD; switch to a branch to sync.');
  }
  const remote = (await tryRaw(g, ['config', '--get', `branch.${branch}.remote`])).trim();
  const mergeRef = (await tryRaw(g, ['config', '--get', `branch.${branch}.merge`])).trim();
  if (!remote || !mergeRef) {
    throw new SyncBlocked(
      'unconfigured',
      `Branch "${branch}" has no upstream. Set one (git push -u <remote> ${branch}) to enable sync.`,
    );
  }
  if (remote === '.') {
    throw new SyncBlocked('error', `Branch "${branch}" tracks a local branch, not a remote.`);
  }
  return { branch, remote, mergeRef };
}

async function revParse(g: SimpleGit, rev: string): Promise<string | null> {
  const out = (await tryRaw(g, ['rev-parse', '-q', '--verify', rev])).trim();
  return out || null;
}

/**
 * Files that live in the vault folder but must never be synced: the app's own
 * version history (a snapshot per autosave would bloat the remote and leak every
 * intermediate draft), the half-written temp file of an in-flight atomic save,
 * and OS litter. Written to the repo-local `info/exclude` rather than a tracked
 * .gitignore so we never modify the user's repository content.
 */
const LOCAL_EXCLUDES = ['.noted_history/', '*.tmp', '.DS_Store', 'Thumbs.db'];

async function ensureLocalExcludes(g: SimpleGit, dir: string): Promise<void> {
  const common = (await tryRaw(g, ['rev-parse', '--git-common-dir'])).trim();
  if (!common) return;
  const file = path.join(path.resolve(dir, common), 'info', 'exclude');
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const have = new Set(current.split(/\r?\n/).map(l => l.trim()));
  const missing = LOCAL_EXCLUDES.filter(p => !have.has(p));
  if (missing.length === 0) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sep = current === '' || current.endsWith('\n') ? '' : '\n';
  fs.writeFileSync(file, `${current}${sep}# Noted sync\n${missing.join('\n')}\n`, 'utf8');
}

/** Commits any local change. Returns true when a commit was made. */
async function commitLocalChanges(g: SimpleGit, dir: string): Promise<boolean> {
  await ensureLocalExcludes(g, dir);
  const porcelain = await tryRaw(g, ['status', '--porcelain']);
  if (!porcelain.trim()) return false;
  await g.raw(['add', '-A']);
  const staged = (await tryRaw(g, ['diff', '--cached', '--name-only'])).trim();
  if (!staged) return false; // only ignored/no-op changes
  const id = await identityArgs(g, dir);
  await g.raw([...id, 'commit', '-m', `sync: ${new Date().toISOString()}`]);
  return true;
}

// ─── Conflict extraction ──────────────────────────────────────────────────────

interface Stages { 1?: string; 2?: string; 3?: string }

/** Unmerged index entries of a worktree, grouped by path. */
async function readUnmerged(wt: SimpleGit): Promise<Map<string, Stages>> {
  const out = await tryRaw(wt, ['ls-files', '-u', '-z']);
  const map = new Map<string, Stages>();
  for (const entry of out.split('\0')) {
    if (!entry) continue;
    const m = /^\d+ ([0-9a-f]+) ([123])\t([\s\S]+)$/.exec(entry);
    if (!m) continue;
    const stages = map.get(m[3]) ?? {};
    stages[Number(m[2]) as 1 | 2 | 3] = m[1];
    map.set(m[3], stages);
  }
  return map;
}

function kindOf(s: Stages): ConflictKind {
  if (s[2] && s[3]) return s[1] ? 'both-modified' : 'both-added';
  return s[2] ? 'deleted-by-them' : 'deleted-by-us';
}

/** Blob text, or null for "absent" / "not representable as text". */
async function readBlob(raw: SimpleGit, sha: string | undefined): Promise<{ text: string | null; binary: boolean }> {
  if (!sha) return { text: null, binary: false };
  const size = Number((await tryRaw(raw, ['cat-file', '-s', sha])).trim());
  if (!Number.isFinite(size) || size > MAX_TEXT_BYTES) return { text: null, binary: true };
  const text = await raw.raw(['cat-file', 'blob', sha]);
  // eslint-disable-next-line no-control-regex
  if (/\x00/.test(text)) return { text: null, binary: true };
  return { text, binary: false };
}

async function describeConflicts(dir: string, unmerged: Map<string, Stages>): Promise<SyncConflict[]> {
  // Untrimmed: trailing newlines are part of the note.
  const raw = gitFor(dir, false);
  const out: SyncConflict[] = [];
  for (const [p, s] of [...unmerged].sort(([a], [b]) => a.localeCompare(b))) {
    const [base, ours, theirs] = await Promise.all([readBlob(raw, s[1]), readBlob(raw, s[2]), readBlob(raw, s[3])]);
    out.push({
      path: p,
      kind: kindOf(s),
      binary: base.binary || ours.binary || theirs.binary,
      base: base.text,
      ours: ours.text,
      theirs: theirs.text,
      oursSha: s[2] ?? null,
      theirsSha: s[3] ?? null,
    });
  }
  return out;
}

// ─── Merge in a throwaway worktree ────────────────────────────────────────────

async function withTempWorktree<T>(
  g: SimpleGit,
  id: string[],
  fn: (wt: SimpleGit) => Promise<T>,
): Promise<T> {
  await tryRaw(g, ['worktree', 'prune']); // forget worktrees a crashed run left behind
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-sync-'));
  try {
    await g.raw([...id, 'worktree', 'add', '--detach', tmp, 'HEAD']);
    return await fn(gitFor(tmp));
  } finally {
    await tryRaw(g, ['worktree', 'remove', '--force', tmp]);
    fs.rmSync(tmp, { recursive: true, force: true });
    await tryRaw(g, ['worktree', 'prune']);
  }
}

type MergeOutcome =
  | { kind: 'merged'; commit: string }
  | { kind: 'conflict'; conflicts: SyncConflict[] };

/**
 * Merge `theirs` into HEAD inside a temporary worktree.
 *  - No resolutions: report conflicts, or return the finished merge commit.
 *  - With resolutions: apply them (they must cover every conflict, against the
 *    exact blobs the user saw) and return the merge commit.
 */
async function mergeInWorktree(
  g: SimpleGit,
  dir: string,
  theirs: string,
  message: string,
  resolutions?: ConflictResolution[],
): Promise<MergeOutcome> {
  const id = await identityArgs(g, dir);
  return withTempWorktree(g, id, async wt => {
    let mergeError: Error | null = null;
    try {
      await wt.raw([...id, 'merge', '--no-commit', '--no-ff', theirs]);
    } catch (e) {
      mergeError = e as Error;
    }
    const unmerged = await readUnmerged(wt);
    const pending = Boolean(await revParse(wt, 'MERGE_HEAD'));

    if (unmerged.size > 0) {
      if (!resolutions) {
        return { kind: 'conflict', conflicts: await describeConflicts(dir, unmerged) } as MergeOutcome;
      }
      await applyResolutions(wt, unmerged, resolutions);
    } else if (!pending) {
      // The merge neither conflicted nor staged anything: a real failure
      // (unrelated histories, dirty temp tree, ...). Surface it.
      throw mergeError ?? new Error('Merge produced no result.');
    } else if (resolutions && resolutions.length > 0) {
      throw new StaleResolution('The conflicts were resolved by someone else in the meantime. Sync again.');
    }

    await wt.raw([...id, 'commit', '-m', message]);
    const commit = (await wt.revparse(['HEAD'])).trim();
    return { kind: 'merged', commit } as MergeOutcome;
  });
}

class StaleResolution extends Error {}

async function applyResolutions(
  wt: SimpleGit,
  unmerged: Map<string, Stages>,
  resolutions: ConflictResolution[],
): Promise<void> {
  const byPath = new Map(resolutions.map(r => [r.path, r]));
  const missing = [...unmerged.keys()].filter(p => !byPath.has(p));
  const unknown = resolutions.filter(r => !unmerged.has(r.path));
  if (missing.length > 0 || unknown.length > 0 || byPath.size !== resolutions.length) {
    throw new StaleResolution('The set of conflicting notes changed since you reviewed it. Review it again.');
  }
  for (const [p, stages] of unmerged) {
    const r = byPath.get(p)!;
    if ((r.oursSha ?? null) !== (stages[2] ?? null) || (r.theirsSha ?? null) !== (stages[3] ?? null)) {
      throw new StaleResolution(`"${p}" changed since you reviewed it. Review it again.`);
    }
  }
  for (const [p, stages] of unmerged) {
    const r = byPath.get(p)!;
    switch (r.choice) {
      case 'content': {
        if (typeof r.content !== 'string') throw new Error(`Missing resolved content for "${p}".`);
        await writeInWorktree(wt, p, r.content);
        await wt.raw(['add', '--', p]);
        break;
      }
      case 'ours':
      case 'theirs': {
        const side = r.choice === 'ours' ? stages[2] : stages[3];
        if (!side) await wt.raw(['rm', '-f', '--', p]); // that side deleted the note
        else {
          await wt.raw(['checkout', r.choice === 'ours' ? '--ours' : '--theirs', '--', p]);
          await wt.raw(['add', '--', p]);
        }
        break;
      }
      case 'delete':
        await wt.raw(['rm', '-f', '--', p]);
        break;
      default:
        throw new Error(`Unknown resolution for "${p}".`);
    }
  }
}

async function writeInWorktree(wt: SimpleGit, relPath: string, content: string): Promise<void> {
  const root = (await wt.revparse(['--show-toplevel'])).trim();
  const abs = path.resolve(root, relPath);
  // relPath came from git's own unmerged list, but never write outside the worktree.
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error('Refusing to write outside the worktree.');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

// ─── The sync cycle ───────────────────────────────────────────────────────────

const isRejected = (msg: string) =>
  /rejected|non-fast-forward|fetch first|failed to push some refs/i.test(msg);

async function cycle(
  g: SimpleGit,
  dir: string,
  t: Tracking,
  resolutions?: ConflictResolution[],
): Promise<SyncState> {
  await commitLocalChanges(g, dir);
  const head = await revParse(g, 'HEAD');
  if (!head) throw new SyncBlocked('error', 'The notes repository has no commits yet.');

  await g.raw(['fetch', t.remote]);

  const upstream = await revParse(g, `${t.branch}@{upstream}`);
  const upstreamName =
    (await tryRaw(g, ['rev-parse', '--abbrev-ref', `${t.branch}@{upstream}`])).trim() ||
    `${t.remote}/${t.mergeRef.replace(/^refs\/heads\//, '')}`;

  const pushRef = `refs/heads/${t.branch}:${t.mergeRef}`;

  // The remote has no such branch yet: the first push creates it.
  if (!upstream) {
    await g.raw(['push', t.remote, pushRef]);
    return finish(dir, t, upstreamName);
  }

  const counts = (await g.raw(['rev-list', '--left-right', '--count', `HEAD...${upstream}`])).trim().split(/\s+/);
  const ahead = Number(counts[0]);
  const behind = Number(counts[1]);
  if (!Number.isFinite(ahead) || !Number.isFinite(behind)) throw new Error('Could not compare with the remote.');

  if (behind > 0 && ahead > 0) {
    const key = path.resolve(dir);
    const pauseKey = `${head}:${upstream}`;
    if (!resolutions && pausedAt.get(key) === pauseKey) {
      // Same divergence we already reported: stay paused without redoing the merge.
      return setState(dir, { phase: 'conflict', message: null });
    }
    const outcome = await mergeInWorktree(
      g, dir, upstream, `sync: merge ${upstreamName} into ${t.branch}`, resolutions,
    );
    if (outcome.kind === 'conflict') {
      pausedAt.set(key, pauseKey);
      return setState(dir, {
        phase: 'conflict', branch: t.branch, upstream: upstreamName, message: null, conflicts: outcome.conflicts,
      });
    }
    // Conflict-free (or resolved): move the real branch onto the finished merge commit.
    await g.raw([...(await identityArgs(g, dir)), 'merge', '--ff-only', outcome.commit]);
  } else if (behind > 0) {
    await g.raw([...(await identityArgs(g, dir)), 'merge', '--ff-only', upstream]);
  } else if (resolutions && resolutions.length > 0) {
    throw new StaleResolution('There is nothing left to resolve. Sync again.');
  }

  // Only push when we have something the remote lacks (after a merge that is the
  // merge commit). A pure pull must not touch the remote: it may be read-only.
  if (ahead > 0) await g.raw(['push', t.remote, pushRef]);
  return finish(dir, t, upstreamName);
}

function finish(dir: string, t: Tracking, upstreamName: string): SyncState {
  pausedAt.delete(path.resolve(dir));
  return setState(dir, {
    phase: 'idle', branch: t.branch, upstream: upstreamName, lastSyncAt: Date.now(), message: null, conflicts: [],
  });
}

async function runSync(dir: string, resolutions?: ConflictResolution[]): Promise<SyncState> {
  const g = gitFor(dir);
  const prev = getSyncState(dir);
  // Keep any outstanding conflicts visible while we work.
  setState(dir, { phase: 'syncing', message: null });
  try {
    const tracking = await inspectTracking(g, dir);
    for (let attempt = 1; ; attempt++) {
      try {
        // The user's decisions are applied on the first attempt only; a retry
        // after a rejected push is a fresh merge against the newer remote.
        return await cycle(g, dir, tracking, attempt === 1 ? resolutions : undefined);
      } catch (e) {
        // Remote moved between our fetch and push: refetch, re-merge, try once more.
        const retry = attempt < MAX_ATTEMPTS && !(e instanceof StaleResolution) && isRejected((e as Error).message);
        if (!retry) throw e;
      }
    }
  } catch (e) {
    if (e instanceof SyncBlocked) {
      return setState(dir, { phase: e.phase, message: e.message, conflicts: [], upstream: null });
    }
    if (e instanceof StaleResolution) {
      // The user's view is out of date: drop it so the next sync recomputes the conflicts.
      pausedAt.delete(path.resolve(dir));
      return setState(dir, { phase: 'error', message: e.message, conflicts: [] });
    }
    const message = sanitizeGitError((e as Error).message || String(e));
    // A transient failure (network, auth) must not hide an unresolved conflict.
    if (prev.phase === 'conflict' && prev.conflicts.length > 0) {
      return setState(dir, { phase: 'conflict', message, conflicts: prev.conflicts });
    }
    return setState(dir, { phase: 'error', message, conflicts: [] });
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** One sync cycle: commit local edits, fetch, merge, push. Never throws. */
export function syncNow(dir: string): Promise<SyncState> {
  return withRepoLock(dir, () => runSync(dir));
}

/**
 * Finish a paused sync with the user's decisions. Every conflict must be
 * resolved, each against the exact blobs the user reviewed; otherwise nothing
 * is written and the user is asked to review again.
 */
export function resolveConflicts(
  dir: string,
  resolutions: ConflictResolution[],
): Promise<GitResult<SyncState>> {
  return withRepoLock(dir, async () => {
    if (!Array.isArray(resolutions) || resolutions.length === 0) {
      return { success: false, error: 'No resolutions given.' };
    }
    const state = await runSync(dir, resolutions);
    return state.phase === 'idle'
      ? { success: true, data: state }
      : { success: false, data: state, error: state.message ?? 'Could not apply the resolutions.' };
  });
}

// ─── Input validation (the renderer is not trusted) ───────────────────────────

const SHA_RE = /^[0-9a-f]{40,64}$/;
const MAX_RESOLUTIONS = 1000;
const MAX_RESOLVED_BYTES = 5 * 1024 * 1024;
const CHOICES: ReadonlySet<string> = new Set(['ours', 'theirs', 'content', 'delete']);

/** Validate an IPC payload into ConflictResolution[]; null when malformed. */
export function parseConflictResolutions(input: unknown): ConflictResolution[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_RESOLUTIONS) return null;
  const out: ConflictResolution[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== 'object' || raw === null) return null;
    const r = raw as Record<string, unknown>;
    const p = r.path;
    if (typeof p !== 'string' || !p || p.length > 1024 || p.includes('\0') || seen.has(p)) return null;
    seen.add(p);
    const sha = (v: unknown): string | null | undefined =>
      v === null ? null : typeof v === 'string' && SHA_RE.test(v) ? v : undefined;
    const oursSha = sha(r.oursSha);
    const theirsSha = sha(r.theirsSha);
    if (oursSha === undefined || theirsSha === undefined) return null;
    if (typeof r.choice !== 'string' || !CHOICES.has(r.choice)) return null;
    const choice = r.choice as ResolutionChoice;
    let content: string | undefined;
    if (choice === 'content') {
      if (typeof r.content !== 'string' || Buffer.byteLength(r.content, 'utf8') > MAX_RESOLVED_BYTES) return null;
      content = r.content;
    }
    out.push({ path: p, oursSha, theirsSha, choice, ...(content !== undefined ? { content } : {}) });
  }
  return out;
}
