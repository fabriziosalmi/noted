import { useStore } from '../store/useStore';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function askLLM(messages: ChatMessage[]): Promise<string> {
  const settings = useStore.getState().settings;
  const { llmProvider, llmApiKey, lmStudioUrl } = settings;

  if (['openai', 'anthropic', 'gemini', 'openrouter'].includes(llmProvider) && !llmApiKey) {
    throw new Error('API Key non configurata nelle impostazioni.');
  }

  try {
    switch (llmProvider) {
      case 'openai':
        return await fetchOpenAI(messages, llmApiKey);
      case 'anthropic':
        return await fetchAnthropic(messages, llmApiKey);
      case 'gemini':
        return await fetchGemini(messages, llmApiKey);
      case 'openrouter':
        return await fetchOpenRouter(messages, llmApiKey);
      case 'lmstudio':
        return await fetchLMStudio(messages, lmStudioUrl);
      case 'ollama':
        return await fetchOllama(messages);
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

async function fetchOpenAI(messages: ChatMessage[], apiKey: string) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages,
      temperature: 0.7
    })
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.choices[0].message.content;
}

async function fetchOpenRouter(messages: ChatMessage[], apiKey: string) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'http://localhost:8066',
      'X-Title': 'Noted App'
    },
    body: JSON.stringify({
      model: 'anthropic/claude-3.5-sonnet', // Default fallback model
      messages,
      temperature: 0.7
    })
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.choices[0].message.content;
}

async function fetchLMStudio(messages: ChatMessage[], baseUrl: string) {
  // LM Studio exposes an OpenAI-compatible API
  const url = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const res = await fetch(`${url}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'local-model', // LM Studio usually ignores this and uses the loaded one
      messages,
      temperature: 0.7
    })
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.choices[0].message.content;
}

async function fetchOllama(messages: ChatMessage[]) {
  // Ollama default local endpoint
  const res = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama3', // Default fallback
      messages,
      stream: false
    })
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.message.content;
}

async function fetchAnthropic(messages: ChatMessage[], apiKey: string) {
  // Note: Direct calls to Anthropic from browser usually hit CORS.
  // In a real desktop app, we should proxy this via Electron's ipcMain, 
  // but for the scope of this vibe, we'll try direct or assume OpenRouter is used.
  const systemMsg = messages.find(m => m.role === 'system')?.content;
  const chatMsgs = messages.filter(m => m.role !== 'system');
  
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-3-sonnet-20240229',
      max_tokens: 1024,
      system: systemMsg,
      messages: chatMsgs
    })
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.content[0].text;
}

async function fetchGemini(messages: ChatMessage[], apiKey: string) {
  // Convert standard messages to Gemini format
  const geminiMessages = messages.filter(m => m.role !== 'system').map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));
  
  const systemMsg = messages.find(m => m.role === 'system')?.content;

  const body: Record<string, unknown> = { contents: geminiMessages };
  if (systemMsg) {
    body.systemInstruction = { parts: [{ text: systemMsg }] };
  }

  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.candidates[0].content.parts[0].text;
}
