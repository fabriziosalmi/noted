// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The unlinked-mentions handlers on a real vault: what they list, what they write, and what they leave alone.
const handlers = new Map<string, (...args: unknown[]) => Promise<{ success: boolean; data?: any; error?: string }>>();
let vault: string;

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: never) => { handlers.set(channel, fn); }, on: vi.fn() },
  app: { getPath: () => os.tmpdir(), isPackaged: false, getVersion: () => '0.0.0' },
  dialog: {}, shell: {}, BrowserWindow: class {},
}));

const write = (rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
  fs.writeFileSync(path.join(vault, rel), text);
};
const read = (rel: string) => fs.readFileSync(path.join(vault, rel), 'utf8');
const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args); // (event, ...args), as IPC calls it

beforeEach(async () => {
  vault = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'noted-mentions-')));
  process.env.NOTED_NOTES_DIR = vault;
  vi.resetModules();
  handlers.clear();
  const paths = await import('./core/paths');
  paths.initNotesDir();
  (await import('./ipc/mentions')).registerMentionHandlers();
});
afterEach(() => { fs.rmSync(vault, { recursive: true, force: true }); delete process.env.NOTED_NOTES_DIR; });

const markdownVault = () => fs.writeFileSync(path.join(vault, '.noted-vault.json'), '{"format":"markdown"}');

describe('unlinked mentions', () => {
  beforeEach(() => {
    markdownVault();
    write('Quarterly Plan.md', '---\naliases: [Roadmap]\n---\n# Quarterly Plan\n');
    write('A.md', 'We follow the Quarterly plan closely, and the quarterly plan again.\n');
    write('B.md', 'Already linked: [[Quarterly Plan]] and also the Quarterly Plan in prose.\n');
    write('C.md', 'Only in code: `Quarterly Plan` and a [Quarterly Plan](x.md) link.\n');
    write('D.md', 'The Roadmap says so.\n');
    write('E.md', '---\ntitle: Quarterly Plan\n---\nnothing else\n');
    write('Sub/F.md', 'Sub note about the Quarterly Plan.\n');
  });

  it('lists the notes that write the title or an alias as text and do not link to it, with a snippet', async () => {
    const res = await call('unlinked-mentions', 'Quarterly Plan.md');
    expect(res.success, res.error).toBe(true);
    const items = res.data.items as { name: string; count: number; snippet: { before: string; match: string; after: string } }[];
    expect(items.map(i => i.name).sort()).toEqual(['A.md', 'D.md', 'Sub/F.md']);
    const a = items.find(i => i.name === 'A.md')!;
    expect(a.count).toBe(2);
    expect(a.snippet.match).toBe('Quarterly plan');
    expect(a.snippet.before).toBe('We follow the ');
    expect(items.find(i => i.name === 'D.md')!.snippet.match).toBe('Roadmap');
  });

  it('a note already linking to it is not listed, and neither is the note itself', async () => {
    const names = ((await call('unlinked-mentions', 'Quarterly Plan.md')).data.items as { name: string }[]).map(i => i.name);
    expect(names).not.toContain('B.md');
    expect(names).not.toContain('Quarterly Plan.md');
  });

  it('refuses a name that is not a note path', async () => {
    expect((await call('unlinked-mentions', '../x.md')).success).toBe(false);
    expect((await call('unlinked-mentions', '.noted/x.md')).success).toBe(false);
  });
});

describe('linking a mention', () => {
  beforeEach(() => {
    markdownVault();
    write('Quarterly Plan.md', '---\naliases: [Roadmap]\n---\n# Quarterly Plan\n');
    write('A.md', 'We follow the Quarterly plan closely, and the quarterly plan again.\n');
    write('D.md', 'The Roadmap says so.\n');
  });

  it('turns the first mention into a link, keeping the text shown, and keeps the old text in the note\'s history', async () => {
    const before = read('A.md');
    const res = await call('link-mention', 'A.md', 'Quarterly Plan.md');
    expect(res).toMatchObject({ success: true, data: { remaining: 1 } });
    expect(read('A.md')).toBe('We follow the [[Quarterly Plan|Quarterly plan]] closely, and the quarterly plan again.\n');
    const history = fs.readdirSync(path.join(vault, '.noted_history', 'A.md'));
    expect(history).toHaveLength(1);
    expect(fs.readFileSync(path.join(vault, '.noted_history', 'A.md', history[0]), 'utf8')).toBe(before);
  });

  it('linking again links the next one; after the last, the note is no longer listed and there is nothing left to link', async () => {
    await call('link-mention', 'A.md', 'Quarterly Plan.md');
    expect((await call('link-mention', 'A.md', 'Quarterly Plan.md')).data.remaining).toBe(0);
    expect(read('A.md')).toBe('We follow the [[Quarterly Plan|Quarterly plan]] closely, and the [[Quarterly Plan|quarterly plan]] again.\n');
    expect((await call('link-mention', 'A.md', 'Quarterly Plan.md')).success).toBe(false);
    const names = ((await call('unlinked-mentions', 'Quarterly Plan.md')).data.items as { name: string }[]).map(i => i.name);
    expect(names).toEqual(['D.md']);
  });

  it('an alias is written as the text shown, and the link points at the note', async () => {
    await call('link-mention', 'D.md', 'Quarterly Plan.md');
    expect(read('D.md')).toBe('The [[Quarterly Plan|Roadmap]] says so.\n');
  });

  it('writes the path when the name is shared by another note, so the link finds the right one', async () => {
    write('Work/Plan.md', '# Plan\n');
    write('Life/Plan.md', '# Plan\n');
    write('Note.md', 'We should revisit the Plan someday.\n');
    await call('link-mention', 'Note.md', 'Work/Plan.md');
    expect(read('Note.md')).toBe('We should revisit the [[Work/Plan|Plan]] someday.\n');
  });

  it('leaves the rest of the note byte for byte, including front matter, code and existing links', async () => {
    const note = '---\ntags: [x]  # keep\n---\n\n* item with the Quarterly Plan\n\n```\nQuarterly Plan\n```\n\n[[Other]] and `Quarterly Plan`\n';
    write('G.md', note);
    await call('link-mention', 'G.md', 'Quarterly Plan.md');
    expect(read('G.md')).toBe(note.replace('with the Quarterly Plan', 'with the [[Quarterly Plan]]'));
  });

  it('works in a vault stored as HTML, with the editor\'s own link', async () => {
    fs.rmSync(path.join(vault, '.noted-vault.json'));
    write('Old.md', '<h1>Old</h1><p>See the Quarterly plan here <code>Quarterly plan</code></p>');
    await call('link-mention', 'Old.md', 'Quarterly Plan.md');
    expect(read('Old.md')).toBe('<h1>Old</h1><p>See the <span data-wikilink="Quarterly Plan" class="wikilink">[[Quarterly Plan|Quarterly plan]]</span> here <code>Quarterly plan</code></p>');
  });

  it('refuses bad names, and a source that does not exist', async () => {
    expect((await call('link-mention', '../x.md', 'Quarterly Plan.md')).success).toBe(false);
    expect((await call('link-mention', 'Nope.md', 'Quarterly Plan.md')).success).toBe(false);
  });
});
