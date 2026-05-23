/* ==========================================================
   Daylens — Living Memory Constellation
   Signature WebGL hero scene.
   - Particle field in 3D space (bronze-tinted soft points)
   - Camera ambient drift + mouse parallax + scroll dolly
   - Memory fragments: HTML labels projected from 3D anchors
   - Additive blending for volumetric glow feel
   - prefers-reduced-motion → static gradient hero
   ========================================================== */
(() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) {
    document.documentElement.classList.add('dl-static');
    return;
  }
  if (typeof THREE === 'undefined') return;

  const canvas = document.getElementById('dl-canvas');
  const fragmentsHost = document.getElementById('dl-fragments');
  if (!canvas || !fragmentsHost) return;

  const isTouch = matchMedia('(hover: none)').matches;

  /* ===== Renderer ===== */
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: false, alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 1.25 : 1.6));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x06050a, 0.025);

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
  camera.position.set(0, 0, 22);

  /* ===== Soft-point sprite (radial gradient) ===== */
  function makePointSprite(size = 128) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
    g.addColorStop(0.00, 'rgba(255,235,200,1)');
    g.addColorStop(0.18, 'rgba(216,162,108,0.72)');
    g.addColorStop(0.45, 'rgba(176,124,80,0.20)');
    g.addColorStop(1.00, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const sprite = makePointSprite();

  /* ===== Particles ===== */
  const COUNT = isTouch ? 600 : 1200;
  const positions = new Float32Array(COUNT * 3);
  const sizes     = new Float32Array(COUNT);
  const offsets   = new Float32Array(COUNT); // for ambient breathing
  const colors    = new Float32Array(COUNT * 3);

  // distribute in a soft elongated cloud
  for (let i = 0; i < COUNT; i++) {
    // bias toward foreground depths
    const z = -Math.pow(Math.random(), 0.6) * 60 + 8;
    const radial = Math.pow(Math.random(), 0.45) * 18 * (1 + Math.abs(z) / 40);
    const theta = Math.random() * Math.PI * 2;
    positions[i*3+0] = Math.cos(theta) * radial + (Math.random() - 0.5) * 4;
    positions[i*3+1] = Math.sin(theta) * radial * 0.55 + (Math.random() - 0.5) * 6;
    positions[i*3+2] = z;
    sizes[i] = (0.18 + Math.random() * 0.42) * (1 + (z + 60) / 80);
    offsets[i] = Math.random() * Math.PI * 2;
    // bronze tone variation
    const w = Math.random();
    if (w < 0.05) { colors[i*3+0]=1.0; colors[i*3+1]=0.93; colors[i*3+2]=0.78; }   // hot highlight
    else if (w < 0.5) { colors[i*3+0]=0.95; colors[i*3+1]=0.74; colors[i*3+2]=0.48; } // bronze
    else { colors[i*3+0]=0.78; colors[i*3+1]=0.62; colors[i*3+2]=0.42; }              // copper
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSize',    new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aOffset',  new THREE.BufferAttribute(offsets, 1));
  geo.setAttribute('aColor',   new THREE.BufferAttribute(colors, 3));

  const uniforms = {
    uTime:   { value: 0 },
    uTex:    { value: sprite },
    uScale:  { value: window.innerHeight * 0.5 },
    uOpacity:{ value: 0 }, // fades in
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      uniform float uTime;
      uniform float uScale;
      attribute float aSize;
      attribute float aOffset;
      attribute vec3 aColor;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        // subtle drift on each particle
        p.x += sin(uTime * 0.18 + aOffset) * 0.18;
        p.y += cos(uTime * 0.12 + aOffset * 1.3) * 0.22;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float breath = 0.85 + 0.15 * sin(uTime * 0.9 + aOffset);
        gl_PointSize = aSize * uScale * breath / max(-mv.z, 0.001);
        gl_Position = projectionMatrix * mv;
        vColor = aColor;
        vAlpha = clamp(1.0 - smoothstep(40.0, 75.0, -mv.z), 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D uTex;
      uniform float uOpacity;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 uv = gl_PointCoord;
        vec4 t = texture2D(uTex, uv);
        gl_FragColor = vec4(vColor, 1.0) * t * vAlpha * uOpacity;
      }
    `,
  });

  const points = new THREE.Points(geo, mat);
  scene.add(points);

  /* ===== Memory Fragments (HTML labels projected from 3D anchors) ===== */
  const FRAGMENT_TEXTS = [
    '/morning intention',
    'breath · 4-7-8',
    '"the work was harder than I thought"',
    'reflection · Tuesday',
    'attention budget · 87 %',
    '/evening close',
    'thought drift',
    'memory · spring 2026',
    'energy curve',
    '"I noticed I was anxious"',
    'pattern · 14d',
    '/journal entry',
    'mood arc',
    'recovery score',
    '/quiet hour',
    'signal · clear',
  ];
  const fragmentAnchors = [];
  FRAGMENT_TEXTS.forEach((text, i) => {
    const el = document.createElement('span');
    el.className = 'dl-fragment';
    el.textContent = text;
    fragmentsHost.appendChild(el);
    // anchor position in 3D space, mid-depth
    const z = -8 - Math.random() * 22;
    const r = 10 + Math.random() * 8;
    const a = (i / FRAGMENT_TEXTS.length) * Math.PI * 2 + Math.random() * 0.6;
    fragmentAnchors.push({
      el,
      v: new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r * 0.5 + (Math.random() - 0.5) * 4, z),
      offset: Math.random() * Math.PI * 2,
    });
  });

  /* ===== Mouse + scroll ===== */
  let mx = 0, my = 0, tx = 0, ty = 0;
  if (!isTouch) {
    window.addEventListener('pointermove', (e) => {
      tx = (e.clientX / window.innerWidth)  * 2 - 1;
      ty = (e.clientY / window.innerHeight) * 2 - 1;
    }, { passive: true });
  }

  const heroEl = document.querySelector('.dl-hero');
  function heroScrollProgress() {
    if (!heroEl) return 0;
    const h = window.innerHeight;
    const r = heroEl.getBoundingClientRect();
    // 0 when hero top at viewport top, 1 when hero bottom passes viewport top
    const total = r.height;
    const passed = Math.max(0, -r.top);
    return Math.max(0, Math.min(1, passed / total));
  }

  /* ===== Resize ===== */
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    uniforms.uScale.value = h * 0.5;
  }
  window.addEventListener('resize', resize);
  resize();

  /* ===== Loop ===== */
  const tmp = new THREE.Vector3();
  const t0 = performance.now();
  function frame(now) {
    const t = (now - t0) * 0.001;
    uniforms.uTime.value = t;
    // fade-in the field over ~1.2s
    uniforms.uOpacity.value = Math.min(1, t / 1.2);

    // camera: ambient drift + parallax + scroll dolly
    mx += (tx - mx) * 0.04;
    my += (ty - my) * 0.04;
    const scroll = heroScrollProgress();
    camera.position.x = Math.sin(t * 0.07) * 0.8 + mx * 2.2;
    camera.position.y = Math.cos(t * 0.05) * 0.5 - my * 1.4;
    camera.position.z = 22 - scroll * 32; // dolly forward as user scrolls
    camera.lookAt(0, 0, -10);

    // project fragments → 2D screen positions
    for (let i = 0; i < fragmentAnchors.length; i++) {
      const f = fragmentAnchors[i];
      tmp.copy(f.v);
      tmp.x += Math.sin(t * 0.3 + f.offset) * 0.6;
      tmp.y += Math.cos(t * 0.25 + f.offset * 1.4) * 0.5;
      tmp.project(camera);
      const visible = tmp.z > -1 && tmp.z < 1;
      if (visible) {
        const sx = (tmp.x * 0.5 + 0.5) * window.innerWidth;
        const sy = (-tmp.y * 0.5 + 0.5) * window.innerHeight;
        // depth-based alpha + scale
        const depth = 1 - Math.min(1, Math.abs(tmp.z));
        f.el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) scale(${(0.7 + depth * 0.5).toFixed(2)})`;
        f.el.style.opacity = (0.18 + depth * 0.55 * (1 - scroll)).toFixed(3);
      } else {
        f.el.style.opacity = '0';
      }
    }

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
