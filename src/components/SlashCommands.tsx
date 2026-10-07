import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { Editor } from '@tiptap/react';
import { askLLM, AbortedError, describeLlmError } from '../lib/llm';
import { answerPrompt, loadPrompt, usePromptList, type PromptListing } from '../lib/userPrompts';
import { slugOf } from '../../shared/prompts/prompt';
import { mdToHtml } from '../lib/mdToHtml';
import { Wand2, AlignLeft, List, Languages, Library, Minimize2, Pencil, Loader2, Square } from 'lucide-react';
import { useI18n, type TranslationKey } from '../lib/i18n';
import { useStore } from '../store/useStore';
import { createMasker } from '../lib/piiMasker';

interface SlashCommandsProps {
  editor: Editor;
  onAiError?: (msg: string) => void;
}

/** What the menu lists: the built-in commands, then the prompts of the vault. */
type Entry = { kind: 'builtin'; id: string; cmd: Command } | { kind: 'prompt'; id: string; prompt: PromptListing };

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
  const [runningLabel, setRunningLabel] = useState('');
  const syncDir = useStore(s => s.settings.syncDirectory) || undefined;
  // Prompts that work without a selection (a slash command has none): those for the note, and those for any text.
  const allPrompts = usePromptList();
  const prompts = useMemo(() => allPrompts.filter(p => p.scope !== 'selection'), [allPrompts]);
  const triggerFromRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Abort any in-flight slash command on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  const q = query.toLowerCase();
  const filtered = useMemo<Entry[]>(() => [
    ...COMMANDS.filter(c => !query || t(c.labelKey).toLowerCase().includes(q) || c.id.includes(q)).map((cmd): Entry => ({ kind: 'builtin', id: cmd.id, cmd })),
    ...prompts.filter(p => !query || p.name.toLowerCase().includes(q) || slugOf(p.path).includes(q)).map((p): Entry => ({ kind: 'prompt', id: p.path, prompt: p })),
  ], [query, q, prompts, t]);

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
    setRunningLabel(t(cmd.labelKey));
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
    const masker = piiMasking ? createMasker() : undefined;
    const context = masker ? masker.mask(rawContext) : rawContext;

    try {
      const result = await askLLM([
        { role: 'system', content: 'You are a professional writing assistant. Follow the instructions exactly.' },
        { role: 'user', content: cmd.prompt(context) },
      ], { signal: controller.signal, masker });
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
  }, [editor, onAiError, piiMasking, t]);

  // A prompt of the vault: its /name text goes, it is filled in for the note, and the answer is put where the caret was (or at the end
  // of the note, if the prompt says so). There is no selection here: a prompt that needs one is not in this menu.
  const executePrompt = useCallback(async (listing: PromptListing) => {
    setOpen(false);
    setRunning(listing.path);
    setRunningLabel(listing.name);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { from } = editor.state.selection;
    editor.chain().focus().deleteRange({ from: triggerFromRef.current ?? from, to: from }).run();
    try {
      const prompt = await loadPrompt(listing.path, syncDir);
      if (!prompt) { onAiError?.(t('promptEmpty')); return; }
      const answer = await answerPrompt(prompt, { selection: '', note: editor.getText({ blockSeparator: '\n\n' }), now: new Date() }, { piiMasking, signal: controller.signal });
      if (!answer.ok) { onAiError?.(t('promptsNeedSelection')); return; }
      const html = mdToHtml(answer.text);
      if (answer.mode === 'append') {
        editor.commands.focus('end');
        editor.commands.insertContent(`<hr>${html}`);
      } else {
        editor.chain().focus().insertContent(html).run();
      }
    } catch (err) {
      if (err instanceof AbortedError) return;
      onAiError?.(describeLlmError(err));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setRunning(null);
    }
  }, [editor, onAiError, piiMasking, syncDir, t]);

  const execute = useCallback((entry: Entry) => { void (entry.kind === 'builtin' ? executeCommand(entry.cmd) : executePrompt(entry.prompt)); }, [executeCommand, executePrompt]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.repeat) return;
      if (e.key === 'Escape') { setOpen(false); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, filtered.length - 1)); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
      if ((e.key === 'Enter' || e.key === 'Tab') && filtered[activeIdx]) {
        e.preventDefault();
        execute(filtered[activeIdx]);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open, filtered, activeIdx, execute]);

  // Running spinner overlay
  if (running) {
    return (
      <div className="fixed top-14 right-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl px-4 py-3 flex items-center gap-3 z-50">
        <Loader2 size={16} className="animate-spin text-[var(--accent)]" />
        <span className="text-sm text-gray-600 dark:text-gray-300">
          {runningLabel}...
        </span>
        <button
          type="button"
          onClick={() => abortRef.current?.abort()}
          aria-label={t('stop')}
          title={t('stop')}
          className="shrink-0 flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 transition-colors"
        >
          <Square size={11} className="fill-current" /> {t('stop')}
        </button>
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
      {filtered.map((entry, i) => {
        const label = entry.kind === 'builtin' ? t(entry.cmd.labelKey) : entry.prompt.name;
        const desc = entry.kind === 'builtin' ? t(entry.cmd.descKey) : entry.prompt.description;
        const firstPrompt = entry.kind === 'prompt' && filtered[i - 1]?.kind !== 'prompt';
        return (
          <div key={entry.id}>
            {firstPrompt && (
              <div className="px-3 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider border-t border-gray-100 dark:border-gray-800 mt-1">{t('promptsGroup')}</div>
            )}
            <button
              onMouseDown={e => { e.preventDefault(); execute(entry); }}
              onMouseEnter={() => setActiveIdx(i)}
              className={`w-full flex items-start gap-3 px-3 py-2.5 text-left transition-colors ${
                i === activeIdx
                  ? 'bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent)]'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/60'
              }`}
            >
              <span className="mt-0.5 opacity-70 shrink-0">{entry.kind === 'builtin' ? entry.cmd.icon : <Library size={14} />}</span>
              <div className="min-w-0">
                <div className="text-sm font-medium leading-tight truncate">{label}</div>
                {desc && <div className="text-xs opacity-60 mt-0.5 truncate">{desc}</div>}
              </div>
            </button>
          </div>
        );
      })}
      <div className="px-3 py-1.5 border-t border-gray-100 dark:border-gray-800 mt-1 flex gap-3 text-[10px] text-gray-400">
        <span>{t('navigate')}</span><span>{t('execute')}</span><span>{t('escClose')}</span>
      </div>
    </div>
  );
}
