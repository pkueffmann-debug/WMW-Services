// /api/brain/vision — analyse a screenshot with Claude Sonnet 4.6.
//
// Body: { image_base64, prompt? }
//   image_base64 = base64-encoded PNG/JPEG/WEBP (data-URL prefix optional)
//   prompt       = optional override; defaults to a "what am I looking at"
//                  prompt that asks Claude to describe + suggest next steps
// Response: { analysis: "..." }
//
// 25 s timeout, 1 retry on 5xx/abort, 5 MB body cap.

const { gate } = require('../_lib/auth');

const DEFAULT_PROMPT =
  'Beschreib in 2-3 Sätzen knapp, was auf diesem Screenshot zu sehen ist. ' +
  'Wenn ein nächster Schritt offensichtlich ist (eine Datei öffnen, einen ' +
  'Fehler beheben, jemandem antworten), schlag ihn am Ende vor. Bleib im ' +
  'Stil eines britischen Butlers — kurz, präzise, mit einem Funken trockener ' +
  'Ironie. Sprich den Nutzer mit "Sir" an.';

const TIMEOUT_MS  = 25_000;
const RETRIES     = 1;
const MAX_BYTES   = 5 * 1024 * 1024;   // 5 MB

function readJSON(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      chunks.push(c);
      total += c.length;
      if (total > MAX_BYTES + 1024) {
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function detectMime(b64) {
  // Tiny prefix sniff: PNG magic `iVBOR…` / JPEG `/9j/` / WebP `UklGR…`.
  if (b64.startsWith('iVBOR'))                       return 'image/png';
  if (b64.startsWith('/9j/'))                        return 'image/jpeg';
  if (b64.startsWith('UklGR'))                       return 'image/webp';
  return 'image/png';
}

async function callClaude({ image, mime, prompt }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY missing');

  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mime, data: image } },
            { type: 'text',  text: prompt },
          ],
        }],
      }),
    });
    if (!r.ok) {
      const txt = await r.text();
      throw new Error(`Anthropic ${r.status}: ${txt.slice(0, 200)}`);
    }
    const j = await r.json();
    const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    return { text, model: j.model, usage: j.usage };
  } finally {
    clearTimeout(tid);
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'method not allowed' }));
  }
  const user = await gate(req, res);
  if (!user) return;

  const body = req.body && Object.keys(req.body).length ? req.body : await readJSON(req);
  const promptRaw   = (body.prompt   || '').toString().trim();
  const imageInput  = (body.image_base64 || '').toString();

  if (!imageInput) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'image_base64 required' }));
  }
  const stripped = imageInput.replace(/^data:image\/[^;]+;base64,/, '').replace(/\s+/g, '');
  if (!stripped) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'empty image_base64' }));
  }
  // base64 -> approximate raw size
  if (stripped.length * 0.75 > MAX_BYTES) {
    res.statusCode = 413;
    return res.end(JSON.stringify({ error: `image too large (>${MAX_BYTES} bytes raw)` }));
  }

  const prompt = promptRaw || DEFAULT_PROMPT;
  const mime   = detectMime(stripped);

  let lastErr = null;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const { text, model, usage } = await callClaude({ image: stripped, mime, prompt });
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({
        analysis: text || 'Schwer zu sagen, Sir — der Screenshot war nicht aufschlussreich.',
        model,
        usage,
      }));
    } catch (e) {
      lastErr = e;
      const msg = (e?.message || '').toLowerCase();
      const transient = msg.includes('abort') || msg.includes('timeout') ||
                        msg.includes('429')   || msg.includes('502') ||
                        msg.includes('503')   || msg.includes('504') ||
                        msg.includes('network') || msg.includes('fetch failed');
      if (attempt < RETRIES && transient) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      break;
    }
  }

  console.error('[vision] failed:', lastErr?.message);
  res.statusCode = 500;
  res.end(JSON.stringify({ error: lastErr?.message || 'vision call failed' }));
};
