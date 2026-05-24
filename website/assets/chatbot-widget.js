/* ==========================================================
   Floating Concierge Chatbot — shared widget
   Self-contained: injects markup, handles toggle/send/typing.
   Picks persona by window.location.pathname:
     /daylens  → Aurelys Concierge (concept-AI persona)
     anything else → Studio Concierge (WMW Services persona)
   ========================================================== */
(function () {
  if (window.__cbWidgetMounted) return;
  window.__cbWidgetMounted = true;

  // ---- Personas ----------------------------------------------------------
  var path = (window.location.pathname || '/').toLowerCase();
  var isAurelys = /\/daylens(\/|$)?/.test(path);

  var PERSONAS = {
    aurelys: {
      title: 'Aurelys',
      role:  'concierge',
      greeting: 'Hello. I\'m a small <em>concierge</em> for this concept-website. Ask me about Aurelys — the rhythm, the worlds, the philosophy.',
      chips: [
        { label: 'what is aurelys?',     q: 'What is Aurelys?' },
        { label: 'the day-cycle',         q: 'How does the day-cycle work?' },
        { label: 'privacy',               q: 'Is my data private?' },
        { label: 'different from others', q: 'How is this different from other AI products?' },
      ],
      responses: [
        { rx: /(what is|who is|tell me|explain).*(aurelys|product|this|it)/i,
          reply: 'Aurelys is a <em>concept</em> for a calm AI operating system — designed to hold the rhythm of a day. Not an app. A quiet layer beneath everything else.' },
        { rx: /(day.?cycle|daily|routine|day work|how.*day|rhythm)/i,
          reply: 'Five quiet moments: <em>intention</em> in the morning, <em>focus</em> mid-morning, <em>drift</em> after lunch, <em>reflection</em> in the evening, <em>close</em> at night. It only speaks when you turn toward it.' },
        { rx: /(privacy|data|secure|train|model|gdpr|dsgvo)/i,
          reply: 'Three promises: local-first encryption, no training on your data, full exportable memory. <em>Yours to leave with</em>, anytime.' },
        { rx: /(different|why|what makes|other|alternative)/i,
          reply: 'Most software <em>demands</em> attention. Aurelys earns it — by being quiet by default, attentive only when called.' },
        { rx: /(price|cost|subscribe|buy|free|kosten|preis)/i,
          reply: 'This is a <em>concept</em> website — no product, no pricing, no waitlist. A visual study only.' },
        { rx: /(demo|fictional|real|fake|concept|fiktiv)/i,
          reply: 'Yes — Aurelys is fictional. This page is a design study by <em>WMW Services</em>, not a real product.' },
        { rx: /(hello|hi|hey|hallo|moin|servus|guten tag)/i,
          reply: 'Hello. Take your time. Ask anything about Aurelys.' },
        { rx: /(voice|speak|talk|spoken|sprechen|stimme)/i,
          reply: 'Voice-first by design. You speak; the memory holds.' },
        { rx: /(worlds|wellness|journal|adhd|clarity|biohack|recovery|performance)/i,
          reply: 'Five worlds, one intelligence: <em>Wellness</em>, <em>Journal</em>, <em>Clarity</em>, <em>Performance</em>, <em>Recovery</em>.' },
        { rx: /(thank|danke|cheers|bye|tschuss)/i,
          reply: 'Thank you. <em>Begin quietly.</em>' },
      ],
      fallback: 'I\'m a small concept-demo concierge — try asking about the day-cycle, privacy, or how Aurelys is <em>different</em>.',
    },

    studio: {
      title: 'WMW',
      role:  'studio concierge',
      greeting: 'Hallo. Ich bin der kleine <em>Studio-Concierge</em>. Frag mich gerne nach Preisen, Pilot-Programm, den Demos oder Kontakt.',
      chips: [
        { label: 'preise',         q: 'Was kostet eine Website?' },
        { label: 'pilot-programm', q: 'Wie funktioniert das Pilot-Programm?' },
        { label: 'demos',          q: 'Welche Demos gibt es?' },
        { label: 'kontakt',        q: 'Wie kann ich Kontakt aufnehmen?' },
      ],
      responses: [
        { rx: /(preis|kost|wie viel|wieviel|price|cost|tarif|pauschal)/i,
          reply: 'Drei Festpreis-Pakete: <em>Starter</em> ab 490&nbsp;€ (7 Werktage), <em>Studio</em> ab 1.490&nbsp;€ (14 Werktage), <em>Studio+</em> ab 3.290&nbsp;€ mit AI-Chatbot. Endpreis nach 15-Min-Call.' },
        { rx: /(pilot|reduziert|rabatt|discount|kondition)/i,
          reply: 'Drei Pilot-Plätze 2026 mit <em>−40 % gegen Listenpreis</em> im Tausch für das Recht, das fertige Projekt als Referenz zu führen. Zwei Plätze noch offen.' },
        { rx: /(demo|beispiel|portfolio|arbeit|reference|case)/i,
          reply: 'Sieben Designstudien live: <a href="/cafe">Café</a>, <a href="/kanzlei">Kanzlei</a>, <a href="/trainer">Personal Trainer</a>, <a href="/handwerker">Tischlerei</a>, <a href="/salon">Beauty-Salon</a>, <a href="/freelancer">IT-Consultant</a> und <a href="/daylens">Aurelys</a> (cinematische AI-Konzept-Website). Alles fiktive Konzept-Studien.' },
        { rx: /(kontakt|contact|email|telefon|erreich|anfrage|anfragen|melden)/i,
          reply: 'Am schnellsten via Kontakt-Formular auf der Startseite, Bereich <a href="/#contact"><em>Hast du ein Projekt im Kopf?</em></a>. Antwort innerhalb von 2 Werktagen.' },
        { rx: /(zeit|dauer|wie lang|wann|liefer|live|deadline)/i,
          reply: 'Landing-Pages: 7 Werktage. Mehrseitige Sites: 14–21 Tage. Garantiert per Festpreis-Vertrag — kein Stundenkonto.' },
        { rx: /(ai|chatbot|künstlich|intelligen|trained|gpt|claude)/i,
          reply: 'Wir trainieren AI-Chatbots auf deine Speisekarte, Preisliste oder Buchungsregeln. Inkludiert im <em>Studio+</em>-Paket. Eine cinematische AI-Konzept-Demo findest du unter <a href="/daylens">/daylens</a>.' },
        { rx: /(seo|google|local|mobile|performance|speed|lighthouse)/i,
          reply: 'Lighthouse ≥ 90 mobile ist Standard, kein Aufpreis. Mobile-First, Local-SEO für Berlin, Google-Business-Profil-Anbindung inklusive.' },
        { rx: /(wartung|update|hosting|server|maintenance)/i,
          reply: 'Optionale Wartung: Sicherheits-Updates monatlich, Bug-Fixes binnen 7 Tagen, ein Content-Change pro Monat inklusive. Hosting Jahr 1 im Starter-Paket dabei.' },
        { rx: /(daylens|aurelys|concept|cinematic|webgl)/i,
          reply: 'Unter <a href="/daylens">/daylens</a> liegt <em>Aurelys</em> — eine cinematische Konzept-Website für eine fiktive AI-Plattform. WebGL-Memory-Constellation, Scroll-Storytelling, dark editorial. Zeigt was möglich ist, wenn das Budget stimmt.' },
        { rx: /(wmw|studio|wer|who|über|about|paul)/i,
          reply: 'WMW Services ist ein kleines Berliner Studio. Drei Pilot-Plätze 2026, sechs Demo-Studien live, alles transparent. <a href="/about">Mehr →</a>' },
        { rx: /(hallo|hi|hey|moin|servus|guten tag|hello)/i,
          reply: 'Hallo! Schön, dass du da bist. Frag mich nach Preisen, Pilot-Konditionen, den Demos oder Kontakt.' },
        { rx: /(impressum|datenschutz|recht|legal|gdpr|dsgvo)/i,
          reply: 'Alle Rechts-Infos: <a href="/impressum">Impressum</a> · <a href="/datenschutz">Datenschutz</a>. Sitz in Berlin, gewerblich angemeldet.' },
        { rx: /(thank|danke|cheers|bye|tschuss|ciao)/i,
          reply: 'Danke. <em>Bis bald.</em>' },
      ],
      fallback: 'Ich bin ein kleiner Studio-Concierge. Probier es mit <em>Preise</em>, <em>Pilot</em>, <em>Demos</em>, <em>Kontakt</em> oder <em>AI-Chatbot</em>.',
    },
  };

  var persona = isAurelys ? PERSONAS.aurelys : PERSONAS.studio;

  // ---- Build markup ------------------------------------------------------
  var root = document.createElement('div');
  root.className = 'cb-widget';
  root.setAttribute('aria-live', 'polite');

  var initialLetter = persona.title.charAt(0).toUpperCase();

  var chipsHtml = persona.chips.map(function (c) {
    return '<button type="button" class="cb-chip" data-q="' + escapeAttr(c.q) + '">' + escapeHtml(c.label) + '</button>';
  }).join('');

  root.innerHTML =
    '<div class="cb-panel" role="dialog" aria-label="' + escapeAttr(persona.title) + ' ' + escapeAttr(persona.role) + '">' +
      '<div class="cb-header">' +
        '<div class="cb-title">' + escapeHtml(persona.title) + ' <small>' + escapeHtml(persona.role) + '</small></div>' +
        '<button type="button" class="cb-close" aria-label="Close chat">close</button>' +
      '</div>' +
      '<div class="cb-feed">' +
        '<div class="cb-msg cb-msg--bot">' + persona.greeting + '</div>' +
      '</div>' +
      '<div class="cb-chips">' + chipsHtml + '</div>' +
      '<form class="cb-form" autocomplete="off">' +
        '<input type="text" class="cb-input" placeholder="' + (isAurelys ? 'ask quietly…' : 'frag den concierge…') + '" aria-label="Message">' +
        '<button type="submit" class="cb-send">send</button>' +
      '</form>' +
    '</div>' +
    '<button type="button" class="cb-toggle" aria-label="Open concierge chat" aria-expanded="false">' + escapeHtml(initialLetter) + '</button>';

  // Mount after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(root); init(); });
  } else {
    document.body.appendChild(root);
    init();
  }

  // ---- Logic -------------------------------------------------------------
  function init() {
    var toggle = root.querySelector('.cb-toggle');
    var closeBtn = root.querySelector('.cb-close');
    var form = root.querySelector('.cb-form');
    var input = root.querySelector('.cb-input');
    var feed = root.querySelector('.cb-feed');
    var chips = root.querySelector('.cb-chips');

    function setOpen(open) {
      root.classList.toggle('is-open', !!open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) setTimeout(function () { input.focus(); }, 320);
    }
    toggle.addEventListener('click', function () { setOpen(!root.classList.contains('is-open')); });
    closeBtn.addEventListener('click', function () { setOpen(false); });

    function addMsg(html, who) {
      var el = document.createElement('div');
      el.className = 'cb-msg cb-msg--' + who;
      el.innerHTML = html;
      feed.appendChild(el);
      feed.scrollTop = feed.scrollHeight;
      return el;
    }
    function typing() {
      var el = document.createElement('div');
      el.className = 'cb-msg cb-msg--bot';
      el.innerHTML = '<span class="cb-typing"><span></span><span></span><span></span></span>';
      feed.appendChild(el);
      feed.scrollTop = feed.scrollHeight;
      return el;
    }
    function reply(text) {
      for (var i = 0; i < persona.responses.length; i++) {
        if (persona.responses[i].rx.test(text)) return persona.responses[i].reply;
      }
      return persona.fallback;
    }
    function handle(text) {
      text = (text || '').trim();
      if (!text) return;
      addMsg(escapeHtml(text), 'user');
      var t = typing();
      setTimeout(function () { t.remove(); addMsg(reply(text), 'bot'); }, 700 + Math.random() * 500);
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = input.value;
      input.value = '';
      handle(v);
    });
    chips.addEventListener('click', function (e) {
      var b = e.target.closest('.cb-chip');
      if (b) handle(b.getAttribute('data-q'));
    });

    // Subtle pulse after 6s if untouched
    setTimeout(function () {
      if (!root.classList.contains('is-open')) {
        toggle.animate(
          [{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }],
          { duration: 900, iterations: 1, easing: 'cubic-bezier(.2,.7,.2,1)' }
        );
      }
    }, 6000);
  }

  // ---- helpers -----------------------------------------------------------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }
})();
