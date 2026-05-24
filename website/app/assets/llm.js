/* =========================================================
   Aurelys — LLM client (multi-provider)
   - claude / openai → POST /api/llm (server proxy, hides key)
   - ollama          → fetch http://localhost:11434/api/chat directly
   Streaming via SSE for claude/openai, NDJSON for ollama.
   ========================================================= */

import { getSetting } from './storage.js';

const DEFAULT_MODELS = {
  claude: 'claude-haiku-4-5',
  openai: 'gpt-4o-mini',
  ollama: 'llama3.2',
};

export async function getLLMConfig() {
  const provider = (await getSetting('llm_provider', 'claude')).toLowerCase();
  const model = await getSetting(`llm_model_${provider}`, DEFAULT_MODELS[provider]);
  const apiKey = await getSetting(`llm_apikey_${provider}`, '');
  const ollamaUrl = await getSetting('llm_ollama_url', 'http://localhost:11434');
  return { provider, model, apiKey, ollamaUrl };
}

/**
 * Stream a chat completion.
 * @param {{system:string, messages:array, max_tokens?:number, onDelta:(s)=>void, onDone:(meta)=>void, onError:(err)=>void}} opts
 */
export async function streamChat(opts) {
  const cfg = await getLLMConfig();
  const { provider, model, apiKey, ollamaUrl } = cfg;
  try {
    if (provider === 'ollama') {
      await streamOllama({ ...opts, model, baseUrl: ollamaUrl });
    } else {
      await streamProxy({ ...opts, provider, model, apiKey });
    }
  } catch (e) {
    opts.onError?.(e);
  }
}

async function streamProxy({ provider, model, apiKey, system, messages, max_tokens, onDelta, onDone, onError }) {
  const body = {
    provider,
    model,
    system,
    messages,
    max_tokens: max_tokens || 1024,
    stream: true,
  };
  if (apiKey) body.api_key = apiKey;

  const resp = await fetch('/api/llm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`LLM error ${resp.status}: ${txt.slice(0, 200)}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (!payload) continue;
      try {
        const j = JSON.parse(payload);
        if (j.delta) onDelta?.(j.delta);
        if (j.error) onError?.(new Error(j.error));
        if (j.done) onDone?.({ usage: j.usage, model: j.model });
      } catch (e) { /* skip */ }
    }
  }
}

async function streamOllama({ baseUrl, model, system, messages, onDelta, onDone, onError }) {
  const oMessages = system
    ? [{ role: 'system', content: system }, ...messages]
    : messages;
  let resp;
  try {
    resp = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: oMessages, stream: true }),
    });
  } catch (e) {
    throw new Error(`Ollama unreachable at ${baseUrl}. Is the server running?`);
  }
  if (!resp.ok) throw new Error(`Ollama error ${resp.status}`);

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line);
        const delta = j.message?.content;
        if (delta) onDelta?.(delta);
        if (j.done) onDone?.({ model: j.model });
      } catch (e) { /* skip */ }
    }
  }
}

// ─── Convenience: collect full response (non-streamed UX) ──

export async function chatCollect(opts) {
  let full = '';
  await streamChat({
    ...opts,
    onDelta: (d) => { full += d; opts.onDelta?.(d); },
    onDone: (m) => opts.onDone?.(m),
    onError: (e) => opts.onError?.(e),
  });
  return full;
}
