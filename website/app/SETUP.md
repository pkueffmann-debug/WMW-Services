# Aurelys — Setup

Aurelys runs at `https://www.daylens.dev/app/`. Before it works end-to-end you need to wire up:

1. **Supabase** (auth + cloud sync) — required, blocks login
2. **LLM provider keys in Vercel env** (Anthropic / OpenAI) — required for AI features unless every user provides their own key in Settings
3. **`config.js`** in `/website/app/assets/` — committed file with your Supabase public values

---

## 1. Supabase project (10 min)

1. Go to [supabase.com](https://supabase.com) → New project. Pick any region near Europe.
2. Once provisioned, go to **Project Settings → API**:
   - Copy **Project URL** (`https://xxxxx.supabase.co`)
   - Copy **anon public** key (long JWT)
3. Go to **SQL Editor → New query** and run:

   ```sql
   create table public.entries (
     id          uuid primary key default gen_random_uuid(),
     user_id     uuid not null references auth.users(id) on delete cascade,
     date        date not null,
     journal     text default '',
     plan        jsonb default '[]'::jsonb,
     reflection  text default '',
     updated_at  timestamptz default now(),
     unique (user_id, date)
   );

   alter table public.entries enable row level security;

   create policy "users can read own entries"
     on public.entries for select
     using (auth.uid() = user_id);

   create policy "users can insert own entries"
     on public.entries for insert
     with check (auth.uid() = user_id);

   create policy "users can update own entries"
     on public.entries for update
     using (auth.uid() = user_id);

   create policy "users can delete own entries"
     on public.entries for delete
     using (auth.uid() = user_id);
   ```

4. Go to **Authentication → URL Configuration**:
   - **Site URL**: `https://www.daylens.dev/app/`
   - **Redirect URLs**: add `https://www.daylens.dev/app/**` and `http://localhost:3000/app/**` (for local testing)
5. Go to **Authentication → Email Templates → Magic Link** — optionally customise the email subject/body (default works fine).

---

## 2. Frontend config

Copy the example and fill in:

```bash
cp website/app/assets/config.example.js website/app/assets/config.js
```

Edit `config.js`:

```js
window.AURELYS_CONFIG = {
  SUPABASE_URL: 'https://YOUR_PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOi...',  // the anon public key
};
```

This file is **committed to git** — the anon key is safe to expose (RLS protects the data).

---

## 3. Vercel env vars (for AI features)

In Vercel → Project → Settings → Environment Variables, add:

| Name                 | Value                                  | Required when                                        |
| -------------------- | -------------------------------------- | ---------------------------------------------------- |
| `ANTHROPIC_API_KEY`  | `sk-ant-…` from console.anthropic.com  | You want Claude to work without users pasting keys   |
| `OPENAI_API_KEY`     | `sk-…` from platform.openai.com        | You want OpenAI to work without users pasting keys   |

Apply to **Production, Preview, Development**. Redeploy after adding.

**Cost note:** every reflection / plan call hits these. For a real product you'd add per-user rate limiting or pass costs through. For private/personal use, this is fine.

Users can also paste their own key in **Settings → AI Provider** — it's stored in their IndexedDB and overrides the server key for their requests only.

---

## 4. Test the deploy

After pushing & Vercel rebuild:

1. Open `https://www.daylens.dev/app/`
2. Enter email → check inbox → click the magic link
3. You land back at `/app/today` signed in
4. Write something, click **Reflect on today** — Claude should stream a response
5. Check **Constellation** — your first star appears

If reflection fails, hit `https://www.daylens.dev/api/llm` (GET) — it returns a JSON diagnostic showing which env vars are set.

---

## 5. (Optional) Local Ollama for fully-private mode

Users who want zero-cloud LLM:

```bash
brew install ollama
ollama pull llama3.2
ollama serve   # runs on http://localhost:11434
```

Then in **Settings → AI Provider** pick **Ollama (local, private)**. The browser hits localhost directly — nothing leaves the user's machine.

CORS: Ollama allows localhost origins by default. For `https://www.daylens.dev` → `http://localhost:11434` the browser will block it unless you start Ollama with `OLLAMA_ORIGINS="https://www.daylens.dev"` set. Add this to your shell profile.

---

## Architecture summary

```
Browser (PWA)
├─ IndexedDB     ← local-first source of truth
├─ Supabase JS   ← auth + cloud sync (RLS-protected)
└─ LLM client
    ├─ /api/llm       ← Vercel function, proxies Claude + OpenAI
    └─ localhost:11434 ← direct, when provider=ollama

Vercel
└─ /api/llm.js   ← uses @anthropic-ai/sdk on Node runtime
```

No server-side database, no backend besides the LLM proxy. Aurelys is mostly a thick client.
