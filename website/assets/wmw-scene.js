/* ==========================================================
   WMW Services — editorial scroll choreography (v4)
   One effect only: H2 fade + slide-up on viewport entry.
   Plus Lenis smooth-scroll for buttery feel.
   prefers-reduced-motion fully respected — no animation, no Lenis.
   ========================================================== */
(() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return; // Native scroll, native H2 visibility — no work.

  function load(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.async = false;
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  Promise.all([
    load('/assets/vendor/gsap.min.js'),
    load('/assets/vendor/ScrollTrigger.min.js'),
    load('/assets/vendor/lenis.min.js'),
  ]).then(init).catch(() => {});

  function init() {
    gsap.registerPlugin(ScrollTrigger);

    /* Lenis smooth-scroll, driven by the GSAP ticker so ScrollTrigger stays in sync. */
    const lenis = new Lenis({
      duration: 1.15,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      smoothTouch: false,
    });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
    window.__lenis = lenis;

    /* Anchor links route through Lenis for consistent easing. */
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

    /* H2 reveal — the only choreography. */
    document.querySelectorAll('h2').forEach((h2) => {
      gsap.fromTo(h2,
        { opacity: 0, y: 24 },
        {
          opacity: 1,
          y: 0,
          duration: 0.6,
          ease: 'power3.out',
          scrollTrigger: { trigger: h2, start: 'top 80%', once: true },
        }
      );
    });
  }
})();
