/* =========================================================
   Aurelys — Storage layer
   IndexedDB local-first + Supabase cloud sync.

   Schema (per user):
     entries: { date (YYYY-MM-DD, PK), journal, plan[], reflection,
                updated_at, synced }
     settings: { key, value }

   Supabase table `entries`:
     id uuid pk default gen_random_uuid()
     user_id uuid references auth.users(id) on delete cascade
     date date not null
     journal text default '',
     plan jsonb default '[]'::jsonb,
     reflection text default '',
     updated_at timestamptz default now()
     UNIQUE (user_id, date)
     RLS: enable; policy "own rows" using (auth.uid() = user_id)
   ========================================================= */

import { getClient, getUser } from './auth.js';

const DB_NAME = 'aurelys';
const DB_VERSION = 1;
let db = null;

function openDB() {
  if (db) return Promise.resolve(db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const idb = e.target.result;
      if (!idb.objectStoreNames.contains('entries')) {
        idb.createObjectStore('entries', { keyPath: 'date' });
      }
      if (!idb.objectStoreNames.contains('settings')) {
        idb.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode = 'readonly') {
  return openDB().then((d) => d.transaction(store, mode).objectStore(store));
}

// ─── Entries: local ──────────────────────────────────────

export async function getEntry(date) {
  const store = await tx('entries');
  return new Promise((res) => {
    const r = store.get(date);
    r.onsuccess = () => res(r.result || defaultEntry(date));
    r.onerror = () => res(defaultEntry(date));
  });
}

export async function listEntries() {
  const store = await tx('entries');
  return new Promise((res) => {
    const out = [];
    store.openCursor().onsuccess = (e) => {
      const cur = e.target.result;
      if (cur) { out.push(cur.value); cur.continue(); }
      else res(out.sort((a, b) => a.date.localeCompare(b.date)));
    };
  });
}

export async function saveEntry(entry) {
  entry.updated_at = new Date().toISOString();
  entry.synced = false;
  const store = await tx('entries', 'readwrite');
  await new Promise((res, rej) => {
    const r = store.put(entry);
    r.onsuccess = res; r.onerror = () => rej(r.error);
  });
  // Best-effort cloud sync (non-blocking)
  syncEntryUp(entry).catch((e) => console.warn('[storage] sync up failed', e?.message));
  return entry;
}

export async function deleteEntry(date) {
  const store = await tx('entries', 'readwrite');
  await new Promise((res, rej) => {
    const r = store.delete(date);
    r.onsuccess = res; r.onerror = () => rej(r.error);
  });
  const supa = getClient();
  const user = getUser();
  if (supa && user) {
    await supa.from('entries').delete().eq('user_id', user.id).eq('date', date);
  }
}

function defaultEntry(date) {
  return {
    date,
    journal: '',
    plan: [],
    reflection: '',
    updated_at: null,
    synced: false,
  };
}

// ─── Settings: local ─────────────────────────────────────

export async function getSetting(key, fallback = null) {
  const store = await tx('settings');
  return new Promise((res) => {
    const r = store.get(key);
    r.onsuccess = () => res(r.result?.value ?? fallback);
    r.onerror = () => res(fallback);
  });
}

export async function setSetting(key, value) {
  const store = await tx('settings', 'readwrite');
  await new Promise((res, rej) => {
    const r = store.put({ key, value });
    r.onsuccess = res; r.onerror = () => rej(r.error);
  });
}

// ─── Cloud sync ──────────────────────────────────────────

async function syncEntryUp(entry) {
  const supa = getClient();
  const user = getUser();
  if (!supa || !user) return;

  const payload = {
    user_id: user.id,
    date: entry.date,
    journal: entry.journal || '',
    plan: entry.plan || [],
    reflection: entry.reflection || '',
    updated_at: entry.updated_at,
  };
  const { error } = await supa.from('entries').upsert(payload, {
    onConflict: 'user_id,date',
  });
  if (error) throw error;

  // mark synced
  const store = await tx('entries', 'readwrite');
  entry.synced = true;
  await new Promise((res) => { store.put(entry).onsuccess = res; });
}

export async function syncAllDown() {
  const supa = getClient();
  const user = getUser();
  if (!supa || !user) return { ok: false, reason: 'not-authed' };

  const { data, error } = await supa
    .from('entries')
    .select('date,journal,plan,reflection,updated_at')
    .eq('user_id', user.id)
    .order('date', { ascending: false });
  if (error) return { ok: false, reason: error.message };

  const store = await tx('entries', 'readwrite');
  for (const row of data || []) {
    // Merge: prefer the newer updated_at
    const local = await new Promise((res) => {
      const r = store.get(row.date);
      r.onsuccess = () => res(r.result);
    });
    if (local && local.updated_at && row.updated_at && local.updated_at > row.updated_at) continue;
    store.put({ ...row, synced: true });
  }
  return { ok: true, count: (data || []).length };
}

export async function syncAllUp() {
  const all = await listEntries();
  const unsynced = all.filter((e) => !e.synced);
  let ok = 0;
  for (const e of unsynced) {
    try { await syncEntryUp(e); ok++; } catch (err) { /* skip */ }
  }
  return { ok, total: unsynced.length };
}

// ─── Helpers ─────────────────────────────────────────────

export function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatDateLong(key) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, {
    month: 'long', day: 'numeric', year: 'numeric',
  });
}

export function formatWeekday(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long' });
}
