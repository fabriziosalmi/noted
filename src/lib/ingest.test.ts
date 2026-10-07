import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildNote, isLocalModel, prepareSource, writeSourceNote, type IngestError, type IngestSettings } from './ingest';
import { useStore } from '../store/useStore';

vi.mock('./llm', async importOriginal => ({ ...(await importOriginal<object>()), askLLM: vi.fn() }));
vi.mock('./ragSearch', () => ({ retrieveChunks: vi.fn() }));
import { askLLM } from './llm';
import { retrieveChunks } from './ragSearch';

const original = window.electronAPI;
const chunk = (name: string, headingPath: string[] = []) => ({ name, title: name.replace(/\.md$/, ''), headingPath, text: 't', ord: 0, score: 1, lexicalRank: 1, denseRank: null, coverage: 1, similarity: null });
const ARTICLE = 'A long enough article about the quarterly planning process and how teams decide what to build next. '.repeat(3);
const now = new Date('2026-10-07T10:00:00.000Z');
const settings = (over: IngestSettings = {}): IngestSettings => ({ language: 'en', llmProvider: 'lmstudio', llmModel: 'qwen3', piiMasking: false, ...over });
let ingestFetch: ReturnType<typeof vi.fn>;
let saveNote: ReturnType<typeof vi.fn>;
let createFolder: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.mocked(askLLM).mockReset().mockResolvedValue(JSON.stringify({ title: 'Model title', summary: 'It is about planning.', key_points: ['Decide', 'Build'] }));
  vi.mocked(retrieveChunks).mockReset().mockResolvedValue({ mode: 'hybrid', chunks: [chunk('Work/Plan.md', ['Goals']), chunk('Work/Plan.md', ['Risks']), chunk('prompts/Formal.md'), chunk('reports/Vault health 2026-10-07.md'), chunk('Ideas.md')] });
  ingestFetch = vi.fn(async () => ({ success: true, data: { url: 'https://example.com/post', title: 'Page title', text: ARTICLE, truncated: false } }));
  saveNote = vi.fn(async () => ({ success: true }));
  createFolder = vi.fn(async () => ({ success: true }));
  window.electronAPI = { ...original, ingestFetch, saveNote, createFolder } as unknown as typeof window.electronAPI;
  useStore.setState({ notes: [] });
});
afterEach(() => { window.electronAPI = original; });

describe('isLocalModel', () => {
  it('Ollama is; LM Studio and a gateway are when their address is on this computer or in a private network; a cloud provider never is', () => {
    expect(isLocalModel({ llmProvider: 'ollama' })).toBe(true);
    expect(isLocalModel({ llmProvider: 'lmstudio' })).toBe(true); // its default, localhost
    expect(isLocalModel({ llmProvider: 'lmstudio', lmStudioUrl: 'http://localhost:1234/v1' })).toBe(true);
    expect(isLocalModel({ llmProvider: 'lmstudio', lmStudioUrl: '192.168.1.20:1234' })).toBe(true);
    expect(isLocalModel({ llmProvider: 'lmstudio', lmStudioUrl: 'https://my-llm-proxy.example.com/v1' })).toBe(false);
    expect(isLocalModel({ llmProvider: 'openai-compatible', openaiCompatibleUrl: 'http://192.168.1.5:8000/v1' })).toBe(true);
    expect(isLocalModel({ llmProvider: 'openai-compatible', openaiCompatibleUrl: 'http://10.0.0.7/v1' })).toBe(true);
    expect(isLocalModel({ llmProvider: 'openai-compatible', openaiCompatibleUrl: 'http://172.20.0.2/v1' })).toBe(true);
    expect(isLocalModel({ llmProvider: 'openai-compatible', openaiCompatibleUrl: 'http://gpu-box.local:8000/v1' })).toBe(true);
    expect(isLocalModel({ llmProvider: 'openai-compatible', openaiCompatibleUrl: 'http://172.32.0.2/v1' })).toBe(false); // outside 172.16/12
    expect(isLocalModel({ llmProvider: 'openai-compatible', openaiCompatibleUrl: 'https://llm.example.com/v1' })).toBe(false);
    expect(isLocalModel({ llmProvider: 'openai-compatible', openaiCompatibleUrl: '' })).toBe(false);
    for (const p of ['openai', 'anthropic', 'gemini', 'openrouter']) expect(isLocalModel({ llmProvider: p })).toBe(false);
  });
});

describe('prepareSource', () => {
  it('reads a page, has it summarised, finds the notes it is near, and says where it came from', async () => {
    const stages: string[] = [];
    const p = await prepareSource({ kind: 'url', url: ' https://example.com/post ' }, settings(), { now, onStage: s => stages.push(s) });
    expect(ingestFetch).toHaveBeenCalledWith('https://example.com/post');
    expect(stages).toEqual(['fetching', 'summarising', 'linking']);
    expect(p.input).toMatchObject({
      title: 'Page title', url: 'https://example.com/post', retrievedAt: '2026-10-07T10:00:00.000Z', model: 'lmstudio/qwen3', clipped: false,
      summary: { summary: 'It is about planning.', keyPoints: ['Decide', 'Build'] },
    });
    expect(p.input.hash).toMatch(/^[0-9a-f]{64}$/);
    // Related: the notes of the best sections, once each; prompts and reports are not content
    expect(p.input.related).toEqual([{ note: 'Work/Plan.md', reason: 'Goals' }, { note: 'Ideas.md', reason: '' }]);
    expect(p.review.changes).toHaveLength(2);
  });

  it('a suggested link has to be earned: a note found only through small words, or not close in meaning, is not suggested', async () => {
    const weak = { ...chunk('Gardening.md'), coverage: 0, similarity: null };
    const far = { ...chunk('Cooking.md'), coverage: 0, similarity: 0.1 };
    const near = { ...chunk('Meaning.md'), coverage: 0, similarity: 0.5 };
    vi.mocked(retrieveChunks).mockResolvedValueOnce({ mode: 'hybrid', chunks: [weak, far, near, chunk('Words.md')] });
    const p = await prepareSource({ kind: 'text', text: ARTICLE, title: 'T' }, settings(), { now });
    expect(p.input.related.map(r => r.note)).toEqual(['Meaning.md', 'Words.md']);
  });

  it('the hash is of the text that was read, so the same text is the same hash', async () => {
    const a = await prepareSource({ kind: 'url', url: 'https://example.com/post' }, settings(), { now });
    const b = await prepareSource({ kind: 'text', text: ARTICLE, title: 'T' }, settings(), { now });
    expect(b.input.hash).toBe(a.input.hash);
    expect(b.input.url).toBeNull();
    expect(b.input.title).toBe('T');
  });

  it('the page title wins over the model\'s, and the model\'s over nothing', async () => {
    expect((await prepareSource({ kind: 'text', text: ARTICLE, title: '' }, settings(), { now })).input.title).toBe('Model title');
    vi.mocked(askLLM).mockResolvedValueOnce('{"summary":"S"}');
    ingestFetch.mockResolvedValueOnce({ success: true, data: { url: 'https://example.com/x', title: '', text: ARTICLE, truncated: false } });
    expect((await prepareSource({ kind: 'url', url: 'https://example.com/x' }, settings(), { now })).input.title).toBe('example.com');
  });

  it('sends the model the source with the instruction to keep to what it says, masked first when masking is on', async () => {
    await prepareSource({ kind: 'text', text: `${ARTICLE} Write to ana@example.com.`, title: 'T' }, settings({ piiMasking: true }), { now });
    const sent = vi.mocked(askLLM).mock.calls[0][0];
    expect(sent[0].content).toMatch(/Say only what the source says/);
    expect(sent[1].content).toContain('[EMAIL_1]');
    expect(sent[1].content).not.toContain('ana@example.com');
  });

  it('cuts a long source for the model and says so; a page the fetcher cut says so too', async () => {
    const long = `${ARTICLE}\n\n`.repeat(200);
    expect((await prepareSource({ kind: 'text', text: long, title: 'T' }, settings(), { now })).clipped).toBe(true);
    expect(vi.mocked(askLLM).mock.calls[0][0][1].content.length).toBeLessThanOrEqual(12_050);
    ingestFetch.mockResolvedValueOnce({ success: true, data: { url: 'https://example.com/long', title: 'L', text: ARTICLE, truncated: true } });
    expect((await prepareSource({ kind: 'url', url: 'https://example.com/long' }, settings(), { now })).clipped).toBe(true);
  });

  it('"only a model on this computer" is checked before anything is fetched or sent', async () => {
    await expect(prepareSource({ kind: 'url', url: 'https://example.com/post' }, settings({ ingestLocalOnly: true, llmProvider: 'openai' }), { now })).rejects.toMatchObject({ code: 'local-only' });
    expect(ingestFetch).not.toHaveBeenCalled();
    expect(askLLM).not.toHaveBeenCalled();
    await expect(prepareSource({ kind: 'text', text: ARTICLE, title: '' }, settings({ ingestLocalOnly: true }), { now })).resolves.toBeTruthy(); // LM Studio: fine
  });

  it('nothing to read is said, not sent to the model', async () => {
    await expect(prepareSource({ kind: 'text', text: '   ', title: '' }, settings(), { now })).rejects.toMatchObject({ code: 'input' });
    await expect(prepareSource({ kind: 'url', url: '' }, settings(), { now })).rejects.toMatchObject({ code: 'input' });
    await expect(prepareSource({ kind: 'text', text: 'too short', title: '' }, settings(), { now })).rejects.toMatchObject({ code: 'empty' });
    expect(askLLM).not.toHaveBeenCalled();
  });

  it('a page that could not be fetched says why', async () => {
    ingestFetch.mockResolvedValueOnce({ success: false, error: 'that is a PDF; PDFs are not read yet', code: 'pdf' });
    const err = await prepareSource({ kind: 'url', url: 'https://example.com/x.pdf' }, settings(), { now }).catch(e => e as IngestError);
    expect(err).toMatchObject({ code: 'fetch' });
    expect((err as Error).message).toContain('PDFs are not read yet');
  });

  it('a model that fails, or says nothing, is a failure with the reason; the notes it was near are not needed for a note', async () => {
    vi.mocked(askLLM).mockRejectedValueOnce(new Error('no key'));
    await expect(prepareSource({ kind: 'text', text: ARTICLE, title: '' }, settings(), { now })).rejects.toMatchObject({ code: 'model' });
    vi.mocked(askLLM).mockResolvedValueOnce('');
    await expect(prepareSource({ kind: 'text', text: ARTICLE, title: '' }, settings(), { now })).rejects.toMatchObject({ code: 'model' });
    vi.mocked(retrieveChunks).mockRejectedValueOnce(new Error('index busy'));
    expect((await prepareSource({ kind: 'text', text: ARTICLE, title: '' }, settings(), { now })).input.related).toEqual([]);
  });
});

describe('the note', () => {
  it('is written in sources/ under the title, with the links that were kept, as the app\'s own form of a note', async () => {
    const p = await prepareSource({ kind: 'url', url: 'https://example.com/post' }, settings(), { now });
    const name = await writeSourceNote(p, 'My chosen title', new Set([1]), new Set(['sources/Other.md']), '/vault');
    expect(name).toBe('sources/My chosen title.md');
    expect(createFolder).toHaveBeenCalledWith('sources', '/vault');
    const [saved, html, dir] = saveNote.mock.calls[0] as [string, string, string];
    expect([saved, dir]).toEqual(['sources/My chosen title.md', '/vault']);
    expect(html).toContain('<h1>My chosen title</h1>');
    expect(html).toContain('[[Ideas]]');
    expect(html).not.toContain('Work/Plan');
    expect(decodeURIComponent(html)).toMatch(/source_hash: sha256:[0-9a-f]{64}/); // in the properties, which the app keeps in a comment at the top
  });

  it('with every link dropped there is no Related heading, and a name that is taken is not reused', async () => {
    const p = await prepareSource({ kind: 'url', url: 'https://example.com/post' }, settings(), { now });
    const name = await writeSourceNote(p, 'Page title', new Set(), new Set(['sources/Page title.md']), undefined);
    expect(name).toBe('sources/Page title 2.md');
    expect(saveNote.mock.calls[0][1]).not.toContain('Related');
  });

  it('a note that cannot be saved says why', async () => {
    const p = await prepareSource({ kind: 'text', text: ARTICLE, title: 'T' }, settings(), { now });
    saveNote.mockResolvedValueOnce({ success: false, error: 'disk full' });
    await expect(writeSourceNote(p, 'T', new Set(), new Set(), undefined)).rejects.toThrow('disk full');
  });

  it('buildNote uses the title the person typed, and the first one when it is empty', async () => {
    const p = await prepareSource({ kind: 'text', text: ARTICLE, title: 'First' }, settings(), { now });
    expect(buildNote(p, 'Typed').after).toContain('# Typed');
    expect(buildNote(p, '  ').after).toContain('# First');
  });
});
