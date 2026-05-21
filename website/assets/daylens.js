/* Daylens shared client behaviors */
(() => {
  // Nav glass on scroll
  const nav = document.getElementById('nav');
  if (nav && !document.body.classList.contains('subpage')) {
    const onScroll = () => {
      if (window.scrollY > 24) nav.classList.add('is-scrolled');
      else nav.classList.remove('is-scrolled');
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // Reveal-on-view
  const reveals = document.querySelectorAll('.reveal');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if ('IntersectionObserver' in window && !reducedMotion) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('is-visible');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.18, rootMargin: '0px 0px -60px 0px' });
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add('is-visible'));
  }

  // Floating mobile CTA — appear once past hero
  const mobileCta = document.getElementById('mobileCta');
  const hero = document.querySelector('.hero');
  if (hero && mobileCta && 'IntersectionObserver' in window) {
    const heroIO = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) mobileCta.classList.add('is-visible');
      else mobileCta.classList.remove('is-visible');
    }, { threshold: 0.1 });
    heroIO.observe(hero);
  }
})();
