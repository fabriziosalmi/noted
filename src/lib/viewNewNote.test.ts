import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createNoteInView } from './viewNewNote';
import { useStore } from '../store/useStore';
import { blankView } from '../../shared/views/model';
import { extractHtmlFrontmatterComment } from '../../shared/markdown/frontmatter';
import { fieldsFromFrontmatter } from '../../shared/vault/fields';

const original = useStore.getState().createNote;
let createNote: ReturnType<typeof vi.fn>;
beforeEach(() => {
  createNote = vi.fn(async () => undefined);
  useStore.setState({ createNote, settings: { ...useStore.getState().settings, language: 'en' } });
  vi.spyOn(Date, 'now').mockReturnValue(1234);
});
afterEach(() => { useStore.setState({ createNote: original }); vi.restoreAllMocks(); });

const typeOf = (f: string) => (f === 'votes' ? 'number' as const : 'text' as const);
const created = () => {
  const [name, content] = createNote.mock.calls[0] as [string, string];
  const { frontmatter, body } = extractHtmlFrontmatterComment(content);
  return { name, body, fields: fieldsFromFrontmatter(frontmatter) };
};

describe('createNoteInView', () => {
  it('a plain view makes an empty note at the top of the vault, with no properties', async () => {
    await createNoteInView(blankView('v', 'V'), typeOf);
    expect(created()).toEqual({ name: 'New_Note_1234.md', body: '<h1></h1><p></p>', fields: {} });
  });

  it('in the view\'s folder, with its tag, and with what its filters say', async () => {
    const view = blankView('v', 'V', { source: { kind: 'folder', folder: 'Work' }, filters: [{ field: 'votes', op: 'equals', value: '4' }] });
    await createNoteInView(view, typeOf);
    expect(created()).toMatchObject({ name: 'Work/New_Note_1234.md', fields: { votes: 4 } });
    createNote.mockClear();
    await createNoteInView(blankView('v', 'V', { source: { kind: 'tag', tag: '#idea' } }), typeOf);
    expect(created().body).toBe('<h1></h1><p>#idea </p>');
  });

  it('from a board column, the column\'s value; from the "no value" column, none', async () => {
    const view = blankView('v', 'V', { layout: 'board', groupBy: 'status' });
    await createNoteInView(view, typeOf, 'doing');
    expect(created().fields).toEqual({ status: 'doing' });
    createNote.mockClear();
    await createNoteInView(view, typeOf, null);
    expect(created().fields).toEqual({});
  });
});
