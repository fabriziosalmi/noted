// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveHttpToken } from './index';

// The HTTP transport is never open without a token: started by hand with none, the server makes one and keeps it.
const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-http-token-'));
afterAll(() => { fs.rmSync(vault, { recursive: true, force: true }); });
const file = path.join(vault, '.noted', 'mcp-http-token');

describe('resolveHttpToken', () => {
  it('uses the token it was given', () => {
    expect(resolveHttpToken('given-token', vault)).toEqual({ token: 'given-token' });
    expect(fs.existsSync(file)).toBe(false);
  });

  it('makes a token when none is given, owner-only, and keeps it for the next start', () => {
    const first = resolveHttpToken(undefined, vault);
    expect(first.token).toMatch(/^[0-9a-f]{48}$/);
    expect(first.file).toBe(file);
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(resolveHttpToken(undefined, vault)).toEqual(first);
  });

  it('replaces a saved token too short to be one', () => {
    fs.writeFileSync(file, 'abc\n');
    expect(resolveHttpToken(undefined, vault).token).toMatch(/^[0-9a-f]{48}$/);
  });
});
