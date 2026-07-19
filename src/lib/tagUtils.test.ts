import { describe, expect, it } from 'vitest';
import { buildTagIndex, extractTags } from './tagUtils';

describe('tagUtils', () => {
  it('extractTags parses and normalizes tags from html/text', () => {
    const content = '<p>#Work #idea</p> plain #work #àccento';
    expect(extractTags(content)).toEqual(['#work', '#idea', '#àccento']);
  });

  it('extractTags supports one-level namespaces like #project/aurora', () => {
    expect(extractTags('grouped under #project/Aurora and #urgent')).toEqual(['#project/aurora', '#urgent']);
    // only one level — a second slash is not part of the tag
    expect(extractTags('#a/b/c')).toEqual(['#a/b']);
  });

  it('buildTagIndex builds tag to note map', () => {
    const idx = buildTagIndex([
      { name: 'a.md', text: '#one #two' },
      { name: 'b.md', text: '#two #three' },
    ]);
    expect(idx['#one']).toEqual(['a.md']);
    expect(idx['#two']).toEqual(['a.md', 'b.md']);
    expect(idx['#three']).toEqual(['b.md']);
  });
});
