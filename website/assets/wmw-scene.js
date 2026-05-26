/* ==========================================================
   WMW Services — editorial scroll choreography (v4.1)
   - Lenis smooth-scroll (self-paced raf loop)
   - H2 reveal via IntersectionObserver (no GSAP needed)
   prefers-reduced-motion: skip Lenis + skip the reveal animation
   ========================================================== */
(() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* H2 reveal works even without JS libs — uses IO + CSS transitions */
  setupHeadingReveal(reduced);

  if (reduced) return;

  /* Lenis disabled — native scroll only. Duplicate instances caused lag. */

  function initLenis() {
    const lenis = new Lenis({
      duration: 1.15,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      smoothTouch: false,
    });
    window.__lenis = lenis;

    /* Self-driven raf loop (we no longer route through gsap.ticker). */
    function raf(time) {
      lenis.raf(time);
      requestAnimationFrame(raf);
    }
    requestAnimationFrame(raf);

    /* Anchor links route through Lenis. */
    document.querySelectorAll('a[href^="#"]').forEach((a) => {
      a.addEventListener('click', (e) => {
        const href = a.getAttribute('href');
        if (!href || href === '#') return;
        const target = document.querySelector(href);
        if (target) {
          e.preventDefault();
          lenis.scrollTo(target, { offset: -50, duration: 1.4 });
        }
      });
    });
  }

  function setupHeadingReveal(reduced) {
    const heads = document.querySelectorAll('h2');
    if (!heads.length) return;
    heads.forEach((h) => h.classList.add('h-reveal'));
    if (reduced || !('IntersectionObserver' in window)) {
      heads.forEach((h) => h.classList.add('is-visible'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('is-visible');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -20% 0px' });
    heads.forEach((h) => io.observe(h));
  }
})();
