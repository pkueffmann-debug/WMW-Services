/* =========================================================
   Aurelys — Today view
   Journal + Plan + AI Reflect + AI Plan-Day
   ========================================================= */

import {
  getEntry, saveEntry, todayKey, formatDateLong, formatWeekday, listEntries,
} from '../storage.js';
import { streamChat } from '../llm.js';
import { toast } from '../app.js';

let entry = null;
let saveTimer = null;
let lastSavedAt = 0;

const SYSTEM_REFLECT = `You are Aurelys — a calm, observant presence for someone's daily journal. Your job is to read what they wrote today (and recent days if provided) and offer ONE gentle observation. Not advice. Not a list. Not a summary. A single short reflection — two or three sentences — that notices a pattern, a feeling, or a quiet shift. Speak in second person ("you"). Be warm but unsentimental. Never use emoji. Never start with "It seems" or "It sounds like".`;

const SYSTEM_PLAN = `You are Aurelys — helping someone shape their day. They will give you a free-form brain dump of what they want to do today. Convert it into a concise, prioritized plan of 3–6 tasks. Each task: short, action-oriented, no more than 8 words. Return ONLY a JSON array of strings like ["Walk 20 min","Draft Q3 proposal","..."]. No prose, no markdown, no explanation. If their dump is vague or too short to plan, return ["Pause. Write more about what you need today."].`;

const PLACEHOLDER_JOURNAL =
  "What's on your mind today? Write freely — Aurelys remembers gently.";

export async function render(main) {
  const key = todayKey();
  entry = await getEntry(key);

  main.innerHTML = `
    <header class="today-header">
      <div>
        <div class="today-date">${formatDateLong(key)}</div>
        <div class="today-weekday">${formatWeekday(key)}</div>
      </div>
      <div class="today-greeting" id="greeting">${greetingFor()}</div>
    </header>

    <section class="day-section">
      <div class="section-label">Journal</div>
      <textarea id="journal" class="journal-textarea" placeholder="${PLACEHOLDER_JOURNAL}"></textarea>
      <div class="save-indicator" id="save-ind"></div>
    </section>

    <section class="day-section">
      <div class="section-label">Plan</div>
      <ul id="plan-list" class="plan-list"></ul>
      <form id="plan-add-form" class="plan-add-form">
        <input id="plan-add-input" class="plan-add-input" type="text" placeholder="Add a task…" />
        <button class="plan-add-btn" type="submit">Add</button>
      </form>
    </section>

    <div class="actions-row">
      <button id="btn-reflect" class="action-btn">✦ Reflect on today</button>
      <button id="btn-plan-ai" class="action-btn">Shape my day with AI</button>
    </div>

    <div class="ai-output" id="ai-output">
      <span class="ai-output-label" id="ai-output-label"></span>
      <span id="ai-output-text"></span>
    </div>
  `;

  // Hydrate
  const $journal = main.querySelector('#journal');
  $journal.value = entry.journal || '';
  renderPlan(main);

  // Wire journal autosave (debounced)
  $journal.addEventListener('input', () => {
    entry.journal = $journal.value;
    scheduleSave(main);
  });

  // Plan add
  main.querySelector('#plan-add-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = main.querySelector('#plan-add-input');
    const v = input.value.trim();
    if (!v) return;
    entry.plan = entry.plan || [];
    entry.plan.push({ text: v, done: false });
    input.value = '';
    renderPlan(main);
    scheduleSave(main, true);
  });

  // AI buttons
  main.querySelector('#btn-reflect').addEventListener('click', () => runReflect(main));
  main.querySelector('#btn-plan-ai').addEventListener('click', () => runPlanAI(main));

  // Re-render greeting periodically (in case user crosses noon/etc)
  const greetingInt = setInterval(() => {
    main.querySelector('#greeting').textContent = greetingFor();
  }, 60_000);

  // Cleanup on view change
  return () => {
    clearInterval(greetingInt);
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveEntry(entry).catch(() => {});
    }
  };
}

function renderPlan(main) {
  const ul = main.querySelector('#plan-list');
  ul.innerHTML = '';
  (entry.plan || []).forEach((task, i) => {
    const li = document.createElement('li');
    li.className = 'plan-item' + (task.done ? ' done' : '');
    li.innerHTML = `
      <input type="checkbox" class="plan-check" ${task.done ? 'checked' : ''} />
      <input type="text" class="plan-text" value="" />
      <button type="button" class="plan-delete" title="Remove">×</button>
    `;
    const $check = li.querySelector('.plan-check');
    const $text = li.querySelector('.plan-text');
    const $del = li.querySelector('.plan-delete');
    $text.value = task.text;
    $check.addEventListener('change', () => {
      task.done = $check.checked;
      li.classList.toggle('done', task.done);
      scheduleSave(main, true);
    });
    $text.addEventListener('input', () => {
      task.text = $text.value;
      scheduleSave(main);
    });
    $del.addEventListener('click', () => {
      entry.plan.splice(i, 1);
      renderPlan(main);
      scheduleSave(main, true);
    });
    ul.appendChild(li);
  });
}

function scheduleSave(main, immediate = false) {
  if (saveTimer) clearTimeout(saveTimer);
  const indicator = main.querySelector('#save-ind');
  if (indicator) indicator.textContent = 'unsaved';

  const doSave = async () => {
    await saveEntry(entry);
    lastSavedAt = Date.now();
    if (indicator) indicator.textContent = 'saved · ' + new Date().toLocaleTimeString();
    saveTimer = null;
  };
  if (immediate) doSave();
  else saveTimer = setTimeout(doSave, 800);
}

function greetingFor() {
  const h = new Date().getHours();
  if (h < 5) return 'A quiet hour.';
  if (h < 12) return 'A new morning.';
  if (h < 17) return 'Midday.';
  if (h < 21) return 'Evening settles.';
  return 'Night, again.';
}

// ─── AI: Reflect ─────────────────────────────────────────

async function runReflect(main) {
  const btn = main.querySelector('#btn-reflect');
  const outBox = main.querySelector('#ai-output');
  const outText = main.querySelector('#ai-output-text');
  const outLabel = main.querySelector('#ai-output-label');

  if (!(entry.journal || '').trim()) {
    toast('Write something first.');
    return;
  }
  btn.disabled = true; btn.textContent = '✦ Reflecting…';
  outLabel.textContent = 'Reflection';
  outText.textContent = '';

  const recent = (await listEntries())
    .filter((e) => e.date !== entry.date && (e.journal || '').trim())
    .slice(-5)
    .map((e) => `[${e.date}]\n${e.journal.slice(0, 800)}`)
    .join('\n\n');

  const userMsg =
    (recent ? `Recent days:\n${recent}\n\n---\n` : '') +
    `Today (${entry.date}):\n${entry.journal}`;

  let acc = '';
  await streamChat({
    system: SYSTEM_REFLECT,
    messages: [{ role: 'user', content: userMsg }],
    max_tokens: 400,
    onDelta: (d) => { acc += d; outText.textContent = acc; },
    onDone: async () => {
      entry.reflection = acc;
      await saveEntry(entry);
      btn.disabled = false; btn.textContent = '✦ Reflect on today';
    },
    onError: (e) => {
      outText.textContent = `(Reflection failed: ${e.message})`;
      btn.disabled = false; btn.textContent = '✦ Reflect on today';
    },
  });
}

// ─── AI: Plan day ────────────────────────────────────────

async function runPlanAI(main) {
  const btn = main.querySelector('#btn-plan-ai');
  const outLabel = main.querySelector('#ai-output-label');
  const outText = main.querySelector('#ai-output-text');

  if (!(entry.journal || '').trim()) {
    toast('Brain-dump in the journal first, then I can shape it into a plan.');
    return;
  }
  btn.disabled = true; btn.textContent = 'Shaping…';
  outLabel.textContent = 'Plan draft';
  outText.textContent = '';

  let acc = '';
  await streamChat({
    system: SYSTEM_PLAN,
    messages: [{ role: 'user', content: entry.journal }],
    max_tokens: 300,
    onDelta: (d) => { acc += d; outText.textContent = acc; },
    onDone: async () => {
      try {
        const cleaned = acc.trim()
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/```\s*$/i, '');
        const arr = JSON.parse(cleaned);
        if (Array.isArray(arr)) {
          entry.plan = arr.map((t) => ({ text: String(t), done: false }));
          renderPlan(main);
          await saveEntry(entry);
          outText.textContent = `Added ${arr.length} tasks to your plan.`;
          toast('Plan updated');
        }
      } catch (e) {
        // Leave the raw output visible; the user can copy it manually
      }
      btn.disabled = false; btn.textContent = 'Shape my day with AI';
    },
    onError: (e) => {
      outText.textContent = `(Plan failed: ${e.message})`;
      btn.disabled = false; btn.textContent = 'Shape my day with AI';
    },
  });
}
