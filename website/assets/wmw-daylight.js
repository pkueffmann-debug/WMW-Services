/* ==========================================================
   daylens — Daylight cycle background
   Brand storytelling: a lens shows light, and daylight shifts.
   The page background blends through 4 color stops as you scroll:
     0%   Morgenlicht        #eef1f5  (cool off-white)
     45%  Mittagslicht       #f4f5f7  (neutral)
     75%  Goldene Stunde     #f6f3ed  (warm peach hint)
     100% Dämmerung          #eeedf2  (cool grey-lavender)
   prefers-reduced-motion: lock to #f4f5f7.
   ========================================================== */
(() => {
  const stops = [
    { p: 0.00, r: 238, g: 241, b: 245 },
    { p: 0.45, r: 244, g: 245, b: 247 },
    { p: 0.75, r: 246, g: 243, b: 237 },
    { p: 1.00, r: 238, g: 237, b: 242 },
  ];

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) {
    document.body.style.backgroundColor = '#f4f5f7';
    return;
  }

  function lerp(a, b, t) { return a + (b - a) * t; }
  function colorAt(p) {
    if (p <= stops[0].p) return stops[0];
    if (p >= stops[stops.length-1].p) return stops[stops.length-1];
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i], b = stops[i+1];
      if (p >= a.p && p <= b.p) {
        const t = (p - a.p) / (b.p - a.p);
        return {
          r: Math.round(lerp(a.r, b.r, t)),
          g: Math.round(lerp(a.g, b.g, t)),
          b: Math.round(lerp(a.b, b.b, t)),
        };
      }
    }
    return stops[0];
  }

  let ticking = false;
  function update() {
    ticking = false;
    const max = (document.documentElement.scrollHeight - window.innerHeight) || 1;
    const p = Math.max(0, Math.min(1, window.scrollY / max));
    const c = colorAt(p);
    document.body.style.backgroundColor = `rgb(${c.r}, ${c.g}, ${c.b})`;
  }
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  update();
})();
