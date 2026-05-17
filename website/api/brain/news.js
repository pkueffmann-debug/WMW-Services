// /api/brain/news — top headlines from public RSS feeds.
// No API key needed; we round-robin BBC + Spiegel + DW so the user gets
// a mix of EN/DE sources. Cached at the edge for 5 minutes.

const { gate } = require('../_lib/auth');

const FEEDS = [
  { url: 'https://feeds.bbci.co.uk/news/world/rss.xml',     source: 'BBC' },
  { url: 'https://www.spiegel.de/schlagzeilen/index.rss',   source: 'Spiegel' },
  { url: 'https://rss.dw.com/xml/rss-de-all',               source: 'DW' },
];

function decodeXml(s) {
  return s
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&apos;/g, "'");
}

function pickTag(block, tag) {
  // Matches both plain and CDATA-wrapped content for one tag.
  const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i');
  return (block.match(re) || [])[1] || '';
}

function parseRssItems(xml, source) {
  const items = [];
  const re = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) !== null && items.length < 10) {
    const block = m[1];
    const title = decodeXml(pickTag(block, 'title')).trim();
    const link  = pickTag(block, 'link').trim();
    const desc  = decodeXml(pickTag(block, 'description'))
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240);
    if (title) items.push({ title, link, description: desc, source });
  }
  return items;
}

async function fetchFeed(url, source) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'JARVIS/0.2 (+https://daylens.dev)' },
    });
    if (!r.ok) {
      console.warn(`[news] ${source} ${r.status}`);
      return [];
    }
    const xml = await r.text();
    return parseRssItems(xml, source);
  } catch (e) {
    console.warn(`[news] ${source} failed:`, e?.message);
    return [];
  } finally {
    clearTimeout(tid);
  }
}

module.exports = async (req, res) => {
  // Anyone allowed past the auth gate gets news. /api/brain/news is reached
  // by both the dashboard and the morning briefing in brain.html.
  const user = await gate(req, res);
  if (!user) return;

  try {
    const feedItems = await Promise.all(FEEDS.map(f => fetchFeed(f.url, f.source)));

    // Round-robin pick so the user gets a mix of sources, not 5×BBC.
    const interleaved = [];
    for (let i = 0; interleaved.length < 10; i++) {
      let added = false;
      for (const feed of feedItems) {
        if (feed[i]) {
          interleaved.push(feed[i]);
          added = true;
          if (interleaved.length >= 10) break;
        }
      }
      if (!added) break;
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.end(JSON.stringify({
      fetched_at: new Date().toISOString(),
      sources: FEEDS.map(f => f.source),
      items: interleaved.slice(0, 5),
    }));
  } catch (e) {
    console.error('[news] handler failed', e);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: e?.message || 'news fetch failed' }));
  }
};
