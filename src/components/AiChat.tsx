import { useState } from 'react';
import { Bot, Loader2 } from 'lucide-react';
import { askLLM } from '../lib/llm';

interface AiChatProps {
  getEditorText: () => string;
}

interface ChatMessage { role: 'assistant' | 'user'; content: string }

const GREETING = 'Ciao! Sono il tuo assistente. MCP attivato. Posso leggere quello che scrivi e aiutarti. Come posso aiutarti oggi?';

export function AiChat({ getEditorText }: AiChatProps) {
  // displayHistory includes the greeting bubble shown in the UI
  const [displayHistory, setDisplayHistory] = useState<ChatMessage[]>([
    { role: 'assistant', content: GREETING },
  ]);
  // llmHistory contains only real user/assistant turns sent to the LLM — no greeting
  const [llmHistory, setLlmHistory] = useState<ChatMessage[]>([]);
  const [aiInput, setAiInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

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
      const textContext = getEditorText();
      const response = await askLLM([
        {
          role: 'system',
          content: `Sei un assistente integrato in un editor di testo Markdown. Il tuo obiettivo è aiutare l'utente a scrivere e ragionare.
Ecco il contenuto attuale del documento a cui l'utente sta lavorando (se presente):
"""
${textContext}
"""
Rispondi in modo conciso e utile.`,
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
        { role: 'assistant', content: `❌ Errore: ${err.message}. Controlla le impostazioni (Provider e API Key).` },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <div className="p-3 text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center space-x-2 border-b border-gray-200">
        <Bot size={14} />
        <span>AI Assistant</span>
      </div>

      <div className="flex-1 p-4 text-sm text-gray-600 overflow-y-auto flex flex-col space-y-3">
        {displayHistory.map((msg, idx) => (
          <div
            key={idx}
            className={`p-3 rounded-lg shadow-sm border border-gray-100 whitespace-pre-wrap ${
              msg.role === 'assistant' ? 'bg-white' : 'bg-blue-50 text-blue-900 self-end'
            }`}
          >
            {msg.content}
          </div>
        ))}
        {isLoading && (
          <div className="p-3 rounded-lg shadow-sm border border-gray-100 bg-white flex items-center space-x-2 text-gray-400 self-start">
            <Loader2 size={14} className="animate-spin" />
            <span>Pensando...</span>
          </div>
        )}
      </div>

      <div className="p-3 border-t border-gray-200 bg-white">
        <input
          type="text"
          value={aiInput}
          onChange={e => setAiInput(e.target.value)}
          onKeyDown={handleSubmit}
          disabled={isLoading}
          placeholder={isLoading ? 'Attendi la risposta...' : 'Chiedi qualcosa... (Premi Invio)'}
          className="w-full p-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-500 bg-gray-50 disabled:opacity-50"
        />
      </div>
    </>
  );
}
