// /api/brain/execute — run code in a sandbox.
//
// Originally proxied to Piston's public API, but that became whitelist-only
// in Feb 2026. Current implementation:
//   - JavaScript: Node's built-in `vm` module with a restricted global set
//                 and a 5-s timeout. Stdout captured via overridden console.
//   - Python / Bash / TypeScript: gracefully refused with a helpful note.
//                 To re-enable, set PISTON_URL to a self-hosted Piston
//                 instance (engineer-man/piston Docker) and we'll proxy.
//
// Body shape: { language, code, stdin? }
// Response:   { language, stdout, stderr, output, exit_code, success, ... }

const vm = require('vm');
const { gate } = require('../_lib/auth');

const PISTON_URL = process.env.PISTON_URL || '';   // optional self-hosted

const MAX_CODE_BYTES   = 12 * 1024;
const JS_TIMEOUT_MS    = 5_000;
const PISTON_TIMEOUT_MS = 15_000;

const LANG_MAP = {
  javascript: 'js',
  js:         'js',
  node:       'js',
  python:     'python',
  py:         'python',
  python3:    'python',
  bash:       'bash',
  sh:         'bash',
  shell:      'bash',
  typescript: 'ts',
  ts:         'ts',
};

const PISTON_VERSIONS = {
  python: '3.10.0',
  js:     '18.15.0',
  bash:   '5.2.0',
  ts:     '5.0.3',
};

function readJSON(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

// ── JavaScript via Node's vm module ────────────────────────────────────
function safeStringify(v) {
  if (typeof v === 'string') return v;
  if (v === undefined) return 'undefined';
  if (v === null)      return 'null';
  try { return JSON.stringify(v); } catch { return String(v); }
}

function runJS(code) {
  const stdout = [];
  const stderr = [];
  const consoleProxy = {
    log:   (...a) => stdout.push(a.map(safeStringify).join(' ')),
    info:  (...a) => stdout.push(a.map(safeStringify).join(' ')),
    debug: (...a) => stdout.push(a.map(safeStringify).join(' ')),
    warn:  (...a) => stderr.push(a.map(safeStringify).join(' ')),
    error: (...a) => stderr.push(a.map(safeStringify).join(' ')),
  };
  // Whitelist of globals the sandbox can see. No require, no process, no
  // fetch, no child_process, no fs. The function-string idiom (Function
  // constructor) is still reachable but can't reach further than this set.
  const sandbox = {
    console: consoleProxy,
    setTimeout, setInterval, clearTimeout, clearInterval,
    Math, Date, JSON, Promise,
    Array, Object, String, Number, Boolean, RegExp, Map, Set,
    parseInt, parseFloat, isNaN, isFinite,
    Symbol, Error, TypeError, RangeError,
    encodeURIComponent, decodeURIComponent, encodeURI, decodeURI,
  };
  try {
    const result = vm.runInNewContext(code, sandbox, {
      timeout: JS_TIMEOUT_MS,
      displayErrors: true,
    });
    if (result !== undefined && stdout.length === 0) {
      stdout.push(safeStringify(result));
    }
    return {
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
      exit_code: 0,
      success: true,
      runtime: 'node-vm',
    };
  } catch (e) {
    return {
      stdout: stdout.join('\n'),
      stderr: (stderr.length ? stderr.join('\n') + '\n' : '') + (e.message || String(e)),
      exit_code: 1,
      success: false,
      runtime: 'node-vm',
    };
  }
}

// ── Optional: Piston proxy (self-hosted, opt-in via env) ───────────────
async function runPiston(language, code, stdin) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), PISTON_TIMEOUT_MS);
  try {
    const r = await fetch(PISTON_URL.replace(/\/$/, '') + '/api/v2/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language, version: PISTON_VERSIONS[language] || '*',
        files: [{ content: code }],
        stdin: (stdin || '').slice(0, 4096),
        run_timeout: 10_000, compile_timeout: 10_000,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    if (!r.ok) {
      const text = await r.text();
      return { error: `Piston ${r.status}: ${text.slice(0, 200)}` };
    }
    const j = await r.json();
    const run = j.run || {};
    return {
      stdout:    run.stdout || '',
      stderr:    run.stderr || '',
      exit_code: typeof run.code === 'number' ? run.code : null,
      success:   run.code === 0,
      runtime:   `piston/${j.language}@${j.version}`,
    };
  } catch (e) {
    clearTimeout(tid);
    return { error: e.name === 'AbortError' ? 'timeout' : e.message };
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
  const rawLang = (body.language || body.lang || '').toString().toLowerCase().trim();
  const code    = (body.code     || '').toString();
  const stdin   = (body.stdin    || '').toString();

  if (!rawLang) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'language required' })); }
  const lang = LANG_MAP[rawLang];
  if (!lang)    { res.statusCode = 400; return res.end(JSON.stringify({ error: `unsupported language: ${rawLang}` })); }
  if (!code.trim())                              { res.statusCode = 400; return res.end(JSON.stringify({ error: 'code is empty' })); }
  if (Buffer.byteLength(code, 'utf8') > MAX_CODE_BYTES) {
    res.statusCode = 413;
    return res.end(JSON.stringify({ error: `code too large (>${MAX_CODE_BYTES} bytes)` }));
  }

  // Route: JS always local. Python/Bash/TS only if Piston is configured.
  if (lang === 'js') {
    const r = runJS(code);
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ language: 'javascript', ...r }));
  }
  if (PISTON_URL) {
    const r = await runPiston(lang, code, stdin);
    res.setHeader('Content-Type', 'application/json');
    if (r.error) { res.statusCode = 502; return res.end(JSON.stringify({ error: r.error })); }
    return res.end(JSON.stringify({ language: lang, ...r }));
  }

  res.statusCode = 501;
  return res.end(JSON.stringify({
    error: `Sprache "${lang}" derzeit nicht ausführbar — die öffentliche Piston-API ist seit Feb 2026 whitelist-only. JavaScript läuft lokal über die node-vm-Sandbox. Für Python/Bash/TS: PISTON_URL env var auf eine self-hosted Piston-Instanz setzen.`,
  }));
};
