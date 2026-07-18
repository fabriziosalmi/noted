import { useState, useEffect, useRef, useCallback } from 'react';
import type { Editor } from '@tiptap/react';
import { askLLM, AbortedError, describeLlmError } from '../lib/llm';
import { Wand2, AlignLeft, List, Languages, Minimize2, Pencil, Loader2 } from 'lucide-react';
import { useI18n, type TranslationKey } from '../lib/i18n';
import { useStore } from '../store/useStore';
import { maskPii } from '../lib/piiMasker';

interface SlashCommandsProps {
  editor: Editor;
  onAiError?: (msg: string) => void;
}

interface Command {
  id: string;
  icon: React.ReactNode;
  labelKey: TranslationKey;
  descKey: TranslationKey;
  prompt: (context: string) => string;
}

const COMMANDS: Command[] = [
  {
    id: 'continue',
    icon: <Wand2 size={14} />,
    labelKey: 'cmdContinueLabel',
    descKey: 'cmdContinueDesc',
    prompt: ctx => `Continue this text naturally, same style and language, 2-4 sentences. Return ONLY the continuation, do not repeat existing text:\n\n${ctx}`,
  },
  {
    id: 'expand',
    icon: <AlignLeft size={14} />,
    labelKey: 'cmdExpandLabel',
    descKey: 'cmdExpandDesc',
    prompt: ctx => `Expand and deepen this text with details, examples and explanations. Maintain the same style and language. Return ONLY the expanded text:\n\n${ctx}`,
  },
  {
    id: 'summarize',
    icon: <Minimize2 size={14} />,
    labelKey: 'cmdSummarizeLabel',
    descKey: 'cmdSummarizeDesc',
    prompt: ctx => `Create a concise summary in 3-5 key bullet points in the same language as the text:\n\n${ctx}`,
  },
  {
    id: 'improve',
    icon: <Pencil size={14} />,
    labelKey: 'cmdImproveLabel',
    descKey: 'cmdImproveDesc',
    prompt: ctx => `Improve clarity, flow and style while keeping the original meaning and language. Return ONLY the improved text:\n\n${ctx}`,
  },
  {
    id: 'bullets',
    icon: <List size={14} />,
    labelKey: 'cmdBulletsLabel',
    descKey: 'cmdBulletsDesc',
    prompt: ctx => `Convert this text into a clear, concise bullet list in the same language. Return ONLY the bullet points:\n\n${ctx}`,
  },
  {
    id: 'translate',
    icon: <Languages size={14} />,
    labelKey: 'cmdTranslateLabel',
    descKey: 'cmdTranslateDesc',
    prompt: ctx => `Translate this text: Italian → English, English → Italian, any other language → English. Return ONLY the translation:\n\n${ctx}`,
  },
];

export function SlashCommands({ editor, onAiError }: SlashCommandsProps) {
  const { t } = useI18n();
  const piiMasking = useStore(s => s.settings.piiMasking ?? false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const triggerFromRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Abort any in-flight slash command on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  const filtered = COMMANDS.filter(c =>
    !query || t(c.labelKey).toLowerCase().includes(query.toLowerCase()) || c.id.includes(query.toLowerCase())
  );

  useEffect(() => { setActiveIdx(0); }, [query]);

  // Watch for / trigger
  useEffect(() => {
    const update = () => {
      const { state } = editor;
      const { from } = state.selection;
      const textBefore = state.doc.textBetween(Math.max(0, from - 30), from, '\n', '\0');
      // Match / at start of block or after space/newline
      const match = textBefore.match(/(^|\s)\/([\w]*)$/);
      if (match) {
        triggerFromRef.current = from - match[0].length + (match[1].length); // position of /
        setQuery(match[2]);
        const coords = editor.view.coordsAtPos(from);
        setPos({ top: coords.bottom + 6, left: Math.min(coords.left, window.innerWidth - 280) });
        setOpen(true);
      } else {
        setOpen(false);
      }
    };
    editor.on('selectionUpdate', update);
    editor.on('update', update);
    return () => { editor.off('selectionUpdate', update); editor.off('update', update); };
  }, [editor]);

  const executeCommand = useCallback(async (cmd: Command) => {
    setOpen(false);
    setRunning(cmd.id);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Delete the /command text
    const { from } = editor.state.selection;
    const triggerFrom = triggerFromRef.current ?? from;
    editor.chain().focus().deleteRange({ from: triggerFrom, to: from }).run();

    // Full doc for summarize/bullets/translate; last 800 chars for others
    const { state } = editor;
    const curFrom = state.selection.from;
    const needsFullContext = ['summarize', 'bullets', 'translate'].includes(cmd.id);
    const rawContext = needsFullContext
      ? editor.getText().slice(0, 6000)
      : (state.doc.textBetween(Math.max(0, curFrom - 800), curFrom, '\n').trim() || editor.getText().slice(-800));
    const context = piiMasking ? maskPii(rawContext).maskedText : rawContext;

    try {
      const result = await askLLM([
        { role: 'system', content: 'You are a professional writing assistant. Follow the instructions exactly.' },
        { role: 'user', content: cmd.prompt(context) },
      ], { signal: controller.signal });
      // Insert with a newline if needed
      const needsNewline = cmd.id === 'summarize' || cmd.id === 'bullets' || cmd.id === 'continue' || cmd.id === 'expand';
      editor.chain().focus().insertContent(needsNewline ? `\n${result}` : result).run();
    } catch (err) {
      if (err instanceof AbortedError) return;
      onAiError?.(describeLlmError(err));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setRunning(null);
    }
  }, [editor, onAiError, piiMasking]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.repeat) return;
      if (e.key === 'Escape') { setOpen(false); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, filtered.length - 1)); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
      if ((e.key === 'Enter' || e.key === 'Tab') && filtered[activeIdx]) {
        e.preventDefault();
        void executeCommand(filtered[activeIdx]);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open, filtered, activeIdx, executeCommand]);

  // Running spinner overlay
  if (running) {
    return (
      <div className="fixed top-14 right-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl px-4 py-3 flex items-center gap-3 z-50">
        <Loader2 size={16} className="animate-spin text-[var(--accent)]" />
        <span className="text-sm text-gray-600 dark:text-gray-300">
          {t(COMMANDS.find(c => c.id === running)?.labelKey ?? 'cmdContinueLabel')}...
        </span>
      </div>
    );
  }

  if (!open || filtered.length === 0 || !pos) return null;

  return (
    <div
      className="fixed z-50 bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl border border-gray-200/80 dark:border-gray-700/80 rounded-xl shadow-2xl py-1 w-64"
      style={{ top: pos.top, left: pos.left }}
    >
      <div className="px-3 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100 dark:border-gray-800 mb-1">
        {t('aiActions')}
      </div>
      {filtered.map((cmd, i) => (
        <button
          key={cmd.id}
          onMouseDown={e => { e.preventDefault(); void executeCommand(cmd); }}
          onMouseEnter={() => setActiveIdx(i)}
          className={`w-full flex items-start gap-3 px-3 py-2.5 text-left transition-colors ${
            i === activeIdx
              ? 'bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent)]'
              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/60'
          }`}
        >
          <span className="mt-0.5 opacity-70 shrink-0">{cmd.icon}</span>
          <div>
            <div className="text-sm font-medium leading-tight">{t(cmd.labelKey)}</div>
            <div className="text-xs opacity-60 mt-0.5">{t(cmd.descKey)}</div>
          </div>
        </button>
      ))}
      <div className="px-3 py-1.5 border-t border-gray-100 dark:border-gray-800 mt-1 flex gap-3 text-[10px] text-gray-400">
        <span>{t('navigate')}</span><span>{t('execute')}</span><span>{t('escClose')}</span>
      </div>
    </div>
  );
}
