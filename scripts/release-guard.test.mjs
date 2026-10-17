import { afterAll, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

// scripts/release.sh builds the signed macOS release. It must refuse to build from anything but the tagged commit.
// Run here in a scratch repository holding only the script and a package.json: it stops at the guard, long before it
// would read credentials, install or build anything.
const repo = mkdtempSync(path.join(os.tmpdir(), 'noted-release-guard-'));
afterAll(() => rmSync(repo, { recursive: true, force: true }));
const git = (...args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
mkdirSync(path.join(repo, 'scripts'));
cpSync('scripts/release.sh', path.join(repo, 'scripts', 'release.sh'));
writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ version: '9.9.9' }));
git('init', '-q');
git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'base');
git('add', '.');
git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'release');
const release = () => spawnSync('bash', ['scripts/release.sh'], { cwd: repo, encoding: 'utf8', env: { ...process.env, APPLE_CREDS_ENV: '/nonexistent' } });

describe('release.sh', () => {
  it.skipIf(process.platform === 'win32')('refuses a working tree with changes', () => {
    writeFileSync(path.join(repo, 'stray.txt'), 'x');
    const run = release();
    rmSync(path.join(repo, 'stray.txt'));
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('The working tree has changes');
    expect(run.stdout).not.toContain('Loading Apple credentials');
  });

  it.skipIf(process.platform === 'win32')('refuses a commit that is not the tag of the version', () => {
    git('tag', 'v9.9.8');
    const run = release();
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('HEAD is not tagged v9.9.9 (found: v9.9.8)');
  });
});
