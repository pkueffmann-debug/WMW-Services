/* WMW Services — shared client behaviors
   Used across main landing + all subsites.
   Pages may load extra page-specific scripts after this. */
(() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- Nav scroll state ---- */
  const nav = document.getElementById('nav');
  if (nav) {
    const onScroll = () => {
      if (window.scrollY > 24) nav.classList.add('is-scrolled');
      else nav.classList.remove('is-scrolled');
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---- Mobile menu ---- */
  const menuBtn = document.getElementById('navMenuBtn');
  const mobileMenu = document.getElementById('mobileMenu');
  const mobileClose = document.getElementById('mobileClose');
  if (menuBtn && mobileMenu) {
    const open = () => { mobileMenu.classList.add('is-open'); document.body.style.overflow = 'hidden'; };
    const close = () => { mobileMenu.classList.remove('is-open'); document.body.style.overflow = ''; };
    menuBtn.addEventListener('click', open);
    if (mobileClose) mobileClose.addEventListener('click', close);
    mobileMenu.querySelectorAll('a').forEach((a) => a.addEventListener('click', close));
  }

  /* ---- Reveal on view ---- */
  const reveals = document.querySelectorAll('.reveal');
  if (!reduced && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); }
      });
    }, { threshold: 0.16, rootMargin: '0px 0px -50px 0px' });
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add('is-visible'));
  }

  /* ---- Anchor smooth scroll (in case CSS smooth is overridden by Lenis on landing) ---- */
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const href = a.getAttribute('href');
      if (!href || href === '#') return;
      const target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
      }
    });
  });
})();
