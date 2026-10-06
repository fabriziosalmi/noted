// Canonical HTML -> plain text used by the shared full-text index. This is the
// superset of the two historical strippers (electron stripHtmlToText and the
// MCP htmlToText): it drops HTML comments (e.g. the noted-frontmatter block),
// turns block boundaries into spaces, strips remaining tags, decodes the common
// entities, and collapses whitespace.
export function htmlToPlainText(input: string): string {
  if (!input) return '';
  return input
    .replace(/<!--[\s\S]*?-->/g, ' ') // HTML comments (incl. frontmatter)
    .replace(/<\/(p|div|li|h[1-6]|br|tr|td|th|blockquote|pre|ul|ol)>|<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// Display title stem from a note's relative path ("folder/My_Note.md" -> "My Note").
export function deriveTitleFromRelPath(relPath: string): string {
  const base = relPath.split('/').pop() ?? relPath;
  return base.replace(/\.md$/i, '').replace(/_/g, ' ');
}

const looksLikeHtml = (s: string): boolean => s.trimStart().startsWith('<');

/**
 * Plain text of a Markdown note for search and previews: no frontmatter, no syntax characters, link and
 * image text kept, code kept (it is searchable), whitespace collapsed. Not a renderer: good enough that
 * a query for "plan" finds `[the plan](x)` and `**plan**`, and that a snippet reads like prose.
 */
export function markdownToPlainText(input: string): string {
  if (!input) return '';
  return input
    .replace(/^\uFEFF/, '')
    .replace(/^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/, ' ') // YAML frontmatter
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/%%[\s\S]*?%%/g, ' ') // Obsidian comments are not content
    .replace(/^[ \t]*(`{3,}|~{3,})[^\n]*$/gm, ' ') // fence lines
    .replace(/!\[\[([^\]|]*)(?:\|[^\]]*)?\]\]/g, ' $1 ') // embeds
    .replace(/\[\[([^\]|#]*)(?:#[^\]|]*)?\|([^\]]*)\]\]/g, ' $2 ') // [[target|alias]] -> alias
    .replace(/\[\[([^\]|#]*)(?:#([^\]]*))?\]\]/g, ' $1 $2 ') // [[target#heading]]
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, ' $1 ') // images -> alt text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, ' $1 ') // links -> text
    .replace(/^\[[^\]]+\]:\s.*$/gm, ' ') // link reference definitions
    .replace(/^[ \t]*>+[ \t]?(\[![^\]]*\][+-]?)?/gm, ' ') // quote and callout markers
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, ' ') // heading markers
    .replace(/^[ \t]*(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gm, ' ') // list and task markers
    .replace(/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/gm, ' ') // table rule rows
    .replace(/<[^>]+>/g, ' ')
    .replace(/\\([\\`*_{}[\]()#+\-.!|~=%$<>&])/g, '$1') // backslash escapes
    .replace(/[*_~=|`]+/g, ' ') // emphasis, strike, highlight, table pipes, code ticks
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Plain text of a note file, whichever format it is in. */
export function noteToPlainText(raw: string): string {
  return looksLikeHtml(raw) ? htmlToPlainText(raw) : markdownToPlainText(raw);
}

/**
 * The short body preview shown under a note's title in the sidebar, from the first few KB of the file:
 * the title heading and the frontmatter are skipped, what is left is flattened to ~120 characters.
 */
export function notePreview(head: string, maxLength = 120): string {
  if (looksLikeHtml(head)) {
    const stripped = head
      .replace(/^\s*<!--noted-frontmatter:[\s\S]*?-->/i, '') // frontmatter comment
      .replace(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/i, ''); //      the title heading
    return htmlToPlainText(stripped).slice(0, maxLength);
  }
  // A frontmatter block that the read cut off is not prose: show nothing rather than YAML.
  if (/^\uFEFF?---[ \t]*\r?\n/.test(head) && !/^\uFEFF?---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/.test(head)) return '';
  const body = head
    .replace(/^\uFEFF/, '')
    .replace(/^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/, '') //  frontmatter
    .replace(/^\s*#{1,6}[ \t]+[^\n]*\n?/, ''); //                                  the title heading
  return markdownToPlainText(body).slice(0, maxLength);
}
