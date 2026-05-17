import { useState, useEffect, useRef, useCallback } from 'react';
import type { Editor } from '@tiptap/react';
import { askLLM } from '../lib/llm';
import { Wand2, AlignLeft, List, Languages, Minimize2, Pencil, Loader2 } from 'lucide-react';

interface SlashCommandsProps {
  editor: Editor;
  onAiError?: (msg: string) => void;
}

interface Command {
  id: string;
  icon: React.ReactNode;
  label: string;
  description: string;
  prompt: (context: string) => string;
}

const COMMANDS: Command[] = [
  {
    id: 'continue',
    icon: <Wand2 size={14} />,
    label: 'Continua',
    description: 'Continua a scrivere dal punto corrente',
    prompt: ctx => `Continua questo testo in modo naturale, stesso stile e lingua, 2-4 frasi. NON ripetere il testo esistente, scrivi solo la continuazione:\n\n${ctx}`,
  },
  {
    id: 'expand',
    icon: <AlignLeft size={14} />,
    label: 'Espandi',
    description: 'Elabora e approfondisce il paragrafo corrente',
    prompt: ctx => `Espandi e approfondisci questo testo aggiungendo dettagli, esempi e spiegazioni. Mantieni lo stesso stile. Restituisci SOLO il testo espanso:\n\n${ctx}`,
  },
  {
    id: 'summarize',
    icon: <Minimize2 size={14} />,
    label: 'Riassumi',
    description: 'Sintetizza la nota in punti chiave',
    prompt: ctx => `Crea un riassunto conciso in 3-5 punti chiave di questo testo. Usa bullet points. Rispondi nella stessa lingua:\n\n${ctx}`,
  },
  {
    id: 'improve',
    icon: <Pencil size={14} />,
    label: 'Migliora',
    description: 'Migliora chiarezza e stile del testo',
    prompt: ctx => `Migliora la chiarezza, scorrevolezza e stile di questo testo mantenendo il significato originale. Restituisci SOLO il testo migliorato:\n\n${ctx}`,
  },
  {
    id: 'bullets',
    icon: <List size={14} />,
    label: 'Converti in lista',
    description: 'Trasforma in elenco puntato',
    prompt: ctx => `Converti questo testo in un elenco puntato chiaro e conciso. Restituisci SOLO i bullet points:\n\n${ctx}`,
  },
  {
    id: 'translate',
    icon: <Languages size={14} />,
    label: 'Traduci',
    description: 'Traduci in inglese (o in italiano se già in inglese)',
    prompt: ctx => `Traduci questo testo. Se è in italiano → inglese, se è in inglese → italiano. Restituisci SOLO la traduzione:\n\n${ctx}`,
  },
];

export function SlashCommands({ editor, onAiError }: SlashCommandsProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const triggerFromRef = useRef<number | null>(null);

  const filtered = COMMANDS.filter(c =>
    !query || c.label.toLowerCase().includes(query.toLowerCase()) || c.id.includes(query.toLowerCase())
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

    // Delete the /command text
    const { from } = editor.state.selection;
    const triggerFrom = triggerFromRef.current ?? from;
    editor.chain().focus().deleteRange({ from: triggerFrom, to: from }).run();

    // Get context: current paragraph or last 800 chars
    const { state } = editor;
    const curFrom = state.selection.from;
    const context = state.doc.textBetween(Math.max(0, curFrom - 800), curFrom, '\n').trim()
      || editor.getText().slice(-800);

    try {
      const result = await askLLM([
        { role: 'system', content: 'Sei un assistente di scrittura professionale. Segui le istruzioni esattamente.' },
        { role: 'user', content: cmd.prompt(context) },
      ]);
      // Insert with a newline if needed
      const needsNewline = cmd.id === 'summarize' || cmd.id === 'bullets';
      editor.chain().focus().insertContent(needsNewline ? `\n${result}` : result).run();
    } catch (err) {
      onAiError?.((err as Error).message);
    } finally {
      setRunning(null);
    }
  }, [editor, onAiError]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
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
          {COMMANDS.find(c => c.id === running)?.label}...
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
        Azioni AI
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
            <div className="text-sm font-medium leading-tight">{cmd.label}</div>
            <div className="text-xs opacity-60 mt-0.5">{cmd.description}</div>
          </div>
        </button>
      ))}
      <div className="px-3 py-1.5 border-t border-gray-100 dark:border-gray-800 mt-1 flex gap-3 text-[10px] text-gray-400">
        <span>↑↓ naviga</span><span>↵ esegui</span><span>esc chiudi</span>
      </div>
    </div>
  );
}
