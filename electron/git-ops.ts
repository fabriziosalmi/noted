/**
 * git-ops.ts — All Git operations for Noted's optional Git integration.
 *
 * Rules:
 *  - Never exec shell commands with user-provided strings; use simple-git API only.
 *  - All public functions return { success, data?, error? } — never throw to callers.
 *  - Remote URLs are validated before any network operation.
 *  - Branch names are sanitized (slug) before creation.
 *  - GitHub tokens are never logged.
 */

import simpleGit, { type SimpleGit, type DefaultLogFields } from 'simple-git';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GitResult<T = undefined> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface GitStatusData {
  initialized: boolean;
  branch: string;
  dirty: boolean;           // uncommitted changes exist
  ahead: number;            // commits ahead of remote
  stagedFiles: string[];
  modifiedFiles: string[];
}

export interface GitLogEntry {
  hash: string;
  date: string;
  message: string;
  author: string;
}

export interface PrData {
  url: string;
  number: number;
  title: string;
}

// ─── Validation helpers ───────────────────────────────────────────────────────

const GITHUB_HTTPS = /^https:\/\/github\.com\/[\w.\-]+\/[\w.\-]+(\.git)?$/;
const GITHUB_SSH   = /^git@github\.com:[\w.\-]+\/[\w.\-]+(\.git)?$/;

export function validateRemoteUrl(url: string): void {
  if (!GITHUB_HTTPS.test(url) && !GITHUB_SSH.test(url)) {
    throw new Error('Remote URL must be a valid GitHub HTTPS or SSH URL');
  }
}

/** Returns owner/repo from a GitHub remote URL, or throws. */
export function parseGitHubRepo(remoteUrl: string): { owner: string; repo: string } {
  validateRemoteUrl(remoteUrl);
  // Strip protocol / host
  const segment = remoteUrl
    .replace(/^https:\/\/github\.com\//, '')
    .replace(/^git@github\.com:/, '')
    .replace(/\.git$/, '');
  const [owner, repo] = segment.split('/');
  if (!owner || !repo) throw new Error('Cannot parse owner/repo from remote URL');
  return { owner, repo };
}

/** Slugifies a note name for use as a branch name. */
export function noteBranchName(noteName: string): string {
  return 'note/' + noteName
    .replace(/\.md$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Validates a custom commit message — no shell metacharacters. */
function validateCommitMessage(msg: string): void {
  if (msg.length > 500) throw new Error('Commit message too long (max 500 chars)');
  // simple-git passes the message as a string arg, not a shell command,
  // but we still strip potential control characters
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(msg)) {
    throw new Error('Commit message contains invalid characters');
  }
}

// ─── Git factory ──────────────────────────────────────────────────────────────

function git(dir: string): SimpleGit {
  return simpleGit(dir, { binary: 'git', maxConcurrentProcesses: 1, trimmed: true });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Returns true if dir is inside a git repository. */
export async function isRepo(dir: string): Promise<boolean> {
  try {
    await git(dir).revparse(['--git-dir']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Initializes a new git repository in dir.
 * Creates .gitignore and an initial commit.
 */
export async function initRepo(dir: string): Promise<GitResult> {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const g = git(dir);
    await g.init();

    // Force main as default branch (git 2.28+)
    try { await g.raw(['checkout', '-b', 'main']); } catch { /* already on main */ }

    // Write .gitignore
    const giPath = path.join(dir, '.gitignore');
    if (!fs.existsSync(giPath)) {
      fs.writeFileSync(giPath, [
        '# Noted — auto-generated',
        '.DS_Store',
        '*.tmp',
        'Thumbs.db',
        '',
      ].join('\n'), 'utf8');
    }

    // Config user identity if not set globally (avoids "Please tell me who you are" error)
    try { await g.raw(['config', 'user.email']); } catch {
      await g.addConfig('user.email', 'noted@local');
      await g.addConfig('user.name', 'Noted');
    }

    // Initial commit
    await g.add('.gitignore');
    await g.commit('chore: init Noted notes repository', { '--allow-empty': null });

    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/** Returns the current git status of the notes directory. */
export async function getStatus(dir: string): Promise<GitResult<GitStatusData>> {
  try {
    const initialized = await isRepo(dir);
    if (!initialized) {
      return { success: true, data: { initialized: false, branch: '', dirty: false, ahead: 0, stagedFiles: [], modifiedFiles: [] } };
    }
    const g = git(dir);
    const status = await g.status();
    return {
      success: true,
      data: {
        initialized: true,
        branch: status.current ?? 'HEAD',
        dirty: !status.isClean(),
        ahead: status.ahead,
        stagedFiles: status.staged,
        modifiedFiles: [...status.modified, ...status.not_added],
      },
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Stages and commits a single note file.
 * If customMessage is omitted, generates one from the note name.
 */
export async function commitNote(
  dir: string,
  noteName: string,
  customMessage?: string,
): Promise<GitResult<{ hash: string }>> {
  try {
    const g = git(dir);
    const msg = customMessage?.trim()
      ? customMessage.trim()
      : `docs: update ${noteName.replace(/\.md$/, '')}`;
    validateCommitMessage(msg);

    // Stage the specific note file (safe: noteName validated by Electron IPC before reaching here)
    await g.add(noteName);
    const result = await g.commit(msg);
    return { success: true, data: { hash: result.commit } };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Stages and commits all modified notes at once.
 * Used by auto-commit on save.
 */
export async function commitAll(
  dir: string,
  message: string,
): Promise<GitResult<{ hash: string }>> {
  try {
    validateCommitMessage(message);
    const g = git(dir);
    await g.add('.');
    const result = await g.commit(message, { '--allow-empty': null });
    return { success: true, data: { hash: result.commit } };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Creates (or resets) a branch for a note, commits the note there,
 * and returns the branch name. Does NOT push.
 */
export async function preparePrBranch(
  dir: string,
  noteName: string,
  commitMessage?: string,
): Promise<GitResult<{ branch: string; hash: string }>> {
  try {
    const g = git(dir);
    const branch = noteBranchName(noteName);

    // Make sure the note is committed on current branch first
    await g.add(noteName);
    const hasStaged = (await g.status()).staged.length > 0;
    if (hasStaged) {
      const msg = commitMessage?.trim() || `docs: update ${noteName.replace(/\.md$/, '')}`;
      validateCommitMessage(msg);
      await g.commit(msg);
    }

    // Create / reset the PR branch from current HEAD
    const branches = await g.branchLocal();
    if (branches.all.includes(branch)) {
      await g.deleteLocalBranch(branch, true); // force-delete to reset
    }
    await g.checkoutLocalBranch(branch);

    // Switch back to previous branch (usually main)
    const prevBranch = branches.current || 'main';
    await g.checkout(prevBranch);

    // Cherry-pick is tricky with a single-file update — instead we use the
    // branch as a snapshot: checkout branch, ensure note is committed there.
    await g.checkout(branch);
    await g.add(noteName);
    const status = await g.status();
    let hash = '';
    if (status.staged.length > 0) {
      const msg = commitMessage?.trim() || `docs: update ${noteName.replace(/\.md$/, '')}`;
      const result = await g.commit(msg);
      hash = result.commit;
    } else {
      hash = (await g.log({ maxCount: 1 })).latest?.hash ?? '';
    }

    // Go back to main / default
    await g.checkout(prevBranch);

    return { success: true, data: { branch, hash } };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Pushes a branch to the given remote.
 * Validates the remote URL before touching the network.
 */
export async function pushBranch(
  dir: string,
  branch: string,
  remoteUrl: string,
): Promise<GitResult> {
  try {
    validateRemoteUrl(remoteUrl);
    const g = git(dir);

    // Ensure remote 'noted-origin' points to the correct URL
    const remotes = await g.getRemotes(true);
    const existing = remotes.find(r => r.name === 'noted-origin');
    if (existing) {
      if (existing.refs.push !== remoteUrl) {
        await g.remote(['set-url', 'noted-origin', remoteUrl]);
      }
    } else {
      await g.addRemote('noted-origin', remoteUrl);
    }

    await g.push('noted-origin', branch, { '--set-upstream': null });
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/** Returns the git log for a specific note file (or all notes). */
export async function getLog(
  dir: string,
  noteName?: string,
): Promise<GitResult<GitLogEntry[]>> {
  try {
    const g = git(dir);
    const options: { maxCount: number; file?: string } = { maxCount: 50 };
    if (noteName) options.file = noteName;
    const log = await g.log<DefaultLogFields>(options);
    const entries: GitLogEntry[] = log.all.map(e => ({
      hash: e.hash.slice(0, 7),
      date: e.date,
      message: e.message,
      author: e.author_name,
    }));
    return { success: true, data: entries };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Creates a GitHub Pull Request via the REST API.
 * All network I/O is done with Node's built-in fetch (Electron 42 / Node 22+).
 */
export async function createGitHubPr(params: {
  remoteUrl: string;
  token: string;
  branch: string;
  base: string;
  title: string;
  body: string;
}): Promise<GitResult<PrData>> {
  try {
    if (!params.token) throw new Error('GitHub token is required');
    if (!params.title.trim()) throw new Error('PR title is required');
    validateRemoteUrl(params.remoteUrl);
    const { owner, repo } = parseGitHubRepo(params.remoteUrl);

    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Noted-App/1.0',
      },
      body: JSON.stringify({
        title: params.title.trim(),
        body: params.body.trim(),
        head: params.branch,
        base: params.base,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      let msg = `GitHub API error ${res.status}`;
      try {
        const j = JSON.parse(detail) as { message?: string };
        if (j.message) msg += `: ${j.message}`;
      } catch { /* raw text */ }
      throw new Error(msg);
    }

    const pr = await res.json() as { html_url: string; number: number; title: string };
    return { success: true, data: { url: pr.html_url, number: pr.number, title: pr.title } };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
