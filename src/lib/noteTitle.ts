// Derive a display title from a note's HTML and turn it into a filesystem-safe
// filename stem. Used by the Apple Notes-style capture flow, where the first
// line (title) drives the .md filename.

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'",
};

/** First heading's text, else the first non-empty text line, else ''. */
export function deriveTitle(html: string): string {
  if (!html) return '';
  const heading = html.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
  // With a heading, use it directly. Otherwise turn block boundaries into
  // newlines so we can pick the first non-empty line rather than mashing
  // every paragraph together.
  const source = heading
    ? heading[1]
    : html.replace(/<\/(p|div|li|h[1-6])>|<br\s*\/?>/gi, '\n');
  const firstLine = source
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;|&#x27;/g, (m) => ENTITIES[m] ?? m)
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0) ?? '';
  return firstLine.replace(/\s+/g, ' ').trim();
}

/**
 * Filesystem-safe stem aligned with validateFileName's reserved-char set
 * (electron/ipc-utils.ts). Returns '' when the title yields no usable name.
 */
export function slugifyTitle(title: string): string {
  return title
    // reserved characters: \ / : * ? " < > | ; ` $
    .replace(/[\\/:*?"<>|;`$]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}
