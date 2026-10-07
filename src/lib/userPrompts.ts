import { useMemo } from 'react';
import { useStore } from '../store/useStore';
import { askLLM } from './llm';
import { createMasker } from './piiMasker';
import {
  isPromptPath, modeFor, parsePrompt, promptHeader, renderPrompt, variablesIn, varsFor,
  type PromptContext, type PromptMode, type UserPrompt,
} from '../../shared/prompts/prompt';

export type PromptListing = Omit<UserPrompt, 'template'>;

/** The prompts of the vault, by name: from what the app already knows (the note names and their properties), no file is read. */
export function usePromptList(): PromptListing[] {
  const notes = useStore(s => s.notes);
  const fields = useStore(s => s.frontmatterIndex);
  return useMemo(
    () => notes.filter(n => isPromptPath(n.name)).map(n => promptHeader(n.name, fields[n.name] ?? {})).sort((a, b) => a.name.localeCompare(b.name)),
    [notes, fields],
  );
}

/** The instruction of a prompt, read from its note when it is used (it may have been edited since the list was made). */
export async function loadPrompt(path: string, syncDir?: string): Promise<UserPrompt | null> {
  // The raw API, not the one that converts to the editor's HTML: an instruction is Markdown, and is kept as it was written.
  const res = await window.electronAPI?.readNote(path, syncDir);
  return res?.success && typeof res.data === 'string' ? parsePrompt(path, res.data) : null;
}

export type PromptAnswer =
  | { ok: true; text: string; mode: PromptMode; usedSelection: boolean }
  | { ok: false; reason: 'needs-selection' };

/**
 * Fills a prompt in for this note and selection, asks the model, and says where the answer should go. A prompt that does not
 * use the selection never replaces it (a selection that is only there by chance is not what the answer is about).
 */
export async function answerPrompt(prompt: UserPrompt, ctx: PromptContext, opts: { piiMasking: boolean; signal?: AbortSignal }): Promise<PromptAnswer> {
  const filled = varsFor(prompt, ctx);
  if (!filled.ok) return filled;
  const rendered = renderPrompt(prompt.template, filled.vars);
  const usedSelection = variablesIn(prompt.template).includes('selection') && ctx.selection.trim() !== '';
  const masker = opts.piiMasking ? createMasker() : undefined;
  const text = await askLLM([
    { role: 'system', content: 'Follow the instruction in the user message exactly. Return ONLY the result, in Markdown, with no preface and no explanation.' },
    { role: 'user', content: masker ? masker.mask(rendered) : rendered },
  ], { signal: opts.signal, masker });
  return { ok: true, text, mode: modeFor(prompt, usedSelection), usedSelection };
}
