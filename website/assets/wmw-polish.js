/* WMW / Daylens — Tier-1 Editorial Polish
   Lädt nach wmw.js und wmw-cinematic.js. Aktiviert:
   1. Lenis Smooth Scroll
   2. Split-Letter H1 Reveal (für .split-letter)
   3. Mask-Reveal für Sections (.mask-reveal)
   4. Custom Cursor (Dot + Halo)
   Alles respektiert prefers-reduced-motion + touch devices.
*/
(() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const touch = matchMedia('(hover: none)').matches;

  /* ===== 1. Lenis Smooth Scroll ===== */
  function initLenis() {
    return null; // disabled: native scroll only — duplicate Lenis instances caused lag
    if (reduced || typeof window.Lenis !== 'function') return null;
    const lenis = new window.Lenis({
      duration: 1.15,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), // expo-out
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 1.2,
    });
    function raf(time) { lenis.raf(time); requestAnimationFrame(raf); }
    requestAnimationFrame(raf);

    // Sync with GSAP ScrollTrigger if present
    if (window.ScrollTrigger && window.gsap) {
      lenis.on('scroll', window.ScrollTrigger.update);
      window.gsap.ticker.add((time) => lenis.raf(time * 1000));
      window.gsap.ticker.lagSmoothing(0);
    }
    // Anchor links: hand off to Lenis instead of native smooth-scroll
    document.querySelectorAll('a[href^="#"]').forEach((a) => {
      a.addEventListener('click', (e) => {
        const href = a.getAttribute('href');
        if (!href || href === '#') return;
        const target = document.querySelector(href);
        if (!target) return;
        e.preventDefault();
        lenis.scrollTo(target, { offset: -60, duration: 1.2 });
      });
    });
    return lenis;
  }

  /* ===== 2. Split-Letter H1 Reveal ===== */
  function prepareSplitLetter() {
    document.querySelectorAll('.split-letter').forEach((el) => {
      if (el.querySelector('.char')) return;
      const walk = (node) => {
        const out = document.createDocumentFragment();
        let idx = 0;
        node.childNodes.forEach((c) => {
          if (c.nodeType === 3) {
            // text node — split into chars
            const text = c.textContent;
            for (let i = 0; i < text.length; i++) {
              const ch = text[i];
              if (ch === ' ' || ch === ' ') {
                out.appendChild(document.createTextNode(ch));
              } else {
                const s = document.createElement('span');
                s.className = 'char';
                s.style.transitionDelay = (idx++ * 40) + 'ms';
                s.textContent = ch;
                out.appendChild(s);
              }
            }
          } else if (c.nodeType === 1 && !['STYLE','SCRIPT'].includes(c.tagName)) {
            // recurse into element children
            const wrapper = c.cloneNode(false);
            const inner = walk(c);
            wrapper.appendChild(inner);
            out.appendChild(wrapper);
          } else {
            out.appendChild(c.cloneNode(true));
          }
        });
        return out;
      };
      const replaced = walk(el);
      el.innerHTML = '';
      el.appendChild(replaced);
    });
  }

  function observeReveals(selector, addClass = 'is-visible', threshold = 0.18) {
    if (!('IntersectionObserver' in window) || reduced) {
      document.querySelectorAll(selector).forEach((el) => el.classList.add(addClass));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add(addClass);
          io.unobserve(e.target);
        }
      });
    }, { threshold, rootMargin: '0px 0px -40px 0px' });
    document.querySelectorAll(selector).forEach((el) => io.observe(el));
  }

  /* ===== 3. Mask-Reveal Sections ===== */
  // Same observe machinery — CSS handles the clip-path animation via .is-visible

  /* ===== Init ===== */
  prepareSplitLetter();
  observeReveals('.split-letter', 'is-visible', 0.25);
  observeReveals('.mask-reveal', 'is-visible', 0.18);
  observeReveals('.layered-in',  'is-visible', 0.15);
  observeReveals('.reveal',      'is-visible', 0.12);
  observeReveals('.kinetic',     'is-visible', 0.3);
  initLenis();
  // Custom cursor: removed permanently. Native system cursor on every page.
  // Defensive: remove any leftover class/element from an older cached build.
  document.documentElement.classList.remove('has-custom-cursor');
  document.querySelectorAll('.wmw-cursor').forEach((el) => el.remove());
})();
