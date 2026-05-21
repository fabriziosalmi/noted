import { useState, useRef, useEffect, useMemo } from 'react';
import { Bot, Loader2, Database, RotateCcw, ShieldAlert } from 'lucide-react';
import { marked } from 'marked';
import { askLLM, AbortedError, describeLlmError } from '../lib/llm';
import { findRelevantNotesHybrid, type NoteChunk, type RetrievalScoredNote } from '../lib/noteSearch';
import { useI18n } from '../lib/i18n';
import { useStore } from '../store/useStore';
import { maskPii } from '../lib/piiMasker';

marked.setOptions({ breaks: true, gfm: true });

// Minimal renderer-side HTML sanitizer for LLM output rendered as markdown.
// Strips dangerous tags/attributes that marked would otherwise pass through verbatim.
function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '')
    .replace(/javascript\s*:/gi, '');
}

function renderMarkdown(src: string): string {
  return sanitizeHtml(marked.parse(src, { async: false }) as string);
}

interface AiChatProps {
  getEditorText: () => string;
  noteChunks?: NoteChunk[]; // all notes for RAG
}

interface ChatMessage { role: 'assistant' | 'user'; content: string }

function ChatBubble({ role, content }: ChatMessage) {
  const html = useMemo(() => role === 'assistant' ? renderMarkdown(content) : null, [role, content]);
  const base = 'p-3 rounded-lg shadow-sm border';
  if (role === 'assistant') {
    return (
      <div
        className={`${base} ai-chat-md bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700`}
        dangerouslySetInnerHTML={{ __html: html ?? '' }}
      />
    );
  }
  return (
    <div className={`${base} bg-[var(--accent-light)] text-[var(--accent)] border-[var(--accent-mid)] self-end whitespace-pre-wrap`}>
      {content}
    </div>
  );
}

export function AiChat({ getEditorText, noteChunks = [] }: AiChatProps) {
  const { t } = useI18n();
  const lang = useStore(s => s.settings.language ?? 'en');
  const piiMasking = useStore(s => s.settings.piiMasking ?? false);
  const ragTopK = useStore(s => Math.max(1, Math.min(10, s.settings.ragTopK ?? 3)));
  const ragContextChars = useStore(s => Math.max(1500, Math.min(30000, s.settings.ragContextChars ?? 8000)));
  const ragDebug = useStore(s => s.settings.ragDebug ?? false);
  const embeddingsEnabled = useStore(s => s.settings.embeddingsEnabled ?? false);
  const embeddingProvider = useStore(s => s.settings.embeddingProvider ?? 'none');
  const embeddingModel = useStore(s => s.settings.embeddingModel ?? '');
  const lmStudioUrl = useStore(s => s.settings.lmStudioUrl ?? '');
  const llmApiKey = useStore(s => s.settings.llmApiKey ?? '');
  const [piiNotice, setPiiNotice] = useState<number>(0);
  // displayHistory includes the greeting bubble shown in the UI
  const [displayHistory, setDisplayHistory] = useState<ChatMessage[]>([
    { role: 'assistant', content: t('aiGreeting') },
  ]);
  // llmHistory contains only real user/assistant turns sent to the LLM — no greeting
  const [llmHistory, setLlmHistory] = useState<ChatMessage[]>([]);
  const [aiInput, setAiInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [lastRetrievalMode, setLastRetrievalMode] = useState<'lexical' | 'hybrid'>('lexical');
  const [lastRetrievalScores, setLastRetrievalScores] = useState<RetrievalScoredNote[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Abort any in-flight request when the component unmounts so it doesn't
  // resolve into a stale setState after navigation.
  useEffect(() => () => abortRef.current?.abort(), []);

  const handleClear = () => {
    abortRef.current?.abort();
    setDisplayHistory([{ role: 'assistant', content: t('aiGreeting') }]);
    setLlmHistory([]);
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [displayHistory, isLoading]);

  const handleSubmit = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key !== 'Enter' || !aiInput.trim() || isLoading) return;

    const rawUserMessage = aiInput.trim();
    setAiInput('');

    let userMessage = rawUserMessage;
    let piiCount = 0;
    if (piiMasking) {
      const r = maskPii(rawUserMessage);
      userMessage = r.maskedText;
      piiCount += r.count;
    }

    const userTurn: ChatMessage = { role: 'user', content: rawUserMessage };
    const llmUserTurn: ChatMessage = { role: 'user', content: userMessage };
    // Cap history sent to the LLM at the last MAX_HISTORY_TURNS turns to avoid
    // unbounded context-window growth (long chats would otherwise eventually
    // 400-out on Anthropic's 200k limit, silently).
    const MAX_HISTORY_TURNS = 10;
    const nextLlmHistory: ChatMessage[] = [...llmHistory, llmUserTurn];
    const trimmedHistory = nextLlmHistory.slice(-MAX_HISTORY_TURNS * 2); // user+assistant pairs

    setDisplayHistory(prev => [...prev, userTurn]);
    setLlmHistory(nextLlmHistory);
    setIsLoading(true);

    // Cancel any prior in-flight request before starting a new one.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const MAX_CONTEXT_CHARS = ragContextChars;
      let rawContext = getEditorText();
      if (piiMasking) {
        const r = maskPii(rawContext);
        rawContext = r.maskedText;
        piiCount += r.count;
      }
      const isTruncated = rawContext.length > MAX_CONTEXT_CHARS;
      // Trim back to the last paragraph break before the cap so we don't split
      // a wikilink, markdown link, or code fence in half. Falls back to last
      // newline, then to the hard char cap if nothing better is found.
      const truncatedSlice = (() => {
        if (!isTruncated) return rawContext;
        const hardCut = rawContext.slice(0, MAX_CONTEXT_CHARS);
        const lastPara = hardCut.lastIndexOf('\n\n');
        if (lastPara > MAX_CONTEXT_CHARS * 0.6) return hardCut.slice(0, lastPara);
        const lastLine = hardCut.lastIndexOf('\n');
        if (lastLine > MAX_CONTEXT_CHARS * 0.6) return hardCut.slice(0, lastLine);
        return hardCut;
      })();
      const textContext = isTruncated
        ? truncatedSlice + (lang === 'it' ? '\n\n[...documento troncato per lunghezza...]' : '\n\n[...document truncated for length...]')
        : rawContext;
      if (isTruncated) {
        setDisplayHistory(prev => [...prev, { role: 'assistant', content: t('contextTruncated') }]);
      }
      if (piiMasking && piiCount > 0) setPiiNotice(piiCount);

      // RAG: find related notes from the full vault
      const retrieval = noteChunks.length > 0
        ? await findRelevantNotesHybrid(userMessage, noteChunks, ragTopK, {
          enabled: embeddingsEnabled,
          provider: embeddingProvider,
          model: embeddingModel,
          apiKey: llmApiKey,
          lmStudioUrl,
        })
        : { notes: [], mode: 'lexical' as const, scored: [] };
      const relevant = retrieval.notes;
      setLastRetrievalMode(retrieval.mode);
      setLastRetrievalScores(retrieval.scored);
      const ragContext = relevant.length > 0
        ? relevant.map(n => `### ${n.name.replace('.md', '')}\n${n.text.slice(0, 1500)}`).join('\n\n---\n\n')
        : '';

      const activeNoteLabel = lang === 'it' ? 'Nota attiva' : 'Active note';
      const relatedLabel = lang === 'it' ? 'Note correlate dal vault' : 'Related notes from vault';
      const systemInstructions = lang === 'it'
        ? 'Sei un assistente integrato in un editor di note Markdown. Hai accesso al contenuto delle note dell\'utente.\n\nRispondi in modo conciso e utile. Se citi una nota specifica, indica il titolo.'
        : 'You are an assistant integrated into a Markdown note editor. You have access to the user\'s note content.\n\nReply concisely and helpfully. If you cite a specific note, mention its title.';

      const response = await askLLM([
        {
          role: 'system',
          content: `${systemInstructions}

${textContext ? `${activeNoteLabel}:\n"""\n${textContext}\n"""` : ''}
${ragContext ? `\n${relatedLabel}:\n"""\n${ragContext}\n"""` : ''}`,
        },
        ...trimmedHistory,
      ], { signal: controller.signal });
      const assistantTurn: ChatMessage = { role: 'assistant', content: response };
      setDisplayHistory(prev => [...prev, assistantTurn]);
      setLlmHistory(prev => [...prev, assistantTurn]);
    } catch (error: unknown) {
      if (error instanceof AbortedError) return; // user cancelled / superseded
      const friendly = describeLlmError(error, lang === 'it' ? 'it' : 'en');
      setDisplayHistory(prev => [
        ...prev,
        { role: 'assistant', content: t('aiError').replace('{msg}', friendly) },
      ]);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setIsLoading(false);
    }
  };

  return (
    <>
      <div className="p-3 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider flex items-center justify-between border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center space-x-2">
          <Bot size={14} />
          <span>{t('aiAssistant')}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {noteChunks.length > 0 && (
            <span className="flex items-center gap-1 text-[10px] font-normal normal-case tracking-normal" style={{ color: 'var(--accent)' }} title={`${t('ragActive').replace('{n}', String(noteChunks.length))} · ${embeddingsEnabled ? 'hybrid' : 'lexical'}`}>
              <Database size={10} />
              {t('ragActive').replace('{n}', String(noteChunks.length))}
            </span>
          )}
          <button
            onClick={handleClear}
            aria-label={t('clearChat')}
            title={t('clearChat')}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <RotateCcw size={11} />
          </button>
        </div>
      </div>

      {piiMasking && (
        <div className="px-3 py-1.5 flex items-center gap-1.5 text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-100 dark:border-amber-800">
          <ShieldAlert size={10} />
          {t('piiMasking')}
          {piiNotice > 0 && <span className="ml-auto font-medium">{t('piiMasked').replace('{n}', String(piiNotice))}</span>}
        </div>
      )}

      {ragDebug && (
        <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/70">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            RAG Debug · {lastRetrievalMode}
          </p>
          <div className="mt-1 space-y-1">
            {lastRetrievalScores.slice(0, 3).map((row) => (
              <div key={row.note.name} className="text-[10px] text-gray-500 dark:text-gray-400 flex items-center justify-between gap-2">
                <span className="truncate">{row.note.name.replace('.md', '')}</span>
                <span className="shrink-0">
                  L {row.lexical.toFixed(2)} · D {row.dense.toFixed(2)} · C {row.combined.toFixed(2)}
                </span>
              </div>
            ))}
            {lastRetrievalScores.length === 0 && (
              <p className="text-[10px] text-gray-400 dark:text-gray-500">No retrieval scores yet.</p>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 p-4 text-sm text-gray-600 dark:text-gray-300 overflow-y-auto flex flex-col space-y-3 scroll-fade-y">
        {displayHistory.map((msg, idx) => (
          <ChatBubble key={idx} role={msg.role} content={msg.content} />
        ))}
        {isLoading && (
          <div className="p-3 rounded-lg shadow-sm border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 flex items-center space-x-2 text-gray-400 dark:text-gray-500 self-start">
            <Loader2 size={14} className="animate-spin" />
            <span>{t('thinking')}</span>
          </div>
        )}
        <div ref={messagesEndRef} aria-hidden="true" />
      </div>

      <div className="p-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <input
          type="text"
          value={aiInput}
          onChange={e => setAiInput(e.target.value)}
          onKeyDown={handleSubmit}
          disabled={isLoading}
          placeholder={isLoading ? t('waitingResponse') : t('askSomething')}
          className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded text-sm focus:outline-none focus:border-[var(--accent)] bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-500 disabled:opacity-50"
        />
      </div>
    </>
  );
}
