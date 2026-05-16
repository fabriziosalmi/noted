import { useState, useCallback } from 'react';
import type { Editor } from '@tiptap/react';
import {
  ChevronRight, Maximize2, Minimize2, Wand2,
  FileText, Eye, Zap, HelpCircle, Loader2,
} from 'lucide-react';
import { askLLM } from '../lib/llm';

interface Action {
  id: string;
  label: string;
  icon: React.ElementType;
  mode: 'append' | 'replace';
  system: string;
  heading?: string;
}

const ACTIONS: Action[] = [
  {
    id: 'continue',
    label: 'Continua',
    icon: ChevronRight,
    mode: 'append',
    system: `Sei un assistente di scrittura. L'utente ti mostra il suo testo. Continua la scrittura in modo naturale, mantenendo stile e tono. Restituisci SOLO il testo continuato, senza ripetere quello esistente. Formato Markdown.`,
  },
  {
    id: 'expand',
    label: 'Espandi',
    icon: Maximize2,
    mode: 'replace',
    system: `Espandi il testo seguente aggiungendo dettagli, esempi e contesto, mantenendo lo stesso tono e struttura. Restituisci SOLO il testo espanso in Markdown.`,
  },
  {
    id: 'shorten',
    label: 'Accorcia',
    icon: Minimize2,
    mode: 'replace',
    system: `Accorcia il testo seguente mantenendo tutti i punti chiave. Elimina ridondanze e riduci la lunghezza del 40-50%. Restituisci SOLO il testo accorciato in Markdown.`,
  },
  {
    id: 'refine',
    label: 'Raffina',
    icon: Wand2,
    mode: 'replace',
    system: `Migliora il testo seguente: correggi grammatica, migliora la fluidità, raffina lo stile, rendi la scrittura più chiara e professionale. Restituisci SOLO il testo migliorato in Markdown.`,
  },
];

const ANALYSIS_ACTIONS: Action[] = [
  {
    id: 'summarize',
    label: 'Riassumi',
    icon: FileText,
    mode: 'append',
    heading: '## Sommario',
    system: `Riassumi il seguente documento in modo conciso e strutturato. Restituisci SOLO il riassunto in Markdown.`,
  },
  {
    id: 'review',
    label: 'Revisiona',
    icon: Eye,
    mode: 'append',
    heading: '## Revisione',
    system: `Analizza il seguente testo e fornisci un feedback critico strutturato: punti di forza, aree di miglioramento, suggerimenti specifici. Restituisci in Markdown.`,
  },
  {
    id: 'devil',
    label: "Devil's Advocate",
    icon: Zap,
    mode: 'append',
    heading: "## Devil's Advocate",
    system: `Fai il devil's advocate del seguente testo: presenta controargomenti solidi, obiezioni, prospettive alternative e potenziali criticità. Restituisci in Markdown.`,
  },
  {
    id: 'qa',
    label: 'Q&A',
    icon: HelpCircle,
    mode: 'append',
    heading: '## Domande & Risposte',
    system: `Dal seguente testo genera una lista di domande e risposte utili per approfondire e testare la comprensione dei concetti chiave. Restituisci in Markdown.`,
  },
];

function mdToHtml(md: string): string {
  return md
    .split('\n\n')
    .map(block => {
      if (/^#{1,6} /.test(block)) {
        return block
          .replace(/^###### (.+)$/m, '<h6>$1</h6>')
          .replace(/^##### (.+)$/m, '<h5>$1</h5>')
          .replace(/^#### (.+)$/m, '<h4>$1</h4>')
          .replace(/^### (.+)$/m, '<h3>$1</h3>')
          .replace(/^## (.+)$/m, '<h2>$1</h2>')
          .replace(/^# (.+)$/m, '<h1>$1</h1>');
      }
      if (/^[-*] /.test(block)) {
        const items = block.split('\n').filter(l => /^[-*] /.test(l))
          .map(l => `<li>${inlineFormat(l.replace(/^[-*] /, ''))}</li>`).join('');
        return `<ul>${items}</ul>`;
      }
      if (/^\d+\. /.test(block)) {
        const items = block.split('\n').filter(l => /^\d+\. /.test(l))
          .map(l => `<li>${inlineFormat(l.replace(/^\d+\. /, ''))}</li>`).join('');
        return `<ol>${items}</ol>`;
      }
      if (block.startsWith('```')) {
        const code = block.replace(/^```\w*\n?/, '').replace(/```$/, '');
        return `<pre><code>${code}</code></pre>`;
      }
      return `<p>${inlineFormat(block.replace(/\n/g, '<br>'))}</p>`;
    })
    .join('');
}

function inlineFormat(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

interface AiActionsBarProps {
  editor: Editor;
  onError?: (msg: string) => void;
}

export function AiActionsBar({ editor, onError }: AiActionsBarProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const runAction = useCallback(async (action: Action) => {
    if (activeId) return;
    const text = editor.getText();
    if (!text.trim()) {
      onError?.('Scrivi qualcosa nella nota prima di usare le azioni AI.');
      return;
    }

    setActiveId(action.id);
    try {
      const result = await askLLM([
        { role: 'system', content: action.system },
        { role: 'user', content: text },
      ]);

      const html = mdToHtml(result);

      if (action.mode === 'replace') {
        editor.commands.setContent(html);
      } else {
        const headingHtml = action.heading ? `<hr><h2>${action.heading.replace(/^##\s*/, '')}</h2>` : '<hr>';
        editor.commands.focus('end');
        editor.commands.insertContent(headingHtml + html);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onError?.(msg);
    } finally {
      setActiveId(null);
    }
  }, [activeId, editor, onError]);

  const renderBtn = (action: Action) => {
    const isActive = activeId === action.id;
    const isDisabled = !!activeId;
    const Icon = action.icon;
    return (
      <button
        key={action.id}
        onClick={() => void runAction(action)}
        disabled={isDisabled}
        title={action.label}
        className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors whitespace-nowrap
          ${isActive
            ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300'
            : isDisabled
              ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
              : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-indigo-600 dark:hover:text-indigo-400'
          }`}
      >
        {isActive
          ? <Loader2 size={12} className="animate-spin shrink-0" />
          : <Icon size={12} className="shrink-0" />
        }
        <span>{action.label}</span>
      </button>
    );
  };

  return (
    <div className="flex items-center gap-0.5 mb-3 pb-3 border-b border-indigo-50 dark:border-indigo-900/40 flex-wrap">
      <span className="text-[10px] font-semibold text-indigo-300 dark:text-indigo-600 uppercase tracking-wider mr-1 shrink-0">AI</span>
      {ACTIONS.map(renderBtn)}
      <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-1 shrink-0" />
      {ANALYSIS_ACTIONS.map(renderBtn)}
    </div>
  );
}
