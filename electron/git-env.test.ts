// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { commitAll, inheritedGitEnvironment, initRepo } from './git-ops';

// simple-git 4 strips GIT_* variables from git's environment unless they are allowed. The user's own (an SSH command,
// an askpass helper, their identity) and the app's (GIT_TERMINAL_PROMPT=0 for unattended sync) must still reach git.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-git-env-'));
const saved = { name: process.env.GIT_AUTHOR_NAME, email: process.env.GIT_AUTHOR_EMAIL };
afterAll(() => {
  for (const [k, v] of [['GIT_AUTHOR_NAME', saved.name], ['GIT_AUTHOR_EMAIL', saved.email]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('git environment', () => {
  it('names every GIT_ and GCM_ variable of the process, in any case', () => {
    expect(inheritedGitEnvironment({ GIT_SSH_COMMAND: 'ssh -i k', git_askpass: 'x', GCM_INTERACTIVE: 'never', PATH: '/bin' }))
      .toEqual(['GIT_SSH_COMMAND', 'git_askpass', 'GCM_INTERACTIVE']);
  });

  it('lets the GIT_ variables of the process reach the git that commits', async () => {
    expect((await initRepo(dir)).success).toBe(true);
    process.env.GIT_AUTHOR_NAME = 'Author From The Environment';
    process.env.GIT_AUTHOR_EMAIL = 'env@example.com';
    fs.writeFileSync(path.join(dir, 'Note.md'), '# Note\n');
    expect((await commitAll(dir, 'docs: a note')).success).toBe(true);
    const last = (await simpleGit(dir).log({ maxCount: 1 })).latest;
    expect(last?.author_name).toBe('Author From The Environment');
  });
});
