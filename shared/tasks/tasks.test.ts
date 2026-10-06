import { describe, it, expect } from 'vitest';
import { extractTasks, setTaskDone, mayHaveTasks, withoutTaskLines } from './parse';
import { queryTasks, matchesTask, compareTasks, addDays, localDay, dueFilter, type NoteTask } from './query';

const NOTE = `---
title: Plan
tasks: - [ ] not a task, it is yaml
---
# Plan

- [ ] write the draft 📅 2026-10-10 #work
- [x] outline
  - [ ] nested step due:: 2026-10-12
* [X] star item [due:: 2026-10-01]
1. [ ] numbered
+ [ ] plus item

\`\`\`
- [ ] inside code
\`\`\`

- [x] done late 📅 2026-02-30
- [ ]
- [ ]missing space
- not a task
`;

describe('extractTasks', () => {
  const tasks = extractTasks(NOTE);

  it('finds the list items with a checkbox, at any depth, in any list marker', () => {
    expect(tasks.map(t => [t.line, t.done, t.text])).toEqual([
      [7, false, 'write the draft #work'], [8, true, 'outline'], [9, false, 'nested step'], [10, true, 'star item'],
      [11, false, 'numbered'], [12, false, 'plus item'], [18, true, 'done late 📅 2026-02-30'],
    ]);
    expect(tasks[2].depth).toBe(1);
  });

  it('reads the due date as the Tasks plugin and Dataview write it, and keeps it out of the text', () => {
    expect(tasks[0].due).toBe('2026-10-10');
    expect(tasks[2].due).toBe('2026-10-12');
    expect(tasks[3].due).toBe('2026-10-01');
    expect(tasks[6].due).toBeUndefined(); // 30 February is not a day
  });

  it('collects the tags written in the task', () => {
    expect(tasks[0].tags).toEqual(['#work']);
    expect(tasks[1].tags).toEqual([]);
  });

  it('does not look in the frontmatter or in fenced code', () => {
    expect(tasks.some(t => t.text.includes('inside code') || t.text.includes('yaml'))).toBe(false);
  });

  it('is fast to rule out a note with no task, and reads CRLF', () => {
    expect(mayHaveTasks('# nothing\n- a list\n')).toBe(false);
    expect(extractTasks('# nothing\n')).toEqual([]);
    expect(extractTasks('- [ ] a\r\n- [x] b 📅 2026-10-10\r\n').map(t => [t.text, t.done, t.due])).toEqual([['a', false, undefined], ['b', true, '2026-10-10']]);
  });
});

describe('withoutTaskLines', () => {
  it('blanks the task lines and nothing else', () => {
    expect(withoutTaskLines('#note\n\n- [ ] a #t\n- plain #p\n- [x] b\n')).toBe('#note\n\n\n- plain #p\n\n');
    expect(withoutTaskLines('no tasks #x')).toBe('no tasks #x');
  });
});

describe('setTaskDone', () => {
  it('flips the one checkbox and nothing else', () => {
    const out = setTaskDone(NOTE, 7, 'write the draft #work', true);
    expect(out).toEqual({ ok: true, content: NOTE.replace('- [ ] write the draft', '- [x] write the draft') });
    expect(setTaskDone(NOTE, 8, 'outline', false)).toEqual({ ok: true, content: NOTE.replace('- [x] outline', '- [ ] outline') });
  });

  it('keeps CRLF, and is no change when the task already is as asked', () => {
    expect(setTaskDone('- [ ] a\r\n- [ ] b\r\n', 2, 'b', true)).toEqual({ ok: true, content: '- [ ] a\r\n- [x] b\r\n' });
    expect(setTaskDone('- [x] a\n', 1, 'a', true)).toEqual({ ok: true, content: '- [x] a\n' });
  });

  it('refuses when the line is not that task any more (the note was edited), or is gone', () => {
    expect(setTaskDone(NOTE, 7, 'something else', true).ok).toBe(false);
    expect(setTaskDone(NOTE, 6, 'write the draft #work', true).ok).toBe(false);
    expect(setTaskDone(NOTE, 400, 'x', true).ok).toBe(false);
  });

  it('the expected text is the one without the due marker', () => {
    expect(setTaskDone('- [ ] pay 📅 2026-10-10\n', 1, 'pay', true).ok).toBe(true);
  });
});

const task = (note: string, line: number, over: Partial<NoteTask> = {}): NoteTask => ({
  note, line, done: false, text: `t${line}`, tags: [], depth: 0, noteTags: [], ...over,
});
const TODAY = '2026-10-07';

describe('queryTasks', () => {
  const all = [
    task('Work/a.md', 3, { due: '2026-10-05', text: 'late one' }),
    task('Work/a.md', 9, { due: '2026-10-07', tags: ['#urgent'] }),
    task('Work/deep/b.md', 1, { due: '2026-10-20', noteTags: ['#project/x'] }),
    task('Home/c.md', 2),
    task('Home/c.md', 5, { done: true, due: '2026-10-01' }),
    task('Workshop/d.md', 4, { text: 'Buy Milk' }),
  ];
  const names = (f: Parameters<typeof queryTasks>[1]) => queryTasks(all, f, TODAY).map(t => `${t.note}:${t.line}`);

  it('open tasks by default, soonest due first, those with no date after, then by note and line', () => {
    expect(names({})).toEqual(['Work/a.md:3', 'Work/a.md:9', 'Work/deep/b.md:1', 'Home/c.md:2', 'Workshop/d.md:4']);
    expect(names({ status: 'done' })).toEqual(['Home/c.md:5']);
    expect(names({ status: 'all' })).toHaveLength(6);
  });

  it('a folder at any depth, but not a folder that merely starts alike', () => {
    expect(names({ folder: 'Work' })).toEqual(['Work/a.md:3', 'Work/a.md:9', 'Work/deep/b.md:1']);
    expect(names({ folder: '/work/' })).toEqual(['Work/a.md:3', 'Work/a.md:9', 'Work/deep/b.md:1']);
  });

  it('a tag the task carries or its note has, with or without the #', () => {
    expect(names({ tag: 'urgent' })).toEqual(['Work/a.md:9']);
    expect(names({ tag: '#PROJECT/x' })).toEqual(['Work/deep/b.md:1']);
  });

  it('due ranges, overdue, and no date', () => {
    expect(names({ dueFrom: '2026-10-07', dueTo: '2026-10-31' })).toEqual(['Work/a.md:9', 'Work/deep/b.md:1']);
    expect(names({ dueTo: '2026-10-06' })).toEqual(['Work/a.md:3']);
    expect(names({ overdue: true })).toEqual(['Work/a.md:3']);
    expect(queryTasks(all, { overdue: true, status: 'all' }, TODAY).map(t => t.line)).toEqual([3]); // a finished task is not overdue
    expect(names({ noDue: true })).toEqual(['Home/c.md:2', 'Workshop/d.md:4']);
  });

  it('text, case-insensitive', () => {
    expect(names({ text: 'milk' })).toEqual(['Workshop/d.md:4']);
  });

  it('filters combine', () => {
    expect(names({ folder: 'Work', overdue: true, text: 'late' })).toEqual(['Work/a.md:3']);
    expect(matchesTask(all[0], { tag: 'x' }, TODAY)).toBe(false);
  });

  it('the order is total', () => {
    const shuffled = [...all].reverse();
    expect(queryTasks(shuffled, { status: 'all' }, TODAY)).toEqual(queryTasks(all, { status: 'all' }, TODAY));
    expect(compareTasks(all[0], all[0])).toBe(0);
  });
});

describe('dueFilter', () => {
  it('what each choice of the due-date menu asks for', () => {
    expect(dueFilter('any', TODAY)).toEqual({});
    expect(dueFilter('overdue', TODAY)).toEqual({ overdue: true });
    expect(dueFilter('today', TODAY)).toEqual({ dueFrom: TODAY, dueTo: TODAY });
    expect(dueFilter('week', TODAY)).toEqual({ dueFrom: TODAY, dueTo: '2026-10-13' });
    expect(dueFilter('none', TODAY)).toEqual({ noDue: true });
  });
});

describe('days', () => {
  it('addDays crosses months and years; localDay is the machine\'s own day', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(localDay(new Date(2026, 9, 7, 23, 59))).toBe('2026-10-07');
  });
});
