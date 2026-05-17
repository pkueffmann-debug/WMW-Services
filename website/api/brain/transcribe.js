// /api/brain/transcribe — STT via Groq Whisper.
// Groq runs whisper-large-v3-turbo at ~10× the speed of OpenAI Whisper and
// is free (well within the Groq free tier for voice traffic). We request
// `verbose_json` so we get per-segment avg_logprob from which we derive a
// 0..1 confidence score that the frontend uses to drop low-quality
// transcripts (background noise, fragments, etc.) before sending them to
// Claude.
//
// Falls back to OpenAI Whisper if GROQ_API_KEY isn't configured.

const { gate } = require('../_lib/auth');
const Busboy = (() => { try { return require('busboy'); } catch { return null; } })();

module.exports.config = { api: { bodyParser: false } };

const WHISPER_TIMEOUT_MS = 20_000;
const RETRIES = 1;

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('method not allowed'); }
  const user = await gate(req, res);
  if (!user) return;

  const groqKey = process.env.GROQ_API_KEY;
  const oaKey   = process.env.OPENAI_API_KEY;
  if (!groqKey && !oaKey) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: 'GROQ_API_KEY or OPENAI_API_KEY required' }));
  }
  if (!Busboy) { res.statusCode = 500; return res.end(JSON.stringify({ error: 'busboy not installed' })); }

  try {
    const audio = await readAudioPart(req);
    if (!audio || !audio.buffer.length) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: 'no audio uploaded' }));
    }

    // Prefer Groq when configured.
    const useGroq = !!groqKey;
    const provider = useGroq ? 'groq' : 'openai';
    const endpoint = useGroq
      ? 'https://api.groq.com/openai/v1/audio/transcriptions'
      : 'https://api.openai.com/v1/audio/transcriptions';
    const apiKey = useGroq ? groqKey : oaKey;
    const model  = useGroq ? 'whisper-large-v3-turbo' : 'whisper-1';

    async function callWhisper() {
      const fd = new FormData();
      const blob = new Blob([audio.buffer], { type: audio.mime || 'audio/webm' });
      fd.append('file', blob, audio.filename || 'audio.webm');
      fd.append('model', model);
      // verbose_json gives us segment-level avg_logprob → confidence heuristic.
      fd.append('response_format', 'verbose_json');

      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), WHISPER_TIMEOUT_MS);
      try {
        return await fetch(endpoint, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}` },
          body: fd,
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(tid);
      }
    }

    let r, lastErr;
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      try {
        r = await callWhisper();
        if (r.status >= 500 && r.status < 600 && attempt < RETRIES) {
          console.warn(`[transcribe/${provider}] ${r.status}, retrying (${attempt + 1}/${RETRIES})`);
          await new Promise(rs => setTimeout(rs, 1000));
          continue;
        }
        break;
      } catch (e) {
        lastErr = e;
        const isAbort = e.name === 'AbortError';
        console.warn(`[transcribe/${provider}] attempt ${attempt + 1} ${isAbort ? 'TIMEOUT' : 'NETWORK'}: ${e.message}`);
        if (attempt < RETRIES) {
          await new Promise(rs => setTimeout(rs, 1000));
          continue;
        }
        throw lastErr;
      }
    }

    if (!r.ok) {
      const t = await r.text();
      console.error(`[transcribe/${provider}] rejected:`, r.status, t.slice(0, 200));
      res.statusCode = 500;
      return res.end(JSON.stringify({ error: `Whisper ${r.status}: ${t.slice(0, 200)}` }));
    }
    const j = await r.json();
    const text = (j.text || '').trim();

    // Confidence: average exp(avg_logprob) across segments. avg_logprob is a
    // negative number (closer to 0 = more confident). exp(-0.2) ≈ 0.82,
    // exp(-1.0) ≈ 0.37. We clamp to [0, 1].
    let confidence = 1;
    if (Array.isArray(j.segments) && j.segments.length) {
      const probs = j.segments
        .filter(s => typeof s.avg_logprob === 'number')
        .map(s => Math.exp(s.avg_logprob));
      if (probs.length) {
        confidence = probs.reduce((a, b) => a + b, 0) / probs.length;
        confidence = Math.max(0, Math.min(1, confidence));
      }
    }

    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ text, confidence, provider }));
  } catch (e) {
    console.error('[transcribe] failed', {
      message: e?.message,
      name: e?.name,
      stack: e?.stack?.split('\n').slice(0, 4).join('\n'),
    });
    res.statusCode = 500;
    res.end(JSON.stringify({ error: e.message }));
  }
};

function readAudioPart(req) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers });
    let out = null;
    bb.on('file', (_name, file, info) => {
      const chunks = [];
      file.on('data', (c) => chunks.push(c));
      file.on('end', () => {
        out = { buffer: Buffer.concat(chunks), mime: info.mimeType, filename: info.filename };
      });
    });
    bb.on('finish', () => resolve(out));
    bb.on('error', reject);
    req.pipe(bb);
  });
}
