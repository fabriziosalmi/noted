import { useState, useCallback, useRef, useEffect } from 'react';
import type { Editor } from '@tiptap/react';
import {
  ChevronRight, Maximize2, Minimize2, Wand2,
  FileText, Eye, Zap, HelpCircle, Loader2, Square,
  Languages, SlidersHorizontal, List, MessageSquarePlus, X, Library, Plus,
} from 'lucide-react';
import { askLLM, AbortedError, describeLlmError } from '../lib/llm';
import { Tooltip } from './Tooltip';
import { useStore } from '../store/useStore';
import { createMasker } from '../lib/piiMasker';
import { reviewable } from '../../shared/diff/hunks';
import { mdToHtml } from '../lib/mdToHtml';
import { AiEditReview } from './AiEditReview';
import { answerPrompt, loadPrompt, usePromptList, type PromptListing } from '../lib/userPrompts';
import { getElectronApi } from '../lib/electronApi';
import { diskToWire } from '../lib/noteIo';
import { PROMPTS_FOLDER, promptTemplateNote, type PromptMode } from '../../shared/prompts/prompt';
import { useI18n, type TranslationKey } from '../lib/i18n';

interface Action {
  id: string;
  labelKey: TranslationKey;
  icon: React.ElementType;
  mode: 'append' | 'replace';
  system: string;
  headingKey?: TranslationKey;
}

const ACTIONS: Action[] = [
  {
    id: 'continue',
    labelKey: 'aiActionContinue',
    icon: ChevronRight,
    mode: 'append',
    system: 'You are a writing assistant. Continue this text naturally, maintaining its style and tone. Return ONLY the continuation in the same language as the original. Markdown format.',
  },
  {
    id: 'expand',
    labelKey: 'aiActionExpand',
    icon: Maximize2,
    mode: 'replace',
    system: 'Expand this text with more detail, examples and context, maintaining the same style and tone. Return ONLY the expanded text in the same language. Markdown format.',
  },
  {
    id: 'shorten',
    labelKey: 'aiActionShorten',
    icon: Minimize2,
    mode: 'replace',
    system: 'Shorten this text while keeping all key points. Reduce length by 40-50%, eliminate redundancy. Return ONLY the shortened text in the same language. Markdown format.',
  },
  {
    id: 'refine',
    labelKey: 'aiActionRefine',
    icon: Wand2,
    mode: 'replace',
    system: 'Improve this text: fix grammar, improve flow, enhance clarity and style. Return ONLY the improved text in the same language. Markdown format.',
  },
  {
    id: 'translate',
    labelKey: 'aiActionTranslate',
    icon: Languages,
    mode: 'replace',
    system: 'Translate this text: if it is in English translate it to Italian, otherwise translate it to English. Return ONLY the translation, preserving Markdown formatting.',
  },
  {
    id: 'tone',
    labelKey: 'aiActionTone',
    icon: SlidersHorizontal,
    mode: 'replace',
    system: 'Rewrite this text flipping its tone: if it reads formal, make it casual and friendly; if it reads casual, make it more formal and professional. Keep the meaning and the original language. Return ONLY the rewritten text. Markdown format.',
  },
  {
    id: 'bullets',
    labelKey: 'aiActionBullets',
    icon: List,
    mode: 'replace',
    system: 'Convert this text into a clear, well-structured bullet-point list in the same language, preserving all key information. Return ONLY the list. Markdown format.',
  },
];

const ANALYSIS_ACTIONS: Action[] = [
  {
    id: 'summarize',
    labelKey: 'aiActionSummarize',
    icon: FileText,
    mode: 'append',
    headingKey: 'aiHeadingSummary',
    system: 'Summarize this document concisely and structurally in the same language as the text. Return ONLY the summary. Markdown format.',
  },
  {
    id: 'review',
    labelKey: 'aiActionReview',
    icon: Eye,
    mode: 'append',
    headingKey: 'aiHeadingReview',
    system: 'Analyze this text and provide structured feedback in the same language: strengths, areas for improvement, specific suggestions. Markdown format.',
  },
  {
    id: 'devil',
    labelKey: 'aiActionDevil',
    icon: Zap,
    mode: 'append',
    headingKey: 'aiHeadingDevil',
    system: "Play devil's advocate on this text in the same language: present strong counterarguments, objections, and alternative perspectives. Markdown format.",
  },
  {
    id: 'qa',
    labelKey: 'aiActionQA',
    icon: HelpCircle,
    mode: 'append',
    headingKey: 'aiHeadingQA',
    system: 'Generate a list of questions and answers from this text in the same language to deepen understanding of key concepts. Markdown format.',
  },
];

interface AiActionsBarProps {
  editor: Editor;
  onError?: (msg: string) => void;
}

/** A rewrite waiting to be read: the text that was selected, what the model proposes for it, and where it was. */
interface PendingReview { title: string; original: string; proposed: string; from: number; to: number }

/** The selected text as the model is given it, and as it is compared when the rewrite comes back: paragraphs apart, as in Markdown. */
const selectionText = (editor: Editor, from: number, to: number): string => editor.state.doc.textBetween(from, to, '\n\n');

export function AiActionsBar({ editor, onError }: AiActionsBarProps) {
  const { t } = useI18n();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState('');
  const customInputRef = useRef<HTMLInputElement>(null);
  const piiMasking = useStore(s => s.settings.piiMasking ?? false);
  const reviewEdits = useStore(s => s.settings.aiReviewEdits ?? true);
  const [review, setReview] = useState<PendingReview | null>(null);
  const prompts = usePromptList();
  const syncDir = useStore(s => s.settings.syncDirectory) || undefined;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // The prompts menu closes on Escape, and on a click anywhere else.
  useEffect(() => {
    if (!menuOpen) return;
    const away = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key); };
  }, [menuOpen]);
  const abortRef = useRef<AbortController | null>(null);
  const { from, to } = editor.state.selection;
  const hasSelection = from !== to;

  // Abort any in-flight request on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Focus the custom-prompt input when it opens (avoids the autoFocus a11y trap).
  useEffect(() => { if (customOpen) customInputRef.current?.focus(); }, [customOpen]);

  const runAction = useCallback(async (action: Action) => {
    // Cancel any in-flight call before starting a new one. Combined with the
    // `activeId` button-disabled guard this prevents 5-click thundering herds.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const { from, to } = editor.state.selection;
    const hasSelection = from !== to;
    const rawText = hasSelection
      ? (action.mode === 'replace' ? selectionText(editor, from, to) : editor.state.doc.textBetween(from, to, '\n'))
      : editor.getText();

    if (!rawText.trim()) {
      onError?.(t('errWriteSomethingFirst'));
      return;
    }

    // Guard the data-loss footgun: replace-mode actions rewrite their input, so
    // require an explicit selection. Without one they used to silently overwrite
    // the entire note. Users who want to transform the whole note select all first.
    if (action.mode === 'replace' && !hasSelection) {
      onError?.(t('aiSelectToRewrite'));
      return;
    }

    // The answer is written into the note: what was masked on the way out is restored on the way back.
    const masker = piiMasking ? createMasker() : undefined;
    const selectedText = masker ? masker.mask(rawText) : rawText;

    setActiveId(action.id);
    try {
      const result = await askLLM([
        { role: 'system', content: action.system },
        { role: 'user', content: selectedText },
      ], { signal: controller.signal, masker });

      const html = mdToHtml(result);

      if (action.mode === 'replace' && reviewEdits) {
        // Read before it replaces anything: the selection stays as it is until the person applies what they keep.
        if (reviewable(rawText, result).changes.length === 0) onError?.(t('reviewNoChange'));
        else setReview({ title: t(action.labelKey), original: rawText, proposed: result, from, to });
      } else if (action.mode === 'replace') {
        // Guaranteed to have a selection here (guarded above); replacing via a
        // chain transaction keeps it in the undo history, unlike setContent().
        editor.chain().focus().deleteSelection().insertContent(html).run();
      } else {
        const headingHtml = action.headingKey ? `<hr><h2>${t(action.headingKey)}</h2>` : '<hr>';
        editor.commands.focus('end');
        editor.commands.insertContent(headingHtml + html);
      }
    } catch (err) {
      if (err instanceof AbortedError) return; // silently dropped
      onError?.(describeLlmError(err));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setActiveId(null);
    }
  }, [editor, onError, piiMasking, reviewEdits, t]);

  // Free-form instruction on the selection (or the whole note if nothing is
  // selected). A selection is rewritten in place; without one the result is
  // appended, so a custom prompt never silently overwrites the note.
  const runCustom = useCallback(async (instruction: string) => {
    if (!instruction.trim()) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const { from, to } = editor.state.selection;
    const hasSelection = from !== to;
    const rawText = hasSelection ? selectionText(editor, from, to) : editor.getText();
    if (!rawText.trim()) {
      onError?.(t('errWriteSomethingFirst'));
      return;
    }
    // The answer is written into the note: what was masked on the way out is restored on the way back.
    const masker = piiMasking ? createMasker() : undefined;
    const selectedText = masker ? masker.mask(rawText) : rawText;

    setActiveId('custom');
    try {
      const result = await askLLM([
        { role: 'system', content: `Apply the following instruction to the text. Return ONLY the result, in the same language as the text, Markdown format.\n\nInstruction: ${instruction.trim()}` },
        { role: 'user', content: selectedText },
      ], { signal: controller.signal, masker });
      const html = mdToHtml(result);
      if (hasSelection && reviewEdits) {
        if (reviewable(rawText, result).changes.length === 0) onError?.(t('reviewNoChange'));
        else setReview({ title: t('aiActionCustom'), original: rawText, proposed: result, from, to });
      } else if (hasSelection) {
        editor.chain().focus().deleteSelection().insertContent(html).run();
      } else {
        editor.commands.focus('end');
        editor.commands.insertContent('<hr>' + html);
      }
      setCustomText('');
      setCustomOpen(false);
    } catch (err) {
      if (err instanceof AbortedError) return;
      onError?.(describeLlmError(err));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setActiveId(null);
    }
  }, [editor, onError, piiMasking, reviewEdits, t]);

  // Apply what was kept. The note may have moved on while the model worked or the person read: the text is put in only if it is
  // still exactly the text that was sent, never in place of something else.
  const applyReview = (text: string) => {
    if (!review) return;
    const { from, to, original } = review;
    setReview(null);
    if (to > editor.state.doc.content.size || selectionText(editor, from, to) !== original) { onError?.(t('reviewStale')); return; }
    editor.chain().focus().insertContentAt({ from, to }, mdToHtml(text)).run();
  };

  // A prompt from the vault: filled in for this note and selection, answered by the model, and the answer put where the prompt says
  // (in place of the selection, through the same review as any rewrite; at the caret; or at the end of the note).
  const runPrompt = useCallback(async (listing: PromptListing) => {
    setMenuOpen(false);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { from, to } = editor.state.selection;
    const selected = from !== to ? selectionText(editor, from, to) : '';
    setActiveId('prompt');
    try {
      const prompt = await loadPrompt(listing.path, syncDir);
      if (!prompt) { onError?.(t('promptEmpty')); return; }
      const answer = await answerPrompt(prompt, { selection: selected, note: editor.getText({ blockSeparator: '\n\n' }), now: new Date() }, { piiMasking, signal: controller.signal });
      if (!answer.ok) { onError?.(t('promptsNeedSelection')); return; }
      const html = mdToHtml(answer.text);
      const place = (mode: PromptMode) => {
        if (mode === 'replace' && reviewEdits) {
          if (reviewable(selected, answer.text).changes.length === 0) onError?.(t('reviewNoChange'));
          else setReview({ title: prompt.name, original: selected, proposed: answer.text, from, to });
        } else if (mode === 'replace') {
          editor.chain().focus().deleteSelection().insertContent(html).run();
        } else if (mode === 'append') {
          editor.commands.focus('end');
          editor.commands.insertContent(`<hr><h2>${prompt.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</h2>${html}`);
        } else {
          editor.chain().focus().insertContentAt(editor.state.selection.to, html).run();
        }
      };
      place(answer.mode);
    } catch (err) {
      if (err instanceof AbortedError) return;
      onError?.(describeLlmError(err));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setActiveId(null);
    }
  }, [editor, onError, piiMasking, reviewEdits, syncDir, t]);

  // A new prompt: a note in prompts/ to start from, opened for writing. Its name is the first free "New prompt", "New prompt 2"…
  const newPrompt = useCallback(async () => {
    setMenuOpen(false);
    const api = getElectronApi();
    const taken = new Set(useStore.getState().notes.map(n => n.name.toLowerCase()));
    let n = 1;
    const base = t('promptsNew');
    const nameOf = () => `${PROMPTS_FOLDER}/${n === 1 ? base : `${base} ${n}`}.md`;
    while (taken.has(nameOf().toLowerCase())) n++;
    const name = nameOf();
    const folder = await api?.createFolder(PROMPTS_FOLDER, syncDir);
    if (folder && !folder.success && !/already exists/i.test(folder.error ?? '')) { onError?.(t('promptsCreateFailed').replace('{error}', folder.error ?? 'failed')); return; }
    const res = await api?.saveNote(name, diskToWire(promptTemplateNote(n === 1 ? base : `${base} ${n}`), 'markdown'), syncDir);
    if (!res?.success) { onError?.(t('promptsCreateFailed').replace('{error}', res?.error ?? 'failed')); return; }
    await useStore.getState().fetchNotes();
    await useStore.getState().openNote(name);
  }, [onError, syncDir, t]);

  const renderBtn = (action: Action) => {
    const isActive = activeId === action.id;
    const isDisabled = !!activeId;
    const Icon = action.icon;
    return (
      <Tooltip key={action.id} label={isActive ? t('stop') : t(action.labelKey)} side="bottom">
        <button
          // While this action runs, the button becomes a Stop control (the abort
          // plumbing already exists) instead of dead-locking behind the spinner.
          onClick={() => (isActive ? abortRef.current?.abort() : void runAction(action))}
          disabled={isDisabled && !isActive}
          aria-label={isActive ? t('stop') : t(action.labelKey)}
          className={`group flex items-center py-1 px-1.5 rounded transition-colors duration-150
            ${isActive
              ? 'bg-[var(--accent-light)] text-[var(--accent)] hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400'
              : isDisabled
                ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-[var(--accent)]'
            }`}
        >
          {isActive
            ? <>
                <Loader2 size={13} className="animate-spin group-hover:hidden" />
                <Square size={13} className="hidden group-hover:block fill-current" />
              </>
            : <Icon size={13} />
          }
        </button>
      </Tooltip>
    );
  };

  const customBusy = activeId === 'custom';
  const customDisabled = !!activeId && !customBusy;
  return (
    <>
      {ACTIONS.map(renderBtn)}
      <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-1 shrink-0" />
      {ANALYSIS_ACTIONS.map(renderBtn)}
      <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-1 shrink-0" />
      <div ref={menuRef} className="relative">
        <Tooltip label={t('promptsMenu')} side="bottom">
          <button
            type="button"
            onClick={() => setMenuOpen(o => !o)}
            disabled={!!activeId}
            aria-label={t('promptsMenu')}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className={`group flex items-center py-1 px-1.5 rounded transition-colors duration-150 ${
              menuOpen ? 'bg-[var(--accent-light)] text-[var(--accent)]'
                : activeId ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-[var(--accent)]'
            }`}
          >
            <Library size={13} />
          </button>
        </Tooltip>
        {menuOpen && (
          <div role="menu" aria-label={t('promptsMenu')} className="absolute left-0 top-full mt-1 z-40 w-64 max-h-72 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl py-1">
            {prompts.length === 0 && <p className="px-3 py-2 text-[11px] text-gray-500 dark:text-gray-400">{t('promptsNone')}</p>}
            {prompts.map(p => {
              const blocked = p.scope === 'selection' && !hasSelection;
              return (
                <button
                  key={p.path}
                  type="button"
                  role="menuitem"
                  disabled={blocked}
                  title={blocked ? t('promptsNeedSelection') : p.description || p.path}
                  onClick={() => { void runPrompt(p); }}
                  className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <span className="block truncate">{p.name}</span>
                  {p.description && <span className="block truncate text-[11px] text-gray-500 dark:text-gray-400">{p.description}</span>}
                </button>
              );
            })}
            <button type="button" role="menuitem" onClick={() => { void newPrompt(); }} className="w-full flex items-center gap-1.5 px-3 py-1.5 text-sm text-[var(--accent)] hover:bg-gray-100 dark:hover:bg-gray-800 border-t border-gray-100 dark:border-gray-800 mt-1">
              <Plus size={12} aria-hidden="true" /> {t('promptsNew')}
            </button>
          </div>
        )}
      </div>
      <Tooltip label={t('aiActionCustom')} side="bottom">
        <button
          onClick={() => setCustomOpen(o => !o)}
          disabled={customDisabled}
          aria-label={t('aiActionCustom')}
          aria-expanded={customOpen}
          className={`group flex items-center py-1 px-1.5 rounded transition-colors duration-150 ${
            customOpen
              ? 'bg-[var(--accent-light)] text-[var(--accent)]'
              : customDisabled
                ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-[var(--accent)]'
          }`}
        >
          <MessageSquarePlus size={13} />
        </button>
      </Tooltip>
      {customOpen && (
        <div className="flex items-center gap-1 ml-1 shrink-0">
          <input
            ref={customInputRef}
            type="text"
            aria-label={t('aiActionCustom')}
            value={customText}
            onChange={e => setCustomText(e.target.value)}
            onKeyDown={e => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'Enter') { e.preventDefault(); void runCustom(customText); }
              if (e.key === 'Escape') { setCustomOpen(false); setCustomText(''); }
            }}
            placeholder={t('aiCustomPlaceholder')}
            disabled={customBusy}
            className="text-xs bg-gray-100 dark:bg-gray-700 rounded px-2 py-1 outline-none text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 w-56 focus:ring-1 focus:ring-[var(--accent)]"
          />
          {customBusy
            ? <button type="button" onClick={() => abortRef.current?.abort()} aria-label={t('stop')} className="p-1 rounded text-[var(--accent)] hover:text-red-600 dark:hover:text-red-400"><Square size={13} className="fill-current" /></button>
            : <button type="button" onClick={() => { setCustomOpen(false); setCustomText(''); }} aria-label={t('closeFind')} className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={13} /></button>
          }
        </div>
      )}
      {review && (
        <AiEditReview
          title={review.title}
          original={review.original}
          proposed={review.proposed}
          onApply={applyReview}
          onCancel={() => setReview(null)}
        />
      )}
      {hasSelection && !customOpen && (
        <span className="ml-2 text-[10px] italic shrink-0" style={{ color: 'var(--accent)', opacity: 0.7 }}>
          {t('aiSelectionBadge')}
        </span>
      )}
    </>
  );
}
