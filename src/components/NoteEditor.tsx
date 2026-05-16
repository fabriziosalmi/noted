import { useEffect, useRef, useCallback, useState } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Typography from '@tiptap/extension-typography';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
  Bold, Italic, Strikethrough, Bot, FileText, CheckCheck,
  Heading1, Heading2, Heading3, Table as TableIcon, Code,
  Search, X, ChevronUp, ChevronDown,
} from 'lucide-react';
import { askLLM } from '../lib/llm';
import { AiActionsBar } from './AiActionsBar';

type SaveStatus = 'idle' | 'saving' | 'saved';

interface Match { from: number; to: number }

function findInDoc(doc: ProseMirrorNode, searchText: string): Match[] {
  const results: Match[] = [];
  if (!searchText.trim()) return results;
  const escaped = searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped, 'gi');
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

interface NoteEditorProps {
  activeNoteName: string | null;
  activeNoteContent: string;
  saveActiveNote: (content: string) => Promise<void>;
  onEditorReady: (editor: Editor | null) => void;
  onWordCountChange?: (count: number) => void;
  showToolbar?: boolean;
  showAiBar?: boolean;
}

export function NoteEditor({ activeNoteName, activeNoteContent, saveActiveNote, onEditorReady, onWordCountChange, showToolbar = true, showAiBar = true }: NoteEditorProps) {
  const [isSmartPasting, setIsSmartPasting] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [wordCount, setWordCount] = useState(0);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [matches, setMatches] = useState<Match[]>([]);
  const [matchIndex, setMatchIndex] = useState(0);
  const findInputRef = useRef<HTMLInputElement>(null);
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
      StarterKit,
      Typography,
      Placeholder.configure({ placeholder: 'Scrivi qualcosa...' }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
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
              {
                role: 'system',
                content: `Sei un esperto di formattazione Markdown. L'utente ha incollato del testo grezzo.
Il tuo unico compito è restituire lo STESSO testo, ma pulito e formattato in Markdown (titoli, liste, grassetti, codice).
Non aggiungere saluti o commenti. Restituisci SOLO il Markdown finale.`,
              },
              { role: 'user', content: text },
            ]);
            if (mountedRef.current) editor?.chain().focus().insertContent(result).run();
          } catch {
            if (mountedRef.current) editor?.chain().focus().insertContent(text).run();
          } finally {
            if (mountedRef.current) setIsSmartPasting(false);
          }
        })();
        return true;
      },
    },
  });

  // --- Find bar logic ---
  const openFind = useCallback(() => {
    setFindOpen(true);
    setTimeout(() => findInputRef.current?.focus(), 0);
  }, []);

  const closeFind = useCallback(() => {
    setFindOpen(false);
    setFindQuery('');
    setMatches([]);
    setMatchIndex(0);
    editor?.commands.focus();
  }, [editor]);

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

  // Cmd+S and Cmd+F
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's' && editor) {
        e.preventDefault();
        void flushSave(editor.getHTML());
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        openFind();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [editor, flushSave, openFind]);

  useEffect(() => { onEditorReady(editor ?? null); }, [editor, onEditorReady]);

  useEffect(() => {
    if (editor && activeNoteName !== prevNoteNameRef.current) {
      prevNoteNameRef.current = activeNoteName;
      editor.commands.setContent(activeNoteContent);
      updateWordCount(editor.getText());
      setFindOpen(false);
      setFindQuery('');
      setMatches([]);
    }
  }, [activeNoteName, activeNoteContent, editor, updateWordCount]);

  if (!activeNoteName) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-400 mt-32">
        <FileText size={48} className="mb-4 opacity-20" />
        <p>Seleziona una nota o creane una nuova</p>
      </div>
    );
  }

  return (
    <>
      {/* AI Actions bar */}
      {showAiBar && editor && <AiActionsBar editor={editor} />}

      {/* Find bar */}
      {findOpen && (
        <div className="flex items-center gap-2 mb-3 px-2 py-1.5 bg-gray-50 border border-gray-200 rounded-lg">
          <Search size={13} className="text-gray-400 shrink-0" />
          <input
            ref={findInputRef}
            type="text"
            value={findQuery}
            onChange={e => { setFindQuery(e.target.value); runFind(e.target.value); }}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); goToMatch(e.shiftKey ? matchIndex - 1 : matchIndex + 1); }
              if (e.key === 'Escape') closeFind();
            }}
            placeholder="Cerca nel documento..."
            className="flex-1 text-sm bg-transparent outline-none text-gray-700 placeholder-gray-400"
          />
          {findQuery && (
            <span className="text-xs text-gray-400 shrink-0">
              {matches.length > 0 ? `${matchIndex + 1}/${matches.length}` : '0 risultati'}
            </span>
          )}
          <button onClick={() => goToMatch(matchIndex - 1)} disabled={matches.length === 0}
            className="p-0.5 rounded hover:bg-gray-200 text-gray-500 disabled:opacity-30" aria-label="Precedente">
            <ChevronUp size={14} />
          </button>
          <button onClick={() => goToMatch(matchIndex + 1)} disabled={matches.length === 0}
            className="p-0.5 rounded hover:bg-gray-200 text-gray-500 disabled:opacity-30" aria-label="Successivo">
            <ChevronDown size={14} />
          </button>
          <button onClick={closeFind} className="p-0.5 rounded hover:bg-gray-200 text-gray-500" aria-label="Chiudi ricerca">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Formatting toolbar */}
      {showToolbar && editor && (
        <div className="flex items-center gap-0.5 mb-4 pb-3 border-b border-gray-100 flex-wrap">
          <button onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Titolo 1 (Ctrl+Alt+1)"
            className={`p-1.5 rounded hover:bg-gray-100 ${editor.isActive('heading', { level: 1 }) ? 'bg-gray-200 text-black' : 'text-gray-500'}`}>
            <Heading1 size={15} />
          </button>
          <button onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Titolo 2 (Ctrl+Alt+2)"
            className={`p-1.5 rounded hover:bg-gray-100 ${editor.isActive('heading', { level: 2 }) ? 'bg-gray-200 text-black' : 'text-gray-500'}`}>
            <Heading2 size={15} />
          </button>
          <button onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Titolo 3 (Ctrl+Alt+3)"
            className={`p-1.5 rounded hover:bg-gray-100 ${editor.isActive('heading', { level: 3 }) ? 'bg-gray-200 text-black' : 'text-gray-500'}`}>
            <Heading3 size={15} />
          </button>
          <div className="w-px h-4 bg-gray-200 mx-1" />
          <button onClick={() => editor.chain().focus().toggleBold().run()} title="Grassetto (Ctrl+B)"
            className={`p-1.5 rounded hover:bg-gray-100 ${editor.isActive('bold') ? 'bg-gray-200 text-black' : 'text-gray-500'}`}>
            <Bold size={15} />
          </button>
          <button onClick={() => editor.chain().focus().toggleItalic().run()} title="Corsivo (Ctrl+I)"
            className={`p-1.5 rounded hover:bg-gray-100 ${editor.isActive('italic') ? 'bg-gray-200 text-black' : 'text-gray-500'}`}>
            <Italic size={15} />
          </button>
          <button onClick={() => editor.chain().focus().toggleStrike().run()} title="Barrato"
            className={`p-1.5 rounded hover:bg-gray-100 ${editor.isActive('strike') ? 'bg-gray-200 text-black' : 'text-gray-500'}`}>
            <Strikethrough size={15} />
          </button>
          <button onClick={() => editor.chain().focus().toggleCode().run()} title="Codice inline"
            className={`p-1.5 rounded hover:bg-gray-100 ${editor.isActive('code') ? 'bg-gray-200 text-black' : 'text-gray-500'}`}>
            <Code size={15} />
          </button>
          <div className="w-px h-4 bg-gray-200 mx-1" />
          <button
            onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
            title="Inserisci tabella"
            className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-indigo-600"
          >
            <TableIcon size={15} />
          </button>
        </div>
      )}

      {/* BubbleMenu for quick inline formatting on selection */}
      {editor && (
        // @ts-expect-error tippyOptions valid but untyped
        <BubbleMenu editor={editor} tippyOptions={{ duration: 100 }} className="flex space-x-1 bg-white border border-gray-200 shadow-lg rounded-lg p-1">
          <button onClick={() => editor.chain().focus().toggleBold().run()}
            className={`p-1.5 rounded hover:bg-gray-100 ${editor.isActive('bold') ? 'bg-gray-200 text-black' : 'text-gray-600'}`}>
            <Bold size={14} />
          </button>
          <button onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`p-1.5 rounded hover:bg-gray-100 ${editor.isActive('italic') ? 'bg-gray-200 text-black' : 'text-gray-600'}`}>
            <Italic size={14} />
          </button>
          <button onClick={() => editor.chain().focus().toggleStrike().run()}
            className={`p-1.5 rounded hover:bg-gray-100 ${editor.isActive('strike') ? 'bg-gray-200 text-black' : 'text-gray-600'}`}>
            <Strikethrough size={14} />
          </button>
          <button onClick={() => editor.chain().focus().toggleCode().run()}
            className={`p-1.5 rounded hover:bg-gray-100 ${editor.isActive('code') ? 'bg-gray-200 text-black' : 'text-gray-600'}`}>
            <Code size={14} />
          </button>
        </BubbleMenu>
      )}

      <EditorContent editor={editor} />

      {isSmartPasting && (
        <div className="absolute top-4 right-4 bg-indigo-500 text-white text-xs px-3 py-1.5 rounded-full flex items-center space-x-2 shadow-lg animate-pulse">
          <Bot size={14} />
          <span>Smart Paste...</span>
        </div>
      )}

      {/* Status bar: word count + save indicator */}
      <div className="absolute bottom-4 right-4 flex items-center gap-3">
        {wordCount > 0 && (
          <span className="text-xs text-gray-300">{wordCount} {wordCount === 1 ? 'parola' : 'parole'}</span>
        )}
        {!isSmartPasting && saveStatus !== 'idle' && (
          <div className={`text-xs px-2.5 py-1 rounded-full flex items-center gap-1.5 ${
            saveStatus === 'saving' ? 'text-gray-400' : 'text-emerald-600'
          }`}>
            {saveStatus === 'saving' ? <span>Salvando...</span> : <><CheckCheck size={13} /><span>Salvato</span></>}
          </div>
        )}
      </div>
    </>
  );
}
