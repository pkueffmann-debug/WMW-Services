/* ==========================================================
   WMW / daylens — Build-Process Hero
   Hero zeigt den Bauprozess als 6 Stages: Leer → Wireframe → Grid →
   Farbe → Typografie → Live. ScrollTrigger pinnt die Szene, Stages
   crossfaden anhand scrollProgress. Maus-Tilt via CSS-Perspective.
   prefers-reduced-motion → Stage 5 (Live) statisch.
   Mobile/Touch → kein 3D-Tilt, 2D Layer-Fade.
   ========================================================== */
(() => {
  const section = document.querySelector('[data-build-hero]');
  if (!section) return;

  const stages  = section.querySelectorAll('.bh-stage');
  const counter = section.querySelector('[data-counter]');
  const label   = section.querySelector('[data-label]');
  const frame   = section.querySelector('.build-hero__frame');
  const total   = stages.length;
  const labels  = ['Leeres Browser-Fenster', 'Wireframe', 'Grid', 'Farbe', 'Typografie', 'Live'];

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isTouch = matchMedia('(hover: none)').matches;
  const narrow  = window.innerWidth < 768;

  /* --- Fallback: show only Stage 5 (Live) as a static snapshot --- */
  if (reduced) {
    stages.forEach((s, i) => { s.style.opacity = (i === total - 1 ? '1' : '0'); });
    if (counter) counter.textContent = String(total - 1).padStart(2,'0') + ' / 0' + (total - 1);
    if (label)   label.textContent   = labels[total - 1];
    section.classList.add('is-static');
    return;
  }

  /* --- Stage cross-fade driver --- */
  function setProgress(p) {
    p = Math.max(0, Math.min(1, p));
    // 6 stages → 5 transitions. Map p ∈ [0,1] to stageIndex ∈ [0,5]
    const fp = p * (total - 1);
    const idx = Math.floor(fp);
    const f = fp - idx;
    stages.forEach((s, i) => {
      let o = 0;
      if (i < idx)      o = 0;
      else if (i === idx) o = 1 - f;
      else if (i === idx + 1) o = f;
      else o = 0;
      // Ensure last stage stays solid once reached
      if (idx >= total - 1 && i === total - 1) o = 1;
      s.style.opacity = o.toFixed(3);
    });
    const showIdx = Math.min(total - 1, f > 0.5 ? idx + 1 : idx);
    if (counter) counter.textContent = String(showIdx).padStart(2,'0') + ' / 0' + (total - 1);
    if (label)   label.textContent   = labels[showIdx];
  }

  /* --- Use GSAP ScrollTrigger if available, else native scroll fallback --- */
  function initScroll() {
    if (window.gsap && window.ScrollTrigger) {
      gsap.registerPlugin(ScrollTrigger);
      ScrollTrigger.create({
        trigger: section,
        start: 'top top',
        end:   '+=' + (window.innerHeight * 3), // pin for 3 viewport heights
        pin:   '.build-hero__pin',
        pinSpacing: true,
        scrub: 0.6,
        anticipatePin: 1,
        onUpdate: (self) => setProgress(self.progress),
        onRefresh: (self) => setProgress(self.progress),
      });
      // Lenis ↔ ScrollTrigger sync (Lenis already runs via wmw-scene.js)
      if (window.__lenis) {
        window.__lenis.on('scroll', ScrollTrigger.update);
      }
    } else {
      // Fallback: native scroll, treat first 3 viewports as the build range
      const pinH = window.innerHeight * 3;
      function onScroll() {
        const rect = section.getBoundingClientRect();
        const start = window.scrollY + rect.top;
        const local = Math.max(0, window.scrollY - start);
        setProgress(local / pinH);
      }
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }
  }

  /* --- Mouse parallax tilt via CSS perspective (skipped on touch/narrow) --- */
  function initTilt() {
    if (isTouch || narrow || !frame) return;
    let tx = 0, ty = 0, mx = 0, my = 0;
    section.addEventListener('pointermove', (e) => {
      const r = section.getBoundingClientRect();
      tx = ((e.clientX - r.left) / r.width  - 0.5) * 2; // -1..1
      ty = ((e.clientY - r.top)  / r.height - 0.5) * 2;
    }, { passive: true });
    section.addEventListener('pointerleave', () => { tx = 0; ty = 0; });
    function loop() {
      mx += (tx - mx) * 0.07;
      my += (ty - my) * 0.07;
      const ry = mx * 5;   // max 5°
      const rx = -my * 4;
      frame.style.transform = `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
      requestAnimationFrame(loop);
    }
    loop();
  }

  initScroll();
  initTilt();
  setProgress(0);
})();
