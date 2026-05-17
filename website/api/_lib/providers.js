// providers.js — unified LLM interface across Anthropic / OpenAI / Gemini /
// Groq / Mistral. All adapters expose the same shape:
//
//   askProvider({ provider, model, system, messages, tools, max_tokens, temperature })
//     → { text: string, toolCalls: Array, raw: any, usage: {input, output} }
//
// `messages` is the canonical history format:
//   [{ role: 'user'|'assistant', content: string | [{type:'tool_result', ...}] }]
//
// Each adapter translates this into the provider-native format and back.
// Tool execution stays the caller's responsibility — the adapter only
// reports tool_use blocks; it doesn't run them.

const MODELS = {
  anthropic: { default: 'claude-sonnet-4-6', fast: 'claude-haiku-4-5-20251001' },
  openai:    { default: 'gpt-4o-mini',       smart: 'gpt-4o', fast: 'gpt-4o-mini' },
  gemini:    { default: 'gemini-2.5-flash', fast: 'gemini-2.5-flash-lite', smart: 'gemini-2.5-pro' },
  groq:      { default: 'llama-3.3-70b-versatile', fast: 'llama-3.1-8b-instant' },
  mistral:   { default: 'mistral-large-latest', fast: 'mistral-small-latest' },
};

function pickModel(provider, tier = 'default') {
  return MODELS[provider]?.[tier] || MODELS[provider]?.default;
}

// Which providers are configured? Used by routers + UI to show availability.
function availableProviders() {
  const set = new Set();
  if (process.env.ANTHROPIC_API_KEY) set.add('anthropic');
  if (process.env.OPENAI_API_KEY)    set.add('openai');
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) set.add('gemini');
  if (process.env.GROQ_API_KEY)      set.add('groq');
  if (process.env.MISTRAL_API_KEY)   set.add('mistral');
  return [...set];
}

// ── Anthropic ──────────────────────────────────────────────────────────────
async function askAnthropic({ model, system, messages, tools, max_tokens = 1024, temperature, stream, onChunk }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY missing');
  const body = {
    model, system, messages,
    max_tokens,
  };
  if (typeof temperature === 'number') body.temperature = temperature;
  if (tools && tools.length) body.tools = tools;
  if (stream) body.stream = true;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);

  // Non-streaming path (unchanged).
  if (!stream) {
    const data = await r.json();
    const blocks = data.content || [];
    const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('');
    const toolCalls = blocks.filter(b => b.type === 'tool_use').map(b => ({
      id: b.id, name: b.name, input: b.input,
    }));
    return {
      text, toolCalls,
      raw: data,
      stop: data.stop_reason,
      usage: { input: data.usage?.input_tokens, output: data.usage?.output_tokens },
      provider: 'anthropic',
    };
  }

  // Streaming SSE path. Anthropic emits events like:
  //   event: content_block_start  { "content_block": { "type": "text" | "tool_use", ... } }
  //   event: content_block_delta  { "delta": { "type": "text_delta", "text": "..." } }
  //   event: content_block_delta  { "delta": { "type": "input_json_delta", "partial_json": "..." } }
  //   event: content_block_stop
  //   event: message_delta        { "delta": { "stop_reason": "..." } }
  //   event: message_stop
  //
  // We accumulate text + tool calls and call onChunk(text) for every text delta
  // so the caller can forward it to the client live.
  let fullText = '';
  const blocks = []; // per-index: { type, text, toolUse }
  let stopReason = null;
  let usage = { input: undefined, output: undefined };

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // Process complete SSE events (separated by blank lines).
    let idx;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const dataLine = raw.split('\n').find(l => l.startsWith('data:'));
      if (!dataLine) continue;
      const json = dataLine.slice(5).trim();
      if (!json) continue;
      let evt;
      try { evt = JSON.parse(json); } catch { continue; }

      if (evt.type === 'content_block_start') {
        blocks[evt.index] = { type: evt.content_block.type, text: '', toolUse: evt.content_block.type === 'tool_use' ? {
          id: evt.content_block.id, name: evt.content_block.name, jsonAcc: '',
        } : null };
      } else if (evt.type === 'content_block_delta') {
        const b = blocks[evt.index];
        if (!b) continue;
        if (evt.delta?.type === 'text_delta') {
          const t = evt.delta.text || '';
          b.text += t;
          fullText += t;
          if (onChunk) { try { onChunk(t); } catch {} }
        } else if (evt.delta?.type === 'input_json_delta' && b.toolUse) {
          b.toolUse.jsonAcc += evt.delta.partial_json || '';
        }
      } else if (evt.type === 'message_delta') {
        if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
        if (evt.usage?.output_tokens) usage.output = evt.usage.output_tokens;
      } else if (evt.type === 'message_start') {
        usage.input = evt.message?.usage?.input_tokens;
      }
    }
  }

  const toolCalls = blocks
    .filter(b => b && b.type === 'tool_use')
    .map(b => {
      let input = {};
      try { input = b.toolUse.jsonAcc ? JSON.parse(b.toolUse.jsonAcc) : {}; } catch {}
      return { id: b.toolUse.id, name: b.toolUse.name, input };
    });

  return {
    text: fullText,
    toolCalls,
    raw: { content: blocks.map(b => b ? (b.type === 'text' ? { type: 'text', text: b.text } : { type: 'tool_use', id: b.toolUse.id, name: b.toolUse.name, input: (() => { try { return JSON.parse(b.toolUse.jsonAcc); } catch { return {}; } })() }) : null).filter(Boolean), model, stop_reason: stopReason },
    stop: stopReason,
    usage,
    provider: 'anthropic',
  };
}

// ── OpenAI (chat-completions API; supports tools/functions) ────────────────
async function askOpenAI({ model, system, messages, tools, max_tokens = 700, temperature }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY missing');
  // OpenAI message format: system message + user/assistant/tool
  const oaiMsgs = [];
  if (system) oaiMsgs.push({ role: 'system', content: system });
  for (const m of messages) {
    if (typeof m.content === 'string') {
      oaiMsgs.push({ role: m.role, content: m.content });
    } else if (Array.isArray(m.content)) {
      // tool_result blocks → role:'tool'. tool_use blocks (assistant) → tool_calls.
      for (const c of m.content) {
        if (c.type === 'tool_result') {
          oaiMsgs.push({ role: 'tool', tool_call_id: c.tool_use_id, content: typeof c.content === 'string' ? c.content : JSON.stringify(c.content) });
        } else if (c.type === 'tool_use') {
          oaiMsgs.push({
            role: 'assistant',
            content: null,
            tool_calls: [{ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input || {}) } }],
          });
        } else if (c.type === 'text') {
          oaiMsgs.push({ role: m.role, content: c.text });
        }
      }
    }
  }
  const body = { model, messages: oaiMsgs, max_tokens };
  if (typeof temperature === 'number') body.temperature = temperature;
  if (tools && tools.length) {
    body.tools = tools.map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }));
    body.tool_choice = 'auto';
  }
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  const choice = data.choices?.[0];
  const msg = choice?.message;
  const text = msg?.content || '';
  const toolCalls = (msg?.tool_calls || []).map(tc => ({
    id: tc.id, name: tc.function.name,
    input: safeParseJSON(tc.function.arguments),
  }));
  return {
    text, toolCalls,
    raw: data,
    stop: choice?.finish_reason,
    usage: { input: data.usage?.prompt_tokens, output: data.usage?.completion_tokens },
    provider: 'openai',
  };
}

// ── Google Gemini ─────────────────────────────────────────────────────────
async function askGemini({ model, system, messages, tools, max_tokens = 700, temperature }) {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY missing');

  const contents = [];
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'model' : 'user';
    if (typeof m.content === 'string') {
      contents.push({ role, parts: [{ text: m.content }] });
    } else if (Array.isArray(m.content)) {
      const parts = [];
      for (const c of m.content) {
        if (c.type === 'text') parts.push({ text: c.text });
        else if (c.type === 'tool_use') parts.push({ functionCall: { name: c.name, args: c.input } });
        else if (c.type === 'tool_result') {
          parts.push({ functionResponse: { name: c.tool_use_id, response: { result: typeof c.content === 'string' ? c.content : c.content } } });
        }
      }
      if (parts.length) contents.push({ role, parts });
    }
  }

  const body = {
    contents,
    generationConfig: { maxOutputTokens: max_tokens, ...(typeof temperature === 'number' ? { temperature } : {}) },
  };
  if (system) body.systemInstruction = { role: 'user', parts: [{ text: system }] };
  if (tools && tools.length) {
    body.tools = [{ functionDeclarations: tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    })) }];
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${key}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  const cand = data.candidates?.[0];
  const parts = cand?.content?.parts || [];
  const text = parts.filter(p => p.text).map(p => p.text).join('');
  const toolCalls = parts.filter(p => p.functionCall).map((p, i) => ({
    id: `gem-${i}-${Date.now()}`,
    name: p.functionCall.name,
    input: p.functionCall.args || {},
  }));
  return {
    text, toolCalls,
    raw: data,
    stop: cand?.finishReason,
    usage: { input: data.usageMetadata?.promptTokenCount, output: data.usageMetadata?.candidatesTokenCount },
    provider: 'gemini',
  };
}

// ── Groq (OpenAI-compatible API) ──────────────────────────────────────────
async function askGroq({ model, system, messages, tools, max_tokens = 700, temperature }) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY missing');
  // Same wire format as OpenAI — reuse the message translator
  const oaiMsgs = [];
  if (system) oaiMsgs.push({ role: 'system', content: system });
  for (const m of messages) {
    if (typeof m.content === 'string') {
      oaiMsgs.push({ role: m.role, content: m.content });
    } else if (Array.isArray(m.content)) {
      for (const c of m.content) {
        if (c.type === 'tool_result') {
          oaiMsgs.push({ role: 'tool', tool_call_id: c.tool_use_id, content: typeof c.content === 'string' ? c.content : JSON.stringify(c.content) });
        } else if (c.type === 'tool_use') {
          oaiMsgs.push({ role: 'assistant', content: null, tool_calls: [{ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input || {}) } }] });
        } else if (c.type === 'text') {
          oaiMsgs.push({ role: m.role, content: c.text });
        }
      }
    }
  }
  const body = { model, messages: oaiMsgs, max_tokens };
  if (typeof temperature === 'number') body.temperature = temperature;
  if (tools && tools.length) {
    body.tools = tools.map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }));
    body.tool_choice = 'auto';
  }
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Groq ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  const choice = data.choices?.[0];
  const msg = choice?.message;
  const text = msg?.content || '';
  const toolCalls = (msg?.tool_calls || []).map(tc => ({
    id: tc.id, name: tc.function.name, input: safeParseJSON(tc.function.arguments),
  }));
  return {
    text, toolCalls, raw: data, stop: choice?.finish_reason,
    usage: { input: data.usage?.prompt_tokens, output: data.usage?.completion_tokens },
    provider: 'groq',
  };
}

// ── Mistral ───────────────────────────────────────────────────────────────
async function askMistral({ model, system, messages, tools, max_tokens = 700, temperature }) {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) throw new Error('MISTRAL_API_KEY missing');
  // Mistral API is OpenAI-style
  const msgs = [];
  if (system) msgs.push({ role: 'system', content: system });
  for (const m of messages) {
    if (typeof m.content === 'string') {
      msgs.push({ role: m.role, content: m.content });
    } else if (Array.isArray(m.content)) {
      const flat = m.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
      if (flat) msgs.push({ role: m.role, content: flat });
      // Mistral tools are limited; we degrade to text-only here.
    }
  }
  const body = { model, messages: msgs, max_tokens };
  if (typeof temperature === 'number') body.temperature = temperature;
  const r = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Mistral ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  const choice = data.choices?.[0];
  return {
    text: choice?.message?.content || '',
    toolCalls: [],
    raw: data,
    stop: choice?.finish_reason,
    usage: { input: data.usage?.prompt_tokens, output: data.usage?.completion_tokens },
    provider: 'mistral',
  };
}

// ── Dispatcher ────────────────────────────────────────────────────────────
async function askProvider(opts) {
  const provider = opts.provider || 'anthropic';
  const model = opts.model || pickModel(provider, opts.tier);
  switch (provider) {
    case 'anthropic': return askAnthropic({ ...opts, model });
    case 'openai':    return askOpenAI({ ...opts, model });
    case 'gemini':    return askGemini({ ...opts, model });
    case 'groq':      return askGroq({ ...opts, model });
    case 'mistral':   return askMistral({ ...opts, model });
    default: throw new Error(`unknown provider: ${provider}`);
  }
}

function safeParseJSON(s) {
  if (typeof s !== 'string') return s || {};
  try { return JSON.parse(s); } catch { return {}; }
}

module.exports = { askProvider, availableProviders, MODELS, pickModel };
