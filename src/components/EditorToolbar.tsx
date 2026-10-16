import { useRef, useState, useCallback, useEffect } from 'react';
import { useI18n } from '../lib/i18n';
import { modKey, shiftKey } from '../lib/platform';
import type { Editor } from '@tiptap/react';
import {
  Bold, Italic, Strikethrough, Heading1, Heading2, Heading3,
  Table as TableIcon, Code, Search, X, ChevronUp, ChevronDown,
  List, ListOrdered, ListChecks, Quote, Sparkles, Highlighter, Link2, Undo2, Redo2,
} from 'lucide-react';
import { findHighlightKey, type FindMeta } from '../lib/findHighlight';
import { AiActionsBar } from './AiActionsBar';
import { Tooltip } from './Tooltip';
import { usePrompt } from './ConfirmProvider';

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
  const prompt = usePrompt();
  const [findQuery, setFindQuery] = useState('');
  // Mirrors the find plugin (lib/findHighlight), which keeps the matches right while the note is edited.
  const [findInfo, setFindInfo] = useState({ count: 0, current: 0 });
  const matchCount = findInfo.count;
  const matchIndex = findInfo.current;
  const findInputRef = useRef<HTMLInputElement>(null);

  // Insert/edit/remove a link on the current selection via the in-app prompt.
  // Empty input clears the link; the mark range is extended so editing works
  // even when the caret merely sits inside an existing link.
  const handleLink = useCallback(async () => {
    if (!editor) return;
    const prev = (editor.getAttributes('link').href as string | undefined) ?? '';
    const url = await prompt({ title: t('linkPromptTitle'), placeholder: 'https://example.com', defaultValue: prev, confirmLabel: t('linkApply') });
    if (url === null) return; // cancelled
    const href = url.trim();
    if (!href) { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
  }, [editor, prompt, t]);

  const showMatch = useCallback((meta: FindMeta) => {
    if (!editor) return;
    editor.view.dispatch(editor.state.tr.setMeta(findHighlightKey, meta));
    const state = findHighlightKey.getState(editor.state);
    const match = state?.matches[state.current];
    if (match) {
      editor.commands.setTextSelection(match);
      editor.commands.scrollIntoView();
    }
  }, [editor]);

  const runFind = useCallback((q: string) => showMatch({ query: q, current: 0 }), [showMatch]);

  const goToMatch = useCallback((idx: number) => {
    if (matchCount === 0) return;
    showMatch({ current: (idx + matchCount) % matchCount });
  }, [matchCount, showMatch]);

  useEffect(() => {
    if (!editor || !findOpen) return;
    const sync = () => {
      const state = findHighlightKey.getState(editor.state);
      const count = state?.matches.length ?? 0;
      const current = state?.current ?? 0;
      setFindInfo(prev => (prev.count === count && prev.current === current ? prev : { count, current }));
    };
    sync();
    editor.on('transaction', sync);
    return () => { editor.off('transaction', sync); };
  }, [editor, findOpen]);

  useEffect(() => {
    if (findOpen) findInputRef.current?.focus();
  }, [findOpen]);

  // Closed from outside the bar (Cmd+F again): take the marks away too.
  useEffect(() => {
    if (findOpen || !editor || editor.isDestroyed || !findHighlightKey.getState(editor.state)?.query) return;
    editor.view.dispatch(editor.state.tr.setMeta(findHighlightKey, { query: '', current: 0 }));
    setFindQuery('');
  }, [editor, findOpen]);

  const handleClose = useCallback(() => {
    setFindQuery('');
    editor?.view.dispatch(editor.state.tr.setMeta(findHighlightKey, { query: '', current: 0 }));
    setFindInfo({ count: 0, current: 0 });
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
            <TbButton onClick={() => editor.chain().focus().undo().run()} label={t('undo')}>
              <Undo2 size={15} />
            </TbButton>
            <TbButton onClick={() => editor.chain().focus().redo().run()} label={t('redo')}>
              <Redo2 size={15} />
            </TbButton>
            {sep}
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
            <TbButton onClick={() => editor.chain().focus().toggleHighlight().run()} active={editor.isActive('highlight')} label={t('highlight')}>
              <Highlighter size={15} />
            </TbButton>
            <TbButton onClick={handleLink} active={editor.isActive('link')} label={t('link')}>
              <Link2 size={15} />
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
            <TbButton onClick={() => editor.chain().focus().toggleTaskList().run()} active={editor.isActive('taskList')} label={t('taskList')}>
              <ListChecks size={15} />
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
              <TbButton onClick={onOpenGlobalSearch} label={`${t('shortcutSearchAll')} (${modKey}${shiftKey}F)`}>
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
              {matchCount > 0 ? `${matchIndex + 1}/${matchCount}` : t('noResults')}
            </span>
          )}
          <button type="button" onClick={() => goToMatch(matchIndex - 1)} disabled={matchCount === 0}
            className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 disabled:opacity-30" aria-label={t('previous')}>
            <ChevronUp size={14} />
          </button>
          <button type="button" onClick={() => goToMatch(matchIndex + 1)} disabled={matchCount === 0}
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
