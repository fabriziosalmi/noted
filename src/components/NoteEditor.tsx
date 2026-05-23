import { useEffect, useRef, useCallback, useState } from 'react';
import { useI18n } from '../lib/i18n';
import { useEditor, EditorContent, ReactNodeViewRenderer, type Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Typography from '@tiptap/extension-typography';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Image from '@tiptap/extension-image';
import Mathematics from '@tiptap/extension-mathematics';
import { createLowlight, common } from 'lowlight';
import 'katex/dist/katex.min.css';
import { Bold, Italic, Strikethrough, Code, FileText, CheckCheck } from 'lucide-react';
import { askLLM } from '../lib/llm';
import { useStore } from '../store/useStore';
import { WikilinkMark, createWikilinkHighlightPlugin } from '../lib/WikilinkExtension';
import { WikilinkSuggestion } from './WikilinkSuggestion';
import { TagSuggestion } from './TagSuggestion';
import { BacklinksPanel } from './BacklinksPanel';
import { Extension } from '@tiptap/core';
import { CodeBlockView } from './CodeBlockView';
import { SlashCommands } from './SlashCommands';
import { SmartTagSuggestion } from './SmartTagSuggestion';
import { GhostTextExtension, ghostTextKey } from '../lib/ghostTextExtension';

const lowlight = createLowlight(common);

const WikilinkPlugin = Extension.create({
  name: 'wikilinkPlugin',
  addProseMirrorPlugins() { return [createWikilinkHighlightPlugin()]; },
});

type SaveStatus = 'idle' | 'saving' | 'saved';

interface NoteEditorProps {
  activeNoteName: string | null;
  activeNoteContent: string;
  saveActiveNote: (content: string) => Promise<void>;
  onEditorReady: (editor: Editor | null) => void;
  onWordCountChange?: (count: number) => void;
  onAiError?: (msg: string) => void;
  allNoteNames?: string[];
  allTags?: string[];
  backlinks?: string[];
  onSelectNote?: (name: string) => void;
  notesCount?: number;
  onCreateNote?: () => void;
  onOpenDaily?: () => void;
  onOpenSettings?: () => void;
  onOpenShortcuts?: () => void;
}

function hasShortcutModifier(event: KeyboardEvent | globalThis.KeyboardEvent): boolean {
  if (event.metaKey) return true;
  // Avoid AltGr (Ctrl+Alt) false positives on intl keyboard layouts.
  return event.ctrlKey && !event.altKey;
}

export function NoteEditor({ activeNoteName, activeNoteContent, saveActiveNote, onEditorReady, onWordCountChange, onAiError, allNoteNames = [], allTags = [], backlinks = [], onSelectNote, notesCount = 0, onCreateNote, onOpenDaily, onOpenSettings, onOpenShortcuts }: NoteEditorProps) {
  const { t } = useI18n();
  const llmProvider = useStore(s => s.settings.llmProvider);
  const llmApiKey = useStore(s => s.settings.llmApiKey);
  const onboardingDismissed = useStore(s => s.settings.onboardingDismissed ?? false);
  const aiGhostMode = useStore(s => s.settings.aiGhostMode ?? 'manual');
  const smartTagsEnabled = useStore(s => s.settings.smartTagsEnabled ?? false);
  const updateSettings = useStore(s => s.updateSettings);
  const llmReady = llmProvider === 'lmstudio' || llmProvider === 'ollama' || !!llmApiKey;
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [wordCount, setWordCount] = useState(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const prevNoteNameRef = useRef<string | null>(null);
  const ghostTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ghostTextRef = useRef('');
  const ghostActiveRef = useRef(false);
  const ghostGenerationRef = useRef(0);
  const [ghostActive, setGhostActive] = useState(false);
  const [ghostLoading, setGhostLoading] = useState(false);
  const editorRef = useRef<Editor | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const flushSave = useCallback(async (content: string) => {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    setSaveStatus('saving');
    await saveActiveNote(content);
    if (mountedRef.current) {
      setSaveStatus('saved');
      savedTimerRef.current = setTimeout(() => { if (mountedRef.current) setSaveStatus('idle'); }, 1500);
    }
  }, [saveActiveNote]);

  const debouncedSave = useCallback((content: string) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    setSaveStatus('saving');
    saveTimerRef.current = setTimeout(async () => {
      await saveActiveNote(content);
      if (mountedRef.current) {
        setSaveStatus('saved');
        savedTimerRef.current = setTimeout(() => { if (mountedRef.current) setSaveStatus('idle'); }, 1500);
      }
    }, 600);
  }, [saveActiveNote]);

  const updateWordCount = useCallback((text: string) => {
    const count = text.trim() ? text.trim().split(/\s+/).length : 0;
    setWordCount(count);
    onWordCountChange?.(count);
  }, [onWordCountChange]);

  // Fire one ghost-text suggestion against the current cursor position.
  // Used by both auto-on-typing mode and the manual ⌘L trigger.
  const triggerGhost = useCallback(() => {
    const ed = editorRef.current;
    if (!ed || !mountedRef.current || !llmReady) return;
    const gen = ++ghostGenerationRef.current;
    setGhostLoading(true);
    (async () => {
      const { state } = ed;
      const { from } = state.selection;
      const capturedFrom = from;
      const context = state.doc.textBetween(Math.max(0, from - 400), from, '\n').trim();
      if (context.length < 12) {
        if (mountedRef.current) setGhostLoading(false);
        return;
      }
      try {
        const suggestion = await askLLM([
          { role: 'system', content: 'You are a writing assistant. Complete the text with 1 natural sentence in the same language and style. Reply with ONLY the continuation, no repetition, no quotes.' },
          { role: 'user', content: context },
        ]);
        if (!mountedRef.current || ghostGenerationRef.current !== gen) return;
        if (ed.state.selection.from !== capturedFrom) return;
        const trimmed = suggestion.trim().replace(/^[.,;:\s]+/, '');
        if (!trimmed) return;
        ghostTextRef.current = ' ' + trimmed;
        ghostActiveRef.current = true;
        setGhostActive(true);
        ed.view.dispatch(ed.state.tr.setMeta(ghostTextKey, ' ' + trimmed));
      } catch {
        // best-effort
      } finally {
        if (mountedRef.current && ghostGenerationRef.current === gen) setGhostLoading(false);
      }
    })();
  }, [llmReady]);

  const clearGhost = useCallback(() => {
    ghostTextRef.current = '';
    ghostActiveRef.current = false;
    setGhostActive(false);
    setGhostLoading(false);
    const ed = editorRef.current;
    if (ed) ed.view.dispatch(ed.state.tr.setMeta(ghostTextKey, ''));
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      Typography,
      Placeholder.configure({ placeholder: t('editorPlaceholder') }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      CodeBlockLowlight.extend({
        addNodeView() { return ReactNodeViewRenderer(CodeBlockView); },
      }).configure({ lowlight }),
      Image.configure({ inline: false, allowBase64: true }),
      Mathematics,
      WikilinkMark,
      WikilinkPlugin,
      GhostTextExtension,
    ],
    content: activeNoteContent,
    onUpdate: ({ editor }) => {
      debouncedSave(editor.getHTML());
      updateWordCount(editor.getText());

      // Always clear any visible ghost on edit — the user is typing.
      clearGhost();
      if (ghostTimerRef.current) clearTimeout(ghostTimerRef.current);

      // Only schedule a new automatic suggestion in 'auto' mode. In 'manual'
      // and 'off' modes the user explicitly invokes ghost text via ⌘L.
      if (aiGhostMode !== 'auto' || !llmReady) return;
      ghostTimerRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        // Require some context before bothering the LLM in auto mode.
        const { state } = editor;
        const ctxLen = state.doc.textBetween(Math.max(0, state.selection.from - 400), state.selection.from, '\n').trim().length;
        if (ctxLen < 80) return;
        triggerGhost();
      }, 1200);
    },
    onCreate: ({ editor }) => {
      updateWordCount(editor.getText());
    },
    editorProps: {
      attributes: { class: 'prose prose-sm sm:prose lg:prose-lg xl:prose-2xl mx-auto focus:outline-none' },
      handleKeyDown: (_view, event) => {
        // Manual ghost-text trigger: ⌘L (or Ctrl+L). Works in any aiGhostMode
        // except 'off'.
        if (!event.isComposing && hasShortcutModifier(event) && event.key.toLowerCase() === 'l') {
          event.preventDefault();
          if (aiGhostMode !== 'off') triggerGhost();
          return true;
        }
        if (event.key === 'Tab' && ghostActiveRef.current && ghostTextRef.current) {
          event.preventDefault();
          const ghost = ghostTextRef.current;
          clearGhost();
          editorRef.current?.chain().focus().insertContent(ghost).run();
          return true;
        }
        if (event.key === 'Escape' && ghostActiveRef.current) {
          clearGhost();
          return false;
        }
        if (ghostActiveRef.current && !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Shift','Control','Meta','Alt'].includes(event.key)) {
          clearGhost();
        }
        return false;
      },
      handlePaste: (_view, event) => {
        // Image paste — convert to base64 and insert
        const items = Array.from(event.clipboardData?.items ?? []);
        const imageItem = items.find(i => i.type.startsWith('image/'));
        if (imageItem) {
          event.preventDefault();
          const file = imageItem.getAsFile();
          if (!file) return false;
          const reader = new FileReader();
          reader.onload = () => {
            editor?.chain().focus().setImage({ src: reader.result as string }).run();
          };
          reader.readAsDataURL(file);
          return true;
        }

        return false;
      },
      handleDrop: (_view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? []).filter(f => f.type.startsWith('image/'));
        if (!files.length) return false;
        event.preventDefault();
        files.forEach(file => {
          const reader = new FileReader();
          reader.onload = () => {
            editor?.chain().focus().setImage({ src: reader.result as string }).run();
          };
          reader.readAsDataURL(file);
        });
        return true;
      },
    },
  });

  // Cmd+S
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (hasShortcutModifier(e) && e.key.toLowerCase() === 's' && editor) {
        e.preventDefault();
        void flushSave(editor.getHTML());
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [editor, flushSave]);

  useEffect(() => {
    editorRef.current = editor ?? null;
    onEditorReady(editor ?? null);
  }, [editor, onEditorReady]);

  useEffect(() => {
    if (editor && activeNoteName !== prevNoteNameRef.current) {
      prevNoteNameRef.current = activeNoteName;
      editor.commands.setContent(activeNoteContent);
      updateWordCount(editor.getText());
      // Auto-focus editor at start of content when switching notes
      setTimeout(() => editor.commands.focus('start'), 0);
    }
  }, [activeNoteName, activeNoteContent, editor, updateWordCount]);

  if (!activeNoteName) {
    const isEmpty = notesCount === 0;
    const onboardingVisible = !onboardingDismissed;
    const onboardingSteps = [
      { key: 'note', done: notesCount > 0, label: t('onboardingStepNote') },
      { key: 'ai', done: llmReady, label: t('onboardingStepAi') },
      { key: 'shortcuts', done: false, label: t('onboardingStepShortcuts') },
    ];
    const doneCount = onboardingSteps.filter(s => s.done).length;
    return (
      <div className="h-full flex flex-col items-center justify-center px-8">
        <div className="flex flex-col items-center max-w-sm text-center">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5" style={{ background: 'var(--accent-light)' }}>
            <FileText size={26} style={{ color: 'var(--accent)' }} />
          </div>
          <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-200 mb-2">
            {t('welcomeTitle')}
          </h2>
          <p className="text-sm text-gray-400 dark:text-gray-500 mb-6">
            {isEmpty ? t('welcomeSubtitleEmpty') : t('welcomeSubtitleHasNotes')}
          </p>
          {onCreateNote && (
            <div className="flex gap-3">
              <button
                onClick={onCreateNote}
                className="btn-primary px-4 py-2 rounded-lg text-sm font-medium shadow-sm"
              >
                {t('welcomeNewNote')}
              </button>
              {isEmpty && onOpenDaily && (
                <button
                  onClick={onOpenDaily}
                  className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  {t('dailyNote')}
                </button>
              )}
            </div>
          )}
          {isEmpty && onOpenSettings && (
            <p className="mt-8 text-xs text-gray-400 dark:text-gray-600">
              {t('welcomeAiHint')}{' '}
              <button onClick={onOpenSettings} className="underline underline-offset-2 hover:text-[var(--accent)] transition-colors">
                {t('settings')}
              </button>
            </p>
          )}
          {onboardingVisible && (
            <div className="mt-6 w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-800/60 p-4 text-left">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  {t('onboardingTitle')}
                </p>
                <span className="text-[11px] text-gray-400 dark:text-gray-500">
                  {doneCount}/3
                </span>
              </div>
              <div className="space-y-1.5 mb-3">
                {onboardingSteps.map(step => (
                  <div key={step.key} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                    {step.done ? <CheckCheck size={13} className="text-emerald-500" /> : <span className="w-[13px] h-[13px] rounded-full border border-gray-300 dark:border-gray-600" />}
                    <span>{step.label}</span>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {onCreateNote && (
                  <button onClick={onCreateNote} className="text-xs px-2.5 py-1 rounded-md border border-gray-200 dark:border-gray-700 hover:bg-white dark:hover:bg-gray-700 transition-colors">
                    {t('welcomeNewNote')}
                  </button>
                )}
                {onOpenSettings && (
                  <button onClick={onOpenSettings} className="text-xs px-2.5 py-1 rounded-md border border-gray-200 dark:border-gray-700 hover:bg-white dark:hover:bg-gray-700 transition-colors">
                    {t('onboardingCtaAi')}
                  </button>
                )}
                {onOpenShortcuts && (
                  <button onClick={onOpenShortcuts} className="text-xs px-2.5 py-1 rounded-md border border-gray-200 dark:border-gray-700 hover:bg-white dark:hover:bg-gray-700 transition-colors">
                    {t('onboardingCtaShortcuts')}
                  </button>
                )}
                <button
                  onClick={() => updateSettings({ onboardingDismissed: true })}
                  className="text-xs px-2.5 py-1 rounded-md text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                >
                  {t('dismissSuggestion')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Bubble menu for inline selection formatting */}
      {editor && (
        // @ts-expect-error tippyOptions valid but untyped
        <BubbleMenu editor={editor} tippyOptions={{ duration: 100 }} className="flex space-x-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-lg rounded-lg p-1">
          <button onClick={() => editor.chain().focus().toggleBold().run()}
            className={`p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 ${editor.isActive('bold') ? 'bg-gray-200 dark:bg-gray-700 text-black dark:text-white' : 'text-gray-600 dark:text-gray-300'}`}>
            <Bold size={14} />
          </button>
          <button onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 ${editor.isActive('italic') ? 'bg-gray-200 dark:bg-gray-700 text-black dark:text-white' : 'text-gray-600 dark:text-gray-300'}`}>
            <Italic size={14} />
          </button>
          <button onClick={() => editor.chain().focus().toggleStrike().run()}
            className={`p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 ${editor.isActive('strike') ? 'bg-gray-200 dark:bg-gray-700 text-black dark:text-white' : 'text-gray-600 dark:text-gray-300'}`}>
            <Strikethrough size={14} />
          </button>
          <button onClick={() => editor.chain().focus().toggleCode().run()}
            className={`p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 ${editor.isActive('code') ? 'bg-gray-200 dark:bg-gray-700 text-black dark:text-white' : 'text-gray-600 dark:text-gray-300'}`}>
            <Code size={14} />
          </button>
        </BubbleMenu>
      )}

      <div
        role="presentation"
        onClick={e => {
          const target = e.target as HTMLElement;
          const wl = target.closest('[data-wikilink]');
          if (wl && onSelectNote) {
            const name = wl.getAttribute('data-wikilink');
            if (name) onSelectNote(name.endsWith('.md') ? name : `${name}.md`);
          }
        }}
      >
        <EditorContent editor={editor} />
      </div>

      {editor && allNoteNames.length > 0 && (
        <WikilinkSuggestion editor={editor} notes={allNoteNames} />
      )}
      {editor && allTags.length > 0 && (
        <TagSuggestion editor={editor} allTags={allTags} />
      )}
      {editor && (
        <SlashCommands editor={editor} onAiError={onAiError} />
      )}

      {smartTagsEnabled && activeNoteContent && (
        <SmartTagSuggestion
          content={activeNoteContent}
          existingTags={allTags}
          onAccept={tags => {
            if (editor) {
              editor.chain().focus().insertContentAt(editor.state.doc.content.size, `<p>${tags.join(' ')}</p>`).run();
            }
          }}
        />
      )}

      {activeNoteName && backlinks.length > 0 && onSelectNote && (
        <BacklinksPanel activeNoteName={activeNoteName} backlinks={backlinks} onSelectNote={onSelectNote} />
      )}



      {/* Status bar */}
      <div className="fixed bottom-4 right-4 flex items-center gap-3 z-20">
        {ghostLoading && !ghostActive && (
          <span className="text-[10px] text-gray-400 dark:text-gray-500 flex items-center gap-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
            {t('ghostThinking')}
          </span>
        )}
        {ghostActive && (
          <span className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1 bg-gray-50 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-full px-2.5 py-1">
            <kbd className="font-mono text-[10px] bg-gray-200 dark:bg-gray-700 rounded px-1">Tab</kbd>
            {t('tabAccept')}
          </span>
        )}
        {wordCount > 0 && (
          <span className="text-xs text-gray-300 dark:text-gray-600">{wordCount} {t(wordCount === 1 ? 'word' : 'words')}</span>
        )}
        {saveStatus !== 'idle' && (
          <div className={`text-xs px-2.5 py-1 rounded-full flex items-center gap-1.5 ${
            saveStatus === 'saving' ? 'text-gray-400 dark:text-gray-500' : 'text-emerald-600 dark:text-emerald-400'
          }`}>
            {saveStatus === 'saving' ? <span>{t('saving')}</span> : <><CheckCheck size={13} /><span>{t('saved')}</span></>}
          </div>
        )}
      </div>
    </>
  );
}
