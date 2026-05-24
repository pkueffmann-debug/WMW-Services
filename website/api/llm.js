/* =========================================================
   /api/llm — Multi-provider LLM proxy for Aurelys
   Providers: claude (Anthropic), openai
   Ollama is handled client-side directly (browser → localhost:11434).

   Streaming via SSE. Request body:
     { provider: 'claude'|'openai', model: string,
       system: string, messages: [...], max_tokens: int }

   Env required:
     ANTHROPIC_API_KEY — for provider=claude
     OPENAI_API_KEY    — for provider=openai
   ========================================================= */
const Anthropic = require('@anthropic-ai/sdk');

function mask(k) {
  if (!k) return '(unset)';
  return k.length > 12 ? `${k.slice(0,6)}…${k.slice(-4)}` : `(len=${k.length})`;
}

module.exports = async function handler(req, res) {
  const reqId = `llm_${Date.now().toString(36)}${Math.random().toString(36).slice(2,5)}`;

  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      providers: ['claude', 'openai', 'ollama (client-side)'],
      env: {
        ANTHROPIC_API_KEY: mask(process.env.ANTHROPIC_API_KEY),
        OPENAI_API_KEY: mask(process.env.OPENAI_API_KEY),
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

      // SSE streaming
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

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

    if (provider === 'openai') {
      const key = userApiKey || process.env.OPENAI_API_KEY;
      if (!key) return res.status(500).json({ error: 'OPENAI_API_KEY not configured', reqId });

      const oaiMessages = system
        ? [{ role: 'system', content: system }, ...messages]
        : messages;

      const upstreamUrl = 'https://api.openai.com/v1/chat/completions';
      const upstreamBody = {
        model: model || 'gpt-4o-mini',
        messages: oaiMessages,
        max_tokens: maxTokens,
        stream,
      };
      const upstream = await fetch(upstreamUrl, {
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

      // Pipe OpenAI's SSE through, normalize to {delta} / {done}
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

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
