import type { NoteFormat } from './format';

/**
 * How a note's text is written: a Markdown vault is all Markdown; a vault from before the marker can still hold
 * plain-Markdown notes beside the editor's HTML, told apart by their first character.
 */
export function noteFormatIn(vaultFormat: NoteFormat, raw: string): NoteFormat {
  if (vaultFormat === 'markdown') return 'markdown';
  return raw.replace(/^\uFEFF/, '').trimStart().startsWith('<') ? 'html' : 'markdown';
}
