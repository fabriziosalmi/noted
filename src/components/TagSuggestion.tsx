import { useState, useEffect, useRef, useCallback } from 'react';
import type { Editor } from '@tiptap/react';

interface TagSuggestionProps {
  editor: Editor;
  allTags: string[];
}

export function TagSuggestion({ editor, allTags }: TagSuggestionProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const triggerRef = useRef<number | null>(null); // position in doc where # was typed

  const suggestions = allTags
    .filter(t => t.startsWith('#' + query) && t !== '#' + query)
    .slice(0, 8);

  const insertTag = useCallback((tag: string) => {
    const { from } = editor.state.selection;
    const startPos = triggerRef.current ?? from;
    editor.chain()
      .focus()
      .deleteRange({ from: startPos, to: from })
      .insertContent(tag + ' ')
      .run();
    setOpen(false);
  }, [editor]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.repeat) return;
      if (e.key === 'Escape') { setOpen(false); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, suggestions.length - 1)); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
      if ((e.key === 'Enter' || e.key === 'Tab') && suggestions[activeIdx]) {
        e.preventDefault();
        insertTag(suggestions[activeIdx]);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open, suggestions, activeIdx, insertTag]);

  useEffect(() => { setActiveIdx(0); }, [query]);

  // Watch editor updates for # trigger
  useEffect(() => {
    const update = () => {
      const { state } = editor;
      const { from } = state.selection;
      const text = state.doc.textBetween(Math.max(0, from - 30), from, '\n', '\0');
      const match = text.match(/#([a-zA-Z0-9_\-àèéìòùÀÈÉÌÒÙ]*)$/);

      if (match) {
        triggerRef.current = from - match[0].length;
        setQuery(match[1]);

        // Position dropdown near cursor
        const coords = editor.view.coordsAtPos(from);
        setPos({ top: coords.bottom + 4, left: coords.left });
        setOpen(true);
      } else {
        setOpen(false);
      }
    };

    editor.on('selectionUpdate', update);
    editor.on('update', update);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('update', update);
    };
  }, [editor]);

  if (!open || suggestions.length === 0 || !pos) return null;

  return (
    <div
      className="fixed z-50 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl py-1 min-w-[160px]"
      style={{ top: pos.top, left: pos.left }}
    >
      {suggestions.map((tag, i) => (
        <button
          key={tag}
          onMouseDown={e => { e.preventDefault(); insertTag(tag); }}
          onMouseEnter={() => setActiveIdx(i)}
          className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 transition-colors ${
            i === activeIdx
              ? 'bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent)]'
              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
          }`}
        >
          <span className="opacity-50 text-xs">#</span>
          {tag.slice(1)}
        </button>
      ))}
    </div>
  );
}
