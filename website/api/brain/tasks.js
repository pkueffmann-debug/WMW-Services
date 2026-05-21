// /api/brain/tasks — agent_tasks CRUD for the authenticated user.
//
//   GET    /api/brain/tasks?status=open&type=bug&limit=50  → list
//   POST   /api/brain/tasks   { type, title, ... }         → insert
//   PATCH  /api/brain/tasks   { id, status?, ... }         → update
//   DELETE /api/brain/tasks   { id }                       → remove
//
// Auth via cookie (sb-access-token) — same gate as memory/dashboard.

const { gate } = require('../_lib/auth');
const { adminClient } = require('../_lib/supabase');

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  const user = await gate(req, res);
  if (!user) return;

  const admin = adminClient();
  if (!admin) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: 'supabase-not-configured' }));
  }

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'private, no-store');

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://x');
      const status = url.searchParams.get('status');
      const type = url.searchParams.get('type');
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 200);

      let q = admin
        .from('agent_tasks')
        .select('*')
        .eq('user_id', user.id)
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit);
      if (status) q = q.eq('status', status);
      if (type) q = q.eq('type', type);

      const { data, error } = await q;
      if (error) throw error;
      res.statusCode = 200;
      return res.end(JSON.stringify({ tasks: data || [] }));
    }

    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const { type, title, description, priority = 3, related_files, created_by = 'human' } = body || {};
      if (!type || !title) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'type and title required' }));
      }
      const { data, error } = await admin
        .from('agent_tasks')
        .insert({ user_id: user.id, type, title, description, priority, related_files, created_by })
        .select()
        .single();
      if (error) throw error;
      res.statusCode = 201;
      return res.end(JSON.stringify({ task: data }));
    }

    if (req.method === 'PATCH') {
      const body = await readJsonBody(req);
      const { id, status, result_summary, priority, title, description } = body || {};
      if (!id) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'id required' }));
      }
      const updates = {};
      if (status !== undefined) updates.status = status;
      if (result_summary !== undefined) updates.result_summary = result_summary;
      if (priority !== undefined) updates.priority = priority;
      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description;

      const { data, error } = await admin
        .from('agent_tasks')
        .update(updates)
        .eq('id', id)
        .eq('user_id', user.id)
        .select()
        .single();
      if (error) throw error;
      res.statusCode = 200;
      return res.end(JSON.stringify({ task: data }));
    }

    if (req.method === 'DELETE') {
      const body = await readJsonBody(req);
      const { id } = body || {};
      if (!id) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'id required' }));
      }
      const { error } = await admin
        .from('agent_tasks')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);
      if (error) throw error;
      res.statusCode = 204;
      return res.end();
    }

    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'method not allowed' }));
  } catch (err) {
    console.error('[api/brain/tasks]', err);
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: err.message || 'server-error' }));
  }
};
