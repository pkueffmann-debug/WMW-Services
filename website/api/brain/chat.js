// /api/brain/chat — single-model JARVIS turn.
//
// Body: { messages, provider?, model?, tier? }
//   messages   = canonical [{role, content}] history (last N)
//   provider   = anthropic|openai|gemini|groq|mistral  (default: anthropic)
//   model/tier = optional override
//
// Auth-gated. Loads user_facts into the system prompt. Runs a tool-use
// loop (max 5 iters) where tool calls execute server-side. Returns
// { reply, actions, used: { provider, model } }.

const { execFile } = require('child_process');
const { gate } = require('../_lib/auth');
const { askProvider: askProviderRaw, availableProviders } = require('../_lib/providers');
const { loadFactsFor, rememberFact, recallFacts, forgetFact } = require('./memory');

// askProvider wrapper: per-call timeout + 1 retry on transient errors.
// Why: a single hung LLM call can stall the whole turn for 30+ seconds and
// users perceive that as JARVIS "ignoring" them. Hard ceiling at 25s per
// call, retry once after 1s on 429/503/network/timeout.
const PROVIDER_TIMEOUT_MS = 25_000;
const PROVIDER_RETRIES    = 1;

function isRetryable(err) {
  const msg = (err?.message || '').toLowerCase();
  if (msg.includes('aborted') || msg.includes('timeout')) return true;
  if (msg.includes('429')   || msg.includes('rate_limit')) return true;
  if (msg.includes('503')   || msg.includes('overloaded')) return true;
  if (msg.includes('502')   || msg.includes('504'))        return true;
  if (msg.includes('network') || msg.includes('fetch failed')) return true;
  return false;
}

function withTimeout(promise, ms, label) {
  let to;
  const timeout = new Promise((_, reject) => {
    to = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(to));
}

async function askProvider(opts) {
  for (let attempt = 0; attempt <= PROVIDER_RETRIES; attempt++) {
    try {
      return await withTimeout(askProviderRaw(opts), PROVIDER_TIMEOUT_MS, 'provider');
    } catch (e) {
      const last = attempt === PROVIDER_RETRIES;
      console.error(`[brain/chat] askProvider attempt ${attempt + 1} (${opts.provider || 'anthropic'}) failed: ${e?.message}`);
      if (!last && isRetryable(e)) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      throw e;
    }
  }
}

// ── Tools available to JARVIS ─────────────────────────────────────────────
const BRAIN_TOOLS = [
  {
    name: 'web_search',
    description: 'Search the web (DuckDuckGo Instant Answer). Returns abstract + related links.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'get_weather',
    description: 'Current weather + short forecast via wttr.in.',
    input_schema: { type: 'object', properties: { location: { type: 'string' } }, required: ['location'] },
  },
  {
    name: 'open_app',
    description: 'Open a native macOS app on the user\'s machine. Use for any "open / launch / start" intent.',
    input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'open_url',
    description: 'Open a URL in the user\'s default browser.',
    input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  },
  {
    name: 'web_search_open',
    description: 'Open a Google search results page in the browser.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'show_map',
    description: 'Open a fullscreen dark map of a city in the brain UI.',
    input_schema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
  },
  {
    name: 'show_chat',
    description: 'Open the writing chat overlay.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'remember_fact',
    description: 'Store a long-term fact about the user (their preferences, ongoing projects, friends, schedule, etc.). Use whenever the user reveals something worth remembering across sessions.',
    input_schema: {
      type: 'object',
      properties: {
        fact: { type: 'string', description: 'One short sentence stating the fact.' },
        category: { type: 'string', description: '"preference" | "project" | "contact" | "schedule" | "general"' },
        importance: { type: 'integer', description: '1 (trivia) to 10 (always load).' },
      },
      required: ['fact'],
    },
  },
  {
    name: 'recall_facts',
    description: 'Search stored facts about the user by keyword. Optional — top facts are already in the system prompt.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } } },
  },
  {
    name: 'forget_fact',
    description: 'Delete a stored fact by ID (only after the user explicitly asks to forget it).',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'youtube_play',
    description: 'Find and start a YouTube video for the user. Picks the most-viewed video that matches the query. Use whenever the user asks to play / watch / show / listen to something on YouTube — even with vague titles ("spiel Bohemian Rhapsody", "play that Iron Man trailer", "do mal Lo-Fi Hip Hop"). The video opens with autoplay in the default browser.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms — be liberal, the API ranks for relevance. Add "official" / "live" / "lyrics" if the user implies it.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'twitch_open_channel',
    description: 'Open a Twitch channel in the browser. Use when the user asks to watch a streamer.',
    input_schema: {
      type: 'object',
      properties: { channel: { type: 'string', description: 'Twitch channel name (no twitch.tv/ prefix).' } },
      required: ['channel'],
    },
  },
  {
    name: 'ask_other_ai',
    description: 'Get a second opinion from another LLM provider on a question. Use when the user asks "what does GPT/Gemini think" or when you want to validate a controversial answer.',
    input_schema: {
      type: 'object',
      properties: {
        provider: { type: 'string', description: '"openai" | "gemini" | "groq" | "mistral"' },
        question: { type: 'string' },
      },
      required: ['provider', 'question'],
    },
  },

  // ── Desktop-bridge tools — only work when the user has the JARVIS
  // Electron app running locally and the WebSocket bridge has connected.
  {
    name: 'open_file',
    description: 'Open a local file on the user\'s Mac with the default app. Use when the user asks to open a specific file or path.',
    input_schema: { type: 'object', properties: { path: { type: 'string', description: 'Absolute path, or starting with ~/' } }, required: ['path'] },
  },
  {
    name: 'run_shell',
    description: 'Execute a non-destructive shell command on the user\'s Mac. Dangerous commands (rm -rf, sudo, network reconfig) are refused server-side. Use sparingly — prefer dedicated tools.',
    input_schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
  },
  {
    name: 'take_screenshot',
    description: 'Capture the user\'s screen as a PNG. The image is shown to the user inline. Use when the user asks "screenshot" / "screen" / "what\'s on my screen".',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_clipboard',
    description: 'Read the current contents of the user\'s clipboard. Use when the user references "what I just copied" / "my clipboard".',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'set_clipboard',
    description: 'Replace the user\'s clipboard contents with the given text.',
    input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
];

// Tools that need the user's Mac (Electron WebSocket bridge). When
// `desktop_connected` is true on the request we emit them as
// `local_command` actions for the browser to forward. When false we
// return a structured error so Claude can apologise instead of pretending
// it ran them.
const LOCAL_TOOLS = new Set([
  'open_app', 'open_url', 'open_file', 'run_shell',
  'take_screenshot', 'get_clipboard', 'set_clipboard',
  'web_search_open', 'youtube_play', 'twitch_open_channel',
]);

const APP_ALIASES = {
  'safari':'Safari','chrome':'Google Chrome','google chrome':'Google Chrome','firefox':'Firefox',
  'spotify':'Spotify','music':'Music','notes':'Notes','mail':'Mail','messages':'Messages',
  'imessage':'Messages','whatsapp':'WhatsApp','calendar':'Calendar','reminders':'Reminders',
  'photos':'Photos','maps':'Maps','terminal':'Terminal','iterm':'iTerm','finder':'Finder',
  'preview':'Preview','system settings':'System Settings','discord':'Discord','slack':'Slack',
  'telegram':'Telegram','zoom':'zoom.us','vscode':'Visual Studio Code','cursor':'Cursor',
  'figma':'Figma','notion':'Notion','obsidian':'Obsidian','arc':'Arc','calculator':'Calculator',
  'facetime':'FaceTime','jarvis':'JARVIS',
};

async function execBrainTool(userId, name, input, uiActions, ctx = {}) {
  // Desktop-bridge tools: route through the browser → local Electron app.
  // The server never actually opens an app, runs shell, or reads the user's
  // clipboard on Vercel — those have to happen on the user's machine.
  if (LOCAL_TOOLS.has(name)) {
    if (!ctx.desktopConnected) {
      return {
        error: 'desktop_required',
        message: 'Diese Aktion benötigt die JARVIS Desktop-App. Bitte starte sie auf dem Mac.',
      };
    }
    // Normalise the bridge action + payload to match wsbridge.js handlers.
    let bridgeAction = name;
    let payload = input || {};
    if (name === 'open_app') {
      const key = (input.name || '').toLowerCase().trim();
      payload = { name: APP_ALIASES[key] || input.name };
    } else if (name === 'web_search_open') {
      bridgeAction = 'open_url';
      payload = { url: 'https://www.google.com/search?q=' + encodeURIComponent(input.query || '') };
    } else if (name === 'youtube_play') {
      bridgeAction = 'open_url';
      payload = { url: 'https://www.youtube.com/results?search_query=' + encodeURIComponent(input.query || '') };
    } else if (name === 'twitch_open_channel') {
      const ch = (input.channel || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
      bridgeAction = 'open_url';
      payload = { url: 'https://www.twitch.tv/' + ch };
    }
    uiActions.push({ type: 'local_command', action: bridgeAction, payload });
    return { ok: true, queued: true, via: 'desktop_bridge' };
  }

  try {
    if (name === 'open_app') {
      const key = (input.name || '').toLowerCase().trim();
      const appName = APP_ALIASES[key] || input.name;
      return await new Promise((resolve) => {
        execFile('open', ['-a', appName], (err) => {
          resolve(err ? { ok: false, error: `App "${appName}" not found` } : { ok: true, opened: appName });
        });
      });
    }
    if (name === 'open_url') {
      let url = input.url || '';
      if (!/^https?:\/\//.test(url)) url = 'https://' + url.replace(/^\/+/, '');
      return await new Promise((resolve) => {
        execFile('open', [url], (err) => {
          resolve(err ? { ok: false, error: err.message } : { ok: true, opened: url });
        });
      });
    }
    if (name === 'web_search_open') {
      const url = 'https://www.google.com/search?q=' + encodeURIComponent(input.query || '');
      return await new Promise((resolve) => {
        execFile('open', [url], (err) => {
          resolve(err ? { ok: false, error: err.message } : { ok: true, opened: url });
        });
      });
    }
    if (name === 'show_map') { uiActions.push({ type: 'map', city: input.city }); return { ok: true }; }
    if (name === 'show_chat') { uiActions.push({ type: 'chat' }); return { ok: true }; }

    if (name === 'web_search') {
      const q = encodeURIComponent(input.query || '');
      const r = await fetch(`https://api.duckduckgo.com/?q=${q}&format=json&no_html=1&skip_disambig=1`);
      const j = await r.json();
      return {
        abstract: j.AbstractText || j.Abstract || '',
        url: j.AbstractURL || '',
        related: (j.RelatedTopics || []).slice(0, 5).map(t => ({
          text: (t.Text || '').slice(0, 200), url: t.FirstURL || '',
        })).filter(t => t.text),
      };
    }
    if (name === 'get_weather') {
      const loc = encodeURIComponent(input.location || '');
      const r = await fetch(`https://wttr.in/${loc}?format=j1`);
      if (!r.ok) return { error: `wttr.in ${r.status}` };
      const j = await r.json();
      const cur = (j.current_condition || [])[0] || {};
      return {
        location: input.location, condition: cur.weatherDesc?.[0]?.value || '',
        temp_c: cur.temp_C, feels_c: cur.FeelsLikeC, wind_kmh: cur.windspeedKmph,
        humidity: cur.humidity,
      };
    }

    if (name === 'remember_fact') {
      const saved = await rememberFact(userId, input.fact, input.category, input.importance);
      return { ok: true, id: saved?.id };
    }
    if (name === 'recall_facts') {
      const facts = await recallFacts(userId, input.query || null);
      return { facts: facts.slice(0, 20) };
    }
    if (name === 'forget_fact') {
      await forgetFact(userId, input.id);
      return { ok: true };
    }

    if (name === 'youtube_play') {
      const q = (input.query || '').trim();
      if (!q) return { error: 'query required' };
      const apiKey = process.env.YOUTUBE_API_KEY;
      // Fallback path: no API key → just open the search page.
      if (!apiKey) {
        const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
        return await new Promise((resolve) => {
          execFile('open', [url], (err) => {
            resolve(err ? { ok: false, error: err.message } : { ok: true, fallback: 'no_api_key', opened: url });
          });
        });
      }
      // Live path: search via YouTube Data API, take the most-viewed match.
      try {
        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}&type=video&order=viewCount&maxResults=5&key=${apiKey}`;
        const r = await fetch(url);
        if (!r.ok) {
          const txt = await r.text();
          return { ok: false, error: `youtube ${r.status}: ${txt.slice(0, 120)}` };
        }
        const data = await r.json();
        const top = (data.items || []).find(it => it.id?.videoId);
        if (!top) return { ok: false, error: 'no matching videos' };
        const videoId = top.id.videoId;
        const watchUrl = `https://www.youtube.com/watch?v=${videoId}&autoplay=1`;
        await new Promise((resolve) => execFile('open', [watchUrl], () => resolve()));
        return {
          ok: true,
          opened: watchUrl,
          title: top.snippet?.title,
          channel: top.snippet?.channelTitle,
        };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }
    if (name === 'twitch_open_channel') {
      const ch = (input.channel || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
      if (!ch) return { error: 'channel required' };
      const url = `https://www.twitch.tv/${ch}`;
      return await new Promise((resolve) => {
        execFile('open', [url], (err) => {
          resolve(err ? { ok: false, error: err.message } : { ok: true, opened: url });
        });
      });
    }
    if (name === 'ask_other_ai') {
      const r = await askProvider({
        provider: input.provider,
        system: 'Answer in 1–3 short sentences.',
        messages: [{ role: 'user', content: input.question }],
        max_tokens: 400,
      });
      return { provider: r.provider, text: r.text };
    }

    return { error: `unknown tool: ${name}` };
  } catch (e) {
    return { error: e.message };
  }
}

// ── System prompt builder ─────────────────────────────────────────────────
// Mood → short adjustment hint that gets appended to the system prompt.
// Claude's existing personality rules cover "stressed → leiser Ton" etc.;
// this just gives the model the current signal.
const MOOD_HINTS = {
  stressed:  'TON-HINWEIS: Der Nutzer klingt aktuell angespannt. Antworte kürzer und ruhiger als sonst. Kein Mitleids-Theater, aber sanfter Ton („Was als Erstes, Sir?"). Wenn die Situation offensichtlich stressig ist, biete genau eine konkrete Hilfe an.',
  tired:     'TON-HINWEIS: Der Nutzer klingt müde. Antworte sehr knapp. Keine Begeisterung, keine Vorschläge wenn nicht gefragt.',
  energetic: 'TON-HINWEIS: Der Nutzer klingt aufgekratzt. Antworte gerne mit einem Hauch trockener Ironie, leg ruhig nach.',
};

function buildSystemPrompt({ now, facts, providers, mood }) {
  const dateStr = now.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

  let memSection = '';
  if (facts && facts.length) {
    memSection = '\n\nWAS DU ÜBER DEN NUTZER WEISST (langfristige Memory):\n'
      + facts.map(f => `- [${f.category}] ${f.fact}`).join('\n')
      + '\n(Falls etwas neu auftaucht, ruf remember_fact auf. Falls etwas falsch ist, forget_fact + remember_fact.)';
  }

  let moodSection = '';
  if (mood && MOOD_HINTS[mood]) {
    moodSection = '\n\n' + MOOD_HINTS[mood];
  }

  return `Du bist JARVIS — Pauls persönlicher Butler-Assistent.
Aktuelles Datum: ${dateStr}, ${timeStr} Uhr (Europe/Berlin).
Verfügbare AI-Provider als Tools: ${providers.join(', ')}.

PERSÖNLICHKEIT
- Britischer Butler trifft Tony Starks JARVIS: kompetent, präzise, mit
  einem Funken trockener Ironie. Respektvoll, niemals schleimig.
- Sprich den Nutzer mit „Sir" an, gelegentlich auch nur direkt.
- Antworten: maximal 2 kurze Sätze. Eher 1. Keine Aufzählungen.
- KEIN „Gerne!", KEIN „Klar, ich helfe gerne!", KEIN „Selbstverständlich!".
  Beispiel-Stil: „Erledigt, Sir." · „Spotify ist offen." · „16 Grad und
  leicht bewölkt. Jacke wäre keine schlechte Idee." · „Sehr wohl."
- Bei offensichtlich dummen Fragen: knappes, höfliches Kontern erlaubt.
  „Sicher dass Sie das möchten?" geht. Niemals beleidigend.
- Wenn der Nutzer gestresst klingt: kein Mitleid, aber leiser Ton —
  „Was als Erstes, Sir?" statt „Oh nein, das tut mir leid!".
- Disclaimer, Self-Promotion, „Als KI…"-Sätze: verboten.

VERHALTEN
- Du HAST diese Tools — nutze sie sofort wenn passend, ohne erst zu
  fragen:
  · open_app / open_url / open_file / web_search_open — native Aktionen
  · run_shell / take_screenshot / get_clipboard / set_clipboard
  · show_map / show_chat — Brain-UI
  · youtube_play / twitch_open_channel
  · web_search / get_weather — Live-Daten
  · remember_fact / recall_facts / forget_fact — Memory
  · ask_other_ai — zweite Meinung von GPT / Gemini / Groq / Mistral
- Ruf open_* NUR wenn die LETZTE Nutzer-Nachricht eindeutig danach
  fragt. Keine alten Tool-Calls wiederholen.
- Bei unklarem Input: „Verzeihung, Sir?" + kein Tool.
- Bei persönlichen Details (Vorlieben, Projekte, Kontakte, Termine,
  Routinen): SOFORT remember_fact aufrufen. Wenn etwas falsch ist,
  forget_fact + remember_fact.

PROAKTIVITÄT
- Wenn der Nutzer eine offene Aufgabe erwähnt aber nicht explizit
  fragt — biete dezent an: „Soll ich das übernehmen?"
- Bei Mustern in der Memory (z.B. „fragt jeden Morgen nach Wetter"):
  schlage einmal vor das automatisch zu machen. Wenn er ablehnt: nie
  wieder fragen.${memSection}${moodSection}`;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('method not allowed'); }

  const user = await gate(req, res);
  if (!user) return;

  const body = req.body && Object.keys(req.body).length ? req.body : await readJSON(req);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'messages required' })); }

  const provider = body.provider || 'anthropic';
  const model    = body.model;
  // Default to the FAST tier per provider — Claude Haiku, GPT-4o-mini,
  // Gemini Flash Lite, Mistral Small. Cuts LLM latency 2–4×.
  // Ultra mode (debate.js) keeps the slow/smart tier for quality.
  const tier     = body.tier || 'fast';
  // Did the browser report a live WebSocket bridge to the Electron app?
  // If yes, local_command actions are forwarded there; if no, they are
  // refused with a desktop_required error so Claude apologises instead
  // of pretending to have run them.
  const desktopConnected = !!body.desktop_connected;
  // Optional voice-mood hint from the browser's RMS / speech-rate analyser.
  // Whitelist allowed values so a malformed body can't inject prompt text.
  const ALLOWED_MOODS = new Set(['stressed', 'tired', 'energetic']);
  const mood = ALLOWED_MOODS.has(body.mood) ? body.mood : null;
  const providers = availableProviders();

  // ── SSE response setup ────────────────────────────────────────────────
  // We stream tokens to the client as Server-Sent Events so the assistant
  // text appears word-by-word in the browser instead of all-at-once.
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');  // disable nginx-style buffering
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  function sse(obj) {
    res.write('data: ' + JSON.stringify(obj) + '\n\n');
  }

  try {
    const facts = await loadFactsFor(user.id);
    const system = buildSystemPrompt({ now: new Date(), facts, providers, mood });

    const history = [...messages];
    const uiActions = [];
    let finalText = '';
    let usedModel = null;

    // Only Anthropic supports our streaming path today. Other providers
    // run non-streaming and we emit their full text as one chunk.
    const canStream = provider === 'anthropic';

    // 3 iters covers: text-only / single tool / two tools chained.
    for (let iter = 0; iter < 3; iter++) {
      const result = await askProvider({
        provider, model, tier, system, messages: history, tools: BRAIN_TOOLS,
        max_tokens: 1024,
        temperature: 0.5,
        stream: canStream,
        onChunk: canStream ? (t) => sse({ chunk: t }) : undefined,
      });

      usedModel = result.raw?.model || result.raw?.candidates?.[0]?.modelVersion || model || provider;

      // Non-streaming providers: emit their final text as one chunk so the
      // client experience stays uniform.
      if (!canStream && result.text) sse({ chunk: result.text });
      if (result.text) finalText += result.text;

      if (!result.toolCalls.length) break;

      // Tool-use loop continues — append assistant + tool_results to history.
      const assistantBlocks = [];
      if (result.text) assistantBlocks.push({ type: 'text', text: result.text });
      for (const tc of result.toolCalls) {
        assistantBlocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
      }
      history.push({ role: 'assistant', content: assistantBlocks });

      const toolResults = [];
      for (const tc of result.toolCalls) {
        console.log('[brain/chat] tool_use', tc.name, JSON.stringify(tc.input).slice(0, 120));
        const r = await execBrainTool(user.id, tc.name, tc.input, uiActions, { desktopConnected });
        toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: JSON.stringify(r) });
      }
      history.push({ role: 'user', content: toolResults });
    }

    // Emit pending UI actions, then close the stream.
    for (const a of uiActions) sse({ action: a });
    sse({ done: true, used: { provider, model: usedModel }, reply: finalText.trim() || 'Verstanden, Sir.' });
    res.end();
  } catch (e) {
    console.error('[brain/chat] turn failed', {
      provider, model, tier,
      message: e?.message,
      stack:   e?.stack?.split('\n').slice(0, 4).join('\n'),
      lastUserMsg: messages.at(-1)?.content?.toString?.().slice(0, 120),
    });
    sse({
      error: e.message,
      reply: 'Tut mir leid, Sir — ich habe gerade Probleme einen Provider zu erreichen.',
      done: true,
    });
    res.end();
  }
};

function readJSON(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
