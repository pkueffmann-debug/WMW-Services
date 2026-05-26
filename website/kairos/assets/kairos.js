/* ═══════════════════════════════════════════════════
   KAIROS — Shared client behavior
   Cursor, header scroll-state, mobile menu, base helpers.
   Page-specific animations live inline in each page.
   ═══════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ─── Dead-link guard ──────────────────────────────
  // Any <a href="#"> without a real fragment target is a demo placeholder.
  // Prevent default so it doesn't jump to top, and mark for a11y.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href="#"]');
    if (!a) return;
    e.preventDefault();
  });
  document.querySelectorAll('a[href="#"]').forEach((a) => {
    if (!a.hasAttribute('aria-disabled')) a.setAttribute('aria-disabled', 'true');
    if (!a.hasAttribute('title')) a.setAttribute('title', 'Demo — fiktiver Link');
  });

  const isCoarse = matchMedia('(pointer: coarse)').matches;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  window.KAIROS = window.KAIROS || {};
  window.KAIROS.isCoarse = isCoarse;
  window.KAIROS.reducedMotion = reducedMotion;

  // ─── Magnetic Cursor ──────────────────────────────
  if (!isCoarse) {
    const cur = document.createElement('div');
    cur.className = 'kairos-cursor';
    cur.setAttribute('aria-hidden', 'true');
    document.body.appendChild(cur);

    let x = 0, y = 0, tx = 0, ty = 0;
    window.addEventListener('mousemove', (e) => { tx = e.clientX; ty = e.clientY; });
    function bindMagnetic(el) {
      el.addEventListener('mouseenter', () => cur.classList.add('expanded'));
      el.addEventListener('mouseleave', () => cur.classList.remove('expanded'));
    }
    document.querySelectorAll('[data-magnetic]').forEach(bindMagnetic);
    window.KAIROS.bindMagnetic = bindMagnetic;

    function tick() {
      x += (tx - x) * 0.18;
      y += (ty - y) * 0.18;
      cur.style.transform = `translate(${x - 12}px, ${y - 12}px)`;
      requestAnimationFrame(tick);
    }
    tick();
  }

  // ─── Header scroll-state ──────────────────────────
  const header = document.querySelector('.kairos-header');
  if (header) {
    function checkScroll() {
      header.classList.toggle('scrolled', window.scrollY > 30);
    }
    checkScroll();
    window.addEventListener('scroll', checkScroll, { passive: true });
  }

  // ─── Mobile menu ──────────────────────────────────
  const hamburger = document.querySelector('.kairos-hamburger');
  const mobileMenu = document.querySelector('.kairos-mobile-menu');
  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', () => {
      const open = hamburger.classList.toggle('open');
      mobileMenu.classList.toggle('open', open);
      document.body.classList.toggle('locked', open);
    });
    mobileMenu.querySelectorAll('a').forEach((a) => {
      a.addEventListener('click', () => {
        hamburger.classList.remove('open');
        mobileMenu.classList.remove('open');
        document.body.classList.remove('locked');
      });
    });
  }

  // ─── Lenis smooth scroll (auto-init if available) ──
  if (!isCoarse && !reducedMotion && typeof Lenis !== 'undefined') {
    const lenis = new Lenis({ duration: 1.05, smoothWheel: true });
    function raf(t) { lenis.raf(t); requestAnimationFrame(raf); }
    requestAnimationFrame(raf);
    window.KAIROS.lenis = lenis;
    if (typeof ScrollTrigger !== 'undefined') {
      lenis.on('scroll', ScrollTrigger.update);
    }
  }
})();
