// /api/brain/tasks-page — auth-gated, serves the tasks HTML page.
// Mirrors api/brain/dashboard.js. The JSON CRUD lives at /api/brain/tasks.

const fs   = require('fs');
const path = require('path');
const cookie = require('cookie');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const WHITELIST = new Set([
  'p.kueffmann@icloud.com',
  't.henseling@gmx.de',
  'jannis.l.timm@gmail.com',
  'orionbo@icloud.com',
]);

const admin = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

module.exports = async (req, res) => {
  try {
    const cookies = cookie.parse(req.headers.cookie || '');
    const accessToken = cookies['sb-access-token'];
    if (!accessToken) return redirect(res, '/auth.html?next=/brain/tasks');

    if (!admin) {
      console.error('[brain/tasks-page] Supabase admin not configured');
      return redirect(res, '/auth.html?next=/brain/tasks&error=server');
    }
    const { data: userData, error: userErr } = await admin.auth.getUser(accessToken);
    if (userErr || !userData?.user) return redirect(res, '/auth.html?next=/brain/tasks');
    const user = userData.user;

    if (!WHITELIST.has((user.email || '').toLowerCase())) {
      const { data: subs, error: subErr } = await admin
        .from('subscriptions')
        .select('plan, status, current_period_end')
        .eq('user_id', user.id)
        .limit(1);
      if (subErr) {
        console.error('[brain/tasks-page] subs lookup failed:', subErr.message);
        return redirect(res, '/#pricing?error=lookup');
      }
      const sub = subs?.[0];
      const active = sub
        && ['trialing', 'active'].includes(sub.status)
        && (!sub.current_period_end || new Date(sub.current_period_end) > new Date());
      if (!active) return redirect(res, '/#pricing');
    }

    const htmlPath = path.join(__dirname, '_lib', 'tasks.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.end(html);
  } catch (e) {
    console.error('[brain/tasks-page]', e);
    return redirect(res, '/auth.html?next=/brain/tasks&error=server');
  }
};
