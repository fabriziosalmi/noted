const YAML_FRONTMATTER_PATTERN = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;
const FRONTMATTER_COMMENT_PATTERN = /<!--noted-frontmatter:([\s\S]*?)-->\s*/;

export interface FrontmatterExtraction {
  frontmatter: string | null;
  body: string;
}

export function extractMarkdownFrontmatter(markdown: string): FrontmatterExtraction {
  const match = markdown.match(YAML_FRONTMATTER_PATTERN);
  if (!match) return { frontmatter: null, body: markdown };
  return {
    frontmatter: match[0].replace(/\r\n/g, '\n').replace(/\n$/, ''),
    body: markdown.slice(match[0].length),
  };
}

export function frontmatterToHtmlComment(frontmatter: string): string {
  return `<!--noted-frontmatter:${encodeURIComponent(frontmatter)}-->`;
}

export function extractHtmlFrontmatterComment(html: string): FrontmatterExtraction {
  const match = html.match(FRONTMATTER_COMMENT_PATTERN);
  if (!match) return { frontmatter: null, body: html };

  let frontmatter: string | null;
  try {
    frontmatter = decodeURIComponent(match[1]);
  } catch {
    frontmatter = null;
  }

  return {
    frontmatter,
    body: html.replace(match[0], ''),
  };
}

export function prependFrontmatterComment(html: string, frontmatter: string | null): string {
  if (!frontmatter) return html;
  return `${frontmatterToHtmlComment(frontmatter)}\n${html}`;
}
