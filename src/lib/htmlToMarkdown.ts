import TurndownService from 'turndown';

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/prefer-for-of */
export function getMarkdownFromHtml(html: string): string {
  const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

  // Add task list rule to preserve task checkboxes
  turndown.addRule('taskItem', {
    filter: function (node: any) {
      return (
        node.nodeName?.toUpperCase() === 'LI' &&
        (node.getAttribute('data-type') === 'taskItem' || node.parentNode?.getAttribute('data-type') === 'taskList')
      );
    },
    replacement: function (content, node: any) {
      const isChecked = node.getAttribute('data-checked') === 'true';
      const clean = content.replace(/^[ \t]*\[[ xX]\][ \t]*/, '').trim();
      return `- [${isChecked ? 'x' : ' '}] ${clean}\n`;
    },
  });

  // Add span rule to format rich text styles (bold, italic, strikethrough, underline)
  turndown.addRule('span', {
    filter: 'span',
    replacement: function (content, node: any) {
      let result = content;
      const style = node.getAttribute('style') || '';

      // Bold
      if (
        style.includes('font-weight: bold') ||
        style.includes('font-weight:bold') ||
        style.includes('font-weight: 700') ||
        style.includes('font-weight:700')
      ) {
        result = '**' + result + '**';
      }
      // Italic
      if (style.includes('font-style: italic') || style.includes('font-style:italic')) {
        result = '*' + result + '*';
      }
      // Strikethrough
      if (style.includes('text-decoration: line-through') || style.includes('text-decoration:line-through')) {
        result = '~~' + result + '~~';
      }
      // Underline
      if (style.includes('text-decoration: underline') || style.includes('text-decoration:underline')) {
        result = '<u>' + result + '</u>';
      }

      return result;
    },
  });

  // Add div rule to handle single line breaks instead of double newlines
  turndown.addRule('div', {
    filter: 'div',
    replacement: function (content, node: any) {
      // Avoid adding extra linebreaks inside list items, pre, code, blockquotes
      let parent = node.parentNode;
      while (parent) {
        const tag = parent.nodeName?.toLowerCase();
        if (tag === 'li' || tag === 'pre' || tag === 'code' || tag === 'blockquote') {
          return content;
        }
        parent = parent.parentNode;
      }
      return '\n' + content + '\n';
    },
  });

  // Add table rules to support Markdown table imports
  turndown.addRule('table', {
    filter: 'table',
    replacement: function (content) {
      const cleanContent = content.split('\n').filter((line: string) => line.trim() !== '').join('\n');
      return '\n\n' + cleanContent + '\n\n';
    },
  });

  turndown.addRule('thead-tbody-tfoot', {
    filter: ['thead', 'tbody', 'tfoot'],
    replacement: function (content) {
      return content;
    },
  });

  turndown.addRule('tr', {
    filter: 'tr',
    replacement: function (content, node: any) {
      let tableNode = node;
      while (tableNode && tableNode.nodeName?.toUpperCase() !== 'TABLE') {
        tableNode = tableNode.parentNode;
      }

      function getTrElements(element: any) {
        const trs: any[] = [];
        function traverse(n: any) {
          if (n.nodeName?.toUpperCase() === 'TR') {
            trs.push(n);
          } else if (n.childNodes) {
            for (let i = 0; i < n.childNodes.length; i++) {
              traverse(n.childNodes[i]);
            }
          }
        }
        traverse(element);
        return trs;
      }

      function hasThDirectChild(trNode: any) {
        if (!trNode.childNodes) return false;
        for (let i = 0; i < trNode.childNodes.length; i++) {
          if (trNode.childNodes[i].nodeName?.toUpperCase() === 'TH') {
            return true;
          }
        }
        return false;
      }

      function getCellCount(trNode: any) {
        let count = 0;
        if (!trNode.childNodes) return 0;
        for (let i = 0; i < trNode.childNodes.length; i++) {
          const name = trNode.childNodes[i].nodeName?.toUpperCase();
          if (name === 'TH' || name === 'TD') {
            count++;
          }
        }
        return count;
      }

      const allRows = tableNode ? getTrElements(tableNode) : [];
      const isFirstRow = allRows[0] === node;
      const hasTh = hasThDirectChild(node);
      const isHeader = hasTh || (isFirstRow && !hasTh);

      let separator = '';
      if (isHeader) {
        const cellCount = getCellCount(node);
        separator = '\n|' + Array(cellCount).fill(' --- ').join('|') + '|';
      }
      return '\n|' + content + separator;
    },
  });

  turndown.addRule('td-or-th', {
    filter: ['td', 'th'],
    replacement: function (content) {
      const cleanContent = content.trim().replace(/\n/g, ' ').replace(/\|/g, '\\|');
      return ' ' + cleanContent + ' |';
    },
  });

  return turndown.turndown(html);
}
/* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/prefer-for-of */
