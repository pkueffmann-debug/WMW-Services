/* =========================================================
   Aurelys — Settings view
   LLM provider, model, optional own API key, Ollama URL, export, danger zone.
   ========================================================= */

import { getSetting, setSetting, listEntries } from '../storage.js';
import { getUser } from '../auth.js';
import { toast } from '../app.js';

const PROVIDERS = {
  claude: {
    label: 'Claude (Anthropic)',
    models: ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-7'],
    hint: 'Warm, observant, careful. Server-hosted key by default; paste your own to bypass.',
  },
  openai: {
    label: 'OpenAI',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo'],
    hint: 'Fast and inexpensive. Server-hosted key by default; paste your own to bypass.',
  },
  gemini: {
    label: 'Gemini (Google)',
    models: ['gemini-2.0-flash', 'gemini-2.0-flash-thinking-exp', 'gemini-1.5-pro'],
    hint: 'Fast and free-tier-friendly. Server-hosted key by default.',
  },
  groq: {
    label: 'Groq (extremely fast Llama/Mixtral)',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
    hint: 'Hardware-accelerated open-weights inference. Lightning quick, decent quality.',
  },
  mistral: {
    label: 'Mistral',
    models: ['mistral-small-latest', 'mistral-large-latest', 'open-mistral-nemo'],
    hint: 'European LLM provider. Server-hosted key by default.',
  },
  cerebras: {
    label: 'Cerebras (fastest inference)',
    models: ['llama-3.3-70b', 'llama3.1-8b'],
    hint: 'Wafer-scale chips. Faster than Groq for Llama-3.3-70B.',
  },
  ollama: {
    label: 'Ollama (local, private)',
    models: ['llama3.2', 'llama3.1', 'mistral', 'qwen2.5'],
    hint: 'Runs entirely on your machine. Requires Ollama installed and running.',
  },
};

export async function render(main) {
  const provider = (await getSetting('llm_provider', 'claude')).toLowerCase();
  const model = await getSetting(`llm_model_${provider}`, PROVIDERS[provider].models[0]);
  const apiKey = await getSetting(`llm_apikey_${provider}`, '');
  const ollamaUrl = await getSetting('llm_ollama_url', 'http://localhost:11434');
  const user = getUser();

  main.innerHTML = `
    <header class="today-header">
      <div>
        <div class="today-date">Settings</div>
        <div class="today-weekday">${user?.email || ''}</div>
      </div>
    </header>

    <section class="settings-section">
      <h2>AI provider</h2>
      <p class="hint">Aurelys can run on Claude, OpenAI, or fully local via Ollama. Your choice — your privacy preference.</p>

      <div class="settings-field">
        <label for="provider">Provider</label>
        <select id="provider">
          ${Object.entries(PROVIDERS).map(([k, v]) =>
            `<option value="${k}" ${k === provider ? 'selected' : ''}>${v.label}</option>`
          ).join('')}
        </select>
        <span class="desc" id="provider-hint">${PROVIDERS[provider].hint}</span>
      </div>

      <div class="settings-field">
        <label for="model">Model</label>
        <select id="model">
          ${PROVIDERS[provider].models.map((m) =>
            `<option value="${m}" ${m === model ? 'selected' : ''}>${m}</option>`
          ).join('')}
        </select>
      </div>

      <div class="settings-field" id="apikey-field">
        <label for="apikey">Your API key <span style="color:var(--stone);text-transform:none;letter-spacing:normal">(optional)</span></label>
        <input id="apikey" type="password" autocomplete="off" placeholder="leave empty to use server-hosted key" value="${escapeAttr(apiKey)}" />
        <span class="desc">Stored only in your browser. Overrides the server's key for your requests.</span>
      </div>

      <div class="settings-field" id="ollama-field" style="display:${provider === 'ollama' ? 'flex' : 'none'}">
        <label for="ollama-url">Ollama URL</label>
        <input id="ollama-url" type="text" value="${escapeAttr(ollamaUrl)}" />
        <span class="desc">Default: http://localhost:11434</span>
      </div>

      <div class="actions-row">
        <button id="save-btn" class="action-btn primary">Save settings</button>
      </div>
    </section>

    <section class="settings-section">
      <h2>Your data</h2>
      <p class="hint">Everything you write is stored in your browser and synced to your private Supabase row. Nothing is shared.</p>
      <div class="actions-row">
        <button id="export-btn" class="action-btn">Export all entries (JSON)</button>
      </div>
    </section>

    <section class="settings-section danger-zone">
      <h2>Danger zone</h2>
      <p class="hint">This clears all local entries from this browser. Cloud data is untouched unless you also delete from Supabase.</p>
      <div class="actions-row">
        <button id="clear-btn" class="action-btn">Clear local data</button>
      </div>
    </section>
  `;

  const $provider = main.querySelector('#provider');
  const $model = main.querySelector('#model');
  const $apikey = main.querySelector('#apikey');
  const $ollamaUrl = main.querySelector('#ollama-url');
  const $hint = main.querySelector('#provider-hint');
  const $ollamaField = main.querySelector('#ollama-field');

  $provider.addEventListener('change', async () => {
    const p = $provider.value;
    $hint.textContent = PROVIDERS[p].hint;
    $model.innerHTML = PROVIDERS[p].models.map((m) => `<option value="${m}">${m}</option>`).join('');
    const existingModel = await getSetting(`llm_model_${p}`, PROVIDERS[p].models[0]);
    $model.value = existingModel;
    $apikey.value = await getSetting(`llm_apikey_${p}`, '');
    $ollamaField.style.display = p === 'ollama' ? 'flex' : 'none';
  });

  main.querySelector('#save-btn').addEventListener('click', async () => {
    const p = $provider.value;
    await setSetting('llm_provider', p);
    await setSetting(`llm_model_${p}`, $model.value);
    await setSetting(`llm_apikey_${p}`, $apikey.value.trim());
    if (p === 'ollama') await setSetting('llm_ollama_url', $ollamaUrl.value.trim());
    toast('Settings saved');
  });

  main.querySelector('#export-btn').addEventListener('click', async () => {
    const all = await listEntries();
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aurelys-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${all.length} entries`);
  });

  main.querySelector('#clear-btn').addEventListener('click', async () => {
    if (!confirm('Clear all local entries? Cloud copies remain.')) return;
    const dbReq = indexedDB.deleteDatabase('aurelys');
    dbReq.onsuccess = () => { toast('Local data cleared'); setTimeout(() => location.reload(), 600); };
  });

  return null;
}

function escapeAttr(s) {
  return String(s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
