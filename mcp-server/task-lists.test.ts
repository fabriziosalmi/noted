// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { taskListsToTiptap } from './index';

// The task-list conversion was two regular expressions whose cost grew with the square of the unclosed items or lists in
// a note; an agent could stall the server with one note. It is now a forward scan: these checks pin that it gives the
// regexes' result on any text, and that its cost grows in a straight line.
function byRegex(html: string): string {
  const withItems = html.replace(
    /<li>\s*(?:<p>\s*)?<input([^>]*?)type="checkbox"([^>]*?)>\s*([\s\S]*?)(?:<\/p>)?\s*<\/li>/g,
    (_m, pre: string, post: string, text: string) => {
      const checked = /\bchecked\b/.test(pre) || /\bchecked\b/.test(post);
      return `<li data-type="taskItem" data-checked="${checked}"><label><input type="checkbox"${checked ? ' checked' : ''}><span></span></label><div><p>${text.trim()}</p></div></li>`;
    },
  );
  return withItems.replace(
    /<ul>((?:(?!<\/ul>)[\s\S])*?data-type="taskItem"(?:(?!<\/ul>)[\s\S])*?)<\/ul>/g,
    '<ul data-type="taskList">$1</ul>',
  );
}

const pieces = [
  '<li>', '</li>', '<p>', '</p>', '<ul>', '</ul>', '<input type="checkbox">', '<input checked="" type="checkbox">',
  '<input disabled="" type="checkbox" checked>', '<input type="radio">', '<input', 'type="checkbox"', '>', ' ', '\n',
  'x', 'Buy milk', 'data-type="taskItem"', '<li data-type="taskItem">',
];

describe('taskListsToTiptap', () => {
  it('gives the same HTML as the regular expressions it replaces, on any mix of list markup', () => {
    fc.assert(fc.property(fc.array(fc.constantFrom(...pieces), { maxLength: 60 }), parts => {
      const html = parts.join('');
      expect(taskListsToTiptap(html)).toBe(byRegex(html));
    }), { numRuns: 3000 });
  });

  it('takes time in proportion to the text, not to its square', () => {
    const time = (n: number) => {
      const html = `${'<ul>'.repeat(n)}${'<li><input type="checkbox">'.repeat(n)}`;
      const t = performance.now();
      taskListsToTiptap(html);
      return performance.now() - t;
    };
    time(1000); // warm up
    const small = time(20_000);
    const large = time(160_000); // 8x the text (about 5 MB)
    // Linear: about 8x. The regexes took about 64x (and minutes at this size).
    expect(large).toBeLessThan(Math.max(small, 1) * 30);
    expect(large).toBeLessThan(2_000);
  });
});
