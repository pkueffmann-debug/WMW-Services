/* =========================================================
   Aurelys — Constellation view
   Three.js timeline of journal entries as stars.
   Larger / brighter = longer journal entry.
   Click a star → see date + first lines.
   ========================================================= */

import { listEntries, formatDateLong } from '../storage.js';

const THREE_URL = 'https://esm.sh/three@0.160.0';

export async function render(main) {
  main.innerHTML = `
    <div class="constellation-wrap">
      <canvas id="constellation-canvas"></canvas>
      <div class="constellation-meta" id="meta">Your year, one point at a time.</div>
      <div class="constellation-detail" id="detail">
        <div class="det-date" id="det-date"></div>
        <div class="det-snippet" id="det-snippet"></div>
      </div>
      <div class="constellation-empty" id="empty" style="display:none">
        Write your first journal entry — your constellation begins there.
      </div>
    </div>
  `;

  const entries = (await listEntries()).filter((e) => (e.journal || '').trim());
  if (!entries.length) {
    main.querySelector('#empty').style.display = 'grid';
    return null;
  }

  const THREE = await import(THREE_URL);
  const canvas = main.querySelector('#constellation-canvas');
  const wrap = canvas.parentElement;
  const detail = main.querySelector('#detail');

  let width = wrap.clientWidth;
  let height = wrap.clientHeight;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 1000);
  camera.position.set(0, 0, 14);

  // Background ambient particles (atmosphere)
  const ambGeom = new THREE.BufferGeometry();
  const ambCount = 400;
  const ambPos = new Float32Array(ambCount * 3);
  for (let i = 0; i < ambCount; i++) {
    ambPos[i * 3 + 0] = (Math.random() - 0.5) * 60;
    ambPos[i * 3 + 1] = (Math.random() - 0.5) * 40;
    ambPos[i * 3 + 2] = -Math.random() * 30 - 5;
  }
  ambGeom.setAttribute('position', new THREE.BufferAttribute(ambPos, 3));
  const ambMat = new THREE.PointsMaterial({
    color: 0xb8895c, size: 0.04, transparent: true, opacity: 0.35,
  });
  scene.add(new THREE.Points(ambGeom, ambMat));

  // Entry stars — laid out on a gentle spiral / timeline
  const starGeom = new THREE.BufferGeometry();
  const N = entries.length;
  const positions = new Float32Array(N * 3);
  const sizes = new Float32Array(N);
  const starMeta = []; // for raycast lookup

  const spiralRadius = 6;
  const spiralTurns = Math.max(1, N / 30);

  entries.forEach((e, i) => {
    const t = N === 1 ? 0.5 : i / (N - 1);
    const angle = t * spiralTurns * Math.PI * 2;
    const r = spiralRadius * (0.4 + 0.6 * t);
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r * 0.6 + (t - 0.5) * 4;
    const z = -t * 8;
    positions[i * 3 + 0] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    const len = (e.journal || '').length;
    sizes[i] = 0.12 + Math.min(0.35, len / 4000);
    starMeta.push({ entry: e, x, y, z, size: sizes[i] });
  });

  starGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  starGeom.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const starMat = new THREE.PointsMaterial({
    color: 0xefe6d4,
    size: 0.22,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.95,
    map: makeStarTexture(THREE),
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const stars = new THREE.Points(starGeom, starMat);
  scene.add(stars);

  // Faint connecting lines (constellation feel)
  const lineGeom = new THREE.BufferGeometry();
  const linePos = new Float32Array((N - 1) * 6);
  for (let i = 0; i < N - 1; i++) {
    linePos[i * 6 + 0] = positions[i * 3 + 0];
    linePos[i * 6 + 1] = positions[i * 3 + 1];
    linePos[i * 6 + 2] = positions[i * 3 + 2];
    linePos[i * 6 + 3] = positions[(i + 1) * 3 + 0];
    linePos[i * 6 + 4] = positions[(i + 1) * 3 + 1];
    linePos[i * 6 + 5] = positions[(i + 1) * 3 + 2];
  }
  lineGeom.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
  const lineMat = new THREE.LineBasicMaterial({
    color: 0xb8895c, transparent: true, opacity: 0.18,
  });
  scene.add(new THREE.LineSegments(lineGeom, lineMat));

  // Raycaster for click → entry
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 0.4;
  const pointer = new THREE.Vector2();

  function onPointer(ev) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(stars);
    if (hits.length) {
      const idx = hits[0].index;
      const m = starMeta[idx];
      detail.classList.add('on');
      main.querySelector('#det-date').textContent = formatDateLong(m.entry.date);
      main.querySelector('#det-snippet').textContent =
        (m.entry.journal || '').slice(0, 280) + ((m.entry.journal || '').length > 280 ? '…' : '');
    } else {
      detail.classList.remove('on');
    }
  }
  canvas.addEventListener('click', onPointer);

  // Drag-to-rotate
  let dragging = false;
  let dragStart = { x: 0, y: 0 };
  let rotation = { y: 0, x: 0 };
  canvas.addEventListener('pointerdown', (e) => { dragging = true; dragStart = { x: e.clientX, y: e.clientY }; });
  window.addEventListener('pointerup', () => { dragging = false; });
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    rotation.y += (e.clientX - dragStart.x) * 0.005;
    rotation.x += (e.clientY - dragStart.y) * 0.003;
    rotation.x = Math.max(-0.6, Math.min(0.6, rotation.x));
    dragStart = { x: e.clientX, y: e.clientY };
  });

  // Resize
  const onResize = () => {
    width = wrap.clientWidth;
    height = wrap.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize);

  // Animate
  let frame = 0;
  let rafId = 0;
  function tick() {
    frame++;
    stars.rotation.y = rotation.y + Math.sin(frame * 0.001) * 0.05;
    stars.rotation.x = rotation.x;
    scene.children[scene.children.length - 1].rotation.y = stars.rotation.y;
    scene.children[scene.children.length - 1].rotation.x = stars.rotation.x;
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(tick);
  }
  tick();

  // Cleanup
  return () => {
    cancelAnimationFrame(rafId);
    window.removeEventListener('resize', onResize);
    renderer.dispose();
    starGeom.dispose(); lineGeom.dispose(); ambGeom.dispose();
    starMat.dispose(); lineMat.dispose(); ambMat.dispose();
  };
}

function makeStarTexture(THREE) {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,238,210,1)');
  g.addColorStop(0.3, 'rgba(232,195,147,0.7)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  return tex;
}
