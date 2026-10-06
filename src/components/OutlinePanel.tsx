import { useCallback, useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { useI18n } from '../lib/i18n';
import { currentHeading, extractOutline, indentLevels, type OutlineItem } from '../lib/outline';

const INDENT_PX = 12;
const REFRESH_MS = 150;
/** How far down the visible page the heading being read is looked for (a fraction of its height). */
const READING_LINE = 0.25;

const sameOutline = (a: readonly OutlineItem[], b: readonly OutlineItem[]): boolean =>
  a.length === b.length && a.every((item, i) => item.pos === b[i].pos && item.level === b[i].level && item.text === b[i].text);

/**
 * The open note's headings as a list to jump around by. The one the reader is in is marked: following the caret
 * when it moves, and the scroll when the page is read without touching it.
 */
export function OutlinePanel({ editor }: { editor: Editor | null }) {
  const { t } = useI18n();
  const [items, setItems] = useState<OutlineItem[]>([]);
  const [current, setCurrent] = useState(-1);

  useEffect(() => {
    if (!editor) {
      setItems([]);
      setCurrent(-1);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let latest: OutlineItem[] = [];

    const refresh = () => {
      const next = extractOutline(editor.state.doc);
      latest = next;
      setItems(prev => (sameOutline(prev, next) ? prev : next));
      setCurrent(currentHeading(next, editor.state.selection.from));
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, REFRESH_MS);
    };

    // Reading by scrolling: the heading at the top of the page is the current one. Scroll events do not bubble, so
    // this listens in the capture phase for whichever ancestor of the editor scrolls (it may not be in the page yet
    // when the editor is handed over, which is why nothing is looked up here).
    const onScroll = (event: Event) => {
      const scroller = event.target;
      if (latest.length === 0) return;
      // The reading line is a quarter of the way down the visible page: the heading above it is the one being read.
      let top: number;
      if (scroller instanceof HTMLElement && scroller.contains(editor.view.dom)) {
        top = scroller.getBoundingClientRect().top + scroller.clientHeight * READING_LINE;
      } else if (scroller instanceof Document) {
        top = window.innerHeight * READING_LINE; // the whole page scrolls
      } else {
        return; // something else scrolled (another panel)
      }
      let found = -1;
      for (let i = 0; i < latest.length; i++) {
        const el = editor.view.nodeDOM(latest[i].pos);
        if (!(el instanceof HTMLElement)) continue;
        if (el.getBoundingClientRect().top <= top) found = i;
        else break;
      }
      setCurrent(found);
    };

    refresh();
    editor.on('update', schedule);
    editor.on('selectionUpdate', schedule);
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      clearTimeout(timer);
      editor.off('update', schedule);
      editor.off('selectionUpdate', schedule);
      document.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, [editor]);

  const go = useCallback((item: OutlineItem) => {
    editor?.chain().focus().setTextSelection(item.pos + 1).scrollIntoView().run();
  }, [editor]);

  if (items.length === 0) {
    return <p className="p-4 text-sm text-gray-400 dark:text-gray-500">{t('outlineEmpty')}</p>;
  }
  const indents = indentLevels(items);
  return (
    <nav aria-label={t('outlineTab')} className="flex-1 overflow-y-auto p-2" data-testid="outline">
      <ul className="space-y-0.5">
        {items.map((item, i) => (
          <li key={`${item.pos}-${i}`} style={{ paddingLeft: indents[i] * INDENT_PX }}>
            <button
              type="button"
              onClick={() => go(item)}
              aria-current={i === current ? 'location' : undefined}
              title={item.text}
              className={`w-full text-left px-2 py-1 rounded text-xs truncate transition-colors ${
                i === current
                  ? 'bg-[var(--accent-light)] text-[var(--accent)] font-semibold'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200/60 dark:hover:bg-gray-700/50'
              } ${item.level === 1 ? 'font-medium' : ''}`}
            >
              {item.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
