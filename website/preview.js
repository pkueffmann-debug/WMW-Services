/**
 * Local-preview server for daylens.dev that mirrors vercel.json rules:
 *   - cleanUrls (so /wellness serves wellness.html)
 *   - SPA fallback for /studio/* -> /studio/index.html (skips assets)
 *
 * Usage:  node preview.js           (PORT=5181 default)
 *         PORT=4000 node preview.js
 *
 * Not used in production. Vercel handles rewrites via vercel.json there.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 5181;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.txt':  'text/plain; charset=utf-8',
};

function safeJoin(rel) {
  const p = path.normalize(path.join(ROOT, rel));
  if (!p.startsWith(ROOT)) return null;
  return p;
}

function tryFile(filePath) {
  try {
    const st = fs.statSync(filePath);
    return st.isFile() ? st : null;
  } catch { return null; }
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);

  // strip trailing slash (except root)
  if (url.length > 1 && url.endsWith('/')) url = url.slice(0, -1);

  // 1) try the literal path
  let fp = safeJoin(url);
  if (!fp) { res.writeHead(400); return res.end('bad path'); }

  // 2) try as-is (file)
  let st = tryFile(fp);
  if (st) return serveFile(res, fp);

  // 3) try as directory -> index.html
  try {
    const dst = fs.statSync(fp);
    if (dst.isDirectory()) {
      const idx = path.join(fp, 'index.html');
      if (tryFile(idx)) return serveFile(res, idx);
    }
  } catch {}

  // 4) cleanUrls — try `${url}.html`
  const asHtml = safeJoin(url + '.html');
  if (asHtml && tryFile(asHtml)) return serveFile(res, asHtml);

  // 5) /studio/* SPA fallback
  if (url.startsWith('/studio')) {
    const spa = safeJoin('/studio/index.html');
    if (spa && tryFile(spa)) return serveFile(res, spa);
  }

  // 6) 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found: ' + url);
});

server.listen(PORT, () => {
  console.log(`[preview] http://localhost:${PORT}/`);
  console.log(`[preview] serving from ${ROOT}`);
});
