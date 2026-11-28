import { describe, it, expect } from 'vitest';
import { extractTasks, mayHaveTasks } from './parse';

describe('extractTasks fenced code', () => {
  it('a four-backtick fence is not closed by an inner three-backtick line (CommonMark)', () => {
    const note = [
      '````',
      '```',
      '- [ ] an example task inside the fence',
      '```',
      '````',
      '',
      '- [ ] a real task',
      '',
    ].join('\n');

    const tasks = extractTasks(note);
    expect(tasks.map(t => [t.line, t.text])).toEqual([[7, 'a real task']]);
    expect(tasks.some(t => t.text.includes('an example task'))).toBe(false);
  });

  it('a three-backtick fence still closes on a three-backtick line', () => {
    const note = ['```', '- [ ] inside code', '```', '', '- [ ] outside'].join('\n');
    expect(extractTasks(note).map(t => t.text)).toEqual(['outside']);
  });

  it('a longer closing fence of the same character closes the block', () => {
    const note = ['````', '- [ ] still inside', '`````', '', '- [ ] outside'].join('\n');
    expect(extractTasks(note).map(t => t.text)).toEqual(['outside']);
  });

  it('a tilde fence behaves the same way', () => {
    const note = ['~~~~', '~~~', '- [ ] an example task', '~~~', '~~~~', '', '- [ ] a real task'].join('\n');
    expect(extractTasks(note).map(t => [t.line, t.text])).toEqual([[7, 'a real task']]);
    const closed = ['~~~', '- [ ] inside', '~~~', '', '- [ ] outside'].join('\n');
    expect(extractTasks(closed).map(t => t.text)).toEqual(['outside']);
  });

  it('a closer of the other character does not close the fence, and text after the fence marker keeps it open', () => {
    const note = ['````', '~~~', '- [ ] still inside', '~~~', '````', '', '- [ ] outside'].join('\n');
    expect(extractTasks(note).map(t => t.text)).toEqual(['outside']);
    // A fence opened with info string is still opened; ````js must not be treated as a three-backtick line.
    const info = ['````js', '- [ ] inside the js block', '````', '', '- [ ] outside'].join('\n');
    expect(extractTasks(info).map(t => t.text)).toEqual(['outside']);
    expect(mayHaveTasks(info)).toBe(true);
  });

  it('a fence line with an info string does not close the block', () => {
    const note = ['```', '```js', '- [ ] inside', '```', '- [ ] after'].join('\n');
    expect(extractTasks(note).map(t => t.text)).toEqual(['after']);
  });

  it('trailing spaces after a closing fence still close it, with CRLF too', () => {
    expect(extractTasks(['````', '- [ ] inside', '````   ', '- [ ] after'].join('\n')).map(t => t.text)).toEqual(['after']);
    expect(extractTasks(['````\r', '```\r', '- [ ] inside\r', '````\r', '- [ ] after\r'].join('\n')).map(t => t.text)).toEqual(['after']);
  });
});
