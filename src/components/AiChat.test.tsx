import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AiChat } from './AiChat';
import { useStore } from '../store/useStore';

const askLLMMock = vi.fn(async () => 'ok');
const hybridMock = vi.fn(async () => ({ notes: [], mode: 'lexical' as const, scored: [] }));

vi.mock('../lib/llm', () => ({
  askLLM: (...args: unknown[]) => askLLMMock(...args),
  AbortedError: class AbortedError extends Error {},
  describeLlmError: () => 'err',
}));

vi.mock('../lib/noteSearch', () => ({
  findRelevantNotesHybrid: (...args: unknown[]) => hybridMock(...args),
}));

describe('AiChat retrieval mode wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    useStore.setState((state) => ({
      ...state,
      settings: {
        ...state.settings,
        llmProvider: 'lmstudio',
        llmModel: 'local',
        llmApiKey: 'k',
        embeddingsEnabled: false,
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
      },
    }));
  });

  it('passes lexical config when embeddings are disabled', async () => {
    render(<AiChat getEditorText={() => 'hello'} noteChunks={[{ name: 'a.md', text: 'hello world' }]} />);
    const input = screen.getByPlaceholderText(/ask something/i);
    fireEvent.change(input, { target: { value: 'query test' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(hybridMock).toHaveBeenCalled());
    const lastCall = hybridMock.mock.calls.at(-1);
    const cfg = lastCall?.[3] as { enabled: boolean };
    expect(cfg.enabled).toBe(false);
  });

  it('passes hybrid config when embeddings are enabled', async () => {
    useStore.setState((state) => ({
      ...state,
      settings: { ...state.settings, embeddingsEnabled: true },
    }));

    render(<AiChat getEditorText={() => 'hello'} noteChunks={[{ name: 'a.md', text: 'hello world' }]} />);
    const input = screen.getByPlaceholderText(/ask something/i);
    fireEvent.change(input, { target: { value: 'query test' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(hybridMock).toHaveBeenCalled());
    const lastCall = hybridMock.mock.calls.at(-1);
    const cfg = lastCall?.[3] as { enabled: boolean; provider: string; model: string };
    expect(cfg.enabled).toBe(true);
    expect(cfg.provider).toBe('openai');
    expect(cfg.model).toBe('text-embedding-3-small');
  });
});
