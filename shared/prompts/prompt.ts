// Prompts kept as notes: a note under `prompts/` whose frontmatter names it and says where it applies, and whose text is the
// instruction, with {{selection}}, {{note}} and {{date}} to be filled in. Pure, so the app and the MCP server read and fill a prompt
// the same way.

import { extractFields, noteBody } from '../vault/extract';
import type { FieldValue } from '../vault/fields';

export const PROMPTS_FOLDER = 'prompts';

/** What a prompt works on: the selected text, the note as a whole, or either (the selection if there is one, else the note). */
export type PromptScope = 'selection' | 'note' | 'any';
/** What is done with the answer: put it in place of the selection, at the caret, or at the end of the note. */
export type PromptMode = 'replace' | 'insert' | 'append';

export interface UserPrompt {
  /** The note, vault-relative ("prompts/Make it formal.md"). */
  path: string;
  /** What it is called in menus: the `name` property, else the file name. */
  name: string;
  scope: PromptScope;
  /** The `mode` property, if the note sets one; see `modeFor` for what is used otherwise. */
  mode: PromptMode | null;
  description: string;
  /** The instruction, as written (the note without its frontmatter). */
  template: string;
}

export const VARIABLES = ['selection', 'note', 'date'] as const;
export type PromptVariable = (typeof VARIABLES)[number];
export type PromptVars = Record<PromptVariable, string>;

const SCOPES: readonly PromptScope[] = ['selection', 'note', 'any'];
const MODES: readonly PromptMode[] = ['replace', 'insert', 'append'];

/** Is this note one of the prompts (in `prompts/`, at any depth)? */
export const isPromptPath = (path: string): boolean => /^prompts\/.+\.md$/i.test(path);

const text = (v: FieldValue | undefined): string => (typeof v === 'string' ? v.trim() : '');
const oneOf = <T extends string>(allowed: readonly T[], v: string): T | null => (allowed.find(a => a === v.toLowerCase()) ?? null);
const fileName = (path: string): string => (path.split('/').pop() ?? path).replace(/\.md$/i, '');

/** What a prompt note says about itself, from its properties alone (no need to read the instruction to list it in a menu). */
export function promptHeader(path: string, fields: Record<string, FieldValue>): Omit<UserPrompt, 'template'> {
  return {
    path,
    name: text(fields.name) || fileName(path),
    scope: oneOf(SCOPES, text(fields.scope)) ?? 'any',
    mode: oneOf(MODES, text(fields.mode)),
    description: text(fields.description),
  };
}

/** The prompt a note holds, or null when it holds no instruction (an empty note is not a prompt). */
export function parsePrompt(path: string, raw: string): UserPrompt | null {
  const html = raw.trimStart().startsWith('<');
  const stored = noteBody(raw, html ? 'html' : 'markdown');
  // A prompt kept in a vault that is still HTML loses its markup (the instruction is the words); Markdown is kept as written.
  const body = html
    ? stored.replace(/<\/(p|div|li|h[1-6]|blockquote|pre)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n')
    : stored;
  const template = body.trim();
  if (!template) return null;
  return { ...promptHeader(path, extractFields(raw, html ? 'html' : 'markdown')), template };
}

// {{selection}}, {{ note }}, a backslash before the braces for the words themselves. One pass over the template: what a variable is
// replaced by is never read again, so a selection that contains "{{note}}" stays as typed.
const TOKEN = /(\\)?\{\{\s*(selection|note|date)\s*\}\}/g;

/** The variables the template uses. */
export function variablesIn(template: string): PromptVariable[] {
  const used = new Set<PromptVariable>();
  for (const m of template.matchAll(TOKEN)) if (!m[1]) used.add(m[2] as PromptVariable);
  return VARIABLES.filter(v => used.has(v));
}

export function renderPrompt(template: string, vars: PromptVars): string {
  return template.replace(TOKEN, (_, escaped: string | undefined, name: PromptVariable) => (escaped ? `{{${name}}}` : vars[name]));
}

/** Today as the prompts read it: 2026-10-07, in the person's own time zone. */
export function isoDay(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export interface PromptContext {
  /** The selected text, '' when nothing is selected. */
  selection: string;
  /** The whole note as text. */
  note: string;
  now: Date;
}

/** What each variable stands for, given the scope; or why the prompt cannot run here. */
export function varsFor(prompt: Pick<UserPrompt, 'scope'>, ctx: PromptContext): { ok: true; vars: PromptVars } | { ok: false; reason: 'needs-selection' } {
  const date = isoDay(ctx.now);
  if (prompt.scope === 'selection') {
    return ctx.selection.trim() ? { ok: true, vars: { selection: ctx.selection, note: ctx.note, date } } : { ok: false, reason: 'needs-selection' };
  }
  if (prompt.scope === 'note') return { ok: true, vars: { selection: '', note: ctx.note, date } };
  return { ok: true, vars: { selection: ctx.selection.trim() ? ctx.selection : ctx.note, note: ctx.note, date } };
}

/** Where the answer goes: as the note says; else in place of the selection when one was used, and at the caret otherwise. */
export function modeFor(prompt: Pick<UserPrompt, 'mode' | 'scope'>, hasSelection: boolean): PromptMode {
  if (prompt.mode) return prompt.mode === 'replace' && !hasSelection ? 'insert' : prompt.mode;
  return hasSelection && prompt.scope !== 'note' ? 'replace' : 'insert';
}

/** The name a prompt is typed as after "/": its file name, lower case, words joined by dashes. */
export function slugOf(path: string): string {
  return fileName(path).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** A new prompt, as a note to start from. */
export function promptTemplateNote(name: string): string {
  return `---\nname: ${name}\nscope: selection\ndescription: What this prompt does, in a few words\n---\nRewrite the following text more clearly, keeping its meaning and its language. Return only the result.\n\n{{selection}}\n`;
}
