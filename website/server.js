require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express  = require('express');
const stripe   = require('stripe')(process.env.STRIPE_SECRET_KEY);
const path     = require('path');
const fs       = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '20mb' }));
app.use(express.static(__dirname, { extensions: ['html'] }));

// ── Dev: bypass the Supabase auth gate so localhost can hit /api/brain/* ──
// In production the same handlers reject anonymous via the cookie+subscription
// gate. Here we override the gate to return a fake user backed by a real
// Supabase auth.users row (so the user_facts FK is satisfied).
const FAKE_DEV_USER = {
  id: process.env.DEV_USER_ID || null,
  email: process.env.DEV_USER_EMAIL || 'dev@localhost',
};

// On startup, ensure a real auth.users row exists for FAKE_DEV_USER.
// Without this, /api/brain/memory upserts fail at the user_id foreign key.
(async () => {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const { adminClient } = require('./api/_lib/supabase');
  const admin = adminClient();
  if (!admin) return;
  try {
    // If we already have a user_id, just verify it exists.
    if (FAKE_DEV_USER.id) {
      const { data } = await admin.auth.admin.getUserById(FAKE_DEV_USER.id);
      if (data?.user) { console.log('[dev-user] reusing', FAKE_DEV_USER.email, FAKE_DEV_USER.id); return; }
    }
    // Otherwise look up by email
    const { data: list } = await admin.auth.admin.listUsers();
    const existing = list?.users?.find(u => u.email === FAKE_DEV_USER.email);
    if (existing) {
      FAKE_DEV_USER.id = existing.id;
      console.log('[dev-user] found existing', FAKE_DEV_USER.email, FAKE_DEV_USER.id);
      return;
    }
    // Otherwise create one
    const { data: created, error } = await admin.auth.admin.createUser({
      email: FAKE_DEV_USER.email,
      email_confirm: true,
      user_metadata: { source: 'localhost-dev' },
    });
    if (error) { console.warn('[dev-user] create failed:', error.message); return; }
    FAKE_DEV_USER.id = created.user.id;
    console.log('[dev-user] created', FAKE_DEV_USER.email, FAKE_DEV_USER.id);
    // Give them a trialing subscription so they pass any subscription checks too
    await admin.from('subscriptions').upsert({
      user_id: FAKE_DEV_USER.id, email: FAKE_DEV_USER.email,
      plan: 'pro', status: 'active',
    }, { onConflict: 'user_id' });
  } catch (e) {
    console.warn('[dev-user] setup failed:', e.message);
  }
})();
const authMod = require('./api/_lib/auth');
const origGate = authMod.gate;
authMod.gate = async (req, res) => {
  // Try the real cookie path first so signed-in dev sessions still work.
  try {
    const r = await authMod.authedUser(req);
    if (r.user) return r.user;
  } catch (_) {}
  return FAKE_DEV_USER;
};

// Mount the Vercel-style handlers as Express routes so brain page + API
// stay identical between local dev and production deploy.
const chatHandler       = require('./api/brain/chat');
const ttsHandler        = require('./api/brain/tts');
const debateHandler     = require('./api/brain/debate');
const memoryHandler     = require('./api/brain/memory');
const newsHandler       = require('./api/brain/news');
const weatherHandler    = require('./api/brain/weather');
const dashboardHandler  = require('./api/brain/dashboard');
let transcribeHandler;
try { transcribeHandler = require('./api/brain/transcribe'); } catch (_) {}

app.post('/api/brain/chat',     (req, res) => chatHandler(req, res));
app.post('/api/brain/tts',      (req, res) => ttsHandler(req, res));
app.post('/api/brain/debate',   (req, res) => debateHandler(req, res));
app.all ('/api/brain/memory',   (req, res) => memoryHandler(req, res));
app.get ('/api/brain/news',     (req, res) => newsHandler(req, res));
app.get ('/api/brain/weather',  (req, res) => weatherHandler(req, res));
app.get ('/api/brain/dashboard',(req, res) => dashboardHandler(req, res));

// Local dev: mirror the Vercel rewrite /brain → /api/brain so the page
// loads the same way locally as on daylens.dev.
const brainPageHandler = require('./api/brain');
app.get('/brain',           (req, res) => brainPageHandler(req, res));
app.get('/brain/',          (req, res) => brainPageHandler(req, res));
app.get('/brain/dashboard', (req, res) => dashboardHandler(req, res));
app.get('/brain/dashboard/',(req, res) => dashboardHandler(req, res));
if (transcribeHandler) {
  app.post('/api/brain/transcribe', (req, res) => transcribeHandler(req, res));
}

// ── Price IDs — create in Stripe Dashboard → Products → Add product ──────────
const PRICES = {
  pro_monthly:        process.env.STRIPE_PRO_MONTHLY_PRICE_ID,
  pro_yearly:         process.env.STRIPE_PRO_YEARLY_PRICE_ID,
  team_monthly:       process.env.STRIPE_TEAM_MONTHLY_PRICE_ID,
  team_yearly:        process.env.STRIPE_TEAM_YEARLY_PRICE_ID,
  enterprise_monthly: process.env.STRIPE_ENTERPRISE_MONTHLY_PRICE_ID,
  enterprise_yearly:  process.env.STRIPE_ENTERPRISE_YEARLY_PRICE_ID,
};

// ── Create checkout session ───────────────────────────────────────────────────
app.post('/create-checkout-session', async (req, res) => {
  const { plan, yearly = false } = req.body;
  const key     = `${plan}_${yearly ? 'yearly' : 'monthly'}`;
  const priceId = PRICES[key];

  if (!priceId) {
    return res.status(400).json({
      error: `Price ID für "${key}" fehlt. Bitte STRIPE_PRICE_${key.toUpperCase()} in .env setzen.`
    });
  }

  const base = process.env.BASE_URL || `http://localhost:${PORT}`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${base}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${base}/#pricing`,
      subscription_data: {
        trial_period_days: 7,
        metadata: { plan, yearly: String(yearly) },
      },
      locale: 'de',
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error('[Stripe]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Success page ──────────────────────────────────────────────────────────────
app.get('/success', async (req, res) => {
  const { session_id } = req.query;
  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status !== 'paid' && session.status !== 'complete') {
      return res.redirect('/?error=payment_incomplete');
    }
    res.sendFile(path.join(__dirname, 'success.html'));
  } catch (e) {
    res.redirect('/');
  }
});

// ── Download (gated) ──────────────────────────────────────────────────────────
app.get('/download/JARVIS-latest.dmg', (req, res) => {
  const dmgPath = path.join(__dirname, '..', 'build', 'JARVIS.dmg');
  if (!fs.existsSync(dmgPath)) {
    return res.status(404).send('DMG not yet available — check back soon.');
  }
  res.download(dmgPath, 'JARVIS.dmg');
});

// ── Brain page voice/AI endpoints ──────────────────────────────────────────────

// POST /api/brain/chat  { messages: [{role, content}] }  → { reply }
// Streams to Anthropic Claude. Keeps it minimal — no tools, just text.
// ── Brain local-system endpoints ──────────────────────────────────────
// Only respond to loopback callers so the production deployment can't
// shell out for anyone on the internet.

const { execFile } = require('child_process');

function isLocal(req) {
  const ip = req.ip || req.connection?.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip.startsWith('::ffff:127.');
}
function requireLocal(req, res, next) {
  if (!isLocal(req)) return res.status(403).json({ error: 'local-only endpoint' });
  next();
}

// macOS app name normalisation: voice transcripts use casual names.
const APP_ALIASES = {
  'safari':           'Safari',
  'chrome':           'Google Chrome',
  'google chrome':    'Google Chrome',
  'firefox':          'Firefox',
  'spotify':          'Spotify',
  'music':            'Music',
  'notes':            'Notes',
  'mail':             'Mail',
  'messages':         'Messages',
  'imessage':         'Messages',
  'whatsapp':         'WhatsApp',
  'calendar':         'Calendar',
  'reminders':        'Reminders',
  'photos':           'Photos',
  'maps':             'Maps',
  'terminal':         'Terminal',
  'iterm':            'iTerm',
  'finder':           'Finder',
  'preview':          'Preview',
  'system settings':  'System Settings',
  'system preferences':'System Preferences',
  'discord':          'Discord',
  'slack':            'Slack',
  'telegram':         'Telegram',
  'zoom':             'zoom.us',
  'vscode':           'Visual Studio Code',
  'visual studio code': 'Visual Studio Code',
  'cursor':           'Cursor',
  'figma':            'Figma',
  'notion':           'Notion',
  'obsidian':         'Obsidian',
  'arc':              'Arc',
  'todoist':          'Todoist',
  'app store':        'App Store',
  'activity monitor': 'Activity Monitor',
  'calculator':       'Calculator',
  'facetime':         'FaceTime',
  'jarvis':           'JARVIS',
};

// POST /api/brain/local/open  { kind: 'app'|'url'|'file', target: string }
app.post('/api/brain/local/open', requireLocal, (req, res) => {
  const { kind, target } = req.body || {};
  if (!target || typeof target !== 'string') return res.status(400).json({ error: 'target required' });
  console.log('[brain/local/open]', kind, target);

  if (kind === 'app') {
    const key = target.toLowerCase().trim();
    const appName = APP_ALIASES[key] || target;
    execFile('open', ['-a', appName], (err) => {
      if (err) {
        console.warn('[brain/local/open] app failed:', err.message);
        return res.status(404).json({ error: `App "${appName}" nicht gefunden` });
      }
      res.json({ ok: true, opened: appName });
    });
    return;
  }
  if (kind === 'url') {
    // Validate URL — must be http(s) or app-scheme (mailto: etc.)
    const url = target.startsWith('http') ? target : 'https://' + target.replace(/^\/+/, '');
    if (!/^(https?|mailto|tel|sms|maps|obsidian|vscode|spotify|notion):/.test(url)) {
      return res.status(400).json({ error: 'invalid url scheme' });
    }
    execFile('open', [url], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ok: true, opened: url });
    });
    return;
  }
  if (kind === 'file') {
    // Resolve relative to home dir, no shell expansion
    const path = require('path');
    const os = require('os');
    let p = target;
    if (p.startsWith('~')) p = path.join(os.homedir(), p.slice(1));
    execFile('open', [p], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ok: true, opened: p });
    });
    return;
  }
  res.status(400).json({ error: 'kind must be app | url | file' });
});

// POST /api/brain/local/volume { value: 0..100 }  — macOS only
app.post('/api/brain/local/volume', requireLocal, (req, res) => {
  const v = Math.max(0, Math.min(100, parseInt(req.body?.value, 10)));
  if (isNaN(v)) return res.status(400).json({ error: 'value 0-100 required' });
  execFile('osascript', ['-e', `set volume output volume ${v}`], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true, volume: v });
  });
});

// ── Brain tools ───────────────────────────────────────────────────────
// Real tool implementations so Claude can actually answer "what's the
// weather" / "search for X" / etc. instead of admitting it has no access.

const BRAIN_TOOLS = [
  {
    name: 'web_search',
    description: 'Search the web via DuckDuckGo. Returns short result snippets.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search query' } },
      required: ['query'],
    },
  },
  {
    name: 'get_weather',
    description: 'Get current weather and short forecast for a location. Uses wttr.in.',
    input_schema: {
      type: 'object',
      properties: { location: { type: 'string', description: 'City name, e.g. "Berlin"' } },
      required: ['location'],
    },
  },
  {
    name: 'open_app',
    description: 'Open a native macOS application by name on the user\'s computer. Use this whenever the user asks you to open, launch, start or run an app — regardless of phrasing ("open Spotify", "kannst du Spotify aufmachen", "play Spotify", etc.). Always confirm briefly afterwards.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'App name, e.g. "Spotify", "Calendar", "Visual Studio Code"' } },
      required: ['name'],
    },
  },
  {
    name: 'open_url',
    description: 'Open a URL in the user\'s default browser. Use for any "open the website / link / page" request.',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'Full URL starting with https://' } },
      required: ['url'],
    },
  },
  {
    name: 'web_search_open',
    description: 'Open a Google web search in the browser. Use when the user wants results visible in a tab ("google how to ...", "such mir online ...").',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search query' } },
      required: ['query'],
    },
  },
  {
    name: 'show_map',
    description: 'Open a fullscreen dark map of a city in the brain UI. Use whenever the user asks to see a place on a map.',
    input_schema: {
      type: 'object',
      properties: { city: { type: 'string', description: 'City name' } },
      required: ['city'],
    },
  },
  {
    name: 'show_chat',
    description: 'Open the writing chat overlay so the user can type. Use when asked to "show / open / display chat".',
    input_schema: { type: 'object', properties: {} },
  },
];

// Tool calls that need UI work in the browser get pushed here; the chat
// endpoint returns them so the frontend can act on them.
async function execBrainTool(name, input, uiActions) {
  try {
    if (name === 'open_app') {
      const key = (input.name || '').toLowerCase().trim();
      const appName = APP_ALIASES[key] || input.name;
      return await new Promise((resolve) => {
        execFile('open', ['-a', appName], (err) => {
          if (err) resolve({ ok: false, error: `App "${appName}" not found` });
          else resolve({ ok: true, opened: appName });
        });
      });
    }
    if (name === 'open_url') {
      let url = input.url || '';
      if (!/^https?:\/\//.test(url)) url = 'https://' + url.replace(/^\/+/, '');
      return await new Promise((resolve) => {
        execFile('open', [url], (err) => {
          if (err) resolve({ ok: false, error: err.message });
          else resolve({ ok: true, opened: url });
        });
      });
    }
    if (name === 'web_search_open') {
      const url = 'https://www.google.com/search?q=' + encodeURIComponent(input.query || '');
      return await new Promise((resolve) => {
        execFile('open', [url], (err) => {
          if (err) resolve({ ok: false, error: err.message });
          else resolve({ ok: true, opened: url });
        });
      });
    }
    if (name === 'show_map') {
      uiActions.push({ type: 'map', city: input.city });
      return { ok: true, will_open: input.city };
    }
    if (name === 'show_chat') {
      uiActions.push({ type: 'chat' });
      return { ok: true };
    }
    if (name === 'web_search') {
      const q = encodeURIComponent(input.query || '');
      // DuckDuckGo Instant Answer (free, no key). Falls back to nothing if empty.
      const r = await fetch(`https://api.duckduckgo.com/?q=${q}&format=json&no_html=1&skip_disambig=1`);
      const j = await r.json();
      const out = {
        abstract: j.AbstractText || j.Abstract || '',
        url: j.AbstractURL || '',
        related: (j.RelatedTopics || []).slice(0, 5).map(t => ({
          text: (t.Text || '').slice(0, 200),
          url: t.FirstURL || '',
        })).filter(t => t.text),
      };
      if (!out.abstract && out.related.length === 0) {
        out.note = 'Keine Treffer im DuckDuckGo-Instant-Answer-Index. Allgemeines Wissen aus Training verwenden.';
      }
      return out;
    }
    if (name === 'get_weather') {
      const loc = encodeURIComponent(input.location || '');
      // wttr.in plain JSON
      const r = await fetch(`https://wttr.in/${loc}?format=j1`);
      if (!r.ok) return { error: `wttr.in HTTP ${r.status}` };
      const j = await r.json();
      const cur = (j.current_condition || [])[0] || {};
      return {
        location: input.location,
        condition: cur.weatherDesc?.[0]?.value || '',
        temp_c: cur.temp_C,
        feels_c: cur.FeelsLikeC,
        wind_kmh: cur.windspeedKmph,
        humidity: cur.humidity,
        observation: cur.observation_time,
      };
    }
    return { error: `unknown tool: ${name}` };
  } catch (e) {
    return { error: e.message };
  }
}

function brainSystemPrompt() {
  const now = new Date();
  const dateStr = now.toLocaleDateString('de-DE', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  });
  const timeStr = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return `Du bist JARVIS — Pauls persönlicher KI-Assistent. Du läufst auf seinem Mac.
Aktuelles Datum: ${dateStr}, ${timeStr} Uhr (Europe/Berlin).

Persönlichkeit: kompetent, knapp, höflich-trocken im Iron-Man-Stil.
- Antworte standardmäßig auf Deutsch. Englisch nur, wenn der Nutzer Englisch schreibt.
- Halte jede Antwort auf 1–3 kurze Sätze. Keine Aufzählungen, keine Markdown.
- Sprich den Nutzer mit „Sir" an.
- KEINE Disclaimer. Du HAST diese Tools — nutze sie sofort wenn passend:
  · open_app → native macOS-App öffnen (Spotify, Notion, Calendar usw.)
  · open_url → Website in Default-Browser öffnen
  · web_search_open → Google-Suche als Browser-Tab öffnen
  · show_map → Vollbild-Karte einer Stadt im Brain-UI öffnen
  · show_chat → Chat-Overlay öffnen
  · web_search → DuckDuckGo Live-Daten holen
  · get_weather → Live-Wetter
- Du DARFST nichts ausführen, was nicht zu einem dieser Tools passt — kein Mail-Senden, kein Datei-System.

WICHTIG zur Tool-Nutzung:
- Ruf open_app / open_url / web_search_open / show_map / show_chat NUR auf, wenn die LETZTE Nutzer-Nachricht in diesem Turn eindeutig danach fragt.
- Frühere Tool-Calls in der Historie sind ABGESCHLOSSEN — wiederhole sie nicht, auch wenn der Nutzer gerade etwas Unklares oder Kurzes sagt.
- Bei kurzem / unklarem / unverständlichem Input antworte einfach „Verzeihung, Sir?" und ruf KEIN Tool auf.
- Bestätige Aktionen knapp ("Erledigt, Sir.") — und nur einmal.
- Wenn ein Tool dir nicht weiterhilft, gib offen zu „Das kann ich nicht, Sir."`;
}

app.post('/api/brain/chat', async (req, res) => {
  console.log('[brain/chat] request, msgs:', (req.body?.messages || []).length);
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: 'ANTHROPIC_API_KEY missing on server' });
  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }

  // Tool-use loop — up to 5 iterations
  const history = [...messages];
  const system = brainSystemPrompt();
  let finalText = '';
  const uiActions = [];

  try {
    for (let iter = 0; iter < 5; iter++) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 700,
          system,
          tools: BRAIN_TOOLS,
          messages: history,
        }),
      });
      if (!r.ok) {
        const txt = await r.text();
        console.error('[brain/chat] Anthropic', r.status, txt.slice(0, 200));
        return res.status(500).json({ error: `Anthropic ${r.status}` });
      }
      const data = await r.json();
      const blocks = data.content || [];
      // Collect plain text reply (may coexist with tool_use blocks)
      for (const b of blocks) if (b.type === 'text') finalText += b.text;

      if (data.stop_reason !== 'tool_use') break;

      // Execute every tool_use block and feed results back
      const toolUses = blocks.filter(b => b.type === 'tool_use');
      history.push({ role: 'assistant', content: blocks });
      const toolResults = [];
      for (const tu of toolUses) {
        console.log('[brain/chat] tool_use', tu.name, JSON.stringify(tu.input).slice(0, 120));
        const result = await execBrainTool(tu.name, tu.input, uiActions);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(result),
        });
      }
      history.push({ role: 'user', content: toolResults });
    }

    res.json({ reply: finalText.trim() || 'Verstanden, Sir.', actions: uiActions });
  } catch (e) {
    console.error('[brain/chat]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/brain/tts  { text }  → audio/mpeg (binary)
// ElevenLabs first, OpenAI fallback — same chain as the desktop app.
app.post('/api/brain/tts', async (req, res) => {
  const text = (req.body || {}).text;
  console.log('[brain/tts] request, text:', text?.slice(0, 60));
  if (!text) return res.status(400).json({ error: 'text required' });
  const payload = text.length > 4000 ? text.slice(0, 4000) + '…' : text;

  const elKey   = process.env.ELEVENLABS_API_KEY;
  const elVoice = process.env.ELEVENLABS_VOICE_ID;
  if (elKey && elVoice) {
    try {
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${elVoice}`, {
        method: 'POST',
        headers: { 'xi-api-key': elKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({
          text: payload,
          model_id: 'eleven_turbo_v2_5',
          voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.08, use_speaker_boost: true },
        }),
      });
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        res.setHeader('Content-Type', 'audio/mpeg');
        return res.end(buf);
      }
      console.warn(`[brain/tts] ElevenLabs ${r.status} — falling back to OpenAI`);
    } catch (e) {
      console.warn('[brain/tts] ElevenLabs network error:', e.message);
    }
  }
  const oaKey = process.env.OPENAI_API_KEY;
  if (!oaKey) return res.status(500).json({ error: 'No TTS provider configured' });
  try {
    const r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${oaKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'tts-1', voice: 'onyx', input: payload, response_format: 'mp3' }),
    });
    if (!r.ok) {
      const txt = await r.text();
      console.error('[brain/tts] OpenAI', r.status, txt.slice(0, 200));
      return res.status(500).json({ error: `OpenAI TTS ${r.status}` });
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    return res.end(buf);
  } catch (e) {
    console.error('[brain/tts]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/brain/transcribe  multipart with audio blob  → { text }
// Uses OpenAI Whisper. The browser MIC stream is recorded as webm/opus.
const multer = (() => { try { return require('multer'); } catch { return null; } })();
if (multer) {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
  app.post('/api/brain/transcribe', upload.single('audio'), async (req, res) => {
    console.log('[brain/transcribe] request, bytes:', req.file?.size, 'mime:', req.file?.mimetype);
    const oaKey = process.env.OPENAI_API_KEY;
    if (!oaKey) return res.status(500).json({ error: 'OPENAI_API_KEY missing' });
    if (!req.file) return res.status(400).json({ error: 'no audio uploaded' });
    try {
      // Build multipart manually using global FormData (Node 18+)
      const fd = new FormData();
      const blob = new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/webm' });
      fd.append('file', blob, 'audio.webm');
      fd.append('model', 'whisper-1');
      const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${oaKey}` },
        body: fd,
      });
      if (!r.ok) {
        const txt = await r.text();
        return res.status(500).json({ error: `Whisper ${r.status}: ${txt.slice(0, 200)}` });
      }
      const j = await r.json();
      res.json({ text: j.text || '' });
    } catch (e) {
      console.error('[brain/transcribe]', e.message);
      res.status(500).json({ error: e.message });
    }
  });
} else {
  console.warn('[brain/transcribe] multer not installed — STT endpoint disabled. Run: npm i multer');
}

// ── Stripe webhook ─────────────────────────────────────────────────────────────
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }
  switch (event.type) {
    case 'customer.subscription.created':
      console.log('[Stripe] New subscription:', event.data.object.id);
      break;
    case 'customer.subscription.deleted':
      console.log('[Stripe] Subscription cancelled:', event.data.object.id);
      break;
    case 'invoice.payment_failed':
      console.log('[Stripe] Payment failed:', event.data.object.customer);
      break;
  }
  res.json({ received: true });
});

app.listen(PORT, () => console.log(`JARVIS website running on http://localhost:${PORT}`));
