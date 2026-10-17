import { Fragment, useRef, useState, useCallback, useEffect } from 'react';
import { useI18n } from '../lib/i18n';
import { modKey, shiftKey } from '../lib/platform';
import type { Editor } from '@tiptap/react';
import {
  Bold, Italic, Strikethrough, Heading1, Heading2, Heading3,
  Table as TableIcon, Code, Search, X, ChevronUp, ChevronDown, ChevronRight,
  List, ListOrdered, ListChecks, Quote, Sparkles, Highlighter, Link2, Undo2, Redo2, MoreHorizontal,
} from 'lucide-react';
import { findHighlightKey, replaceMatches, type FindMeta } from '../lib/findHighlight';
import { promptForLink } from '../lib/linkPrompt';
import { groupsThatFit } from '../lib/toolbarFit';
import { useRovingFocus } from '../hooks/useRovingFocus';
import { AiActionsBar } from './AiActionsBar';
import { Tooltip } from './Tooltip';
import { usePrompt } from './ConfirmProvider';

const btnBase = 'p-1.5 rounded transition-colors';
const btnActive = 'bg-gray-200 dark:bg-gray-600 text-gray-900 dark:text-white';
const btnIdle = 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700';

/** A control of the formatting bar. `pressed` is set for those that are on or off (bold, a heading…). */
interface TbItem { key: string; label: string; icon: React.ReactNode; onClick: () => void; pressed?: boolean }

/** Icon-only toolbar control: styled tooltip + correct button semantics. */
function TbButton({ onClick, active = false, pressed, label, children }: {
  onClick: () => void; active?: boolean; pressed?: boolean; label: string; children: React.ReactNode;
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={pressed}
        className={`${btnBase} ${active ? btnActive : btnIdle}`}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/** The "more" button at the end of a narrow formatting bar: the groups that did not fit, as a menu. */
function ToolbarOverflow({ items, label }: { items: TbItem[]; label: string }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuKeys = useRovingFocus(menuRef, '[role^="menuitem"]', 'vertical');

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const close = () => { setOpen(false); triggerRef.current?.focus(); };
  return (
    <div ref={wrapRef} className="relative shrink-0 flex items-center">
      <Tooltip label={label}>
        <button ref={triggerRef} type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open}
          onClick={() => setOpen(v => !v)} className={`${btnBase} ${open ? btnActive : btnIdle}`}>
          <MoreHorizontal size={15} />
        </button>
      </Tooltip>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          tabIndex={-1}
          onKeyDown={e => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
            if (e.key === 'Tab') { setOpen(false); return; }
            menuKeys.onKeyDown(e);
          }}
          onFocus={menuKeys.onFocus}
          className="absolute right-0 top-full mt-1 z-50 min-w-[12rem] max-h-[calc(100vh-7rem)] overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl py-1"
        >
          {items.map(item => (
            <button
              key={item.key}
              type="button"
              role={item.pressed === undefined ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={item.pressed}
              onClick={() => { setOpen(false); item.onClick(); }}
              className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 ${item.pressed ? 'text-[var(--accent-text)]' : 'text-gray-700 dark:text-gray-300'}`}
            >
              <span className="shrink-0" aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
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
  /** Goes up each time Find and replace is asked for (⌘⌥F / Ctrl+H): the bar opens with its replace row. */
  replaceRequest?: number;
}

export function EditorToolbar({ editor, showToolbar, showAiBar, onAiError, findOpen, onCloseFind, onOpenFind, onOpenGlobalSearch, shareSlot, onToggleAiBar, replaceRequest = 0 }: EditorToolbarProps) {
  const { t } = useI18n();
  const prompt = usePrompt();
  const [findQuery, setFindQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [replacedCount, setReplacedCount] = useState<number | null>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  // Mirrors the find plugin (lib/findHighlight), which keeps the matches right while the note is edited.
  const [findInfo, setFindInfo] = useState({ count: 0, current: 0 });
  const matchCount = findInfo.count;
  const matchIndex = findInfo.current;
  const findInputRef = useRef<HTMLInputElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const toolbarKeys = useRovingFocus(toolbarRef, 'button:not([role^="menuitem"])');
  // The width the buttons have, followed as the window or the side panels change (null: not measured, show all).
  const [barWidth, setBarWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = barRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setBarWidth(Math.floor(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [showToolbar, editor]);

  // Insert/edit/remove a link on the current selection via the in-app prompt.
  // Empty input clears the link; the mark range is extended so editing works
  // even when the caret merely sits inside an existing link.
  const handleLink = useCallback(async () => {
    if (editor) await promptForLink(editor, prompt, t);
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

  useEffect(() => {
    if (replaceRequest > 0) setShowReplace(true);
  }, [replaceRequest]);

  const toggleCase = useCallback(() => {
    const next = !caseSensitive;
    setCaseSensitive(next);
    showMatch({ caseSensitive: next, current: 0 });
  }, [caseSensitive, showMatch]);

  const replace = useCallback((all: boolean) => {
    if (!editor) return;
    const n = replaceMatches(editor.view, replacement, all);
    setReplacedCount(all ? n : null);
    if (!all) showMatch({}); // on to the next match, which is now at the same index
  }, [editor, replacement, showMatch]);

  const handleClose = useCallback(() => {
    setFindQuery('');
    setReplacedCount(null);
    editor?.view.dispatch(editor.state.tr.setMeta(findHighlightKey, { query: '', current: 0 }));
    setFindInfo({ count: 0, current: 0 });
    onCloseFind();
    editor?.commands.focus();
  }, [editor, onCloseFind]);

  if (!editor) return null;

  const sep = <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-0.5 shrink-0" aria-hidden="true" />;
  // The formatting bar as groups: those that do not fit the width go, from the end, into the "more" menu instead of
  // wrapping the bar onto two or three rows in a narrow window.
  const groups: TbItem[][] = [
    [
      { key: 'undo', label: t('undo'), icon: <Undo2 size={15} />, onClick: () => editor.chain().focus().undo().run() },
      { key: 'redo', label: t('redo'), icon: <Redo2 size={15} />, onClick: () => editor.chain().focus().redo().run() },
    ],
    [
      { key: 'h1', label: t('heading1'), icon: <Heading1 size={15} />, pressed: editor.isActive('heading', { level: 1 }), onClick: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
      { key: 'h2', label: t('heading2'), icon: <Heading2 size={15} />, pressed: editor.isActive('heading', { level: 2 }), onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
      { key: 'h3', label: t('heading3'), icon: <Heading3 size={15} />, pressed: editor.isActive('heading', { level: 3 }), onClick: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    ],
    [
      { key: 'bold', label: t('bold'), icon: <Bold size={15} />, pressed: editor.isActive('bold'), onClick: () => editor.chain().focus().toggleBold().run() },
      { key: 'italic', label: t('italic'), icon: <Italic size={15} />, pressed: editor.isActive('italic'), onClick: () => editor.chain().focus().toggleItalic().run() },
      { key: 'strike', label: t('strikethrough'), icon: <Strikethrough size={15} />, pressed: editor.isActive('strike'), onClick: () => editor.chain().focus().toggleStrike().run() },
      { key: 'code', label: t('inlineCode'), icon: <Code size={15} />, pressed: editor.isActive('code'), onClick: () => editor.chain().focus().toggleCode().run() },
      { key: 'highlight', label: t('highlight'), icon: <Highlighter size={15} />, pressed: editor.isActive('highlight'), onClick: () => editor.chain().focus().toggleHighlight().run() },
      { key: 'link', label: t('link'), icon: <Link2 size={15} />, pressed: editor.isActive('link'), onClick: () => { void handleLink(); } },
    ],
    [
      { key: 'bullets', label: t('bulletList'), icon: <List size={15} />, pressed: editor.isActive('bulletList'), onClick: () => editor.chain().focus().toggleBulletList().run() },
      { key: 'numbers', label: t('numberedList'), icon: <ListOrdered size={15} />, pressed: editor.isActive('orderedList'), onClick: () => editor.chain().focus().toggleOrderedList().run() },
      { key: 'quote', label: t('blockquote'), icon: <Quote size={15} />, pressed: editor.isActive('blockquote'), onClick: () => editor.chain().focus().toggleBlockquote().run() },
      { key: 'tasks', label: t('taskList'), icon: <ListChecks size={15} />, pressed: editor.isActive('taskList'), onClick: () => editor.chain().focus().toggleTaskList().run() },
    ],
    [
      { key: 'table', label: t('insertTable'), icon: <TableIcon size={15} />, onClick: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    ],
    [
      { key: 'find', label: t('findAriaLabel'), icon: <Search size={15} />, pressed: findOpen, onClick: onOpenFind },
      ...(onOpenGlobalSearch ? [{
        key: 'search-all', label: `${t('shortcutSearchAll')} (${modKey}${shiftKey}F)`, onClick: onOpenGlobalSearch,
        icon: (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            <path d="M11 8v6M8 11h6" strokeWidth="1.8"/>
          </svg>
        ),
      }] : []),
    ],
    [
      { key: 'ai-bar', label: t('showAiBar'), icon: <Sparkles size={15} />, pressed: showAiBar, onClick: () => onToggleAiBar?.() },
    ],
  ];
  const shown = barWidth === null ? groups.length : groupsThatFit(groups.map(g => g.length), barWidth);
  const overflow = groups.slice(shown).flat();

  return (
    <div className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 shrink-0">
      {/* Row 1: Formatting Toolbar */}
      {showToolbar && (
        <div
          ref={toolbarRef}
          role="toolbar"
          aria-label={t('formattingToolbar')}
          onKeyDown={toolbarKeys.onKeyDown}
          onFocus={toolbarKeys.onFocus}
          className="flex items-center justify-between px-4 py-1.5 gap-2"
        >
          <div ref={barRef} className="flex-1 min-w-0 flex items-center gap-0.5">
            {groups.slice(0, shown).map((group, i) => (
              <Fragment key={group[0].key}>
                {i > 0 && sep}
                {group.map(item => (
                  <TbButton key={item.key} onClick={item.onClick} active={item.pressed} pressed={item.pressed} label={item.label}>
                    {item.icon}
                  </TbButton>
                ))}
              </Fragment>
            ))}
            {overflow.length > 0 && <ToolbarOverflow items={overflow} label={t('toolbarMore')} />}
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
        <div className="border-t border-gray-100 dark:border-gray-700">
        <div className="flex items-center gap-2 px-4 py-1.5">
          <button type="button" onClick={() => setShowReplace(v => !v)} aria-expanded={showReplace} aria-label={t('findToggleReplace')}
            className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400">
            <ChevronRight size={13} className={`transition-transform ${showReplace ? 'rotate-90' : ''}`} />
          </button>
          <Search size={13} className="text-gray-400 dark:text-gray-500 shrink-0" />
          <input
            ref={findInputRef}
            type="text"
            value={findQuery}
            onChange={e => { setFindQuery(e.target.value); setReplacedCount(null); runFind(e.target.value); }}
            onKeyDown={e => {
              if (e.nativeEvent.isComposing || e.repeat) return;
              if (e.key === 'Enter') { e.preventDefault(); goToMatch(e.shiftKey ? matchIndex - 1 : matchIndex + 1); }
              if (e.key === 'Escape') handleClose();
            }}
            placeholder={t('findPlaceholder')}
            className="flex-1 text-sm bg-transparent outline-none text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-600"
          />
          <button type="button" onClick={toggleCase} aria-pressed={caseSensitive} aria-label={t('findMatchCase')}
            className={`px-1 rounded text-[11px] font-semibold ${caseSensitive ? 'bg-gray-200 dark:bg-gray-600 text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'}`}>
            Aa
          </button>
          {findQuery && (
            <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0" role="status">
              {replacedCount !== null ? t('findReplacedCount').replace('{n}', String(replacedCount)) : matchCount > 0 ? `${matchIndex + 1}/${matchCount}` : t('noResults')}
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
        {showReplace && (
          <div className="flex items-center gap-2 pl-[3.25rem] pr-4 pb-1.5">
            <input
              ref={replaceInputRef}
              type="text"
              value={replacement}
              aria-label={t('findReplacePlaceholder')}
              onChange={e => setReplacement(e.target.value)}
              onKeyDown={e => {
                if (e.nativeEvent.isComposing || e.repeat) return;
                if (e.key === 'Enter') { e.preventDefault(); replace(e.metaKey || e.ctrlKey); } // ⌘↩ replaces all
                if (e.key === 'Escape') handleClose();
              }}
              placeholder={t('findReplacePlaceholder')}
              className="flex-1 text-sm bg-transparent outline-none text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-600"
            />
            <button type="button" onClick={() => replace(false)} disabled={matchCount === 0}
              className="text-xs px-2 py-0.5 rounded border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40">
              {t('findReplace')}
            </button>
            <button type="button" onClick={() => replace(true)} disabled={matchCount === 0}
              className="text-xs px-2 py-0.5 rounded border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40">
              {t('findReplaceAll')}
            </button>
          </div>
        )}
        </div>
      )}
    </div>
  );
}
