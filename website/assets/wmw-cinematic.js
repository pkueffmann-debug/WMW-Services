/* WMW Services — cinematic layer
   Only loaded on the main landing.
   - particle field
   - mouse-position broadcast (window.__mouse) for Three.js light
   - magnetic CTA hover
   - kinetic word-by-word reveal
   - layered scroll-in for sections
*/
(() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobile = window.innerWidth < 768;

  /* ---- Mouse position broadcaster ---- */
  // Normalised -1..1 for both x and y, centered at (0,0)
  window.__mouse = { x: 0, y: 0, raw: { x: 0, y: 0 } };
  if (!reduced) {
    window.addEventListener('mousemove', (e) => {
      window.__mouse.raw.x = e.clientX;
      window.__mouse.raw.y = e.clientY;
      window.__mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      window.__mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
    }, { passive: true });
  }

  /* ---- Particle field (canvas behind everything) ---- */
  function startParticles() {
    if (reduced || isMobile) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'particles';
    document.body.prepend(canvas);
    const ctx = canvas.getContext('2d');
    let w, h, particles;

    function resize() {
      w = canvas.width = window.innerWidth * window.devicePixelRatio;
      h = canvas.height = window.innerHeight * window.devicePixelRatio;
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
    }
    function init() {
      const count = Math.min(70, Math.round((window.innerWidth * window.innerHeight) / 26000));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.18,
        r: (Math.random() * 0.9 + 0.4) * window.devicePixelRatio,
        a: Math.random() * 0.35 + 0.05,
      }));
    }
    function frame() {
      ctx.clearRect(0, 0, w, h);
      const mx = window.__mouse.raw.x * window.devicePixelRatio;
      const my = window.__mouse.raw.y * window.devicePixelRatio;
      for (const p of particles) {
        // gentle drift towards mouse
        const dx = mx - p.x, dy = my - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 220 * window.devicePixelRatio) {
          p.vx += (dx / dist) * 0.004;
          p.vy += (dy / dist) * 0.004;
        }
        // damping
        p.vx *= 0.985; p.vy *= 0.985;
        p.x += p.vx; p.y += p.vy;
        // wrap
        if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
        // draw
        ctx.fillStyle = `rgba(212, 163, 115, ${p.a})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      requestAnimationFrame(frame);
    }
    resize(); init();
    window.addEventListener('resize', () => { resize(); init(); });
    frame();
  }

  /* ---- Magnetic CTAs ---- */
  function bindMagnetic() {
    if (reduced || isMobile) return;
    document.querySelectorAll('.magnetic').forEach((el) => {
      const strength = parseFloat(el.dataset.magnet || '0.3');
      el.addEventListener('mousemove', (e) => {
        const r = el.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) * strength;
        const dy = (e.clientY - (r.top + r.height / 2)) * strength;
        el.style.transform = `translate(${dx}px, ${dy}px)`;
      });
      el.addEventListener('mouseleave', () => {
        el.style.transform = 'translate(0, 0)';
      });
    });
  }

  /* ---- Kinetic word reveal ---- */
  function prepareKinetic() {
    document.querySelectorAll('.kinetic').forEach((el) => {
      // Split innerHTML on word boundaries, preserving spaces.
      // Skip if already split (idempotent).
      if (el.querySelector('.word')) return;
      const html = el.innerHTML;
      // Walk text nodes and wrap each word in <span class="word">
      const wrap = (node) => {
        const parts = node.textContent.split(/(\s+)/);
        const frag = document.createDocumentFragment();
        let delayIdx = 0;
        parts.forEach((p) => {
          if (/^\s+$/.test(p)) {
            frag.appendChild(document.createTextNode(p));
          } else if (p.length) {
            const s = document.createElement('span');
            s.className = 'word';
            s.style.transitionDelay = (delayIdx++ * 70) + 'ms';
            s.textContent = p;
            frag.appendChild(s);
          }
        });
        node.parentNode.replaceChild(frag, node);
      };
      const walk = (node) => {
        if (node.nodeType === 3) wrap(node);
        else if (node.nodeType === 1 && !['STYLE','SCRIPT'].includes(node.tagName)) {
          [...node.childNodes].forEach(walk);
        }
      };
      walk(el);
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
    }, { threshold, rootMargin: '0px 0px -60px 0px' });
    document.querySelectorAll(selector).forEach((el) => io.observe(el));
  }

  /* ---- Init ---- */
  prepareKinetic();
  observeReveals('.kinetic', 'is-visible', 0.3);
  observeReveals('.layered-in', 'is-visible', 0.15);
  bindMagnetic();
  startParticles();
})();
