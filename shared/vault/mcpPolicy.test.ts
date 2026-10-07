// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPolicy, savePolicy, policyPath } from './mcpPolicyFile';
import { parsePolicy, accessFor, serializePolicy, lessAccess, canRead, canWrite, isStaged, normalizePolicyPath, DEFAULT_POLICY, type McpPolicy } from './mcpPolicy';

const parse = (text: string): McpPolicy => {
  const r = parsePolicy(text);
  if (!r.ok) throw new Error(r.error);
  return r.policy;
};

describe('parsePolicy', () => {
  it('the example of the issue: private hidden, inbox writable, the rest read-only', () => {
    const p = parse('default: read-only\nfolders:\n  private: hidden\n  inbox: read-write\n');
    expect(p).toEqual({ default: 'read-only', folders: { private: 'hidden', inbox: 'read-write' } });
    expect(accessFor(p, 'private/secret.md')).toBe('hidden');
    expect(accessFor(p, 'inbox/new.md')).toBe('read-write');
    expect(accessFor(p, 'Work/plan.md')).toBe('read-only');
    expect(accessFor(p, 'top.md')).toBe('read-only');
  });

  it('an empty file or no folders means the default, which is open access as before', () => {
    expect(parse('')).toEqual({ default: 'read-write', folders: {} });
    expect(parse('# only a comment\n')).toEqual(DEFAULT_POLICY);
    expect(parse('folders:\n')).toEqual(DEFAULT_POLICY);
  });

  it('refuses what it does not understand rather than ignoring it: a typo must not open a folder', () => {
    for (const bad of ['defualt: hidden', 'default: secret', 'folders: [a, b]', 'folders:\n  a: yes', '- just\n- a list', 'default: [x]', 'folders:\n  "": hidden', 'folders:\n  a/../b: hidden', 'a: [unclosed']) {
      expect(parsePolicy(bad).ok, bad).toBe(false);
    }
  });

  it('two spellings of one folder must agree', () => {
    expect(parsePolicy('folders:\n  Private: hidden\n  private/: hidden\n').ok).toBe(true);
    expect(parsePolicy('folders:\n  Private: hidden\n  private: read-only\n')).toEqual({ ok: false, error: expect.stringContaining('two different') });
  });
});

describe('accessFor', () => {
  const p = parse('default: read-write\nfolders:\n  Private: hidden\n  private/shared: read-only\n  Archive: read-only\n  "Archive/open": read-write\n  secret.md: hidden\n');

  it('the most specific folder wins, so a nested rule can open or close part of its parent', () => {
    expect(accessFor(p, 'private/a.md')).toBe('hidden');
    expect(accessFor(p, 'private/shared/a.md')).toBe('read-only');
    expect(accessFor(p, 'private/shared/deep/er/a.md')).toBe('read-only');
    expect(accessFor(p, 'archive/old.md')).toBe('read-only');
    expect(accessFor(p, 'Archive/open/new.md')).toBe('read-write');
  });

  it('matches whole folders, not names that merely start alike, and a single note by its path', () => {
    expect(accessFor(p, 'privateer/a.md')).toBe('read-write');
    expect(accessFor(p, 'private.md')).toBe('read-write');
    expect(accessFor(p, 'secret.md')).toBe('hidden');
    expect(accessFor(p, 'Other/secret.md')).toBe('read-write');
  });

  it('ignores case, separators and Unicode form', () => {
    expect(accessFor(p, 'PRIVATE/A.MD')).toBe('hidden');
    expect(accessFor(p, 'private\\a.md')).toBe('hidden');
    const unicode = parse('folders:\n  "Résumé": hidden\n'); // written with combining accents
    expect(accessFor(unicode, 'Résumé/cv.md')).toBe('hidden'); // asked with the composed form
    expect(normalizePolicyPath('/A//B\\C/')).toBe('a/b/c');
  });

  it('staged sits between read-only and read-write: it can be read, and proposes changes instead of making them', () => {
    const st = parse('default: read-only\nfolders:\n  drafts: staged\n');
    expect(accessFor(st, 'drafts/a.md')).toBe('staged');
    expect([canRead('staged'), canWrite('staged'), isStaged('staged'), isStaged('read-write'), isStaged('read-only')]).toEqual([true, false, true, false, false]);
    expect(lessAccess('staged', 'read-write')).toBe('staged');
    expect(lessAccess('staged', 'read-only')).toBe('read-only');
    expect(lessAccess('staged', 'hidden')).toBe('hidden');
  });

  it('lessAccess, canRead and canWrite', () => {
    expect(lessAccess('read-write', 'hidden')).toBe('hidden');
    expect(lessAccess('read-only', 'read-write')).toBe('read-only');
    expect(lessAccess('read-write', 'read-write')).toBe('read-write');
    expect([canRead('hidden'), canRead('read-only'), canWrite('read-only'), canWrite('read-write')]).toEqual([false, true, false, true]);
  });
});

describe('the file', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-policy-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('no file is the open default; a file is read as written; a broken one is an error, not a guess', () => {
    expect(loadPolicy(dir)).toEqual({ ok: true, policy: DEFAULT_POLICY, present: false });
    fs.mkdirSync(path.join(dir, '.noted'));
    fs.writeFileSync(policyPath(dir), 'default: read-only\nfolders:\n  inbox: read-write\n');
    expect(loadPolicy(dir)).toEqual({ ok: true, policy: { default: 'read-only', folders: { inbox: 'read-write' } }, present: true });
    fs.writeFileSync(policyPath(dir), 'default: nope\n');
    expect(loadPolicy(dir)).toEqual({ ok: false, error: expect.stringContaining('mcp-policy.yaml is invalid') });
  });

  it('saving writes a file that reads back identically, atomically, in a stable order; the default removes it', () => {
    const policy: McpPolicy = { default: 'read-only', folders: { work: 'read-write', private: 'hidden' } };
    savePolicy(dir, policy);
    expect(loadPolicy(dir)).toEqual({ ok: true, policy, present: true });
    const text = fs.readFileSync(policyPath(dir), 'utf8');
    expect(text.indexOf('private')).toBeLessThan(text.indexOf('work'));
    expect(fs.readdirSync(path.join(dir, '.noted'))).toEqual(['mcp-policy.yaml']);
    expect(serializePolicy(parse(text))).toBe(text);
    savePolicy(dir, DEFAULT_POLICY);
    expect(fs.existsSync(policyPath(dir))).toBe(false);
  });

  it('a folder name that needs quoting survives a round trip', () => {
    const policy: McpPolicy = { default: 'read-write', folders: { 'a: b': 'hidden', '#tag folder': 'read-only', 'yes': 'hidden' } };
    savePolicy(dir, policy);
    expect(loadPolicy(dir)).toEqual({ ok: true, policy, present: true });
  });
});
