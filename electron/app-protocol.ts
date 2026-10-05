/**
 * Path rules for the custom `app://` protocol, which serves the renderer bundle
 * and the vault's images. Kept separate from main so the rules can be tested.
 */

import path from 'node:path';

/**
 * The bundle file a request path maps to, or null when it would leave the bundle.
 * The URL parser folds literal dot segments, but a percent-encoded slash survives
 * it ("a%2F..%2F..%2Fetc"): decoding AFTER the join is what let it through, so
 * decode first, then resolve, then check containment.
 */
export function resolveDistPath(distRoot: string, urlPathname: string): string | null {
  let rel: string;
  try { rel = decodeURIComponent(urlPathname.replace(/^\/+/, '')); } catch { return null; }
  if (rel.includes('\0')) return null;
  const root = path.resolve(distRoot);
  const file = path.resolve(root, rel);
  return file === root || file.startsWith(root + path.sep) ? file : null;
}

/** The vault-relative path a request asks for (decoded), for the image route. */
export function vaultRelFromPathname(urlPathname: string): string | null {
  try {
    const rel = decodeURIComponent(urlPathname.replace(/^\/+/, ''));
    return rel && !rel.includes('\0') ? rel : null;
  } catch {
    return null;
  }
}
