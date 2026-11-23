import type { Editor } from '@tiptap/core';

export interface SemanticHighlight {
  id: 'focus' | 'ok' | 'doubt';
  label: string;
  color: string;
}

export const SEMANTIC_HIGHLIGHTS: SemanticHighlight[] = [
  { id: 'focus', label: 'Focus', color: '#fef08a' },
  { id: 'ok', label: 'OK', color: '#bbf7d0' },
  { id: 'doubt', label: 'Doubt', color: '#fecaca' },
];

export function toggleSemanticHighlight(editor: Editor, color: string): boolean {
  return editor.chain().focus().toggleHighlight({ color }).run();
}
