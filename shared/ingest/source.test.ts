import { describe, expect, it } from 'vitest';
import { clipForModel, composeSourceNote, MODEL_CHARS, parseSummary, relatedNotes, sourceNoteName, tidy, type SourceNoteInput } from './source';
import { compose } from '../diff/hunks';
import { extractFields } from '../vault/extract';

describe('parseSummary', () => {
  it('reads the JSON a model was asked for', () => {
    expect(parseSummary('{"title":"A title","summary":"Two sentences. Here.","key_points":["one","two"]}')).toEqual({ title: 'A title', summary: 'Two sentences. Here.', keyPoints: ['one', 'two'] });
  });
  it('and when it wraps it in a fence, or in words', () => {
    expect(parseSummary('```json\n{"summary":"S","key_points":["a"]}\n```').summary).toBe('S');
    expect(parseSummary('Sure! Here is the JSON:\n{"summary":"S","keyPoints":["a","b"]}\nHope it helps.')).toMatchObject({ summary: 'S', keyPoints: ['a', 'b'] });
    expect(parseSummary('{"summary":"S","points":["x"]}').keyPoints).toEqual(['x']);
  });
  it('a model that did not keep to JSON is not a failure: its words are the summary', () => {
    expect(parseSummary('  The article says\n  that things happen.  ')).toEqual({ title: null, summary: 'The article says that things happen.', keyPoints: [] });
    expect(parseSummary('{"unrelated": 1}').summary).toBe('{"unrelated": 1}');
    expect(parseSummary('[1,2,3]').summary).toBe('[1,2,3]');
    expect(parseSummary('')).toEqual({ title: null, summary: '', keyPoints: [] });
  });
  it('keeps what it gets within limits, and drops what is not text', () => {
    const r = parseSummary(JSON.stringify({ summary: 'x'.repeat(5000), key_points: [...Array.from({ length: 20 }, (_, i) => `point ${i}`), 3, null, '  '], title: 7 }));
    expect(r.summary).toHaveLength(1200);
    expect(r.summary.endsWith('…')).toBe(true);
    expect(r.keyPoints).toHaveLength(8);
    expect(r.title).toBeNull();
  });
});

describe('clipForModel', () => {
  it('leaves a short source alone, and cuts a long one at the end of a paragraph', () => {
    expect(clipForModel('short')).toEqual({ text: 'short', clipped: false });
    const long = `${'a '.repeat(5000)}\n\n${'b '.repeat(5000)}`;
    const r = clipForModel(long);
    expect(r.clipped).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(MODEL_CHARS);
    expect(r.text).not.toContain('b');
  });
  it('with no paragraph to cut at, it cuts at the limit', () => {
    expect(clipForModel('x'.repeat(30_000)).text).toHaveLength(MODEL_CHARS);
  });
});

describe('relatedNotes', () => {
  const c = (name: string, headingPath: string[] = []) => ({ name, title: name.replace(/\.md$/, ''), headingPath });
  it('is the distinct notes of the best sections, in order, with where in the note, without the ones to skip', () => {
    const r = relatedNotes([c('A.md', ['Goals']), c('A.md', ['Risks']), c('sources/Self.md'), c('B.md'), c('C.md', ['X', 'Y'])], new Set(['sources/Self.md']));
    expect(r).toEqual([{ note: 'A.md', reason: 'Goals' }, { note: 'B.md', reason: '' }, { note: 'C.md', reason: 'X › Y' }]);
  });
  it('at most so many', () => {
    expect(relatedNotes(Array.from({ length: 20 }, (_, i) => c(`N${i}.md`)), new Set(), 3)).toHaveLength(3);
  });
});

describe('sourceNoteName', () => {
  it('makes a name a path can hold, in sources/, short, and not one that is taken', () => {
    expect(sourceNoteName('How to: write "good" notes? / a guide', new Set())).toBe('sources/How to write good notes a guide.md');
    expect(sourceNoteName('', new Set())).toBe('sources/Source.md');
    expect(sourceNoteName('...', new Set())).toBe('sources/Source.md');
    expect(sourceNoteName('x'.repeat(200), new Set())).toHaveLength('sources/.md'.length + 80);
    expect(sourceNoteName('Title', new Set(['sources/Title.md', 'sources/title 2.md']))).toBe('sources/Title 3.md');
  });
});

describe('composeSourceNote', () => {
  const input: SourceNoteInput = {
    title: 'A Title', url: 'https://example.com/a?x=1', hash: 'abc123', retrievedAt: '2026-10-07T10:00:00.000Z', model: 'lmstudio/qwen3',
    summary: { title: null, summary: 'It says things.', keyPoints: ['First', 'Second'] },
    related: [{ note: 'Work/Plan.md', reason: 'Goals' }, { note: 'Ideas.md', reason: '' }],
    clipped: false,
    labels: { summary: 'Summary', keyPoints: 'Key points', related: 'Related', source: 'Source', pasted: 'Pasted text', clipped: 'Only the first part was summarised.' },
  };
  const { after } = composeSourceNote(input);

  it('records where it came from, how to tell it is the same text, when, and with which model, as properties', () => {
    const f = extractFields(after, 'markdown');
    expect(f).toMatchObject({ type: 'source', source: 'https://example.com/a?x=1', source_hash: 'sha256:abc123', retrieved_at: '2026-10-07T10:00:00.000Z', model: 'lmstudio/qwen3' });
  });

  it('lays out the summary, the key points, the related notes and the source', () => {
    expect(after).toContain('# A Title\n\n## Summary\n\nIt says things.\n\n## Key points\n\n- First\n- Second\n\n## Related\n\n- [[Work/Plan]]: Goals\n\n- [[Ideas]]\n\n## Source\n\n<https://example.com/a?x=1>\n');
  });

  it('is the note without links, and the note with them, and the review of the difference: one change for each link', () => {
    const { before, after, review } = composeSourceNote(input);
    expect(review.changes.map(c => c.added.map(x => x.segments.map(s => s.text).join('')).join('|'))).toEqual(['- [[Work/Plan]]: Goals|', '- [[Ideas]]|']);
    expect(review.changes.every(c => c.removed.length === 0)).toBe(true);
    // the model and the texts agree: all the links is the note with them, none is the note without
    expect(compose(before, after, review, new Set([0, 1]))).toBe(after);
    expect(compose(before, after, review, new Set())).toBe(before);
  });

  it('a link that is dropped is not in the note, and when all are dropped the heading goes too', () => {
    const { before, after, review } = composeSourceNote(input);
    const some = tidy(compose(before, after, review, new Set([1])), 'Related');
    expect(some).toContain('## Related\n\n- [[Ideas]]\n\n## Source');
    expect(some).not.toContain('Work/Plan');
    const other = tidy(compose(before, after, review, new Set([0])), 'Related');
    expect(other).toContain('## Related\n\n- [[Work/Plan]]: Goals\n\n## Source');
    const none = tidy(compose(before, after, review, new Set()), 'Related');
    expect(none).not.toContain('## Related');
    expect(none).toContain('## Source');
    expect(none.endsWith('\n') && !none.endsWith('\n\n')).toBe(true);
    expect(tidy(after, 'Related')).toBe(after.replace(/\n*$/, '\n'));
  });

  it('a note with nothing related has nothing to review, and no heading for it', () => {
    const { before, after, review } = composeSourceNote({ ...input, related: [] });
    expect(review.changes).toEqual([]);
    expect(after).toBe(before);
    expect(tidy(after, 'Related')).not.toContain('## Related');
  });

  it('pasted text has no address; a source cut short says so; a value that needs quoting is quoted', () => {
    const p = composeSourceNote({ ...input, url: null, clipped: true, model: 'openai/gpt 4: x', summary: { title: null, summary: 'S', keyPoints: [] } }).after;
    expect(extractFields(p, 'markdown')).toMatchObject({ source: 'pasted', model: 'openai/gpt 4: x' });
    expect(p).toContain('## Source\n\nPasted text\n\nOnly the first part was summarised.');
    expect(p).not.toContain('## Key points');
  });
});
