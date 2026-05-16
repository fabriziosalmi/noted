import { useStore } from '../store/useStore';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function askLLM(messages: ChatMessage[]): Promise<string> {
  const settings = useStore.getState().settings;
  const { llmProvider, llmApiKey, llmModel, lmStudioUrl } = settings;

  if (['openai', 'anthropic', 'gemini', 'openrouter'].includes(llmProvider) && !llmApiKey) {
    throw new Error('API Key non configurata nelle impostazioni.');
  }

  try {
    switch (llmProvider) {
      case 'openai':
        return await fetchOpenAI(messages, llmApiKey, llmModel || 'gpt-4o');
      case 'anthropic':
        return await fetchAnthropic(messages, llmApiKey, llmModel || 'claude-3-5-sonnet-20241022');
      case 'gemini':
        return await fetchGemini(messages, llmApiKey, llmModel || 'gemini-1.5-pro');
      case 'openrouter':
        return await fetchOpenRouter(messages, llmApiKey, llmModel || 'anthropic/claude-3.5-sonnet');
      case 'lmstudio':
        return await fetchLMStudio(messages, lmStudioUrl, llmModel || 'local-model');
      case 'ollama':
        return await fetchOllama(messages, llmModel || 'llama3');
      default:
        throw new Error('Provider non supportato');
    }
  } catch (error: unknown) {
    const err = error as Error;
    console.error('LLM Error:', err);
    throw new Error(`Errore LLM: ${err.message}`, { cause: error });
  }
}

// ==========================================
// API Clients
// ==========================================

// Models that don't accept a dedicated 'system' role — prepend as first user message instead
const NO_SYSTEM_ROLE_PATTERNS = [/gemma/i, /mistral.*(7b|8x7b)/i, /phi-/i, /llama-2/i];

function supportsSystemRole(model: string): boolean {
  return !NO_SYSTEM_ROLE_PATTERNS.some(p => p.test(model));
}

function normalizeForNoSystemRole(messages: ChatMessage[]): ChatMessage[] {
  const systemMsg = messages.find(m => m.role === 'system');
  if (!systemMsg) return messages;
  const rest = messages.filter(m => m.role !== 'system');
  // Prepend system content to the first user message, or add a user turn
  if (rest.length > 0 && rest[0].role === 'user') {
    return [
      { role: 'user', content: `[Istruzioni sistema: ${systemMsg.content}]\n\n${rest[0].content}` },
      ...rest.slice(1),
    ];
  }
  return [{ role: 'user', content: systemMsg.content }, ...rest];
}

async function fetchOpenAI(messages: ChatMessage[], apiKey: string, model: string) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, temperature: 0.7 }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.choices[0].message.content as string;
}

async function fetchOpenRouter(messages: ChatMessage[], apiKey: string, model: string) {
  const payload = supportsSystemRole(model) ? messages : normalizeForNoSystemRole(messages);
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'http://localhost:8066',
      'X-Title': 'Noted App',
    },
    body: JSON.stringify({ model, messages: payload, temperature: 0.7 }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.choices[0].message.content as string;
}

async function fetchLMStudio(messages: ChatMessage[], baseUrl: string, model: string) {
  const url = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const res = await fetch(`${url}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, temperature: 0.7 }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.choices[0].message.content as string;
}

async function fetchOllama(messages: ChatMessage[], model: string) {
  const res = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.message.content as string;
}

async function fetchAnthropic(messages: ChatMessage[], apiKey: string, model: string) {
  const systemMsg = messages.find(m => m.role === 'system')?.content;
  const chatMsgs = messages.filter(m => m.role !== 'system');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model, max_tokens: 4096, system: systemMsg, messages: chatMsgs }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.content[0].text as string;
}

async function fetchGemini(messages: ChatMessage[], apiKey: string, model: string) {
  const geminiMessages = messages.filter(m => m.role !== 'system').map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const systemMsg = messages.find(m => m.role === 'system')?.content;
  const body: Record<string, unknown> = { contents: geminiMessages };
  if (systemMsg) body.systemInstruction = { parts: [{ text: systemMsg }] };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.candidates[0].content.parts[0].text as string;
}
