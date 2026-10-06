/**
 * What is inside one `[[...]]`: the note it points at, and, after a `#`, the place in it (a heading, or a block
 * marked `^id`), plus the display alias after a `|`. Obsidian's syntax, shared by the editor (to follow a link and
 * to complete one) and by the tests that pin it.
 */

export interface WikilinkParts {
  /** `![[...]]`: shown in place instead of linked. */
  embed: boolean;
  /** The note, as written: no ".md". Empty for a link inside the same note (`[[#Heading]]`). */
  target: string;
  /** The heading it points at; `A#B` (a heading B under heading A) is kept whole. */
  heading?: string;
  /** The block it points at, without the `^`. */
  block?: string;
  alias?: string;
}

/** Parse the literal text of one link, `[[Note#Heading|alias]]` or `![[Note]]`; null when it is not one. */
export function parseWikilinkText(text: string): WikilinkParts | null {
  const m = /^(!?)\[\[([^\][\n]*)\]\]$/.exec(text.trim());
  if (!m) return null;
  const inner = m[2];
  const pipe = inner.indexOf('|');
  const head = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
  const alias = pipe === -1 ? undefined : inner.slice(pipe + 1).trim() || undefined;
  const hash = head.indexOf('#');
  const target = (hash === -1 ? head : head.slice(0, hash)).trim().replace(/\.md$/i, '');
  const fragment = hash === -1 ? '' : head.slice(hash + 1).trim();
  if (!target && !fragment) return null;
  const parts: WikilinkParts = { embed: m[1] === '!', target };
  if (fragment.startsWith('^')) {
    const block = fragment.slice(1).trim();
    if (block) parts.block = block;
  } else if (fragment) {
    parts.heading = fragment;
  }
  if (alias) parts.alias = alias;
  return parts;
}

/** How headings are compared: case, spacing and Markdown emphasis do not matter, and neither do the characters a link cannot hold. */
export function normalizeHeading(text: string): string {
  return text
    .replace(/[*`~]|==/g, '')
    .replace(/[#^|[\]:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * The index of the heading a link names, or -1. `A#B` means a heading B under a heading A: the first B after an A
 * (and, as Obsidian does, any B if there is no A). The first match wins, as in a note with two headings alike.
 */
export function findHeadingIndex(headings: readonly { text: string }[], wanted: string): number {
  const path = wanted.split('#').map(normalizeHeading).filter(Boolean);
  if (path.length === 0) return -1;
  const last = path[path.length - 1];
  let from = 0;
  for (const parent of path.slice(0, -1)) {
    const at = headings.findIndex((h, i) => i >= from && normalizeHeading(h.text) === parent);
    if (at === -1) break;
    from = at + 1;
  }
  const found = headings.findIndex((h, i) => i >= from && normalizeHeading(h.text) === last);
  return found !== -1 || from === 0 ? found : headings.findIndex(h => normalizeHeading(h.text) === last);
}

/** A heading's text as it reads on the page: the Markdown around it (emphasis, code, a link's address) is gone. */
export function plainHeading(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*`~]|==/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A heading's text as it goes inside a link: plain, and the characters a link cannot hold are spaces, as Obsidian writes them. */
export function headingLinkText(text: string): string {
  return plainHeading(text).replace(/[#^|[\]]/g, ' ').replace(/\s+/g, ' ').trim();
}
