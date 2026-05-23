/* =========================================================
   Cookie consent banner — minimal compliance UI
   Stores: 'wmw_cookie_consent' = 'all' | 'essential'
   Currently no tracking is loaded; banner is honest about that.
   Language preference (wmw_lang) is treated as essential.
   ========================================================= */
(function () {
  'use strict';

  const KEY = 'wmw_cookie_consent';

  function read() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }

  function write(value) {
    try { localStorage.setItem(KEY, value); } catch (e) { /* ignore */ }
  }

  function dismiss(banner) {
    banner.classList.remove('is-visible');
    setTimeout(function () { banner.remove(); }, 420);
  }

  function copyFor(lang) {
    if (lang === 'de') {
      return {
        text: 'Wir verwenden ausschließlich technisch notwendige Speicherung im Browser — für deine Sprachauswahl und das Cookie-Banner selbst. Kein Tracking, keine Werbung, keine Drittanbieter-Analytics.',
        privacy: 'Datenschutz',
        essential: 'Nur Notwendige',
        all: 'Verstanden'
      };
    }
    return {
      text: 'We only use technically necessary browser storage — for your language preference and this banner itself. No tracking, no advertising, no third-party analytics.',
      privacy: 'Privacy',
      essential: 'Essential only',
      all: 'Got it'
    };
  }

  function build() {
    const lang = (document.documentElement.lang || 'en');
    const c = copyFor(lang === 'de' ? 'de' : 'en');
    const banner = document.createElement('div');
    banner.className = 'cookie-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', lang === 'de' ? 'Cookie-Hinweis' : 'Cookie notice');
    banner.innerHTML =
      '<div class="cookie-banner__inner">' +
        '<div class="cookie-banner__copy">' +
          c.text + ' <a href="/datenschutz" target="_blank" rel="noopener">' + c.privacy + ' →</a>' +
        '</div>' +
        '<div class="cookie-banner__actions">' +
          '<button type="button" class="cookie-banner__btn" data-action="essential">' + c.essential + '</button>' +
          '<button type="button" class="cookie-banner__btn cookie-banner__btn--primary" data-action="all">' + c.all + '</button>' +
        '</div>' +
      '</div>';

    banner.querySelector('[data-action="essential"]').addEventListener('click', function () {
      write('essential');
      dismiss(banner);
    });
    banner.querySelector('[data-action="all"]').addEventListener('click', function () {
      write('all');
      dismiss(banner);
    });

    return banner;
  }

  function init() {
    if (read()) return; // already decided
    const banner = build();
    document.body.appendChild(banner);
    // Reflow then animate in
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        banner.classList.add('is-visible');
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 300); });
  } else {
    setTimeout(init, 300);
  }

  // Re-render when language changes (so banner text matches new lang)
  window.addEventListener('storage', function (e) {
    if (e.key === 'wmw_lang') {
      const old = document.querySelector('.cookie-banner');
      if (old) {
        old.remove();
        init();
      }
    }
  });

  window.WMW_cookies = {
    consent: read,
    reset: function () { try { localStorage.removeItem(KEY); } catch (e) {} init(); }
  };
})();
