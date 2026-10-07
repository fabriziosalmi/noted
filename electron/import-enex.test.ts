// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { JSDOM } from 'jsdom';
import { importEnex, vaultWriter, notebookName, type EnexDeps } from './import-enex';
import { readEnex, EnexError } from './enex-stream';
import { reportToMarkdown } from '../shared/import/report';

// A 1x1 PNG and a few bytes that are not an image (a "PDF")
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const md5 = (b: Buffer) => crypto.createHash('md5').update(b).digest('hex');

const resource = (data: Buffer, mime: string, fileName: string) =>
  `<resource><data encoding="base64">${data.toString('base64').replace(/(.{40})/g, '$1\n')}</data><mime>${mime}</mime><resource-attributes><file-name>${fileName}</file-name></resource-attributes></resource>`;
const enml = (inner: string) => `<![CDATA[<?xml version="1.0" encoding="UTF-8" standalone="no"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note>${inner}</en-note>]]>`;
const note = (o: { title: string; content: string; tags?: string[]; created?: string; updated?: string; url?: string; resources?: string[] }) =>
  `<note><title>${o.title}</title><content>${enml(o.content)}</content><created>${o.created ?? '20190314T101530Z'}</created><updated>${o.updated ?? '20200101T000000Z'}</updated>${(o.tags ?? []).map(t => `<tag>${t}</tag>`).join('')}<note-attributes>${o.url ? `<source-url>${o.url}</source-url>` : ''}<author>Fab</author></note-attributes>${(o.resources ?? []).join('')}</note>`;
const enex = (...notes: string[]) => `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd">\n<en-export export-date="20201001T000000Z" application="Evernote" version="10.0">${notes.join('\n')}</en-export>`;

let dir: string, vault: string;
const dom = () => { const w = new JSDOM('').window; return { document: w.document, DOMParser: w.DOMParser as unknown as typeof DOMParser }; };
const deps = (format: 'markdown' | 'html' = 'markdown'): EnexDeps => ({ format, dom: dom(), attachmentsFolder: 'attachments', ...vaultWriter(vault) });
const read = (rel: string) => fs.readFileSync(path.join(vault, rel), 'utf8');
const write = (name: string, text: string) => { const f = path.join(dir, name); fs.writeFileSync(f, text); return f; };

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-enex-')); vault = path.join(dir, 'vault'); fs.mkdirSync(vault); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('reading an export', () => {
  it('gives every note with its properties, text and attachments, and the hash <en-media> names', async () => {
    const f = write('x.enex', enex(note({ title: 'A &amp; B', content: '<div>hi</div>', tags: ['t1', 't2'], url: 'https://x.test', resources: [resource(PNG, 'image/png', 'p.png')] })));
    const notes = [];
    for await (const n of readEnex(f)) notes.push(n);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ title: 'A & B', tags: ['t1', 't2'], sourceUrl: 'https://x.test', author: 'Fab', created: '20190314T101530Z' });
    expect(notes[0].content).toContain('<div>hi</div>');
    expect(notes[0].resources[0]).toMatchObject({ mime: 'image/png', fileName: 'p.png', hash: md5(PNG) });
    expect(notes[0].resources[0].data.equals(PNG)).toBe(true);
  });

  it('reads the same with a tiny read buffer: a note, a tag or an attachment cut across reads is whole', async () => {
    const f = write('x.enex', enex(note({ title: 'T', content: '<div>hello world</div>', tags: ['abc'], resources: [resource(PNG, 'image/png', 'p.png')] })));
    const notes = [];
    for await (const n of readEnex(f, 7)) notes.push(n);
    expect(notes[0].tags).toEqual(['abc']);
    expect(notes[0].content).toContain('hello world');
    expect(notes[0].resources[0].data.equals(PNG)).toBe(true);
  });

  it('refuses a file that is not an export, and one that is cut short', async () => {
    await expect((async () => { for await (const _ of readEnex(write('a.enex', '<html><body>no</body></html>'))) void _; })()).rejects.toBeInstanceOf(EnexError);
    await expect((async () => { for await (const _ of readEnex(write('b.enex', ''))) void _; })()).rejects.toBeInstanceOf(EnexError);
    await expect((async () => { for await (const _ of readEnex(write('c.enex', enex(note({ title: 'T', content: 'x' })).slice(0, -200)))) void _; })()).rejects.toBeInstanceOf(Error);
  });
});

describe('importing', () => {
  it('writes a note per note under Evernote/<notebook>, with properties, an image kept as a file and a PDF linked', async () => {
    const f = write('Work Notes.enex', enex(
      note({ title: 'Plan', content: `<div>Ship it</div><div><en-media hash="${md5(PNG)}" type="image/png"/></div><div><en-media hash="${md5(PDF)}" type="application/pdf"/></div>`, tags: ['work'], url: 'https://x.test/p', resources: [resource(PNG, 'image/png', 'shot.png'), resource(PDF, 'application/pdf', 'spec v2.pdf')] }),
    ));
    const report = await importEnex(deps(), f);
    expect(report.imported).toBe(1);
    const text = read('Evernote/Work Notes/Plan.md');
    expect(text).toMatch(/^---\ncreated: 2019-03-14T10:15:30.000Z\nmodified: 2020-01-01T00:00:00.000Z\ntags:\n {2}- work\nsource: https:\/\/x.test\/p\nauthor: Fab\n---\n/);
    expect(text).toContain('Ship it');
    const png = fs.readdirSync(path.join(vault, 'attachments')).filter(n => n.endsWith('.png'));
    expect(png).toHaveLength(1);
    expect(text).toContain(`![shot.png](attachments/${png[0]})`);
    expect(fs.readFileSync(path.join(vault, 'attachments', png[0])).equals(PNG)).toBe(true);
    const pdf = fs.readdirSync(path.join(vault, 'attachments')).find(n => n.endsWith('.pdf'))!;
    expect(pdf).toMatch(/^[0-9a-f]{8}-spec_v2\.pdf$/);
    expect(text).toContain(`[spec v2.pdf](attachments/${pdf})`);
    expect(report.attachments).toBe(2);
    expect(report.findings.some(x => x.level === 'formatting' && x.message.includes('spec v2.pdf'))).toBe(true);
  });

  it('keeps two notes of one title, and an image used twice is stored once', async () => {
    const same = (n: string) => note({ title: 'Same', content: `<div>${n}<en-media hash="${md5(PNG)}" type="image/png"/></div>`, resources: [resource(PNG, 'image/png', 'p.png')] });
    const report = await importEnex(deps(), write('Box.enex', enex(same('one'), same('two'))));
    expect(report.imported).toBe(2);
    expect(read('Evernote/Box/Same.md')).toContain('one');
    expect(read('Evernote/Box/Same_1.md')).toContain('two');
    expect(fs.readdirSync(path.join(vault, 'attachments'))).toHaveLength(1);
    expect(report.attachments).toBe(1);
  });

  it('treats titles that differ only in case as one, so a vault taken to a case-insensitive disk loses nothing', async () => {
    await importEnex(deps(), write('Box.enex', enex(note({ title: 'Plan', content: '<div>upper</div>' }), note({ title: 'plan', content: '<div>lower</div>' }))));
    expect(fs.readdirSync(path.join(vault, 'Evernote/Box')).sort()).toEqual(['Plan.md', 'plan_1.md']);
  });

  it('does not overwrite a note that is already there, on a second import', async () => {
    const f = write('Box.enex', enex(note({ title: 'Keep', content: '<div>v1</div>' })));
    await importEnex(deps(), f);
    fs.writeFileSync(path.join(vault, 'Evernote/Box/Keep.md'), 'my edits');
    await importEnex(deps(), f);
    expect(read('Evernote/Box/Keep.md')).toBe('my edits');
    expect(read('Evernote/Box/Keep_1.md')).toContain('v1');
  });

  it('reports encrypted text, a missing attachment and an empty one, and imports the rest of the note', async () => {
    const f = write('Box.enex', enex(note({ title: 'Mixed', content: '<div>open <en-crypt cipher="RC2">XYZ</en-crypt></div><div>pic <en-media hash="deadbeef" type="image/png"/></div>', resources: [resource(Buffer.alloc(0), 'image/png', 'empty.png')] })));
    const report = await importEnex(deps(), f);
    const text = read('Evernote/Box/Mixed.md');
    expect(text).toContain('open');
    expect(text).not.toContain('XYZ');
    const by = (level: string) => report.findings.filter(x => x.level === level).map(x => x.message);
    expect(by('lossy').some(m => m.includes('encrypted'))).toBe(true);
    expect(by('lossy').some(m => m.includes('not in the export'))).toBe(true);
    expect(by('skipped')).toEqual(['attachment "empty.png" is empty']);
    expect(reportToMarkdown(report, '2026-10-07')).toContain('## Content that did not come across');
  });

  it('writes an HTML vault in HTML, properties in the comment the app reads', async () => {
    await importEnex(deps('html'), write('Box.enex', enex(note({ title: 'H', content: '<div>body</div>', tags: ['x'] }))));
    const text = read('Evernote/Box/H.md');
    expect(text).toContain('<!--');
    expect(decodeURIComponent(text)).toContain('created: 2019-03-14T10:15:30.000Z');
    expect(text).toContain('<div>body</div>');
  });

  it('survives hostile titles and a note with no title, and stays inside the vault', async () => {
    const f = write('..evil.enex', enex(note({ title: '../../escape', content: '<div>a</div>' }), note({ title: '', content: '<div>b</div>' })));
    await importEnex(deps(), f);
    const all = fs.readdirSync(dir);
    expect(all.sort()).toEqual(['..evil.enex', 'vault']);
    expect(fs.readdirSync(path.join(vault, 'Evernote'))).toHaveLength(1);
    const folder = path.join(vault, 'Evernote', fs.readdirSync(path.join(vault, 'Evernote'))[0]);
    expect(fs.readdirSync(folder).sort()).toEqual(['Untitled.md', 'escape.md'].sort());
  });

  it('names the notebook after the file', () => {
    expect(notebookName('/x/My: Notebook.enex')).toBe('My Notebook');
    expect(notebookName('/x/.enex')).toBe('Untitled');
  });
});
