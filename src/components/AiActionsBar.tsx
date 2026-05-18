import { useState, useCallback } from 'react';
import type { Editor } from '@tiptap/react';
import {
  ChevronRight, Maximize2, Minimize2, Wand2,
  FileText, Eye, Zap, HelpCircle, Loader2,
} from 'lucide-react';
import { askLLM } from '../lib/llm';
import { Tooltip } from './Tooltip';

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
    label: 'Continue',
    icon: ChevronRight,
    mode: 'append',
    system: 'You are a writing assistant. Continue this text naturally, maintaining its style and tone. Return ONLY the continuation in the same language as the original. Markdown format.',
  },
  {
    id: 'expand',
    label: 'Expand',
    icon: Maximize2,
    mode: 'replace',
    system: 'Expand this text with more detail, examples and context, maintaining the same style and tone. Return ONLY the expanded text in the same language. Markdown format.',
  },
  {
    id: 'shorten',
    label: 'Shorten',
    icon: Minimize2,
    mode: 'replace',
    system: 'Shorten this text while keeping all key points. Reduce length by 40-50%, eliminate redundancy. Return ONLY the shortened text in the same language. Markdown format.',
  },
  {
    id: 'refine',
    label: 'Refine',
    icon: Wand2,
    mode: 'replace',
    system: 'Improve this text: fix grammar, improve flow, enhance clarity and style. Return ONLY the improved text in the same language. Markdown format.',
  },
];

const ANALYSIS_ACTIONS: Action[] = [
  {
    id: 'summarize',
    label: 'Summarize',
    icon: FileText,
    mode: 'append',
    heading: '## Summary',
    system: 'Summarize this document concisely and structurally in the same language as the text. Return ONLY the summary. Markdown format.',
  },
  {
    id: 'review',
    label: 'Review',
    icon: Eye,
    mode: 'append',
    heading: '## Review',
    system: 'Analyze this text and provide structured feedback in the same language: strengths, areas for improvement, specific suggestions. Markdown format.',
  },
  {
    id: 'devil',
    label: "Devil's Advocate",
    icon: Zap,
    mode: 'append',
    heading: "## Devil's Advocate",
    system: "Play devil's advocate on this text in the same language: present strong counterarguments, objections, and alternative perspectives. Markdown format.",
  },
  {
    id: 'qa',
    label: 'Q&A',
    icon: HelpCircle,
    mode: 'append',
    heading: '## Q&A',
    system: 'Generate a list of questions and answers from this text in the same language to deepen understanding of key concepts. Markdown format.',
  },
];

function mdToHtml(md: string): string {
  return md
    .split('\n\n')
    .map(block => {
      const trimmed = block.trim();
      if (!trimmed) return '';

      // Headings (handle multiple in same block)
      if (/^#{1,6} /m.test(trimmed)) {
        return trimmed
          .replace(/^###### (.+)$/mg, '<h6>$1</h6>')
          .replace(/^##### (.+)$/mg, '<h5>$1</h5>')
          .replace(/^#### (.+)$/mg, '<h4>$1</h4>')
          .replace(/^### (.+)$/mg, '<h3>$1</h3>')
          .replace(/^## (.+)$/mg, '<h2>$1</h2>')
          .replace(/^# (.+)$/mg, '<h1>$1</h1>');
      }

      // Blockquotes
      if (/^> /.test(trimmed)) {
        const content = trimmed.replace(/^> ?/gm, '').trim();
        return `<blockquote><p>${inlineFormat(content)}</p></blockquote>`;
      }

      // Tables (detect by | at start)
      if (/^\|/.test(trimmed)) {
        const rows = trimmed.split('\n').filter(l => l.trim() && !/^\s*\|[-: |]+\|\s*$/.test(l));
        const html = rows.map((line, i) => {
          const cells = line.split('|').slice(1, -1).map(c => c.trim());
          const tag = i === 0 ? 'th' : 'td';
          return `<tr>${cells.map(c => `<${tag}>${inlineFormat(c)}</${tag}>`).join('')}</tr>`;
        }).join('');
        return `<table>${html}</table>`;
      }

      // Unordered lists
      if (/^[-*] /.test(trimmed)) {
        const items = trimmed.split('\n')
          .filter(l => /^[-*] /.test(l))
          .map(l => `<li>${inlineFormat(l.replace(/^[-*] /, ''))}</li>`)
          .join('');
        return `<ul>${items}</ul>`;
      }

      // Ordered lists
      if (/^\d+\. /.test(trimmed)) {
        const items = trimmed.split('\n')
          .filter(l => /^\d+\. /.test(l))
          .map(l => `<li>${inlineFormat(l.replace(/^\d+\. /, ''))}</li>`)
          .join('');
        return `<ol>${items}</ol>`;
      }

      // Code blocks
      if (trimmed.startsWith('```')) {
        const code = trimmed.replace(/^```\w*\n?/, '').replace(/```$/, '');
        return `<pre><code>${code}</code></pre>`;
      }

      // Horizontal rule
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        return '<hr>';
      }

      return `<p>${inlineFormat(trimmed.replace(/\n/g, '<br>'))}</p>`;
    })
    .filter(Boolean)
    .join('');
}

function inlineFormat(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>');
}

interface AiActionsBarProps {
  editor: Editor;
  onError?: (msg: string) => void;
}

export function AiActionsBar({ editor, onError }: AiActionsBarProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const { from, to } = editor.state.selection;
  const hasSelection = from !== to;

  const runAction = useCallback(async (action: Action) => {
    if (activeId) return;

    const { from, to } = editor.state.selection;
    const hasSelection = from !== to;
    const selectedText = hasSelection
      ? editor.state.doc.textBetween(from, to, '\n')
      : editor.getText();

    if (!selectedText.trim()) {
      onError?.('Scrivi qualcosa nella nota prima di usare le azioni AI.');
      return;
    }

    setActiveId(action.id);
    try {
      const result = await askLLM([
        { role: 'system', content: action.system },
        { role: 'user', content: selectedText },
      ]);

      const html = mdToHtml(result);

      if (action.mode === 'replace') {
        if (hasSelection) {
          editor.chain().focus().deleteSelection().insertContent(html).run();
        } else {
          editor.commands.setContent(html);
        }
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
      <Tooltip key={action.id} label={action.label} side="bottom">
        <button
          onClick={() => void runAction(action)}
          disabled={isDisabled}
          aria-label={action.label}
          className={`flex items-center py-1 px-1.5 rounded transition-colors duration-150
            ${isActive
              ? 'bg-[var(--accent-light)] text-[var(--accent)]'
              : isDisabled
                ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-[var(--accent)]'
            }`}
        >
          {isActive
            ? <Loader2 size={13} className="animate-spin" />
            : <Icon size={13} />
          }
        </button>
      </Tooltip>
    );
  };

  return (
    <div className="flex items-center gap-0.5 mb-3 pb-3 border-b border-[var(--accent-light)] flex-wrap">
      <span className="text-[10px] font-semibold uppercase tracking-wider mr-1 shrink-0" style={{ color: 'var(--accent)', opacity: 0.5 }}>AI</span>
      {ACTIONS.map(renderBtn)}
      <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-1 shrink-0" />
      {ANALYSIS_ACTIONS.map(renderBtn)}
      {hasSelection && (
        <span className="ml-auto text-[10px] italic shrink-0" style={{ color: 'var(--accent)', opacity: 0.7 }}>
          selection active
        </span>
      )}
    </div>
  );
}
