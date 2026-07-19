import { useRef, useState, useCallback, useEffect } from 'react';
import { useI18n } from '../lib/i18n';
import type { Editor } from '@tiptap/react';
import {
  Bold, Italic, Strikethrough, Heading1, Heading2, Heading3,
  Table as TableIcon, Code, Search, X, ChevronUp, ChevronDown,
  List, ListOrdered, Quote, Sparkles,
} from 'lucide-react';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { AiActionsBar } from './AiActionsBar';
import { Tooltip } from './Tooltip';

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

const btnBase = 'p-1.5 rounded transition-colors';
const btnActive = 'bg-gray-200 dark:bg-gray-600 text-gray-900 dark:text-white';
const btnIdle = 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700';

/** Icon-only toolbar control: styled tooltip + correct button semantics. */
function TbButton({ onClick, active = false, label, children }: {
  onClick: () => void; active?: boolean; label: string; children: React.ReactNode;
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className={`${btnBase} ${active ? btnActive : btnIdle}`}
      >
        {children}
      </button>
    </Tooltip>
  );
}

interface EditorToolbarProps {
  editor: Editor | null;
  showToolbar: boolean;
  showAiBar: boolean;
  onAiError?: (msg: string) => void;
  findOpen: boolean;
  onCloseFind: () => void;
  onOpenFind: () => void;
  onOpenGlobalSearch?: () => void;
  onToggleAiBar?: () => void;
  /** Slot rendered after AI actions for share/export menu. */
  shareSlot?: React.ReactNode;
}

export function EditorToolbar({ editor, showToolbar, showAiBar, onAiError, findOpen, onCloseFind, onOpenFind, onOpenGlobalSearch, shareSlot, onToggleAiBar }: EditorToolbarProps) {
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

  const sep = <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-0.5 shrink-0" />;
  return (
    <div className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 shrink-0">
      {/* Row 1: Formatting Toolbar */}
      {showToolbar && (
        <div className="flex items-center justify-between px-4 py-1.5 flex-wrap gap-2">
          <div className="flex items-center gap-0.5 flex-wrap">
            <TbButton onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} label={t('heading1')}>
              <Heading1 size={15} />
            </TbButton>
            <TbButton onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} label={t('heading2')}>
              <Heading2 size={15} />
            </TbButton>
            <TbButton onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} label={t('heading3')}>
              <Heading3 size={15} />
            </TbButton>
            {sep}
            <TbButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} label={t('bold')}>
              <Bold size={15} />
            </TbButton>
            <TbButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} label={t('italic')}>
              <Italic size={15} />
            </TbButton>
            <TbButton onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} label={t('strikethrough')}>
              <Strikethrough size={15} />
            </TbButton>
            <TbButton onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive('code')} label={t('inlineCode')}>
              <Code size={15} />
            </TbButton>
            {sep}
            <TbButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} label={t('bulletList')}>
              <List size={15} />
            </TbButton>
            <TbButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} label={t('numberedList')}>
              <ListOrdered size={15} />
            </TbButton>
            <TbButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} label={t('blockquote')}>
              <Quote size={15} />
            </TbButton>
            {sep}
            <TbButton onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} label={t('insertTable')}>
              <TableIcon size={15} />
            </TbButton>
            {sep}
            <TbButton onClick={onOpenFind} active={findOpen} label={t('findAriaLabel')}>
              <Search size={15} />
            </TbButton>
            {onOpenGlobalSearch && (
              <TbButton onClick={onOpenGlobalSearch} label="Search all notes (⌘⇧F)">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                  <path d="M11 8v6M8 11h6" strokeWidth="1.8"/>
                </svg>
              </TbButton>
            )}
            {sep}
            <TbButton onClick={() => onToggleAiBar?.()} active={showAiBar} label={t('showAiBar')}>
              <Sparkles size={15} />
            </TbButton>
          </div>
          {/* Share menu stays anchored in row 1 whenever the formatting bar is
              shown, so toggling the AI bar below never changes row 1's height
              (removing it would shrink the row and nudge the buttons upward). */}
          {shareSlot && (
            <div className="flex items-center shrink-0">
              {shareSlot}
            </div>
          )}
        </div>
      )}

      {/* Row 2: AI Actions Toolbar */}
      {showAiBar && (
        <div className={`flex items-center justify-between px-4 py-1.5 flex-wrap gap-2 ${showToolbar ? 'border-t border-gray-100 dark:border-gray-700/50' : ''}`}>
          <div className="flex items-center gap-0.5 flex-wrap">
            <AiActionsBar editor={editor} onError={onAiError} />
          </div>
          {/* Only host the share menu here when row 1 is hidden, to avoid a
              duplicate and keep it reachable in AI-only mode. */}
          {!showToolbar && shareSlot && (
            <div className="flex items-center shrink-0">
              {shareSlot}
            </div>
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
              if (e.nativeEvent.isComposing || e.repeat) return;
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
          <button type="button" onClick={() => goToMatch(matchIndex - 1)} disabled={matches.length === 0}
            className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 disabled:opacity-30" aria-label={t('previous')}>
            <ChevronUp size={14} />
          </button>
          <button type="button" onClick={() => goToMatch(matchIndex + 1)} disabled={matches.length === 0}
            className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 disabled:opacity-30" aria-label={t('next')}>
            <ChevronDown size={14} />
          </button>
          <button type="button" onClick={handleClose} className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400" aria-label={t('closeFind')}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
