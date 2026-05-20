import { useState, useEffect, useRef, useCallback } from 'react';
import { FileText } from 'lucide-react';
import type { Editor } from '@tiptap/react';

interface WikilinkSuggestionProps {
  editor: Editor;
  notes: string[]; // all note names without .md
}

export function WikilinkSuggestion({ editor, notes }: WikilinkSuggestionProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [selected, setSelected] = useState(0);
  const startPosRef = useRef<number | null>(null);

  const filtered = notes
    .filter(n => n.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 8);

  const insert = useCallback((noteName: string) => {
    if (startPosRef.current === null) return;
    const { from } = editor.state.selection;
    // Replace from [[... up to cursor with the wikilink mark
    editor.chain()
      .focus()
      .deleteRange({ from: startPosRef.current, to: from })
      .insertWikilink(noteName)
      .run();
    setOpen(false);
    setQuery('');
    startPosRef.current = null;
  }, [editor]);

  useEffect(() => {
    const handleUpdate = () => {
      const { from } = editor.state.selection;
      const text = editor.state.doc.textBetween(Math.max(0, from - 100), from, '\n');
      const match = /\[\[([^\]]*)$/.exec(text);
      if (match) {
        const q = match[1];
        setQuery(q);
        setSelected(0);
        // Only capture start position when freshly opening (startPosRef null)
        if (startPosRef.current === null) {
          startPosRef.current = from - match[0].length;
          const coords = editor.view.coordsAtPos(from);
          setPos({ top: coords.bottom + 6, left: coords.left });
        }
        setOpen(true);
      } else {
        setOpen(false);
        startPosRef.current = null;
      }
    };
    editor.on('update', handleUpdate);
    editor.on('selectionUpdate', handleUpdate);
    return () => {
      editor.off('update', handleUpdate);
      editor.off('selectionUpdate', handleUpdate);
    };
  // open intentionally excluded — re-attaching on every open state change causes listener accumulation
  }, [editor]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.repeat) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, filtered.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (filtered[selected]) { e.preventDefault(); insert(filtered[selected]); }
      }
      if (e.key === 'Escape') { setOpen(false); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, filtered, selected, insert]);

  if (!open || filtered.length === 0) return null;

  return (
    <div
      style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}
      className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl w-64 overflow-hidden"
    >
      {filtered.map((n, i) => (
        <button
          key={n}
          onMouseDown={e => { e.preventDefault(); insert(n); }}
          className={`w-full text-left flex items-center gap-2 px-3 py-2 text-sm transition-colors ${i === selected ? 'bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}
        >
          <FileText size={13} className="shrink-0 text-gray-400" />
          <span className="truncate">{n}</span>
        </button>
      ))}
    </div>
  );
}
