/* =========================================================
   Aurelys — Auth (Supabase magic-link)
   Reads SUPABASE_URL + SUPABASE_ANON_KEY from /app/assets/config.js
   (which is generated from env or written manually — see SETUP.md).
   ========================================================= */

let supabaseClient = null;
let currentUser = null;
const listeners = new Set();

async function loadConfig() {
  try {
    const r = await fetch('/app/assets/config.js', { cache: 'no-store' });
    if (!r.ok) return null;
    const txt = await r.text();
    // Parse `window.AURELYS_CONFIG = {...}` shape
    const m = txt.match(/AURELYS_CONFIG\s*=\s*({[\s\S]+?})/);
    if (!m) return null;
    return new Function('return ' + m[1])();
  } catch (e) {
    return null;
  }
}

async function waitForSupabase() {
  if (window.__supabaseFactory) return window.__supabaseFactory;
  return new Promise((resolve) => {
    window.addEventListener('supabase:ready', () => resolve(window.__supabaseFactory), { once: true });
    setTimeout(() => resolve(window.__supabaseFactory), 4000);
  });
}

export async function initAuth() {
  const cfg = await loadConfig();
  if (!cfg || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    console.warn('[auth] Supabase config missing — see /app/assets/config.example.js');
    return { configured: false };
  }
  const createClient = await waitForSupabase();
  if (!createClient) {
    console.error('[auth] Supabase SDK failed to load');
    return { configured: false };
  }
  supabaseClient = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  // Restore session
  const { data: { session } } = await supabaseClient.auth.getSession();
  currentUser = session?.user || null;

  // Listen for changes
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user || null;
    listeners.forEach((cb) => { try { cb(currentUser); } catch (e) {} });
  });

  return { configured: true, user: currentUser };
}

export function getClient() { return supabaseClient; }
export function getUser() { return currentUser; }
export function onAuthChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }

export async function signInWithEmail(email) {
  if (!supabaseClient) throw new Error('Auth not initialized');
  const redirect = `${window.location.origin}/app/`;
  // Sends both link AND token; user can use either. Whether the email
  // shows a code, a link, or both is controlled by the Supabase
  // 'Magic Link' email template (use {{ .Token }} for a 6-digit code).
  const { error } = await supabaseClient.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirect, shouldCreateUser: true },
  });
  if (error) throw error;
  return true;
}

export async function verifyOtpCode(email, token) {
  if (!supabaseClient) throw new Error('Auth not initialized');
  const cleanToken = String(token).trim().replace(/\s+/g, '');

  // Some Supabase project configs accept type:'email', others need
  // type:'magiclink'. Try both with a hard 12s timeout so the UI never
  // hangs silently.
  const TIMEOUT_MS = 12000;

  function withTimeout(promise, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS)
      ),
    ]);
  }

  console.log('[auth] verifyOtp attempt: type=email');
  try {
    const r = await withTimeout(
      supabaseClient.auth.verifyOtp({ email, token: cleanToken, type: 'email' }),
      'verifyOtp(email)'
    );
    if (r.error) {
      console.warn('[auth] type=email failed:', r.error.message);
      throw r.error;
    }
    console.log('[auth] type=email ok');
    return r.data;
  } catch (e1) {
    console.log('[auth] verifyOtp attempt: type=magiclink');
    try {
      const r2 = await withTimeout(
        supabaseClient.auth.verifyOtp({ email, token: cleanToken, type: 'magiclink' }),
        'verifyOtp(magiclink)'
      );
      if (r2.error) throw r2.error;
      console.log('[auth] type=magiclink ok');
      return r2.data;
    } catch (e2) {
      console.error('[auth] both verify attempts failed', e1, e2);
      throw new Error(`Code invalid or expired. (${e1?.message || e1}; ${e2?.message || e2})`);
    }
  }
}

export async function signOut() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
  currentUser = null;
}
