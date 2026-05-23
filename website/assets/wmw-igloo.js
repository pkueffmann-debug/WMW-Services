/* ==========================================================
   WMW Services — igloo.inc-style WebGL takeover
   - Full-bleed Three.js canvas behind the page
   - Scroll-driven camera dolly + orbit
   - Morphing refractive glass icosahedron (stage per section)
   - Per-section accent color shifts envmap tint
   - Self-hosted Three.js (no CDN). prefers-reduced-motion + touch fallback.
   ========================================================== */
(() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isTouch = matchMedia('(hover: none)').matches;
  if (reduced) return;
  if (typeof THREE === 'undefined') return;

  const canvas = document.getElementById('igloo-canvas');
  if (!canvas) return;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 1.25 : 1.75));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x06070a, 0.06);

  const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 0, 6.2);

  /* ---- Lights ---- */
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const key = new THREE.DirectionalLight(0xfff1d6, 1.1);
  key.position.set(4, 5, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8aa6ff, 0.6);
  rim.position.set(-5, -3, -4);
  scene.add(rim);

  /* ---- Procedural env map (radial gradient → CubeRT via PMREM) ---- */
  function makeEnvMap() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#1a1f2c');
    g.addColorStop(0.45, '#3a2a1c');
    g.addColorStop(0.8, '#8a6a48');
    g.addColorStop(1, '#0b0c10');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromEquirectangular(tex).texture;
    pmrem.dispose(); tex.dispose();
    return env;
  }
  scene.environment = makeEnvMap();

  /* ---- Hero geometry: subdivided icosahedron with displacement via vertex shader hook ---- */
  const geo = new THREE.IcosahedronGeometry(1.35, 24);
  // store original positions for morphing
  const orig = geo.attributes.position.array.slice();

  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xe8d8c0,
    metalness: 0.05,
    roughness: 0.08,
    transmission: 0.92,
    thickness: 1.6,
    ior: 1.45,
    attenuationColor: new THREE.Color(0xb88a55),
    attenuationDistance: 2.4,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.2,
  });

  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);

  /* ---- Outer wireframe halo ---- */
  const haloGeo = new THREE.IcosahedronGeometry(1.85, 1);
  const haloMat = new THREE.MeshBasicMaterial({ color: 0xc89870, wireframe: true, transparent: true, opacity: 0.18 });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  scene.add(halo);

  /* ---- Particle field (depth + parallax) ---- */
  const pCount = isTouch ? 220 : 520;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(pCount * 3);
  for (let i = 0; i < pCount; i++) {
    const r = 4 + Math.random() * 14;
    const th = Math.random() * Math.PI * 2;
    const ph = (Math.random() - 0.5) * Math.PI;
    pPos[i*3+0] = Math.cos(th) * Math.cos(ph) * r;
    pPos[i*3+1] = Math.sin(ph) * r * 0.6;
    pPos[i*3+2] = Math.sin(th) * Math.cos(ph) * r - 4;
  }
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  const pMat = new THREE.PointsMaterial({ color: 0xc89870, size: 0.018, transparent: true, opacity: 0.55, depthWrite: false });
  const points = new THREE.Points(pGeo, pMat);
  scene.add(points);

  /* ---- Stages per section: camera + morph + accent ---- */
  // morphMode: 0 = icosa, 1 = noisy spiky, 2 = elongated (z-stretch), 3 = swirled torus-ish
  const stages = [
    { sel: '#hero',      camZ: 6.2,  rotY: 0.0,  morph: 0, color: 0xe8d8c0, accent: 0xb88a55 },
    { sel: '#services',  camZ: 5.4,  rotY: 0.6,  morph: 1, color: 0xd4b896, accent: 0x8c5a2a },
    { sel: '#process',   camZ: 4.6,  rotY: 1.4,  morph: 2, color: 0xcfa278, accent: 0x6a4a2c },
    { sel: '#portfolio', camZ: 5.0,  rotY: 2.0,  morph: 1, color: 0xb8865a, accent: 0x5a3a20 },
    { sel: '#about',     camZ: 6.8,  rotY: 2.6,  morph: 3, color: 0xe2c9a0, accent: 0x9a6a40 },
    { sel: '#pilot',     camZ: 5.6,  rotY: 3.2,  morph: 1, color: 0xd0a878, accent: 0x7a4e2c },
    { sel: '#preise',    camZ: 4.8,  rotY: 3.9,  morph: 2, color: 0xc89070, accent: 0x5e3a22 },
    { sel: '#contact',   camZ: 6.0,  rotY: 4.6,  morph: 0, color: 0xead5b8, accent: 0xb88a55 },
  ];

  // resolve y-positions
  function resolveStages() {
    stages.forEach((s) => {
      const el = document.querySelector(s.sel);
      s.top = el ? el.getBoundingClientRect().top + window.scrollY : 0;
    });
  }
  resolveStages();
  window.addEventListener('resize', () => { resolveStages(); onResize(); });

  /* ---- Morphing: re-displace vertices each frame based on target morph value ---- */
  const posAttr = geo.attributes.position;
  const tmp = new THREE.Vector3();
  function applyMorph(t, time) {
    // t is continuous 0..3 (mode index lerps)
    const a = Math.floor(t);
    const f = t - a;
    for (let i = 0; i < posAttr.count; i++) {
      const ox = orig[i*3], oy = orig[i*3+1], oz = orig[i*3+2];
      tmp.set(ox, oy, oz);
      const len = tmp.length();
      // mode displacements
      const dA = displace(ox, oy, oz, a, time);
      const dB = displace(ox, oy, oz, (a+1) % 4, time);
      const d  = dA * (1-f) + dB * f;
      const k = 1 + d;
      posAttr.setXYZ(i, ox*k, oy*k, oz*k);
    }
    posAttr.needsUpdate = true;
    geo.computeVertexNormals();
  }
  function displace(x, y, z, mode, time) {
    const s = 1.3;
    if (mode === 0) {
      // gentle breathing
      return 0.04 * Math.sin(time*0.6 + x*2 + y*2);
    }
    if (mode === 1) {
      // spiky noise
      return 0.16 * Math.sin(x*s*3 + time) * Math.cos(y*s*3 + time*0.7) * Math.sin(z*s*3);
    }
    if (mode === 2) {
      // z-elongation pulse
      return 0.18 * Math.abs(z) * Math.sin(time*0.8 + z*2);
    }
    // mode 3: swirl
    return 0.12 * Math.sin(time*0.5 + Math.atan2(y, x)*3 + z*2);
  }

  /* ---- Color interp between stages ---- */
  const colA = new THREE.Color();
  const colB = new THREE.Color();
  function applyStageBlend(progress) {
    // find current segment
    const max = stages.length - 1;
    const fp = Math.max(0, Math.min(max, progress * max));
    const i = Math.floor(fp);
    const f = fp - i;
    const a = stages[i], b = stages[Math.min(max, i+1)];
    // camera
    const camZ = a.camZ * (1-f) + b.camZ * f;
    const rotY = a.rotY * (1-f) + b.rotY * f;
    camera.position.x = Math.sin(rotY) * 1.1;
    camera.position.y = Math.cos(rotY*0.7) * 0.4;
    camera.position.z = camZ;
    camera.lookAt(0, 0, 0);
    // morph index
    const morph = a.morph * (1-f) + b.morph * f;
    // colors
    colA.setHex(a.color); colB.setHex(b.color);
    mat.color.copy(colA).lerp(colB, f);
    colA.setHex(a.accent); colB.setHex(b.accent);
    mat.attenuationColor.copy(colA).lerp(colB, f);
    haloMat.color.copy(mat.attenuationColor);
    pMat.color.copy(mat.attenuationColor);
    return morph;
  }

  /* ---- Mouse parallax ---- */
  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  if (!isTouch) {
    window.addEventListener('pointermove', (e) => {
      mouse.tx = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.ty = (e.clientY / window.innerHeight) * 2 - 1;
    }, { passive: true });
  }

  /* ---- Scroll progress (works with Lenis or native) ---- */
  function scrollProgress() {
    const max = (document.documentElement.scrollHeight - window.innerHeight) || 1;
    return Math.max(0, Math.min(1, window.scrollY / max));
  }

  /* ---- Loop ---- */
  let t0 = performance.now();
  function frame(now) {
    const t = (now - t0) * 0.001;
    const progress = scrollProgress();
    const morph = applyStageBlend(progress);
    applyMorph(morph, t);

    // smooth mouse
    mouse.x += (mouse.tx - mouse.x) * 0.06;
    mouse.y += (mouse.ty - mouse.y) * 0.06;
    mesh.rotation.y = t * 0.18 + mouse.x * 0.35;
    mesh.rotation.x = mouse.y * 0.25;
    halo.rotation.y = -t * 0.07;
    halo.rotation.x = t * 0.05;
    points.rotation.y = t * 0.02;

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  function onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', onResize);
  onResize();
  requestAnimationFrame(frame);
})();
