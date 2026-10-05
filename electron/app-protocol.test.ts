// @vitest-environment node
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { resolveDistPath, vaultRelFromPathname } from './app-protocol';

const DIST = path.resolve('/app/dist');

describe('resolveDistPath', () => {
  it('maps ordinary asset paths into the bundle', () => {
    expect(resolveDistPath(DIST, '/index.html')).toBe(path.join(DIST, 'index.html'));
    expect(resolveDistPath(DIST, '/assets/app-1a2b.js')).toBe(path.join(DIST, 'assets', 'app-1a2b.js'));
    expect(resolveDistPath(DIST, '/assets/a%20b.png')).toBe(path.join(DIST, 'assets', 'a b.png'));
  });

  it.each([
    '/..%2F..%2Fetc%2Fpasswd',
    '/a%2F..%2F..%2Fetc%2Fpasswd',
    '/%2e%2e%2f%2e%2e%2fsecret',
    '/a/../../outside',
    '/%00',
    '/%E0%A4%A',          // malformed escape
  ])('refuses a path that would leave the bundle: %s', p => {
    const r = resolveDistPath(DIST, p);
    expect(r === null || r.startsWith(DIST + path.sep) || r === DIST).toBe(true);
    if (r) expect(path.relative(DIST, r).startsWith('..')).toBe(false);
  });

  it('really returns null for the traversal forms', () => {
    expect(resolveDistPath(DIST, '/..%2F..%2Fetc%2Fpasswd')).toBeNull();
    expect(resolveDistPath(DIST, '/a%2F..%2F..%2Fetc%2Fpasswd')).toBeNull();
    expect(resolveDistPath(DIST, '/%00')).toBeNull();
    expect(resolveDistPath(DIST, '/%E0%A4%A')).toBeNull();
  });

  it('does not treat a sibling directory with the same prefix as inside the bundle', () => {
    expect(resolveDistPath('/app/dist', '/..%2Fdist-evil%2Fx.js')).toBeNull();
  });
});

describe('vaultRelFromPathname', () => {
  it('decodes, strips leading slashes, rejects NUL and bad escapes', () => {
    expect(vaultRelFromPathname('/attachments/a%20b.png')).toBe('attachments/a b.png');
    expect(vaultRelFromPathname('/')).toBeNull();
    expect(vaultRelFromPathname('/a%00.png')).toBeNull();
    expect(vaultRelFromPathname('/%E0%A4%A')).toBeNull();
  });
});
