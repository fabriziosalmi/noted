import { useRef } from 'react';
import type { Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Highlighter,
  Link2,
  RemoveFormatting,
  Table as TableIcon,
  Copy,
  ArrowUpDown,
  ArrowDownUp,
  Eraser,
  WrapText,
  ListOrdered,
  Quote,
  List,
} from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { copySelectionAsMarkdown } from '../lib/copySelectionMd';
import { toggleSortLines } from '../lib/sortLines';
import { removeBlankAndDuplicateLines } from '../lib/cleanLines';
import { joinSelectedLines } from '../lib/joinLines';
import { toggleNumberLines } from '../lib/numberLines';
import { reverseSelectedLines } from '../lib/reverseLines';
import { toggleQuoteLines } from '../lib/quoteLines';
import { CALLOUT_KINDS, toggleWrapCallout } from '../lib/calloutWrap';
import { cycleTextCase, type TextCaseMode } from '../lib/textCase';
import { computeTextStats, formatStatsLabel } from '../lib/selectionStats';
import { parseTextTable, tableDataToHtml } from '../lib/textTable';
import { SEMANTIC_HIGHLIGHTS, toggleSemanticHighlight } from '../lib/highlightColors';

type PromptFn = (opts: {
  title: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
}) => Promise<string | null>;

interface EditorBubbleMenuProps {
  editor: Editor;
  prompt: PromptFn;
}

const BTN_BASE = 'p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300';
const BTN_ACTIVE = 'bg-gray-200 dark:bg-gray-700 text-black dark:text-white';

export function EditorBubbleMenu({ editor, prompt }: EditorBubbleMenuProps) {
  const { t } = useI18n();
  const caseModeRef = useRef<TextCaseMode>('lower');

  const { from, to, empty } = editor.state.selection;
  const selectedText = empty ? '' : editor.state.doc.textBetween(from, to, '\n');
  const isMultiLine = !empty && selectedText.includes('\n');
  const tableRows = isMultiLine ? parseTextTable(selectedText) : null;
  const canConvertTable = Boolean(tableRows && tableRows.length >= 2 && tableRows[0].length >= 2);
  const statsLabel = empty ? '' : formatStatsLabel(computeTextStats(selectedText));

  const replaceSelection = (nextText: string) => {
    editor
      .chain()
      .focus()
      .insertContentAt({ from, to }, nextText)
      .setTextSelection({ from, to: from + nextText.length })
      .run();
  };

  return (
    <BubbleMenu
      editor={editor}
      // @ts-expect-error tippyOptions valid but untyped
      tippyOptions={{ duration: 100 }}
      className="flex flex-wrap items-center gap-0.5 max-w-[min(92vw,34rem)] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-lg rounded-lg p-1"
    >
      <button
        type="button"
        aria-label={t('bold')}
        title={t('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={`p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 ${editor.isActive('bold') ? BTN_ACTIVE : 'text-gray-600 dark:text-gray-300'}`}
      >
        <Bold size={14} />
      </button>
      <button
        type="button"
        aria-label={t('italic')}
        title={t('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={`p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 ${editor.isActive('italic') ? BTN_ACTIVE : 'text-gray-600 dark:text-gray-300'}`}
      >
        <Italic size={14} />
      </button>
      <button
        type="button"
        aria-label={t('strikethrough')}
        title={t('strikethrough')}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        className={`p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 ${editor.isActive('strike') ? BTN_ACTIVE : 'text-gray-600 dark:text-gray-300'}`}
      >
        <Strikethrough size={14} />
      </button>
      <button
        type="button"
        aria-label={t('inlineCode')}
        title={t('inlineCode')}
        onClick={() => editor.chain().focus().toggleCode().run()}
        className={`p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 ${editor.isActive('code') ? BTN_ACTIVE : 'text-gray-600 dark:text-gray-300'}`}
      >
        <Code size={14} />
      </button>
      <button
        type="button"
        aria-label={t('highlight')}
        title={t('highlight')}
        onClick={() => editor.chain().focus().toggleHighlight().run()}
        className={`p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 ${editor.isActive('highlight') ? BTN_ACTIVE : 'text-gray-600 dark:text-gray-300'}`}
      >
        <Highlighter size={14} />
      </button>
      {SEMANTIC_HIGHLIGHTS.map((h) => {
        const active = editor.isActive('highlight', { color: h.color });
        return (
          <button
            key={h.id}
            type="button"
            aria-label={`Highlight: ${h.label}`}
            title={`Highlight: ${h.label}`}
            onClick={() => toggleSemanticHighlight(editor, h.color)}
            className={`p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center ${active ? 'ring-1 ring-gray-500 dark:ring-gray-300' : ''}`}
          >
            <span className="w-2.5 h-2.5 rounded-full border border-black/15" style={{ backgroundColor: h.color }} />
          </button>
        );
      })}
      <button
        type="button"
        aria-label={t('link')}
        title={t('link')}
        onClick={async () => {
          const prev = (editor.getAttributes('link').href as string | undefined) ?? '';
          const url = await prompt({
            title: t('linkPromptTitle'),
            placeholder: 'https://example.com',
            defaultValue: prev,
            confirmLabel: t('linkApply'),
          });
          if (url === null) return;
          const href = url.trim();
          if (!href) {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
            return;
          }
          editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
        }}
        className={`p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 ${editor.isActive('link') ? BTN_ACTIVE : 'text-gray-600 dark:text-gray-300'}`}
      >
        <Link2 size={14} />
      </button>
      <button
        type="button"
        aria-label="Change case"
        title="Change case"
        onClick={() => {
          if (!selectedText) return;
          const { mode, text } = cycleTextCase(selectedText, caseModeRef.current);
          caseModeRef.current = mode;
          replaceSelection(text);
        }}
        className="px-1.5 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 text-[11px] font-semibold leading-none"
      >
        Aa
      </button>
      <button
        type="button"
        aria-label={t('clearFormatting')}
        title={t('clearFormatting')}
        onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
        className={BTN_BASE}
      >
        <RemoveFormatting size={14} />
      </button>
      <button
        type="button"
        aria-label="Copy as Markdown"
        title="Copy as Markdown"
        onClick={() => { void copySelectionAsMarkdown(editor); }}
        className={BTN_BASE}
      >
        <Copy size={14} />
      </button>
      <span className="flex items-center border-l border-gray-200 dark:border-gray-700 pl-1 gap-0.5">
        {CALLOUT_KINDS.map((c) => {
          const active = editor.isActive('callout', { kind: c.kind });
          return (
            <button
              key={c.kind}
              type="button"
              aria-label={`Callout ${c.label}`}
              title={`Wrap in ${c.label} callout`}
              onClick={() => toggleWrapCallout(editor, c.kind)}
              className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${active ? BTN_ACTIVE : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
            >
              {c.label}
            </button>
          );
        })}
      </span>
      {isMultiLine && (
        <span className="flex items-center border-l border-gray-200 dark:border-gray-700 pl-1 gap-0.5">
          <button type="button" aria-label="Sort lines" title="Sort lines" onClick={() => replaceSelection(toggleSortLines(selectedText))} className={BTN_BASE}>
            <ArrowUpDown size={14} />
          </button>
          <button type="button" aria-label="Remove blank and duplicate lines" title="Remove blank & duplicate lines" onClick={() => replaceSelection(removeBlankAndDuplicateLines(selectedText))} className={BTN_BASE}>
            <Eraser size={14} />
          </button>
          <button type="button" aria-label="Join lines" title="Join lines" onClick={() => replaceSelection(joinSelectedLines(selectedText))} className={BTN_BASE}>
            <WrapText size={14} />
          </button>
          <button type="button" aria-label="Number lines" title="Number lines" onClick={() => replaceSelection(toggleNumberLines(selectedText))} className={BTN_BASE}>
            <ListOrdered size={14} />
          </button>
          <button type="button" aria-label="Reverse lines" title="Reverse lines" onClick={() => replaceSelection(reverseSelectedLines(selectedText))} className={BTN_BASE}>
            <ArrowDownUp size={14} />
          </button>
          <button type="button" aria-label="Quote lines" title="Quote lines" onClick={() => replaceSelection(toggleQuoteLines(selectedText))} className={BTN_BASE}>
            <Quote size={14} />
          </button>
          <button type="button" aria-label="Bullet lines" title="Bullet lines" onClick={() => editor.chain().focus().toggleBulletList().run()} className={BTN_BASE}>
            <List size={14} />
          </button>
          {canConvertTable && tableRows && (
            <button
              type="button"
              aria-label="Convert to table"
              title="Convert to table"
              onClick={() => editor.chain().focus().deleteSelection().insertContent(tableDataToHtml(tableRows)).run()}
              className={BTN_BASE}
            >
              <TableIcon size={14} />
            </button>
          )}
        </span>
      )}
      {statsLabel && (
        <span
          data-testid="selection-stats"
          className="px-1.5 text-[11px] text-gray-400 dark:text-gray-500 border-l border-gray-200 dark:border-gray-700 select-none self-center whitespace-nowrap"
        >
          {statsLabel}
        </span>
      )}
    </BubbleMenu>
  );
}
