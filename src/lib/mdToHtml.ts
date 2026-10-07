// The small Markdown the AI actions get back (paragraphs, lists, headings, tables, quotes, code, inline emphasis and links), as the HTML
// the editor takes in. Not a full Markdown parser: what the actions ask the model for is what it reads.

export function mdToHtml(md: string): string {
  return md
    .split('\n\n')
    .map(block => {
      const trimmed = block.trim();
      if (!trimmed) return '';

      // Headings (handle multiple in same block)
      if (/^#{1,6} /m.test(trimmed)) {
        return trimmed
          .replace(/^###### (.+)$/mg, '<h6>$1</h6>')
          .replace(/^##### (.+)$/mg, '<h5>$1</h5>')
          .replace(/^#### (.+)$/mg, '<h4>$1</h4>')
          .replace(/^### (.+)$/mg, '<h3>$1</h3>')
          .replace(/^## (.+)$/mg, '<h2>$1</h2>')
          .replace(/^# (.+)$/mg, '<h1>$1</h1>');
      }

      // Blockquotes
      if (/^> /.test(trimmed)) {
        const content = trimmed.replace(/^> ?/gm, '').trim();
        return `<blockquote><p>${inlineFormat(content)}</p></blockquote>`;
      }

      // Tables (detect by | at start)
      if (/^\|/.test(trimmed)) {
        const rows = trimmed.split('\n').filter(l => l.trim() && !/^\s*\|[-: |]+\|\s*$/.test(l));
        const html = rows.map((line, i) => {
          const cells = line.split('|').slice(1, -1).map(c => c.trim());
          const tag = i === 0 ? 'th' : 'td';
          return `<tr>${cells.map(c => `<${tag}>${inlineFormat(c)}</${tag}>`).join('')}</tr>`;
        }).join('');
        return `<table>${html}</table>`;
      }

      // Unordered lists
      if (/^[-*] /.test(trimmed)) {
        const items = trimmed.split('\n')
          .filter(l => /^[-*] /.test(l))
          .map(l => `<li>${inlineFormat(l.replace(/^[-*] /, ''))}</li>`)
          .join('');
        return `<ul>${items}</ul>`;
      }

      // Ordered lists
      if (/^\d+\. /.test(trimmed)) {
        const items = trimmed.split('\n')
          .filter(l => /^\d+\. /.test(l))
          .map(l => `<li>${inlineFormat(l.replace(/^\d+\. /, ''))}</li>`)
          .join('');
        return `<ol>${items}</ol>`;
      }

      // Code blocks
      if (trimmed.startsWith('```')) {
        const code = trimmed.replace(/^```\w*\n?/, '').replace(/```$/, '');
        return `<pre><code>${code}</code></pre>`;
      }

      // Horizontal rule
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        return '<hr>';
      }

      return `<p>${inlineFormat(trimmed.replace(/\n/g, '<br>'))}</p>`;
    })
    .filter(Boolean)
    .join('');
}

function inlineFormat(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>');
}
