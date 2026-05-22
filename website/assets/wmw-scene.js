/* ==========================================================
   WMW Services — Cinematic Scene
   Full-screen Three.js stage driven by Lenis-synced scroll.
   Architecture:
     1. Lenis smooths native scroll
     2. GSAP ScrollTrigger maps scroll to a master timeline (0..1)
     3. Timeline updates shared state (S.*)
     4. Three.js render loop reads S.* and drives camera + materials
   Mobile: light variant (fewer objects, no fog, no transmission).
   ========================================================== */
(() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = document.getElementById('bg3d');
  if (!canvas) return;

  const isMobile = window.innerWidth < 768;

  if (reduced) {
    canvas.style.display = 'none';
    return;
  }

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
    load('/assets/vendor/three.min.js'),
    load('/assets/vendor/lenis.min.js'),
  ]).then(initAll).catch(() => {
    canvas.style.display = 'none';
  });

  function initAll() {
    gsap.registerPlugin(ScrollTrigger);

    /* ----- Lenis smooth scroll ----- */
    const lenis = new Lenis({
      duration: isMobile ? 0.9 : 1.15,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      smoothTouch: false,
      wheelMultiplier: 1.0,
      touchMultiplier: 1.2,
    });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
    window.__lenis = lenis;

    // Hook anchor links to Lenis scrollTo (override the default smooth)
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

    /* ----- Three.js scene ----- */
    const scene = new THREE.Scene();
    scene.fog = isMobile ? null : new THREE.FogExp2(0x1a1308, 0.06);

    const cam = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
    cam.position.set(0, 0, 14);

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: !isMobile });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.2 : 2));
    renderer.setClearColor(0x000000, 0);

    /* ----- Lighting ----- */
    scene.add(new THREE.AmbientLight(0xfaf6f0, 0.55));
    const key = new THREE.DirectionalLight(0xd4a373, 1.4);
    key.position.set(3, 4, 5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xc8884a, 0.55);
    fill.position.set(-4, -2, -3);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xf5d9a8, 0.4);
    rim.position.set(0, -4, 4);
    scene.add(rim);

    /* ----- Hero octahedron ----- */
    const heroGeo = new THREE.OctahedronGeometry(1.1, 0);
    const heroMat = new THREE.MeshPhysicalMaterial({
      color: 0xf5d9a8,
      transmission: isMobile ? 0 : 0.9,
      opacity: 1,
      metalness: 0,
      roughness: 0.12,
      ior: 1.45,
      thickness: 1.0,
      clearcoat: 1,
      clearcoatRoughness: 0.18,
      attenuationColor: 0xd4a373,
      attenuationDistance: 0.7,
      envMapIntensity: 0.8,
    });
    const hero = new THREE.Mesh(heroGeo, heroMat);
    scene.add(hero);

    // Wire rim
    const wireGeo = new THREE.OctahedronGeometry(1.4, 0);
    const wireMat = new THREE.LineBasicMaterial({ color: 0xc8884a, transparent: true, opacity: 0.2 });
    const wire = new THREE.LineSegments(new THREE.EdgesGeometry(wireGeo), wireMat);
    scene.add(wire);

    /* ----- Constellation ----- */
    const constellation = [];
    const count = isMobile ? 6 : 16;
    const conGeo = new THREE.OctahedronGeometry(0.32, 0);
    for (let i = 0; i < count; i++) {
      const m = new THREE.MeshPhysicalMaterial({
        color: 0xd4a373,
        transmission: isMobile ? 0 : 0.7,
        roughness: 0.22,
        metalness: 0,
        ior: 1.4,
        clearcoat: 0.7,
        clearcoatRoughness: 0.25,
        opacity: 1,
      });
      const mesh = new THREE.Mesh(conGeo, m);
      const t = (i / count) * Math.PI * 2 + Math.random() * 0.6;
      const r = 4 + Math.random() * 3.5;
      const y = (Math.random() - 0.5) * 5;
      mesh.position.set(Math.cos(t) * r, y, Math.sin(t) * r - 1);
      mesh.userData = {
        spin: (Math.random() - 0.5) * 0.014,
        offset: Math.random() * Math.PI * 2,
        baseY: y,
      };
      mesh.scale.setScalar(0.5 + Math.random() * 0.9);
      scene.add(mesh);
      constellation.push(mesh);
    }

    /* ----- Camera curve (CatmullRom through chapter waypoints) ----- */
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 14),      // 0.00 — Hero, far approach
      new THREE.Vector3(0, 0, 4.5),     // 0.08 — Hero settled
      new THREE.Vector3(1.6, -0.3, 5.5),// 0.20 — Services (right pan)
      new THREE.Vector3(-0.4, 0.8, 3.2),// 0.32 — Process (dive)
      new THREE.Vector3(-2.4, 0.2, 1.6),// 0.45 — Portfolio (mid-tunnel)
      new THREE.Vector3(0.4, 0.2, 3.5), // 0.55 — Pull-back
      new THREE.Vector3(0, 0, 4.8),     // 0.62 — Philosophy (climax)
      new THREE.Vector3(2.2, 1.4, 7.0), // 0.75 — Pilot/About
      new THREE.Vector3(-1.6, -0.9, 6), // 0.85 — Pricing
      new THREE.Vector3(0, 0, 5.2),     // 0.95 — Contact
      new THREE.Vector3(0, 0, 5.2),     // 1.00 — Footer
    ]);

    /* ----- Mouse pull (read from window.__mouse if available) ----- */
    const M = { x: 0, y: 0 };

    /* ----- Shared state driven by ScrollTrigger ----- */
    const S = {
      progress: 0,
      heroScale: 1.0,         // scroll-driven
      heroIntro: 0.001,       // one-shot intro multiplier (0..1)
      fogDensity: isMobile ? 0 : 0.085,
      lightIntensity: 1.4,
      attenDist: 0.7,
      constellationOpacity: 0,
      heroOpacity: 1,
    };

    /* ----- Resize ----- */
    function resize() {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h, false);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    }
    resize();
    window.addEventListener('resize', resize);

    /* ----- Render loop ----- */
    let clock = 0;
    function tick() {
      clock += 0.012;

      const m = window.__mouse || { x: 0, y: 0 };
      M.x += (m.x - M.x) * 0.05;
      M.y += (m.y - M.y) * 0.05;

      // Camera along curve
      const t = Math.max(0.001, Math.min(0.999, S.progress));
      const target = curve.getPoint(t);
      cam.position.lerp(
        target.clone().add(new THREE.Vector3(M.x * 0.35, M.y * -0.22, 0)),
        0.08
      );
      cam.lookAt(0, 0, 0);

      // Hero
      hero.rotation.x += 0.0028 + M.y * 0.005;
      hero.rotation.y += 0.0042 + M.x * 0.008;
      const heroEffectiveScale = S.heroScale * S.heroIntro;
      hero.scale.setScalar(heroEffectiveScale);
      heroMat.opacity = S.heroOpacity;
      heroMat.transparent = S.heroOpacity < 1;
      wire.rotation.copy(hero.rotation);
      wire.scale.setScalar(heroEffectiveScale * 1.05);
      wireMat.opacity = 0.2 * S.heroOpacity;

      // Constellation drift + reveal
      for (let i = 0; i < constellation.length; i++) {
        const o = constellation[i];
        o.rotation.x += o.userData.spin;
        o.rotation.y += o.userData.spin * 0.8;
        o.position.y = o.userData.baseY + Math.sin(clock + o.userData.offset) * 0.3;
        o.material.opacity = S.constellationOpacity;
        o.material.transparent = S.constellationOpacity < 1;
      }

      // Fog + lights
      if (scene.fog) scene.fog.density = S.fogDensity;
      key.intensity = S.lightIntensity;
      key.position.x = 3 + M.x * 2.0;
      key.position.y = 4 + M.y * -1.4;
      heroMat.attenuationDistance = S.attenDist;

      renderer.render(scene, cam);
      requestAnimationFrame(tick);
    }
    tick();

    /* ----- Cinematic intro tweens (one-shot, run on load) ----- */
    gsap.to(S, { heroIntro: 1.0, duration: 2.4, ease: 'expo.out', delay: 0.5 });
    gsap.to(S, { constellationOpacity: 0.85, duration: 2.6, ease: 'power2.out', delay: 1.0 });
    gsap.fromTo(key, { intensity: 0 }, { intensity: S.lightIntensity, duration: 2.2, ease: 'power2.out', delay: 0.7 });

    /* ----- Master scroll timeline ----- */
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: 'body',
        start: 'top top',
        end: 'bottom bottom',
        scrub: 1.4,
      },
    });
    tl.to(S, { progress: 1, ease: 'none' }, 0);

    // Per-chapter choreography (independent timeline, same scroller)
    const ch = gsap.timeline({
      scrollTrigger: {
        trigger: 'body',
        start: 'top top',
        end: 'bottom bottom',
        scrub: 1.2,
      },
    });
    // Hero → Services
    ch.to(S, { heroScale: 1.0, fogDensity: 0.06, attenDist: 0.7, lightIntensity: 1.4 }, 0.0);
    // Services → Process (zoom in, fog thickens)
    ch.to(S, { heroScale: 0.8, fogDensity: 0.1, attenDist: 0.45, lightIntensity: 1.1 }, 0.25);
    // Process → Portfolio (deep tunnel)
    ch.to(S, { heroScale: 0.55, fogDensity: 0.14, attenDist: 0.35, lightIntensity: 0.85, constellationOpacity: 1.0 }, 0.42);
    // Pull-back to Philosophy (climax — fog clears, light flares)
    ch.to(S, { heroScale: 1.25, fogDensity: 0.02, attenDist: 1.05, lightIntensity: 2.2 }, 0.58);
    // About / Pilot (steady, mid-fog)
    ch.to(S, { heroScale: 0.9, fogDensity: 0.05, attenDist: 0.75, lightIntensity: 1.5, constellationOpacity: 0.85 }, 0.74);
    // Pricing
    ch.to(S, { heroScale: 1.05, fogDensity: 0.04, attenDist: 0.85, lightIntensity: 1.6 }, 0.86);
    // Contact (calm)
    ch.to(S, { heroScale: 1.1, fogDensity: 0.03, attenDist: 0.95, lightIntensity: 1.4 }, 0.96);

    // Service-item highlight on scroll
    document.querySelectorAll('.services__item').forEach((el) => {
      ScrollTrigger.create({
        trigger: el,
        start: 'top 75%',
        end: 'bottom 25%',
        onToggle: (self) => el.classList.toggle('is-active', self.isActive),
      });
    });

    ScrollTrigger.refresh();
  }
})();
