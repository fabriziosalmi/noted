import { describe, expect, it } from 'vitest';
import {
  captureBlock, clockTime, dailyFileName, insertCapture, newDailyNote, toCaptureTarget,
} from './target';

const sections = { title: 'Wednesday, October 7, 2026', notes: 'Notes', todo: 'To do', ideas: 'Ideas' };

describe('the target of a capture', () => {
  it('is a new note unless it is exactly one of the others', () => {
    expect(toCaptureTarget('daily')).toBe('daily');
    expect(toCaptureTarget('inbox')).toBe('inbox');
    for (const v of [undefined, null, '', 'Daily', '../x', 3, {}]) expect(toCaptureTarget(v)).toBe('new');
  });

  it('names the daily note as the app does, with the zero padding', () => {
    expect(dailyFileName(new Date(2026, 0, 5, 9, 3))).toBe('2026-01-05.md');
    expect(clockTime(new Date(2026, 0, 5, 9, 3))).toBe('09:03');
  });
});

describe('the block that is added', () => {
  it('leads the first paragraph with the time, in either format', () => {
    expect(captureBlock('call Paolo\nabout the import', '14:32', 'markdown')).toBe('**14:32** call Paolo\n\nabout the import');
    expect(captureBlock('call Paolo\nabout the import', '14:32', 'html')).toBe('<p><strong>14:32</strong> call Paolo</p><p>about the import</p>');
  });

  it('writes html text as text, never as markup', () => {
    expect(captureBlock('<img src=x onerror=alert(1)> & co', '08:00', 'html')).toBe('<p><strong>08:00</strong> &lt;img src=x onerror=alert(1)&gt; &amp; co</p>');
  });

  it('is empty for text that is only whitespace', () => {
    expect(captureBlock(' \n\t\n', '08:00', 'markdown')).toBe('');
    expect(captureBlock(' \n\t\n', '08:00', 'html')).toBe('');
  });
});

describe('adding a capture to a daily note', () => {
  const daily = newDailyNote(sections, 'markdown');

  it('lands at the end of the first section, not under the last heading', () => {
    const out = insertCapture(daily, '**14:32** call Paolo', 'markdown', true);
    expect(out).toBe('# Wednesday, October 7, 2026\n\n## Notes\n\n**14:32** call Paolo\n\n## To do\n\n-\n\n## Ideas\n');
  });

  it('keeps the earlier captures above the later one', () => {
    let out = insertCapture(daily, '**09:00** first', 'markdown', true);
    out = insertCapture(out, '**10:00** second', 'markdown', true);
    expect(out.indexOf('first')).toBeLessThan(out.indexOf('second'));
    expect(out.indexOf('second')).toBeLessThan(out.indexOf('## To do'));
  });

  it('does not take a heading inside a code fence, or in front matter, for a section', () => {
    const note = '---\ntitle: x\n## not a heading\n---\n# Day\n\n## Notes\n\n```\n## inside a fence\n```\n\n## To do\n\n- a\n';
    const out = insertCapture(note, 'X', 'markdown', true);
    expect(out).toBe('---\ntitle: x\n## not a heading\n---\n# Day\n\n## Notes\n\n```\n## inside a fence\n```\n\nX\n\n## To do\n\n- a\n');
  });

  it('goes to the end of a note with fewer than two sections', () => {
    expect(insertCapture('# Day\n\n## Notes\n\nhello\n', 'X', 'markdown', true)).toBe('# Day\n\n## Notes\n\nhello\n\nX\n');
    expect(insertCapture('just text', 'X', 'markdown', true)).toBe('just text\n\nX\n');
  });

  it('goes to the end when asked to, whatever the sections', () => {
    expect(insertCapture(daily, 'X', 'markdown', false).endsWith('## Ideas\n\nX\n')).toBe(true);
  });

  it('does the same in an html vault', () => {
    const html = newDailyNote(sections, 'html');
    const out = insertCapture(html, '<p>X</p>', 'html', true);
    expect(out.indexOf('<p>X</p>')).toBeGreaterThan(out.indexOf('<h2>Notes</h2>'));
    expect(out.indexOf('<p>X</p>')).toBeLessThan(out.indexOf('<h2>To do</h2>'));
    expect(insertCapture('<h1>Inbox</h1>', '<p>X</p>', 'html', false)).toBe('<h1>Inbox</h1><p>X</p>');
  });

  it('adds nothing but the block: the rest of the note is byte for byte what it was', () => {
    const note = '# Day\n\n## Notes\n\nold line\n\n## To do\n\n- [ ] keep me\n\n## Ideas\n\nidea\n';
    const out = insertCapture(note, 'NEW', 'markdown', true);
    expect(out.replace('NEW\n\n', '')).toBe(note);
  });
});
