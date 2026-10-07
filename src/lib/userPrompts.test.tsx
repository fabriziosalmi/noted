import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { answerPrompt, loadPrompt, usePromptList } from './userPrompts';
import { useStore } from '../store/useStore';
import { parsePrompt } from '../../shared/prompts/prompt';

vi.mock('./llm', () => ({ askLLM: vi.fn() }));
import { askLLM } from './llm';

const original = window.electronAPI;
const file = (name: string) => ({ name, path: name, stats: { mtimeMs: 1, ctimeMs: 1, size: 1 } });
const now = new Date(2026, 9, 7, 12);

beforeEach(() => { vi.mocked(askLLM).mockReset(); });
afterEach(() => { window.electronAPI = original; });

describe('usePromptList', () => {
  it('lists the notes in prompts/ by name, with what their properties say, and nothing else', () => {
    useStore.setState({
      notes: [file('Plan.md'), file('prompts/Zeta.md'), file('prompts/Work/Formal tone.md'), file('notes/prompts/x.md'), file('prompts/readme.txt')],
      frontmatterIndex: { 'prompts/Work/Formal tone.md': { name: 'Alpha formal', scope: 'selection', description: 'Make it formal' } },
    });
    const { result } = renderHook(() => usePromptList());
    expect(result.current.map(p => [p.path, p.name, p.scope, p.description])).toEqual([
      ['prompts/Work/Formal tone.md', 'Alpha formal', 'selection', 'Make it formal'],
      ['prompts/Zeta.md', 'Zeta', 'any', ''],
    ]);
  });
});

describe('loadPrompt', () => {
  it('reads the note as it is stored (Markdown stays Markdown) and parses it', async () => {
    const readNote = vi.fn(async () => ({ success: true, data: '---\nname: Formal\n---\nMake **formal**:\n\n{{selection}}\n' }));
    window.electronAPI = { ...original, readNote } as unknown as typeof window.electronAPI;
    expect(await loadPrompt('prompts/Formal.md', '/vault')).toMatchObject({ name: 'Formal', template: 'Make **formal**:\n\n{{selection}}' });
    expect(readNote).toHaveBeenCalledWith('prompts/Formal.md', '/vault');
  });
  it('a note that cannot be read, or holds nothing, is no prompt', async () => {
    window.electronAPI = { ...original, readNote: vi.fn(async () => ({ success: false, error: 'gone' })) } as unknown as typeof window.electronAPI;
    expect(await loadPrompt('prompts/x.md')).toBeNull();
    window.electronAPI = { ...original, readNote: vi.fn(async () => ({ success: true, data: '---\nname: x\n---\n' })) } as unknown as typeof window.electronAPI;
    expect(await loadPrompt('prompts/x.md')).toBeNull();
  });
});

describe('answerPrompt', () => {
  const prompt = (raw: string) => parsePrompt('prompts/p.md', raw)!;

  it('fills the prompt in, asks the model with it, and says the selection is to be replaced', async () => {
    vi.mocked(askLLM).mockResolvedValueOnce('FORMAL TEXT');
    const out = await answerPrompt(prompt('---\nscope: selection\n---\nMake formal on {{date}}:\n{{selection}}'), { selection: 'hey', note: 'whole', now }, { piiMasking: false });
    expect(out).toEqual({ ok: true, text: 'FORMAL TEXT', mode: 'replace', usedSelection: true });
    const sent = vi.mocked(askLLM).mock.calls[0][0];
    expect(sent[1]).toEqual({ role: 'user', content: 'Make formal on 2026-10-07:\nhey' });
    expect(sent[0].role).toBe('system');
  });

  it('a prompt for a selection, with none, is not asked of the model', async () => {
    expect(await answerPrompt(prompt('---\nscope: selection\n---\n{{selection}}'), { selection: '', note: 'whole', now }, { piiMasking: false })).toEqual({ ok: false, reason: 'needs-selection' });
    expect(askLLM).not.toHaveBeenCalled();
  });

  it('a prompt that does not use the selection does not replace it, even when one is there', async () => {
    vi.mocked(askLLM).mockResolvedValueOnce('A haiku');
    const out = await answerPrompt(prompt('Write a haiku about today, {{date}}.'), { selection: 'stray selection', note: 'whole', now }, { piiMasking: false });
    expect(out).toMatchObject({ ok: true, mode: 'insert', usedSelection: false });
  });

  it('a note prompt works on the note, and its answer goes at the caret', async () => {
    vi.mocked(askLLM).mockResolvedValueOnce('Summary');
    const out = await answerPrompt(prompt('---\nscope: note\n---\nSummarise: {{note}}'), { selection: 'part', note: 'the whole note', now }, { piiMasking: false });
    expect(vi.mocked(askLLM).mock.calls[0][0][1].content).toBe('Summarise: the whole note');
    expect(out).toMatchObject({ mode: 'insert' });
  });

  it('with PII masking the model is sent masked text, and the masked values come back in the answer', async () => {
    vi.mocked(askLLM).mockImplementationOnce(async (messages, opts) => {
      expect(messages[1].content).toBe('Reply to [EMAIL_1]');
      return opts?.masker?.unmask('Dear [EMAIL_1]') ?? '';
    });
    const out = await answerPrompt(prompt('Reply to {{selection}}'), { selection: 'ana@example.com', note: '', now }, { piiMasking: true });
    expect(out).toMatchObject({ ok: true, text: 'Dear ana@example.com' });
  });

  it('the note can say where the answer goes', async () => {
    vi.mocked(askLLM).mockResolvedValueOnce('x');
    expect(await answerPrompt(prompt('---\nmode: append\n---\n{{selection}}'), { selection: 's', note: 'n', now }, { piiMasking: false })).toMatchObject({ mode: 'append' });
  });
});
