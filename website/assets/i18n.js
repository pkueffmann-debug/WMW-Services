/* =========================================================
   WMW Services — i18n (auto-translate, all pages)
   Default: EN (source HTML). Switcher offers 25+ languages.
   Translation via MyMemory free API + localStorage cache.
   No data-i18n attrs required — walks all visible text nodes.
   ========================================================= */
(function () {
  'use strict';

  const STORAGE_KEY = 'wmw_lang';
  const CACHE_PREFIX = 'wmw_t_';

  // [code, native label]
  const LANGS = [
    ['en', 'English'],   ['de', 'Deutsch'],   ['fr', 'Français'],
    ['es', 'Español'],   ['it', 'Italiano'],  ['pt', 'Português'],
    ['nl', 'Nederlands'],['pl', 'Polski'],    ['ru', 'Русский'],
    ['uk', 'Українська'],['tr', 'Türkçe'],    ['ar', 'العربية'],
    ['zh-CN', '中文'],   ['ja', '日本語'],    ['ko', '한국어'],
    ['hi', 'हिन्दी'],     ['id', 'Indonesia'], ['vi', 'Tiếng Việt'],
    ['th', 'ไทย'],       ['sv', 'Svenska'],   ['da', 'Dansk'],
    ['no', 'Norsk'],     ['fi', 'Suomi'],     ['cs', 'Čeština'],
    ['el', 'Ελληνικά'],  ['he', 'עברית'],     ['ro', 'Română'],
    ['hu', 'Magyar'],    ['ja', '日本語']
  ];

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'TEXTAREA']);
  const RTL = new Set(['ar', 'he']);

  // ---- Storage ----
  function getStored() {
    try { return localStorage.getItem(STORAGE_KEY) || 'en'; } catch (e) { return 'en'; }
  }
  function setStored(v) {
    try { localStorage.setItem(STORAGE_KEY, v); } catch (e) {}
  }
  function hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h.toString(36);
  }
  function cacheGet(lang, text) {
    try { return localStorage.getItem(CACHE_PREFIX + lang + ':' + hash(text)); } catch (e) { return null; }
  }
  function cacheSet(lang, text, tr) {
    try { localStorage.setItem(CACHE_PREFIX + lang + ':' + hash(text), tr); } catch (e) {}
  }

  // ---- DOM scan ----
  let textNodes = null; // [{ node, original }]
  let attrNodes = null; // [{ node, attr, original }]

  function isTranslatable(text) {
    const t = text.trim();
    if (t.length < 2) return false;
    if (/^[\d\s.,:;€$%+\-*/()|·•→←↑↓#@]+$/.test(t)) return false;
    if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(t)) return false;
    if (/^https?:\/\//.test(t)) return false;
    return true;
  }

  function collect() {
    if (textNodes) return;
    textNodes = [];
    attrNodes = [];

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        const p = n.parentNode;
        if (!p || SKIP_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT;
        if (p.closest && p.closest('[data-no-translate]')) return NodeFilter.FILTER_REJECT;
        if (p.closest && p.closest('.lang-switch-select')) return NodeFilter.FILTER_REJECT;
        if (!isTranslatable(n.nodeValue)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let n;
    while ((n = walker.nextNode())) {
      textNodes.push({ node: n, original: n.nodeValue });
    }

    const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
    document.querySelectorAll('[placeholder],[title],[aria-label],[alt]').forEach(function (el) {
      if (el.closest('[data-no-translate]')) return;
      if (el.closest('.lang-switch-select')) return;
      ATTRS.forEach(function (attr) {
        const v = el.getAttribute(attr);
        if (v && isTranslatable(v)) {
          attrNodes.push({ node: el, attr: attr, original: v });
        }
      });
    });
  }

  function restoreEnglish() {
    collect();
    textNodes.forEach(function (it) { it.node.nodeValue = it.original; });
    attrNodes.forEach(function (it) { it.node.setAttribute(it.attr, it.original); });
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
  }

  // ---- Translation API (MyMemory, free, no key) ----
  async function fetchOne(text, lang) {
    const url = 'https://api.mymemory.translated.net/get?q=' +
      encodeURIComponent(text) + '&langpair=en|' + lang;
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      const j = await r.json();
      const t = j && j.responseData && j.responseData.translatedText;
      if (!t) return null;
      // MyMemory sometimes returns warnings like "MYMEMORY WARNING:..." — skip those
      if (/MYMEMORY WARNING/i.test(t)) return null;
      return t;
    } catch (e) {
      return null;
    }
  }

  async function fetchAll(texts, lang, onProgress) {
    const CONCURRENT = 5;
    const result = {};
    let done = 0;
    for (let i = 0; i < texts.length; i += CONCURRENT) {
      const slice = texts.slice(i, i + CONCURRENT);
      await Promise.all(slice.map(async function (t) {
        const tr = await fetchOne(t, lang);
        if (tr) { result[t] = tr; cacheSet(lang, t, tr); }
        done++;
        if (onProgress) onProgress(done, texts.length);
      }));
    }
    return result;
  }

  // ---- Apply translation ----
  let busy = false;

  async function translate(lang) {
    if (busy) return;
    if (lang === 'en') { restoreEnglish(); return; }

    busy = true;
    showLoading(true);
    collect();

    document.documentElement.lang = lang;
    document.documentElement.dir = RTL.has(lang) ? 'rtl' : 'ltr';

    const uniques = new Set();
    textNodes.forEach(function (it) { uniques.add(it.original.trim()); });
    attrNodes.forEach(function (it) { uniques.add(it.original.trim()); });

    const map = {};
    const toFetch = [];
    uniques.forEach(function (t) {
      const c = cacheGet(lang, t);
      if (c != null) map[t] = c; else toFetch.push(t);
    });

    if (toFetch.length) {
      const fetched = await fetchAll(toFetch, lang, function (d, n) {
        updateLoading(d, n);
      });
      Object.assign(map, fetched);
    }

    textNodes.forEach(function (it) {
      const orig = it.original;
      const tr = map[orig.trim()];
      if (tr) {
        const lead = orig.match(/^\s*/)[0];
        const tail = orig.match(/\s*$/)[0];
        it.node.nodeValue = lead + tr + tail;
      }
    });
    attrNodes.forEach(function (it) {
      const tr = map[it.original.trim()];
      if (tr) it.node.setAttribute(it.attr, tr);
    });

    showLoading(false);
    busy = false;
  }

  // ---- UI: dropdown + loading indicator ----
  function injectStyles() {
    if (document.getElementById('wmw-i18n-style')) return;
    const st = document.createElement('style');
    st.id = 'wmw-i18n-style';
    st.textContent =
      '.lang-switch-select{font:inherit;font-size:13px;padding:6px 28px 6px 10px;border-radius:6px;' +
      'border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.65);color:#fff;cursor:pointer;' +
      '-webkit-appearance:none;appearance:none;' +
      'background-image:url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\' viewBox=\'0 0 10 6\'><path fill=\'%23fff\' d=\'M0 0l5 6 5-6z\'/></svg>");' +
      'background-repeat:no-repeat;background-position:right 8px center;background-size:8px}' +
      '.lang-switch-select option{background:#111;color:#fff}' +
      '.lang-switch-select--inline{margin-right:8px}' +
      '.lang-switch-select--floating{position:fixed;top:14px;right:14px;z-index:99999;backdrop-filter:blur(6px)}' +
      '#wmw-i18n-loader{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:99999;' +
      'background:rgba(0,0,0,.85);color:#fff;font:13px/1.2 system-ui,sans-serif;padding:10px 16px;' +
      'border-radius:999px;border:1px solid rgba(255,255,255,.15);display:none}' +
      '#wmw-i18n-loader.on{display:block}' +
      '@media (max-width:640px){.lang-switch-select{font-size:12px;padding:5px 24px 5px 8px}' +
      '.lang-switch-select--floating{top:8px;right:8px}}';
    document.head.appendChild(st);
  }

  function injectSwitcher() {
    if (document.querySelector('.lang-switch-select')) return;
    const sel = document.createElement('select');
    sel.className = 'lang-switch-select';
    sel.setAttribute('aria-label', 'Change language');
    const seen = new Set();
    LANGS.forEach(function (l) {
      if (seen.has(l[0])) return; seen.add(l[0]);
      const o = document.createElement('option');
      o.value = l[0];
      o.textContent = l[1];
      sel.appendChild(o);
    });
    sel.value = getStored();
    sel.addEventListener('change', function () {
      const v = sel.value;
      setStored(v);
      translate(v);
    });

    // Remove any legacy switcher button
    document.querySelectorAll('.lang-switch').forEach(function (b) { b.remove(); });

    const actions = document.querySelector('.nav__actions');
    if (actions) {
      sel.classList.add('lang-switch-select--inline');
      actions.insertBefore(sel, actions.firstChild);
    } else {
      sel.classList.add('lang-switch-select--floating');
      document.body.appendChild(sel);
    }
  }

  function injectLoader() {
    if (document.getElementById('wmw-i18n-loader')) return;
    const d = document.createElement('div');
    d.id = 'wmw-i18n-loader';
    d.textContent = 'Translating…';
    document.body.appendChild(d);
  }

  function showLoading(on) {
    const d = document.getElementById('wmw-i18n-loader');
    if (!d) return;
    if (on) { d.textContent = 'Translating…'; d.classList.add('on'); }
    else d.classList.remove('on');
  }
  function updateLoading(done, total) {
    const d = document.getElementById('wmw-i18n-loader');
    if (!d) return;
    d.textContent = 'Translating… ' + done + ' / ' + total;
  }

  // ---- Bootstrap ----
  function init() {
    injectStyles();
    injectSwitcher();
    injectLoader();
    const cur = getStored();
    if (cur !== 'en') {
      // defer so initial paint completes
      setTimeout(function () { translate(cur); }, 50);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.WMW_i18n = {
    translate: translate,
    getStored: getStored,
    setStored: setStored,
    languages: LANGS
  };
})();
