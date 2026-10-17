import { useEffect } from 'react';
import type { Editor } from '@tiptap/react';

/**
 * A suggestion menu opened from the editor (/, [[ or #), described to assistive technology as the editor's list: the
 * focus stays in the text, and the editor says which list it controls and which option is active.
 */
export function useSuggestionAria(editor: Editor | null, open: boolean, listId: string, activeIndex: number): void {
  useEffect(() => {
    const dom = editor && !editor.isDestroyed ? editor.view.dom : null;
    if (!dom || !open) return;
    dom.setAttribute('aria-controls', listId);
    dom.setAttribute('aria-expanded', 'true');
    dom.setAttribute('aria-autocomplete', 'list');
    dom.setAttribute('aria-activedescendant', optionId(listId, activeIndex));
    return () => {
      for (const a of ['aria-controls', 'aria-expanded', 'aria-autocomplete', 'aria-activedescendant']) dom.removeAttribute(a);
    };
  }, [editor, open, listId, activeIndex]);
}

export const optionId = (listId: string, index: number) => `${listId}-option-${index}`;
