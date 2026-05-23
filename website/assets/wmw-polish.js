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

  /* ===== 4. Custom Cursor ===== */
  function initCursor() {
    if (reduced || touch) return;
    const dot = document.createElement('div');
    dot.className = 'wmw-cursor';
    dot.innerHTML = '<span class="wmw-cursor__dot"></span><span class="wmw-cursor__halo"></span>';
    document.body.appendChild(dot);
    document.documentElement.classList.add('has-custom-cursor');

    let tx = window.innerWidth / 2, ty = window.innerHeight / 2;
    let dx = tx, dy = ty;     // dot (fast)
    let hx = tx, hy = ty;     // halo (slow lag)
    let active = false;

    window.addEventListener('mousemove', (e) => {
      tx = e.clientX; ty = e.clientY;
      if (!active) { active = true; dot.classList.add('is-visible'); }
    }, { passive: true });
    window.addEventListener('mouseleave', () => {
      active = false; dot.classList.remove('is-visible');
    });

    function frame() {
      dx += (tx - dx) * 0.45;
      dy += (ty - dy) * 0.45;
      hx += (tx - hx) * 0.14;
      hy += (ty - hy) * 0.14;
      dot.style.setProperty('--dx', dx + 'px');
      dot.style.setProperty('--dy', dy + 'px');
      dot.style.setProperty('--hx', hx + 'px');
      dot.style.setProperty('--hy', hy + 'px');
      requestAnimationFrame(frame);
    }
    frame();

    // Grow halo on interactive hover
    const interactive = 'a, button, [role="button"], input, textarea, select, label, .work, .price, .glass-card, .eco-card, .work__cta';
    document.querySelectorAll(interactive).forEach((el) => {
      el.addEventListener('mouseenter', () => dot.classList.add('is-hover'));
      el.addEventListener('mouseleave', () => dot.classList.remove('is-hover'));
    });
  }

  /* ===== Init ===== */
  prepareSplitLetter();
  observeReveals('.split-letter', 'is-visible', 0.25);
  observeReveals('.mask-reveal', 'is-visible', 0.18);
  initLenis();
  initCursor();
})();
