import { useState, useEffect, useRef, useCallback } from 'react';
import { FileText, Hash } from 'lucide-react';
import type { Editor } from '@tiptap/react';
import { getElectronApi } from '../lib/electronApi';
import { useStore } from '../store/useStore';
import { headingLinkText, normalizeHeading, plainHeading } from '../../shared/vault/wikilink';

interface WikilinkSuggestionProps {
  editor: Editor;
  notes: string[]; // all note names without .md
  /** The note (with .md) a link target points at, or null. */
  resolve: (target: string) => string | null;
}

interface Heading { level: number; text: string }

/**
 * Completes a link as it is typed: the notes after `[[`, and once the note is named and a `#` follows
 * (`[[Plan#`), the headings of that note.
 */
export function WikilinkSuggestion({ editor, notes, resolve }: WikilinkSuggestionProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [selected, setSelected] = useState(0);
  const startPosRef = useRef<number | null>(null);

  const syncDir = useStore(s => s.settings.syncDirectory) || undefined;
  const [headings, setHeadings] = useState<{ note: string; items: Heading[] } | null>(null);

  // "Plan#Ri" names the note "Plan" and asks for its headings matching "Ri".
  const hash = query.indexOf('#');
  const headingMode = hash !== -1;
  const stem = headingMode ? query.slice(0, hash).trim() : '';
  const headingQuery = headingMode ? normalizeHeading(query.slice(hash + 1).replace(/\|.*$/, '')) : '';
  const noteFile = headingMode && stem ? resolve(stem) : null;

  useEffect(() => {
    if (!noteFile) return;
    let current = true;
    const api = getElectronApi();
    void api?.getVaultIndexNote(noteFile, syncDir).then(res => {
      if (current) setHeadings({ note: noteFile, items: res.success ? (res.data?.headings ?? []) : [] });
    }).catch(() => undefined);
    return () => { current = false; };
  }, [noteFile, syncDir]);

  const items: { key: string; label: string; level?: number; fragment?: string; note: string }[] = headingMode
    ? (noteFile && headings?.note === noteFile ? headings.items : [])
      .filter(h => normalizeHeading(h.text).includes(headingQuery))
      .slice(0, 8)
      .map((h, i) => ({ key: `${i}:${h.text}`, label: plainHeading(h.text), level: h.level, fragment: headingLinkText(h.text), note: stem }))
    : notes
      .filter(n => n.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 8)
      .map(n => ({ key: n, label: n, note: n }));

  const insert = useCallback((noteName: string, fragment?: string) => {
    if (startPosRef.current === null) return;
    const { from } = editor.state.selection;
    // Replace from [[... up to cursor with the wikilink mark
    editor.chain()
      .focus()
      .deleteRange({ from: startPosRef.current, to: from })
      .insertWikilink(noteName, fragment)
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
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, items.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (items[selected]) { e.preventDefault(); insert(items[selected].note, items[selected].fragment); }
      }
      if (e.key === 'Escape') { setOpen(false); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, items, selected, insert]);

  if (!open || items.length === 0) return null;

  return (
    <div
      style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}
      className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl w-64 overflow-hidden"
    >
      {items.map((item, i) => (
        <button
          key={item.key}
          onMouseDown={e => { e.preventDefault(); insert(item.note, item.fragment); }}
          className={`w-full text-left flex items-center gap-2 px-3 py-2 text-sm transition-colors ${i === selected ? 'bg-[var(--accent-light)] text-[var(--accent)] font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}
        >
          {item.level === undefined
            ? <FileText size={13} className="shrink-0 text-gray-400" />
            : <Hash size={13} className="shrink-0 text-gray-400" />}
          <span className="truncate" style={item.level ? { paddingLeft: (item.level - 1) * 8 } : undefined}>{item.label}</span>
          {item.level !== undefined && <span className="ml-auto shrink-0 text-[10px] text-gray-400">H{item.level}</span>}
        </button>
      ))}
    </div>
  );
}
