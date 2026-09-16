/**
 * Detects whether a plain text string looks like a markdown list (numbered, bullet, or task list).
 */
export function isMarkdownList(text: string): boolean {
  if (!text || !text.trim()) return false;
  const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return false;

  const listLinePattern = /^(\d{1,3}[.)]|[-*+](\s+\[[ xX]\])?)\s+\S/;

  if (lines.length === 1) {
    return listLinePattern.test(lines[0]);
  }

  const listLinesCount = lines.filter(line => listLinePattern.test(line)).length;
  return listLinesCount >= 2 || (listLinesCount >= 1 && listLinePattern.test(lines[0]));
}

/**
 * Converts GFM-style task lists into Tiptap taskList / taskItem structure so that
 * Tiptap's TaskList and TaskItem extensions render them with interactive checkboxes.
 */
export function convertTaskListsToTiptap(html: string): string {
  if (!html) return '';
  return html.replace(/<ul\b([^>]*)>([\s\S]*?)<\/ul>/gi, (match: string, _attrs: string, inner: string) => {
    if (!/<input[^>]*type=["']checkbox["']/i.test(inner)) return match;
    const convertedItems = inner.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_liMatch: string, liInner: string) => {
      const checked = /<input[^>]*checked/i.test(liInner);
      const cleanContent = liInner.replace(/<input[^>]*type=["']checkbox["'][^>]*>/i, '').trim();
      return `<li data-type="taskItem" data-checked="${checked}"><p>${cleanContent}</p></li>`;
    });
    return `<ul data-type="taskList">${convertedItems}</ul>`;
  });
}
