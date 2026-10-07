import { describe, it, expect } from 'vitest';
import { closestName, DEFAULT_LINT, lintVault, type Finding, type LintNote } from './vaultLint';

const NOW = Date.UTC(2026, 9, 7);
const DAY = 86_400_000;
const words = (n: number, seed = 'w') => Array.from({ length: n }, (_, i) => `${seed}${i}`).join(' ');
const note = (name: string, over: Partial<LintNote> = {}): LintNote => ({
  name, links: [], headings: [], aliases: [], fields: {}, text: `Some text of ${name} about nothing in particular.`, mtimeMs: NOW - DAY, parsed: true, ...over,
});
const run = (notes: LintNote[], over: Partial<typeof DEFAULT_LINT> = {}) => lintVault(notes, { ...DEFAULT_LINT, ...over, now: NOW });
const of = (r: ReturnType<typeof run>, kind: Finding['kind']) => r.findings.filter(f => f.kind === kind);

describe('links', () => {
  it('a link to no note is broken, once per note and target however often it is written, and a link to one is not', () => {
    const r = run([
      note('A.md', { links: [{ target: 'B' }, { target: 'Missing' }, { target: 'missing' }, { target: 'Work/Deep' }] }),
      note('B.md', { links: [{ target: 'A' }] }),
      note('Work/Deep.md', { links: [{ target: 'A' }] }),
    ]);
    expect(of(r, 'broken-link')).toEqual([{ id: 'broken-link:A.md:missing', kind: 'broken-link', note: 'A.md', target: 'Missing', suggestion: null }]);
  });

  it('follows how the app resolves a link: by bare name in any folder, by alias, case aside', () => {
    const r = run([
      note('A.md', { links: [{ target: 'plan' }, { target: 'Roadmap' }] }),
      note('Work/Plan.md', { links: [{ target: 'A' }] }),
      note('Q4.md', { aliases: ['Roadmap'], links: [{ target: 'A' }] }),
    ]);
    expect(of(r, 'broken-link')).toEqual([]);
  });

  it('suggests the note a missing target was probably meant to be: a typo, or accents and case, and only when it is unambiguous', () => {
    const names = ['Projects/Quarterly Plan.md', 'Café.md', 'Notes.md'];
    expect(closestName('Quartely Plan', names)).toBe('Projects/Quarterly Plan.md');
    expect(closestName('cafe', names)).toBe('Café.md');
    expect(closestName('Totally Different', names)).toBeNull();
    expect(closestName('Note', names)).toBeNull(); // too short to guess from
    expect(closestName('Planx', ['Plana.md', 'Planb.md'])).toBeNull(); // two equally close: no guess
    const r = run([note('A.md', { links: [{ target: 'Quartely Plan' }] }), note('Projects/Quarterly Plan.md', { links: [{ target: 'A' }] })]);
    expect(of(r, 'broken-link')[0]).toMatchObject({ suggestion: 'Projects/Quarterly Plan.md' });
  });

  it('a link to a heading that is not in the note is broken; to one that is, or to the note alone, is not', () => {
    const r = run([
      note('A.md', { links: [{ target: 'B', heading: 'Goals' }, { target: 'B', heading: 'goals' }, { target: 'B', heading: 'Nope' }, { target: 'B' }] }),
      note('B.md', { headings: ['Plan', 'Goals'], links: [{ target: 'A' }] }),
    ]);
    expect(of(r, 'broken-heading')).toEqual([{ id: 'broken-heading:A.md:b.md#nope', kind: 'broken-heading', note: 'A.md', target: 'B', resolved: 'B.md', heading: 'Nope' }]);
  });

  it('says nothing about a note that was too large to read, or about links into one', () => {
    const r = run([
      note('A.md', { links: [{ target: 'Big', heading: 'Anything' }] }),
      note('Big.md', { parsed: false, text: '', links: [{ target: 'Nowhere' }] }),
    ]);
    expect(r.findings.filter(f => f.kind === 'broken-link' || f.kind === 'broken-heading')).toEqual([]);
    expect(r.unread).toEqual(['Big.md']);
  });
});

describe('isolated notes', () => {
  it('a note nothing links to and that links to nothing; one that is linked, or that links, is not', () => {
    const r = run([
      note('Alone.md'),
      note('Links Out.md', { links: [{ target: 'Linked' }] }),
      note('Linked.md'),
      note('Self.md', { links: [{ target: 'Self' }] }), // a link to itself connects nothing
    ]);
    expect(of(r, 'isolated').map(f => (f as { note: string }).note)).toEqual(['Alone.md', 'Self.md']);
  });

  it('daily notes stand alone by design', () => {
    expect(of(run([note('2026-10-06.md'), note('Journal/2026-10-07 Monday.md')]), 'isolated')).toEqual([]);
  });

  it('the report this check writes is not part of what it checks: its links connect nothing, its mentions are no broken links', () => {
    const report = note('reports/Vault health 2026-10-07.md', { links: [{ target: 'Alone' }, { target: 'Not There' }], text: words(300), mtimeMs: NOW - 900 * DAY });
    const r = run([note('Alone.md'), report]);
    expect(of(r, 'isolated').map(f => (f as { note: string }).note)).toEqual(['Alone.md']); // the report's link to it does not count
    expect(of(r, 'broken-link')).toEqual([]);
    expect([...of(r, 'stale'), ...of(r, 'no-summary'), ...of(r, 'near-duplicate'), ...of(r, 'same-name')]).toEqual([]);
    expect(r.notes).toBe(2);
  });

  it('a link to a note that does not exist does not connect the note to anything', () => {
    expect(of(run([note('A.md', { links: [{ target: 'Missing' }] })]), 'isolated')).toHaveLength(1);
  });
});

describe('duplicates', () => {
  const body = 'The quarterly plan covers hiring budget and launch dates for every team in the company this year and next.';
  it('notes with the same text, whatever the case and spacing, are duplicates, the oldest first', () => {
    const r = run([
      note('Copy.md', { text: body.toUpperCase().replace(/ /g, '  '), mtimeMs: NOW - 2 * DAY }),
      note('Original.md', { text: body, mtimeMs: NOW - 9 * DAY }),
      note('Other.md', { text: 'Something else entirely, a different subject with enough words to count as a note.' }),
    ]);
    expect(of(r, 'duplicate')).toEqual([{ id: 'duplicate:Original.md|Copy.md', kind: 'duplicate', notes: ['Original.md', 'Copy.md'] }]);
  });

  it('short notes that happen to match are not duplicates', () => {
    expect(of(run([note('A.md', { text: 'Buy milk' }), note('B.md', { text: 'Buy milk' })]), 'duplicate')).toEqual([]);
  });

  it('notes that share nearly all their text are near duplicates, with how alike; exact ones are not listed twice', () => {
    const base = words(60);
    const edited = base.replace('w30', 'changed');
    const r = run([note('A.md', { text: base }), note('B.md', { text: edited }), note('C.md', { text: words(60, 'z') }), note('D.md', { text: base })]);
    expect(of(r, 'duplicate')).toHaveLength(1); // A and D
    const near = of(r, 'near-duplicate') as Extract<Finding, { kind: 'near-duplicate' }>[];
    expect(near.map(f => f.notes.join('+'))).toEqual(['A.md+B.md']); // A stands for the group of exact copies (A and D)
    expect(near[0].similarity).toBeGreaterThan(0.8);
  });

  it('notes that share only part of their text are not near duplicates', () => {
    const r = run([note('A.md', { text: `${words(30)} ${words(30, 'a')}` }), note('B.md', { text: `${words(30)} ${words(30, 'b')}` })]);
    expect(of(r, 'near-duplicate')).toEqual([]);
  });

  it('a header that a template puts in many notes does not make them duplicates', () => {
    const header = words(25, 'tpl');
    const notes = Array.from({ length: 60 }, (_, i) => note(`T${i}.md`, { text: `${header} ${words(40, `own${i}x`)}` }));
    expect(of(run(notes), 'near-duplicate')).toEqual([]);
  });

  it('the threshold is a choice', () => {
    const base = words(40);
    const notes = [note('A.md', { text: base }), note('B.md', { text: `${words(30)} ${words(10, 'q')}` })];
    expect(of(run(notes, { nearDuplicate: 0.5 }), 'near-duplicate')).toHaveLength(1);
    expect(of(run(notes, { nearDuplicate: 0.95 }), 'near-duplicate')).toHaveLength(0);
  });
});

describe('names, age, emptiness, summaries', () => {
  it('two notes with the same name in different folders are reported, whatever the case or accents', () => {
    const r = run([note('Work/Meeting.md'), note('Home/meeting.md'), note('Unique.md')]);
    expect(of(r, 'same-name')).toEqual([{ id: 'same-name:meeting', kind: 'same-name', name: 'meeting', notes: ['Home/meeting.md', 'Work/Meeting.md'] }]);
  });

  it('a note untouched for a year is stale, with how long; a recent one, or the report itself, is not', () => {
    const r = run([note('Old.md', { mtimeMs: NOW - 400 * DAY }), note('Edge.md', { mtimeMs: NOW - 365 * DAY }), note('New.md', { mtimeMs: NOW - 364 * DAY }), note('reports/Vault health.md', { mtimeMs: NOW - 900 * DAY, text: words(30) })]);
    expect(of(r, 'stale')).toEqual([
      { id: 'stale:Edge.md', kind: 'stale', note: 'Edge.md', days: 365 },
      { id: 'stale:Old.md', kind: 'stale', note: 'Old.md', days: 400 },
    ]);
    expect(of(run([note('Old.md', { mtimeMs: NOW - 40 * DAY })], { staleDays: 30 }), 'stale')).toHaveLength(1);
  });

  it('a note in Archive/ is parked on purpose: not stale, not isolated, not asked for a summary', () => {
    const r = run([note('Archive/Old.md', { mtimeMs: NOW - 900 * DAY, text: words(300) }), note('archive/Older.md', { mtimeMs: NOW - 900 * DAY })]);
    expect(r.findings).toEqual([]);
  });

  it('a note with no text is empty (and is not also stale or lacking a summary)', () => {
    const r = run([note('Blank.md', { text: '  ', mtimeMs: NOW - 900 * DAY })]);
    expect(of(r, 'empty')).toEqual([{ id: 'empty:Blank.md', kind: 'empty', note: 'Blank.md' }]);
    expect(of(r, 'stale')).toEqual([]);
  });

  it('a long note without a summary property is reported; a short one, or one with any of the summary properties, is not', () => {
    const long = words(250);
    const r = run([
      note('Long.md', { text: long }),
      note('Short.md', { text: words(50) }),
      note('Has Summary.md', { text: long, fields: { summary: 'It is about things.' } }),
      note('Has Description.md', { text: long, fields: { description: 'Things.' } }),
      note('Blank Summary.md', { text: long, fields: { summary: '  ' } }),
    ]);
    expect(of(r, 'no-summary').map(f => (f as { note: string }).note)).toEqual(['Blank Summary.md', 'Long.md']);
  });
});

describe('the report', () => {
  it('counts every kind, lists the options it used, and is the same for the same vault however the notes are ordered', () => {
    const notes = [
      note('A.md', { links: [{ target: 'Missing' }] }),
      note('B.md', { mtimeMs: NOW - 500 * DAY }),
      note('C.md', { text: '' }),
    ];
    const a = run(notes);
    const b = run([...notes].reverse());
    expect(b).toEqual(a);
    expect(a.counts).toMatchObject({ 'broken-link': 1, stale: 1, empty: 1, isolated: 3 });
    expect(a.notes).toBe(3);
    expect(a.options).toEqual(DEFAULT_LINT);
    expect(a.generatedAt).toBe(NOW);
  });

  it('a healthy vault has no findings', () => {
    const r = run([note('A.md', { links: [{ target: 'B' }] }), note('B.md', { links: [{ target: 'A' }] })]);
    expect(r.findings).toEqual([]);
    expect(Object.values(r.counts).every(n => n === 0)).toBe(true);
  });

  it('an empty vault is a report of nothing', () => {
    expect(run([])).toMatchObject({ notes: 0, findings: [], unread: [] });
  });
});
