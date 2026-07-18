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
