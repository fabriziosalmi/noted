import { describe, expect, it } from 'vitest';
import { getMarkdownFromHtml } from '../../lib/htmlToMarkdown';

describe('getMarkdownFromHtml', () => {
  it('converts ordered lists to markdown with numbers', () => {
    const html = '<ol><li><p>Item 1</p></li><li><p>Item 2</p></li></ol>';
    const md = getMarkdownFromHtml(html);
    expect(md).toContain('1.  Item 1');
    expect(md).toContain('2.  Item 2');
  });

  it('converts bullet lists to markdown', () => {
    const html = '<ul><li><p>Alpha</p></li><li><p>Beta</p></li></ul>';
    const md = getMarkdownFromHtml(html);
    expect(md).toContain('Alpha');
    expect(md).toContain('Beta');
  });

  it('converts task lists to markdown checkboxes', () => {
    const html = '<ul data-type="taskList"><li data-checked="false" data-type="taskItem"><label><input type="checkbox"><span></span></label><div><p>Task 1</p></div></li><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked"><span></span></label><div><p>Task 2</p></div></li></ul>';
    const md = getMarkdownFromHtml(html);
    expect(md).toContain('- [ ] Task 1');
    expect(md).toContain('- [x] Task 2');
  });
});
