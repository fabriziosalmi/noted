// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  sanitizeGitError,
  validateRemoteUrl,
  parseGitHubRepo,
  noteBranchName,
} from './git-ops';

// A realistic-shaped GitHub PAT: prefix + 36 token chars (regex requires >= 20).
// slopless-disable-next-line VBC-001 -- invented; this file asserts it is redacted
const TOKEN = 'ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';

describe('sanitizeGitError', () => {
  it('redacts ghp_/ghs_/gho_/ghr_/github_pat_ tokens', () => {
    expect(sanitizeGitError(`remote error using ${TOKEN} then more`)).toBe(
      'remote error using [redacted-token] then more',
    );
    expect(sanitizeGitError('ghs_' + 'a'.repeat(30))).toBe('[redacted-token]');
    expect(sanitizeGitError('gho_' + 'b'.repeat(30))).toBe('[redacted-token]');
    expect(sanitizeGitError('ghr_' + 'c'.repeat(30))).toBe('[redacted-token]');
    expect(sanitizeGitError('github_pat_' + 'd'.repeat(30))).toBe('[redacted-token]');
  });

  it('redacts a token embedded in a remote URL', () => {
    const out = sanitizeGitError(`fatal: unable to access 'https://${TOKEN}@github.com/o/r.git/'`);
    expect(out).not.toContain(TOKEN);
    expect(out).toContain('[redacted-token]');
  });

  it('redacts Bearer, x-access-token and authorization headers in isolation', () => {
    expect(sanitizeGitError('sending Bearer abcdefgh12345678 upstream')).toBe(
      'sending Bearer [redacted] upstream',
    );
    const xat = sanitizeGitError('x-access-token:abc123def456ghi@github.com');
    expect(xat).toContain('x-access-token:[redacted]');
    expect(xat).not.toContain('abc123def456ghi');
    expect(sanitizeGitError('authorization: sometokenvalue')).toBe('authorization: [redacted]');
  });

  it('leaves clean messages intact', () => {
    expect(sanitizeGitError('fatal: not a git repository')).toBe('fatal: not a git repository');
    expect(sanitizeGitError('nothing to commit, working tree clean')).toBe(
      'nothing to commit, working tree clean',
    );
  });
});

describe('validateRemoteUrl', () => {
  it('accepts valid GitHub HTTPS and SSH URLs', () => {
    expect(() => validateRemoteUrl('https://github.com/owner/repo')).not.toThrow();
    expect(() => validateRemoteUrl('https://github.com/owner/repo.git')).not.toThrow();
    expect(() => validateRemoteUrl('git@github.com:owner/repo')).not.toThrow();
    expect(() => validateRemoteUrl('git@github.com:owner/repo.git')).not.toThrow();
    expect(() => validateRemoteUrl('https://github.com/my-org/my.repo-name.git')).not.toThrow();
  });

  it('rejects non-HTTPS, non-GitHub, malformed and credential-bearing URLs', () => {
    expect(() => validateRemoteUrl('http://github.com/owner/repo')).toThrow();
    expect(() => validateRemoteUrl('https://gitlab.com/owner/repo')).toThrow();
    expect(() => validateRemoteUrl('https://github.com/owner')).toThrow(); // missing repo
    expect(() => validateRemoteUrl('https://github.com/owner/repo/tree/main')).toThrow(); // trailing path
    expect(() => validateRemoteUrl('https://user:token@github.com/owner/repo')).toThrow(); // creds in host
    expect(() => validateRemoteUrl('git@evil.com:owner/repo')).toThrow();
    expect(() => validateRemoteUrl('javascript:alert(1)')).toThrow();
    expect(() => validateRemoteUrl('')).toThrow();
  });
});

describe('parseGitHubRepo', () => {
  it('extracts owner/repo from HTTPS and SSH URLs, stripping .git', () => {
    expect(parseGitHubRepo('https://github.com/octocat/Hello-World')).toEqual({
      owner: 'octocat',
      repo: 'Hello-World',
    });
    expect(parseGitHubRepo('https://github.com/octocat/Hello-World.git')).toEqual({
      owner: 'octocat',
      repo: 'Hello-World',
    });
    expect(parseGitHubRepo('git@github.com:octocat/Hello-World.git')).toEqual({
      owner: 'octocat',
      repo: 'Hello-World',
    });
  });

  it('throws on invalid URLs (delegates to validateRemoteUrl)', () => {
    expect(() => parseGitHubRepo('https://gitlab.com/o/r')).toThrow();
    expect(() => parseGitHubRepo('not a url')).toThrow();
  });
});

describe('noteBranchName', () => {
  it('slugifies a note name into a note/ branch', () => {
    expect(noteBranchName('My Note.md')).toBe('note/my-note');
    expect(noteBranchName('Ideas!!! 2024.md')).toBe('note/ideas-2024');
    expect(noteBranchName('folder/Sub Note.md')).toBe('note/folder-sub-note');
  });

  it('strips the .md extension and trims leading/trailing dashes', () => {
    expect(noteBranchName('---weird---.md')).toBe('note/weird');
    expect(noteBranchName('.md')).toBe('note/');
  });

  it('caps the slug at 60 characters', () => {
    const out = noteBranchName('a'.repeat(100) + '.md');
    expect(out.startsWith('note/')).toBe(true);
    expect(out.length).toBe('note/'.length + 60);
  });
});
