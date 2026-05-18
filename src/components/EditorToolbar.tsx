import { useRef, useState, useCallback, useEffect } from 'react';
import { useI18n } from '../lib/i18n';
import type { Editor } from '@tiptap/react';
import {
  Bold, Italic, Strikethrough, Heading1, Heading2, Heading3,
  Table as TableIcon, Code, Search, X, ChevronUp, ChevronDown,
} from 'lucide-react';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { AiActionsBar } from './AiActionsBar';

interface Match { from: number; to: number }

function findInDoc(doc: ProseMirrorNode, searchText: string): Match[] {
  const results: Match[] = [];
  if (!searchText.trim()) return results;
  const regex = new RegExp(searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  doc.nodesBetween(0, doc.content.size, (node, pos) => {
    if (node.isText && node.text) {
      let m;
      while ((m = regex.exec(node.text)) !== null) {
        results.push({ from: pos + m.index, to: pos + m.index + m[0].length });
      }
    }
  });
  return results;
}

interface EditorToolbarProps {
  editor: Editor | null;
  showToolbar: boolean;
  showAiBar: boolean;
  onAiError?: (msg: string) => void;
  findOpen: boolean;
  onCloseFind: () => void;
  onOpenFind: () => void;
}

export function EditorToolbar({ editor, showToolbar, showAiBar, onAiError, findOpen, onCloseFind, onOpenFind }: EditorToolbarProps) {
  const { t } = useI18n();
  const [findQuery, setFindQuery] = useState('');
  const [matches, setMatches] = useState<Match[]>([]);
  const [matchIndex, setMatchIndex] = useState(0);
  const findInputRef = useRef<HTMLInputElement>(null);

  const runFind = useCallback((q: string) => {
    if (!editor) return;
    const found = findInDoc(editor.state.doc, q);
    setMatches(found);
    setMatchIndex(0);
    if (found.length > 0) {
      editor.commands.setTextSelection(found[0]);
      editor.commands.scrollIntoView();
    }
  }, [editor]);

  const goToMatch = useCallback((idx: number) => {
    if (!editor || matches.length === 0) return;
    const next = (idx + matches.length) % matches.length;
    setMatchIndex(next);
    editor.commands.setTextSelection(matches[next]);
    editor.commands.scrollIntoView();
  }, [editor, matches]);

  useEffect(() => {
    if (findOpen) findInputRef.current?.focus();
  }, [findOpen]);

  const handleClose = useCallback(() => {
    setFindQuery('');
    setMatches([]);
    setMatchIndex(0);
    onCloseFind();
    editor?.commands.focus();
  }, [editor, onCloseFind]);

  if (!editor) return null;

  const btnBase = 'p-1.5 rounded transition-colors';
  const btnActive = 'bg-gray-200 dark:bg-gray-600 text-gray-900 dark:text-white';
  const btnIdle = 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700';
  const sep = <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-0.5 shrink-0" />;

  return (
    <div className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 shrink-0">
      {/* Unified single toolbar */}
      {(showAiBar || showToolbar) && (
        <div className="flex items-center gap-0.5 px-4 py-1.5 flex-wrap">
          {showAiBar && <AiActionsBar editor={editor} onError={onAiError} />}
          {showAiBar && showToolbar && sep}
          {showToolbar && (
            <>
              <button onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title={t('heading1')}
                className={`${btnBase} ${editor.isActive('heading', { level: 1 }) ? btnActive : btnIdle}`}>
                <Heading1 size={15} />
              </button>
              <button onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title={t('heading2')}
                className={`${btnBase} ${editor.isActive('heading', { level: 2 }) ? btnActive : btnIdle}`}>
                <Heading2 size={15} />
              </button>
              <button onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title={t('heading3')}
                className={`${btnBase} ${editor.isActive('heading', { level: 3 }) ? btnActive : btnIdle}`}>
                <Heading3 size={15} />
              </button>
              {sep}
              <button onClick={() => editor.chain().focus().toggleBold().run()} title={t('bold')}
                className={`${btnBase} ${editor.isActive('bold') ? btnActive : btnIdle}`}>
                <Bold size={15} />
              </button>
              <button onClick={() => editor.chain().focus().toggleItalic().run()} title={t('italic')}
                className={`${btnBase} ${editor.isActive('italic') ? btnActive : btnIdle}`}>
                <Italic size={15} />
              </button>
              <button onClick={() => editor.chain().focus().toggleStrike().run()} title={t('strikethrough')}
                className={`${btnBase} ${editor.isActive('strike') ? btnActive : btnIdle}`}>
                <Strikethrough size={15} />
              </button>
              <button onClick={() => editor.chain().focus().toggleCode().run()} title={t('inlineCode')}
                className={`${btnBase} ${editor.isActive('code') ? btnActive : btnIdle}`}>
                <Code size={15} />
              </button>
              {sep}
              <button onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
                title={t('insertTable')}
                className={`${btnBase} ${btnIdle}`}>
                <TableIcon size={15} />
              </button>
              {sep}
              <button
                onClick={onOpenFind}
                title={t('findShortcut')}
                className={`${btnBase} ${findOpen ? btnActive : btnIdle}`}
                aria-label={t('findAriaLabel')}
              >
                <Search size={15} />
              </button>
            </>
          )}
        </div>
      )}

      {/* Find bar */}
      {findOpen && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-t border-gray-100 dark:border-gray-700">
          <Search size={13} className="text-gray-400 dark:text-gray-500 shrink-0" />
          <input
            ref={findInputRef}
            type="text"
            value={findQuery}
            onChange={e => { setFindQuery(e.target.value); runFind(e.target.value); }}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); goToMatch(e.shiftKey ? matchIndex - 1 : matchIndex + 1); }
              if (e.key === 'Escape') handleClose();
            }}
            placeholder={t('findPlaceholder')}
            className="flex-1 text-sm bg-transparent outline-none text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-600"
          />
          {findQuery && (
            <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
              {matches.length > 0 ? `${matchIndex + 1}/${matches.length}` : t('noResults')}
            </span>
          )}
          <button onClick={() => goToMatch(matchIndex - 1)} disabled={matches.length === 0}
            className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 disabled:opacity-30" aria-label={t('previous')}>
            <ChevronUp size={14} />
          </button>
          <button onClick={() => goToMatch(matchIndex + 1)} disabled={matches.length === 0}
            className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 disabled:opacity-30" aria-label={t('next')}>
            <ChevronDown size={14} />
          </button>
          <button onClick={handleClose} className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400" aria-label={t('closeFind')}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
