/* =========================================================
   Aurelys — App entry: auth gate, router, view loader
   ========================================================= */

import { initAuth, getUser, onAuthChange, signInWithEmail, signOut } from './auth.js';
import { syncAllDown, syncAllUp } from './storage.js';

const VIEWS = {
  today: () => import('./views/today.js'),
  constellation: () => import('./views/constellation.js'),
  settings: () => import('./views/settings.js'),
};

const $ = (sel) => document.querySelector(sel);

// ─── Toast ─────────────────────────────────────────────────
let toastTimer = null;
export function toast(msg, ms = 2400) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), ms);
}

// ─── Router ────────────────────────────────────────────────
let currentView = null;
let currentCleanup = null;

async function navigate() {
  const hash = window.location.hash.replace(/^#\/?/, '') || 'today';
  const route = (hash.split('/')[0] || 'today').toLowerCase();
  const view = VIEWS[route] ? route : 'today';

  // Update nav highlight
  document.querySelectorAll('.nav-link').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === view);
  });

  if (currentView === view) return;
  currentView = view;

  // Teardown previous
  try { currentCleanup?.(); } catch (e) {}
  currentCleanup = null;

  const main = $('#app-main');
  main.innerHTML = '<div style="padding:40px;color:var(--mist);text-align:center;font-style:italic">Loading…</div>';

  try {
    const mod = await VIEWS[view]();
    main.innerHTML = '';
    const cleanup = await mod.render(main);
    currentCleanup = typeof cleanup === 'function' ? cleanup : null;
  } catch (e) {
    console.error('[app] view load failed', e);
    main.innerHTML = `<div style="padding:40px;color:#e0907a">Failed to load: ${e.message}</div>`;
  }
}

window.addEventListener('hashchange', navigate);

// ─── Auth UI ───────────────────────────────────────────────

function showAuthGate(reason) {
  $('#auth-gate').hidden = false;
  $('#app-shell').hidden = true;
  if (reason === 'unconfigured') {
    $('#auth-status').textContent = 'Aurelys is not yet configured for this deployment.';
    $('#auth-status').className = 'auth-status error';
    $('#auth-form').style.opacity = '0.4';
    $('#auth-form').style.pointerEvents = 'none';
  }
}

function showApp(user) {
  $('#auth-gate').hidden = true;
  $('#app-shell').hidden = false;
  $('#user-email').textContent = user.email || '';
  // Sync down from cloud on session start (best-effort)
  syncAllDown().then((r) => {
    if (r.ok && r.count > 0) toast(`${r.count} entries synced from cloud`);
  }).catch(() => {});
  navigate();
}

function wireAuthForm() {
  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#auth-email').value.trim();
    if (!email) return;
    const statusEl = $('#auth-status');
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    statusEl.className = 'auth-status';
    statusEl.textContent = 'Sending link…';
    try {
      await signInWithEmail(email);
      statusEl.textContent = `Check ${email} for your sign-in link.`;
      statusEl.className = 'auth-status success';
    } catch (err) {
      statusEl.textContent = err?.message || 'Could not send link';
      statusEl.className = 'auth-status error';
      btn.disabled = false;
    }
  });

  $('#signout-btn').addEventListener('click', async () => {
    if (!confirm('Sign out of Aurelys?')) return;
    await syncAllUp().catch(() => {});
    await signOut();
    window.location.hash = '#/today';
    window.location.reload();
  });
}

// ─── Boot ──────────────────────────────────────────────────

(async function boot() {
  wireAuthForm();
  const status = await initAuth();
  if (!status.configured) {
    showAuthGate('unconfigured');
    return;
  }

  onAuthChange((user) => {
    if (user) showApp(user);
    else showAuthGate();
  });

  const user = getUser();
  if (user) showApp(user);
  else showAuthGate();

  // Periodic background sync-up
  setInterval(() => { syncAllUp().catch(() => {}); }, 60_000);
})();
