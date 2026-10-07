// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { convertHtmlNote } from '../markdown/migrate';
import { enexFrontmatter, enmlToHtml, noteStem, parseEnexDate, type MediaRef } from './enex';
import { addFinding, countReport, createReport, MAX_LISTED_FINDINGS, mergeReports, reportToMarkdown, summarize } from './report';

const env = { document, DOMParser };
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="no"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">';
const note = (inner: string): string => `${HEAD}<en-note>${inner}</en-note>`;
const md = (inner: string, media = new Map<string, MediaRef>()): { text: string; findings: string[] } => {
  const { html, findings } = enmlToHtml(note(inner), env, media);
  return { text: convertHtmlNote(html, env).text, findings: findings.map((f) => f.message) };
};

describe('dates', () => {
  it('reads the Evernote format, and nothing else', () => {
    expect(parseEnexDate('20190314T101530Z')).toBe('2019-03-14T10:15:30.000Z');
    for (const v of [undefined, '', '2019-03-14', '20191314T101530Z', '20190314T101530']) expect(parseEnexDate(v)).toBeNull();
  });
});

describe('properties', () => {
  it('become frontmatter, in the order a person would read them, and only what is there', () => {
    expect(enexFrontmatter({ created: '2019-03-14T10:15:30.000Z', updated: null, tags: ['work', 'a: b'], sourceUrl: 'https://x.test/a?b=1', author: '' }))
      .toBe('---\ncreated: 2019-03-14T10:15:30.000Z\ntags:\n  - work\n  - "a: b"\nsource: https://x.test/a?b=1\n---\n');
    expect(enexFrontmatter({ created: null, updated: null, tags: [], sourceUrl: '', author: '' })).toBe('');
  });
});

describe('file names', () => {
  it('are the title made safe, never empty, never one the vault refuses', () => {
    expect(noteStem('Plan: Q3/Q4 <draft>?')).toBe('Plan Q3 Q4 draft');
    expect(noteStem('')).toBe('Untitled');
    expect(noteStem('...')).toBe('Untitled');
    expect(noteStem('CON')).toBe('CON_');
    expect(new TextEncoder().encode(noteStem('é'.repeat(300))).length).toBeLessThanOrEqual(120);
  });
});

describe('ENML to Markdown', () => {
  it('keeps text, headings, lists and links, and what follows a self-closing <en-media/>', () => {
    const { text } = md('<div>Hello <b>world</b></div><div><br/></div><ul><li>one</li><li>two</li></ul><div><a href="https://x.test">link</a></div>');
    expect(text).toContain('Hello **world**');
    expect(text).toContain('- one\n- two');
    expect(text).toContain('[link](https://x.test)');
  });

  it('puts an image where <en-media> was, and the text after it stays after it', () => {
    const media = new Map<string, MediaRef>([['abc123', { rel: 'attachments/h.png', name: 'photo.png', image: true }]]);
    const { text } = md('<div>before</div><div><en-media hash="abc123" type="image/png"/></div><div>after</div>', media);
    expect(text).toMatch(/before\n\n!\[photo\.png\]\(attachments\/h\.png\)\n\nafter/);
  });

  it('links a file that is not a picture, by name', () => {
    const media = new Map<string, MediaRef>([['f00', { rel: 'attachments/ab12-report.pdf', name: 'report.pdf', image: false }]]);
    expect(md('<div><en-media hash="f00" type="application/pdf"></en-media></div>', media).text).toContain('[report.pdf](attachments/ab12-report.pdf)');
  });

  it('says so when an attachment is named but absent', () => {
    const r = md('<div>x<en-media hash="nope" type="image/png"/>y</div>');
    expect(r.text).toContain('x(attachment missing from the export)y');
    expect(r.findings).toEqual(['an attachment is named in the note but is not in the export']);
  });

  it('makes check boxes a task list, one list for neighbours', () => {
    const { text } = md('<div><en-todo checked="true"/>done</div><div><en-todo/>todo</div><div>plain</div><div><en-todo/>later</div>');
    expect(text).toContain('- [x] done\n- [ ] todo');
    expect(text).toContain('plain');
    expect(text).toContain('- [ ] later');
  });

  it('turns a list whose items are check boxes into a task list', () => {
    expect(md('<ul><li><en-todo checked="true"/>a</li><li><en-todo/>b</li></ul>').text).toContain('- [x] a\n- [ ] b');
  });

  it('says where encrypted text was, and that it was not read', () => {
    const r = md('<div>secret: <en-crypt hint="pet" cipher="RC2" length="64">ENCRYPTEDBYTES</en-crypt></div>');
    expect(r.text).toContain('*(encrypted text, not imported)*');
    expect(r.text).not.toContain('ENCRYPTEDBYTES');
    expect(r.findings).toHaveLength(1);
  });

  it('does not let note text become markup', () => {
    const r = md('<div>&lt;script&gt;alert(1)&lt;/script&gt; &amp; more</div>');
    expect(r.text).toContain('\\<script>alert(1)\\</script> & more'); // escaped: text, not a tag
  });
});

describe('the report', () => {
  it('counts notes once per level and lists what changed', () => {
    const report = createReport('Work.enex');
    report.imported = 3;
    addFinding(report, { note: 'A', level: 'lossy', message: 'one' });
    addFinding(report, { note: 'A', level: 'lossy', message: 'two' });
    addFinding(report, { note: 'B', level: 'formatting', message: 'colours' });
    expect(countReport(report)).toEqual({ lossy: 1, formatting: 1, skipped: 0, notes: 3 });
    const text = reportToMarkdown(report, '2026-10-07');
    expect(text).toContain('# Import report: Work.enex');
    expect(text).toContain('- **A**: one\n- **A**: two');
    expect(text).toContain('## Styling that was dropped');
    expect(text).not.toContain('## Not imported');
  });

  it('merges several files into one, and summarises for the dialog', () => {
    const a = createReport('a.enex'); a.imported = 2; a.attachments = 1; addFinding(a, { note: 'A/x', level: 'lossy', message: 'm' });
    const b = createReport('b.enex'); b.imported = 3; addFinding(b, { note: 'B/y', level: 'skipped', message: 'm' }); addFinding(b, { note: 'B/y', level: 'formatting', message: 'm' });
    const m = mergeReports('a.enex, b.enex', [a, b]);
    expect(m).toMatchObject({ source: 'a.enex, b.enex', imported: 5, attachments: 1 });
    expect(m.findings).toHaveLength(3);
    expect(summarize(m, 'reports/r.md')).toEqual({ lossy: 1, skipped: 1, formatting: 1, attachments: 1, reportFile: 'reports/r.md' });
  });

  it('says plainly when nothing was lost, and counts what it does not list', () => {
    expect(reportToMarkdown(createReport('x'), 'today')).toContain('Nothing was lost');
    const r = createReport('x');
    for (let i = 0; i < MAX_LISTED_FINDINGS + 7; i++) addFinding(r, { note: `n${i}`, level: 'skipped', message: 'm' });
    expect(r.findings).toHaveLength(MAX_LISTED_FINDINGS);
    expect(reportToMarkdown(r, 'today')).toContain('7 more findings are not listed.');
  });
});
