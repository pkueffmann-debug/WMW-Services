/* =========================================================
   /api/llm — Multi-provider LLM proxy for Aurelys
   Providers (server-proxied):
     - claude    (Anthropic SDK, native)
     - openai    (OpenAI Chat Completions)
     - groq      (OpenAI-compatible at api.groq.com)
     - mistral   (OpenAI-compatible at api.mistral.ai)
     - cerebras  (OpenAI-compatible at api.cerebras.ai)
     - gemini    (Google Generative Language streamGenerateContent)
   Provider (client-direct, not handled here):
     - ollama   (browser → http://localhost:11434)

   Streaming via SSE. Request body:
     { provider, model, system, messages, max_tokens, stream, api_key? }
   Optional api_key overrides the server-side env var for this request only.
   ========================================================= */
const Anthropic = require('@anthropic-ai/sdk');

function mask(k) {
  if (!k) return '(unset)';
  return k.length > 12 ? `${k.slice(0, 6)}…${k.slice(-4)}` : `(len=${k.length})`;
}

// OpenAI-compatible provider config
const OPENAI_COMPAT = {
  openai:   { url: 'https://api.openai.com/v1/chat/completions',          env: 'OPENAI_API_KEY',   defaultModel: 'gpt-4o-mini' },
  groq:     { url: 'https://api.groq.com/openai/v1/chat/completions',      env: 'GROQ_API_KEY',     defaultModel: 'llama-3.3-70b-versatile' },
  mistral:  { url: 'https://api.mistral.ai/v1/chat/completions',           env: 'MISTRAL_API_KEY',  defaultModel: 'mistral-small-latest' },
  cerebras: { url: 'https://api.cerebras.ai/v1/chat/completions',          env: 'CEREBRAS_API_KEY', defaultModel: 'llama-3.3-70b' },
};

module.exports = async function handler(req, res) {
  const reqId = `llm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      providers: {
        claude:   { configured: !!process.env.ANTHROPIC_API_KEY, key: mask(process.env.ANTHROPIC_API_KEY) },
        openai:   { configured: !!process.env.OPENAI_API_KEY,    key: mask(process.env.OPENAI_API_KEY) },
        groq:     { configured: !!process.env.GROQ_API_KEY,      key: mask(process.env.GROQ_API_KEY) },
        mistral:  { configured: !!process.env.MISTRAL_API_KEY,   key: mask(process.env.MISTRAL_API_KEY) },
        cerebras: { configured: !!process.env.CEREBRAS_API_KEY,  key: mask(process.env.CEREBRAS_API_KEY) },
        gemini:   { configured: !!process.env.GEMINI_API_KEY,    key: mask(process.env.GEMINI_API_KEY) },
        ollama:   { note: 'client-side, browser → localhost:11434' },
      },
    });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};
  const provider = String(body.provider || 'claude').toLowerCase();
  const model = String(body.model || '');
  const system = typeof body.system === 'string' ? body.system : '';
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const maxTokens = Math.min(parseInt(body.max_tokens, 10) || 1024, 8192);
  const stream = body.stream !== false;
  const userApiKey = typeof body.api_key === 'string' && body.api_key.trim()
    ? body.api_key.trim() : null;

  if (!messages.length) return res.status(400).json({ error: 'messages required', reqId });

  console.log(`[${reqId}] ${provider} model=${model} msgs=${messages.length} max=${maxTokens} stream=${stream}`);

  try {
    if (provider === 'claude') {
      return await handleClaude({ res, reqId, model, system, messages, maxTokens, stream, userApiKey });
    }
    if (OPENAI_COMPAT[provider]) {
      const cfg = OPENAI_COMPAT[provider];
      return await handleOpenAICompat({
        res, reqId, baseUrl: cfg.url, envName: cfg.env, defaultModel: cfg.defaultModel,
        model, system, messages, maxTokens, stream, userApiKey,
      });
    }
    if (provider === 'gemini') {
      return await handleGemini({ res, reqId, model, system, messages, maxTokens, stream, userApiKey });
    }
    return res.status(400).json({ error: `Unknown provider: ${provider}`, reqId });
  } catch (e) {
    console.error(`[${reqId}] error:`, e?.message, e?.stack);
    if (!res.headersSent) {
      return res.status(500).json({ error: e?.message || 'LLM call failed', reqId });
    }
    res.write(`data: ${JSON.stringify({ error: e?.message || 'stream failed' })}\n\n`);
    return res.end();
  }
};

// ─── Claude (Anthropic SDK) ─────────────────────────────

async function handleClaude({ res, reqId, model, system, messages, maxTokens, stream, userApiKey }) {
  const key = userApiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured', reqId });
  const client = new Anthropic({ apiKey: key });

  const params = {
    model: model || 'claude-haiku-4-5',
    max_tokens: maxTokens,
    messages,
  };
  if (system) params.system = system;

  if (!stream) {
    const r = await client.messages.create(params);
    const text = r.content.filter(b => b.type === 'text').map(b => b.text).join('');
    return res.status(200).json({ text, usage: r.usage, model: r.model });
  }

  sseHeaders(res);
  const s = client.messages.stream(params);
  for await (const ev of s) {
    if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
      res.write(`data: ${JSON.stringify({ delta: ev.delta.text })}\n\n`);
    }
  }
  const final = await s.finalMessage();
  res.write(`data: ${JSON.stringify({ done: true, usage: final.usage, model: final.model })}\n\n`);
  return res.end();
}

// ─── OpenAI-compatible (OpenAI / Groq / Mistral / Cerebras) ──

async function handleOpenAICompat({
  res, reqId, baseUrl, envName, defaultModel, model, system, messages, maxTokens, stream, userApiKey,
}) {
  const key = userApiKey || process.env[envName];
  if (!key) return res.status(500).json({ error: `${envName} not configured`, reqId });

  const oaiMessages = system
    ? [{ role: 'system', content: system }, ...messages]
    : messages;

  const upstreamBody = {
    model: model || defaultModel,
    messages: oaiMessages,
    max_tokens: maxTokens,
    stream,
  };
  const upstream = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(upstreamBody),
  });

  if (!upstream.ok) {
    const errText = await upstream.text();
    return res.status(upstream.status).json({ error: errText, reqId });
  }

  if (!stream) {
    const j = await upstream.json();
    const text = j.choices?.[0]?.message?.content || '';
    return res.status(200).json({ text, usage: j.usage, model: j.model });
  }

  sseHeaders(res);
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') {
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        return res.end();
      }
      try {
        const j = JSON.parse(payload);
        const delta = j.choices?.[0]?.delta?.content;
        if (delta) res.write(`data: ${JSON.stringify({ delta })}\n\n`);
      } catch (e) { /* skip malformed */ }
    }
  }
  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  return res.end();
}

// ─── Gemini (Google Generative Language API) ────────────

async function handleGemini({ res, reqId, model, system, messages, maxTokens, stream, userApiKey }) {
  const key = userApiKey || process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'GEMINI_API_KEY not configured', reqId });
  const mdl = model || 'gemini-2.0-flash';

  // Convert OpenAI-shaped messages → Gemini "contents" + systemInstruction
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
  }));
  const reqBody = {
    contents,
    generationConfig: { maxOutputTokens: maxTokens },
  };
  if (system) reqBody.systemInstruction = { parts: [{ text: system }] };

  if (!stream) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${mdl}:generateContent?key=${key}`;
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody),
    });
    if (!upstream.ok) {
      const errText = await upstream.text();
      return res.status(upstream.status).json({ error: errText, reqId });
    }
    const j = await upstream.json();
    const text = j.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
    return res.status(200).json({ text, model: mdl });
  }

  // Streaming — alt=sse returns proper SSE frames
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${mdl}:streamGenerateContent?alt=sse&key=${key}`;
  const upstream = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reqBody),
  });
  if (!upstream.ok) {
    const errText = await upstream.text();
    return res.status(upstream.status).json({ error: errText, reqId });
  }

  sseHeaders(res);
  const reader = upstream.body.getReader();
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
      if (!payload || payload === '[DONE]') continue;
      try {
        const j = JSON.parse(payload);
        const delta = j.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
        if (delta) res.write(`data: ${JSON.stringify({ delta })}\n\n`);
      } catch (e) { /* skip */ }
    }
  }
  res.write(`data: ${JSON.stringify({ done: true, model: mdl })}\n\n`);
  return res.end();
}

// ─── Helpers ────────────────────────────────────────────

function sseHeaders(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
}
