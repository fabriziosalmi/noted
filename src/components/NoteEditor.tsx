import { useEffect, useRef, useCallback, useState } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Typography from '@tiptap/extension-typography';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { createLowlight, common } from 'lowlight';
import { Bold, Italic, Strikethrough, Code, Bot, FileText, CheckCheck } from 'lucide-react';
import { askLLM } from '../lib/llm';

const lowlight = createLowlight(common);

type SaveStatus = 'idle' | 'saving' | 'saved';

interface NoteEditorProps {
  activeNoteName: string | null;
  activeNoteContent: string;
  saveActiveNote: (content: string) => Promise<void>;
  onEditorReady: (editor: Editor | null) => void;
  onWordCountChange?: (count: number) => void;
  onAiError?: (msg: string) => void;
}

export function NoteEditor({ activeNoteName, activeNoteContent, saveActiveNote, onEditorReady, onWordCountChange, onAiError }: NoteEditorProps) {
  const [isSmartPasting, setIsSmartPasting] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [wordCount, setWordCount] = useState(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const prevNoteNameRef = useRef<string | null>(null);

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

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      Typography,
      Placeholder.configure({ placeholder: 'Scrivi qualcosa...' }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      CodeBlockLowlight.configure({ lowlight }),
    ],
    content: activeNoteContent,
    onUpdate: ({ editor }) => {
      debouncedSave(editor.getHTML());
      updateWordCount(editor.getText());
    },
    onCreate: ({ editor }) => {
      updateWordCount(editor.getText());
    },
    editorProps: {
      attributes: { class: 'prose prose-sm sm:prose lg:prose-lg xl:prose-2xl mx-auto focus:outline-none' },
      handlePaste: (_view, event) => {
        const text = event.clipboardData?.getData('text/plain');
        if (!text || (text.length < 30 && !text.includes('\n'))) return false;
        event.preventDefault();
        (async () => {
          if (!mountedRef.current) return;
          setIsSmartPasting(true);
          try {
            const result = await askLLM([
              { role: 'system', content: `Sei un esperto di formattazione Markdown. L'utente ha incollato del testo grezzo. Il tuo unico compito è restituire lo STESSO testo, ma pulito e formattato in Markdown (titoli, liste, grassetti, codice). Non aggiungere saluti o commenti. Restituisci SOLO il Markdown finale.` },
              { role: 'user', content: text },
            ]);
            if (mountedRef.current) editor?.chain().focus().insertContent(result).run();
          } catch (err) {
            if (mountedRef.current) {
              editor?.chain().focus().insertContent(text).run();
              onAiError?.((err as Error).message);
            }
          } finally {
            if (mountedRef.current) setIsSmartPasting(false);
          }
        })();
        return true;
      },
    },
  });

  // Cmd+S
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's' && editor) {
        e.preventDefault();
        void flushSave(editor.getHTML());
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [editor, flushSave]);

  useEffect(() => { onEditorReady(editor ?? null); }, [editor, onEditorReady]);

  useEffect(() => {
    if (editor && activeNoteName !== prevNoteNameRef.current) {
      prevNoteNameRef.current = activeNoteName;
      editor.commands.setContent(activeNoteContent);
      updateWordCount(editor.getText());
    }
  }, [activeNoteName, activeNoteContent, editor, updateWordCount]);

  if (!activeNoteName) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-400 dark:text-gray-600 mt-32">
        <FileText size={48} className="mb-4 opacity-20" />
        <p>Seleziona una nota o creane una nuova</p>
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

      <EditorContent editor={editor} />

      {isSmartPasting && (
        <div className="fixed top-14 right-4 bg-indigo-500 text-white text-xs px-3 py-1.5 rounded-full flex items-center space-x-2 shadow-lg animate-pulse z-30">
          <Bot size={14} />
          <span>Smart Paste...</span>
        </div>
      )}

      {/* Status bar */}
      <div className="fixed bottom-4 right-4 flex items-center gap-3 z-20">
        {wordCount > 0 && (
          <span className="text-xs text-gray-300 dark:text-gray-600">{wordCount} {wordCount === 1 ? 'parola' : 'parole'}</span>
        )}
        {!isSmartPasting && saveStatus !== 'idle' && (
          <div className={`text-xs px-2.5 py-1 rounded-full flex items-center gap-1.5 ${
            saveStatus === 'saving' ? 'text-gray-400 dark:text-gray-500' : 'text-emerald-600 dark:text-emerald-400'
          }`}>
            {saveStatus === 'saving' ? <span>Salvando...</span> : <><CheckCheck size={13} /><span>Salvato</span></>}
          </div>
        )}
      </div>
    </>
  );
}
