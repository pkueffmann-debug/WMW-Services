/* =========================================================
   WMW Services — i18n system
   Default lang: EN (HTML content is English).
   DE strings live in this file; toggle replaces text in-place.
   ========================================================= */
(function () {
  'use strict';

  const STORAGE_KEY = 'wmw_lang';
  const SUPPORTED = ['en', 'de'];

  // ============== DE dictionary ==============
  // Keys reference the original English text in the HTML.
  // When user clicks the EN→DE switcher, these replace textContent.
  const de = {
    // ---- Nav ----
    'nav.services': 'Leistungen',
    'nav.work': 'Arbeiten',
    'nav.pricing': 'Preise',
    'nav.pilot': 'Pilot 2026',
    'nav.contact': 'Kontakt',
    'nav.cta': 'Projekt anfragen',
    'nav.about': 'Über uns',

    // ---- Index Hero ----
    'index.eyebrow': 'WMW Services · Berlin',
    'index.hero.headline': 'Maßgeschneiderte Websites für Berliner Geschäfte.',
    'index.hero.headlineEm': 'Live in 7–21 Werktagen.',
    'index.hero.sub': 'AI-Integration für Café, Kanzlei, Trainer & lokale Dienstleister. Festpreis, kein Stundenkonto. Ab 1.490 €.',
    'index.hero.ctaPrimary': 'Kostenloses Erstgespräch →',
    'index.hero.ctaSecondary': 'Arbeiten ansehen',

    // ---- Index Services ----
    'index.services.eyebrow': 'Leistungen',
    'index.services.headline': 'Vom Konzept bis Live-Schaltung.',
    'index.services.s01.title': 'Web Design + Build',
    'index.services.s01.detail': 'Custom-Designs mit Festpreis. Mobile-optimiert, performant, modern. Du gibst Material, wir gestalten und entwickeln.',
    'index.services.s02.title': 'AI Chatbot Integration',
    'index.services.s02.detail': 'Chatbot auf deiner Speisekarte oder Preisliste trainiert. Beantwortet echte Kundenfragen — direkt in der Website.',
    'index.services.s05.title': 'Hosting & Bug-Fixes auf Abruf',
    'index.services.s05.detail': 'Vercel-Hosting mit SSL und automatischen Plattform-Updates. Bei kritischen Bugs schreib uns — wir reagieren so schnell wir können. Content-Änderungen abrufbar nach Stundensatz.',

    // ---- Index About ----
    'index.about.headline.text': 'Ein Studio, vier Schüler,',
    'index.about.headline.em': 'ein Anspruch.',
    'index.about.p1': 'WMW Services ist ein junges Berliner Studio für Web Design mit optionaler AI-Integration. Wir bauen, was wir selbst nutzen würden. Festpreis, klare Lieferzeit, kein Stundenkonto.',
    'index.about.p2': 'Paul (Engineering & AI), Jannis (3D & Motion), Tom (Client Strategy) und Justus (Visual Direction). Vier Berliner Schüler, jeder mit eigener Spezialisierung.',
    'index.about.cta': 'About Us lesen →',

    // ---- Index Contact ----
    'index.contact.eyebrow': 'Kontakt',
    'index.contact.consent': 'Ich willige ein, dass meine Angaben zur Bearbeitung meiner Anfrage gespeichert werden.',
    'index.contact.submit': 'Angebot anfordern →',
    'index.contact.sent': 'Danke! Wir melden uns innerhalb von 48 Stunden persönlich bei dir.',

    // ---- About Page ----
    'about.eyebrow': 'About Us',
    'about.h1.text': 'Vier Schüler aus Berlin.',
    'about.h1.em': 'Vier Spezialisierungen.',
    'about.lead.p1': 'WMW Services ist ein Berliner Web-Studio. Wir sind vier — Paul, Tom, Jannis und Justus. Jeder von uns macht etwas anderes besonders gut: Engineering, Client Strategy, 3D & Motion, Visual Direction. Zusammengenommen bauen wir Festpreis-Websites mit optionaler AI-Integration für Berliner KMU. Ohne Stundenkonto. In 7–21 Werktagen.',
    'about.lead.p2': 'Wir sind kein Konzern, keine Agentur, kein Hobby-Projekt. Wir sind vier Leute aus derselben Schule, die seit Jahren mit Code, Design und Bildern arbeiten — und die irgendwann beschlossen haben, das auch für andere zu tun.',
    'about.team.heading': 'Das Team',
    'about.history.heading': 'Wie WMW entstanden ist',
    'about.history.p': 'Wir kennen uns aus der Schule. Über Monate haben wir nebenher an eigenen Projekten gearbeitet — Paul an JARVIS, Jannis an Blender-Animationen, Justus an Schülerzeitungs-Layouts, Tom an Schülervertretungs-Briefs. Irgendwann fiel uns auf, dass wir vier zusammen genau das abdecken, was ein kleines Web-Studio ausmacht. WMW Services entstand 2025 als ehrlicher Versuch, das, was wir sowieso schon können, gegen Geld anzubieten — zum Festpreis, mit klarer Lieferzeit, ohne Agentur-Theater.',
    'about.built.heading': 'Was wir bisher gebaut haben',
    'about.search.heading': 'Was wir suchen',
    'about.cta.primary': 'Erstgespräch anfragen →',
    'about.cta.secondary': 'Pilot-Konditionen ansehen',

    // ---- Common / Footer ----
    'footer.backToTop': '↑ Nach oben',
    'lang.switcherLabel': 'EN',
  };

  // ============== Core ==============
  function detect() {
    const stored = (function () {
      try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
    })();
    if (stored && SUPPORTED.indexOf(stored) !== -1) return stored;
    return 'en'; // default
  }

  function persist(lang) {
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) { /* private mode */ }
  }

  // Walks DOM, replaces [data-i18n="key"] text with translation.
  // For DE: uses dictionary. For EN: restores the data-i18n-en cache.
  function applyLang(lang) {
    document.documentElement.lang = lang;
    const nodes = document.querySelectorAll('[data-i18n]');
    nodes.forEach(function (node) {
      const key = node.getAttribute('data-i18n');
      if (lang === 'de') {
        // Cache English on first switch
        if (!node.hasAttribute('data-i18n-en')) {
          node.setAttribute('data-i18n-en', node.textContent);
        }
        if (de[key] != null) node.textContent = de[key];
      } else {
        // Restore English from cache
        const en = node.getAttribute('data-i18n-en');
        if (en != null) node.textContent = en;
      }
    });

    // Attributes (placeholder, aria-label, title)
    document.querySelectorAll('[data-i18n-attr]').forEach(function (node) {
      const spec = node.getAttribute('data-i18n-attr'); // "placeholder:contact.name"
      const parts = spec.split(':');
      if (parts.length !== 2) return;
      const attr = parts[0];
      const key = parts[1];
      if (lang === 'de') {
        if (!node.hasAttribute('data-i18n-attr-en-' + attr)) {
          node.setAttribute('data-i18n-attr-en-' + attr, node.getAttribute(attr) || '');
        }
        if (de[key] != null) node.setAttribute(attr, de[key]);
      } else {
        const en = node.getAttribute('data-i18n-attr-en-' + attr);
        if (en != null) node.setAttribute(attr, en);
      }
    });

    // Update switcher state
    document.querySelectorAll('.lang-switch').forEach(function (btn) {
      btn.textContent = lang === 'en' ? 'DE' : 'EN';
      btn.setAttribute('aria-label', lang === 'en' ? 'Sprache auf Deutsch umschalten' : 'Switch language to English');
    });
  }

  function setLang(lang) {
    if (SUPPORTED.indexOf(lang) === -1) return;
    persist(lang);
    applyLang(lang);
  }

  function toggle() {
    const current = document.documentElement.lang || 'en';
    setLang(current === 'en' ? 'de' : 'en');
  }

  // Inject switcher into nav if not already present
  function injectSwitcher() {
    if (document.querySelector('.lang-switch')) return;
    const actions = document.querySelector('.nav__actions');
    if (!actions) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lang-switch';
    btn.textContent = 'DE';
    btn.addEventListener('click', toggle);
    actions.insertBefore(btn, actions.firstChild);
  }

  // Bootstrap
  function init() {
    injectSwitcher();
    applyLang(detect());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose
  window.WMW_i18n = { setLang: setLang, toggle: toggle, detect: detect };
})();
