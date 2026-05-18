import { useState, useRef, useEffect } from 'react';
import { Bot, Loader2, Database } from 'lucide-react';
import { askLLM } from '../lib/llm';
import { findRelevantNotes, type NoteChunk } from '../lib/noteSearch';
import { useI18n } from '../lib/i18n';

interface AiChatProps {
  getEditorText: () => string;
  noteChunks?: NoteChunk[]; // all notes for RAG
}

interface ChatMessage { role: 'assistant' | 'user'; content: string }

export function AiChat({ getEditorText, noteChunks = [] }: AiChatProps) {
  const { t } = useI18n();
  // displayHistory includes the greeting bubble shown in the UI
  const [displayHistory, setDisplayHistory] = useState<ChatMessage[]>([
    { role: 'assistant', content: t('aiGreeting') },
  ]);
  // llmHistory contains only real user/assistant turns sent to the LLM — no greeting
  const [llmHistory, setLlmHistory] = useState<ChatMessage[]>([]);
  const [aiInput, setAiInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [displayHistory, isLoading]);

  const handleSubmit = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !aiInput.trim() || isLoading) return;

    const userMessage = aiInput.trim();
    setAiInput('');

    const userTurn: ChatMessage = { role: 'user', content: userMessage };
    const nextLlmHistory: ChatMessage[] = [...llmHistory, userTurn];

    setDisplayHistory(prev => [...prev, userTurn]);
    setLlmHistory(nextLlmHistory);
    setIsLoading(true);

    try {
      const MAX_CONTEXT_CHARS = 8_000;
      const rawContext = getEditorText();
      const isTruncated = rawContext.length > MAX_CONTEXT_CHARS;
      const textContext = isTruncated
        ? rawContext.slice(0, MAX_CONTEXT_CHARS) + '\n\n[...documento troncato per lunghezza...]'
        : rawContext;
      if (isTruncated) {
        setDisplayHistory(prev => [...prev, { role: 'assistant', content: `⚠️ ${t('contextTruncated')}` }]);
      }

      // RAG: find related notes from the full vault
      const relevant = noteChunks.length > 0
        ? findRelevantNotes(userMessage, noteChunks, 3)
        : [];
      const ragContext = relevant.length > 0
        ? relevant.map(n => `### ${n.name.replace('.md', '')}\n${n.text.slice(0, 1500)}`).join('\n\n---\n\n')
        : '';

      const response = await askLLM([
        {
          role: 'system',
          content: `Sei un assistente integrato in un editor di note Markdown. Hai accesso al contenuto delle note dell'utente.

${textContext ? `Nota attiva:\n"""\n${textContext}\n"""` : ''}
${ragContext ? `\nNote correlate dal vault:\n"""\n${ragContext}\n"""` : ''}

Rispondi in modo conciso e utile. Se citi una nota specifica, indica il titolo.`,
        },
        ...nextLlmHistory,
      ]);
      const assistantTurn: ChatMessage = { role: 'assistant', content: response };
      setDisplayHistory(prev => [...prev, assistantTurn]);
      setLlmHistory(prev => [...prev, assistantTurn]);
    } catch (error: unknown) {
      const err = error as Error;
      setDisplayHistory(prev => [
        ...prev,
        { role: 'assistant', content: t('aiError').replace('{msg}', err.message) },
      ]);
    } finally {
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
        {noteChunks.length > 0 && (
          <span className="flex items-center gap-1 text-[10px] font-normal normal-case tracking-normal" style={{ color: 'var(--accent)' }} title={t('ragActive').replace('{n}', String(noteChunks.length))}>
            <Database size={10} />
            {t('ragActive').replace('{n}', String(noteChunks.length))}
          </span>
        )}
      </div>

      <div className="flex-1 p-4 text-sm text-gray-600 dark:text-gray-300 overflow-y-auto flex flex-col space-y-3">
        {displayHistory.map((msg, idx) => (
          <div
            key={idx}
            className={`p-3 rounded-lg shadow-sm border whitespace-pre-wrap ${
              msg.role === 'assistant'
                ? 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700'
                : 'bg-[var(--accent-light)] text-[var(--accent)] border-[var(--accent-mid)] self-end'
            }`}
          >
            {msg.content}
          </div>
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
