import { describe, expect, it } from 'vitest';
import { isMarkdownList, convertTaskListsToTiptap } from './listUtils';

describe('isMarkdownList', () => {
  it('detects numbered lists', () => {
    expect(isMarkdownList('1. First\n2. Second')).toBe(true);
    expect(isMarkdownList('1) First\n2) Second')).toBe(true);
    expect(isMarkdownList('1. Single item')).toBe(true);
  });

  it('detects bullet lists', () => {
    expect(isMarkdownList('- Item 1\n- Item 2')).toBe(true);
    expect(isMarkdownList('* Item 1\n* Item 2')).toBe(true);
    expect(isMarkdownList('+ Item 1\n+ Item 2')).toBe(true);
    expect(isMarkdownList('- Single bullet')).toBe(true);
  });

  it('detects task lists', () => {
    expect(isMarkdownList('- [ ] Todo item\n- [x] Done item')).toBe(true);
    expect(isMarkdownList('* [ ] Task 1')).toBe(true);
  });

  it('rejects regular text and numbers not formatted as lists', () => {
    expect(isMarkdownList('')).toBe(false);
    expect(isMarkdownList('   ')).toBe(false);
    expect(isMarkdownList('This is a regular sentence.')).toBe(false);
    expect(isMarkdownList('The value of pi is 3.14 approximately.')).toBe(false);
    expect(isMarkdownList('Paragraph line 1\nParagraph line 2')).toBe(false);
  });
});

describe('convertTaskListsToTiptap', () => {
  it('converts GFM checkbox inputs inside ul to Tiptap taskList format', () => {
    const input = '<ul>\n<li><input disabled="" type="checkbox"> Task 1</li>\n<li><input checked="" disabled="" type="checkbox"> Task 2</li>\n</ul>';
    const output = convertTaskListsToTiptap(input);
    expect(output).toContain('<ul data-type="taskList">');
    expect(output).toContain('<li data-type="taskItem" data-checked="false"><p>Task 1</p></li>');
    expect(output).toContain('<li data-type="taskItem" data-checked="true"><p>Task 2</p></li>');
  });

  it('leaves standard bullet lists unmodified', () => {
    const input = '<ul><li>Item 1</li><li>Item 2</li></ul>';
    expect(convertTaskListsToTiptap(input)).toBe(input);
  });
});
