// three.js scenes: the hero model viewer and the 3D circuit replay.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

const WHEELS = ['FL', 'FR', 'RL', 'RR'];

// Loads a .glb, or a .js module whose default export is the same .glb as base64
// (used where the host cannot serve binary model files).
async function loadModel(url) {
  const loader = new GLTFLoader();
  if (!url.endsWith('.js')) return loader.loadAsync(url);
  const mod = await import(new URL(url, document.baseURI).href);
  const bin = Uint8Array.from(atob(mod.default), (c) => c.charCodeAt(0));
  return loader.parseAsync(bin.buffer, '');
}
const TYRE_R = 0.38;
let templatePromise = null;

function rimTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#111'; g.beginPath(); g.arc(128, 128, 127, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#2b2f36'; g.beginPath(); g.arc(128, 128, 96, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#9aa3ad'; g.lineWidth = 16; g.lineCap = 'round';
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    g.beginPath(); g.moveTo(128 + Math.cos(a) * 22, 128 + Math.sin(a) * 22); g.lineTo(128 + Math.cos(a) * 90, 128 + Math.sin(a) * 90); g.stroke();
  }
  g.fillStyle = '#ffb21a'; g.fillRect(118, 6, 20, 14);     // tyre-wall marker makes rotation readable
  g.fillStyle = '#c9ced6'; g.beginPath(); g.arc(128, 128, 20, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export function loadCarTemplate(url = window.F1LAB_MODELS?.car || 'models/f1car.glb') {
  if (!templatePromise) {
    templatePromise = loadModel(url).then((gltf) => {
      const root = gltf.scene;
      root.traverse((o) => {
        if (o.isMesh) {
          if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
          if (o.name.startsWith('body')) {
            o.geometry = toCreasedNormals(o.geometry, Math.PI / 5);
          }
          o.castShadow = true; o.receiveShadow = false;
        }
      });
      return root;
    });
  }
  return templatePromise;
}

// Build a car instance: returns { group, setColor(hex), update(dt, speedKph, steer, braking) }
export function makeCar(template, color = '#00665c', { ghost = false } = {}) {
  const group = new THREE.Group();
  const car = template.clone(true);
  group.add(car);
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.35, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.18 });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x111317, metalness: 0.2, roughness: 0.55 });
  const tyre = new THREE.MeshStandardMaterial({ color: 0x141414, metalness: 0, roughness: 0.92 });
  const hub = new THREE.MeshStandardMaterial({ color: 0x777d86, metalness: 0.7, roughness: 0.35, emissive: 0xff4a00, emissiveIntensity: 0 });
  const rimMat = new THREE.MeshStandardMaterial({ map: rimTexture(), metalness: 0.4, roughness: 0.5 });
  const mats = [paint, carbon, tyre, hub, rimMat];
  if (ghost) mats.forEach((m) => { m.transparent = true; m.opacity = 0.38; m.depthWrite = false; });
  const wheels = {};
  car.traverse((o) => {
    if (!o.isMesh) return;
    if (o.name.startsWith('body_paint')) o.material = paint;
    else if (o.name.startsWith('body_carbon')) o.material = carbon;
    else if (o.name.includes('_tyre')) o.material = tyre;
    else if (o.name.includes('_hub')) o.material = hub;
    if (ghost) o.castShadow = false;
  });
  // one spinning rim disc on the outer face of every wheel
  for (const w of WHEELS) {
    const node = car.getObjectByName(`wheel_${w}_tyre`);
    if (!node) continue;
    const pivot = new THREE.Group();
    pivot.position.copy(node.position);
    car.add(pivot);
    const spin = new THREE.Group(); pivot.add(spin);
    const outward = node.position.x > 0 ? 1 : -1;
    const width = w[0] === 'F' ? 0.225 : 0.245;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.3, 40), rimMat);
    disc.rotation.y = outward * Math.PI / 2;
    disc.position.x = outward * (width + 0.004);
    spin.add(disc);
    wheels[w] = { pivot, spin, tyre: node };
  }
  let spinAngle = 0, heat = 0;
  return {
    group, paint,
    setColor(hex) { paint.color.set(hex); },
    update(dt, speedKph, steer = 0, braking = 0) {
      spinAngle += (speedKph / 3.6 / TYRE_R) * dt;
      heat += ((braking ? 1 : 0) - heat) * Math.min(1, dt * (braking ? 3 : 0.8));
      hub.emissiveIntensity = heat * 1.4;
      for (const w of WHEELS) {
        const wh = wheels[w]; if (!wh) continue;
        wh.spin.rotation.x = spinAngle;
        const yaw = w[0] === 'F' ? steer : 0;
        wh.pivot.rotation.y = yaw;
        wh.tyre.rotation.set(spinAngle, yaw, 0, 'YXZ');
      }
    },
  };
}

// Low-poly version of the same model for the 18 cars that are not A or B
let lodPromise = null;
export function loadLodTemplate(url = window.F1LAB_MODELS?.lod || 'models/f1car_lod.glb') {
  if (!lodPromise) lodPromise = loadModel(url).then((g) => g.scene);
  return lodPromise;
}
export function makeProxy(template, color) {
  const g = template.clone(true);
  const mats = {
    paint: new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x121316, roughness: 0.6 }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 }),
  };
  g.traverse((o) => { if (o.isMesh) { const k = ['paint', 'tyre', 'dark'].find((x) => o.name.includes(x)); o.material = mats[k] || mats.dark; if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals(); } });
  return g;
}

function baseRenderer(canvasHost) {
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
  canvasHost.prepend(r.domElement);
  return r;
}

function onVisible(el, cb) {
  let vis = false;
  new IntersectionObserver((es) => { vis = es[0].isIntersecting; cb(vis); }, { rootMargin: '100px' }).observe(el);
  return () => vis;
}

// ------------------------------------------------------------------ hero viewer
export async function heroViewer(host, { color, sensors, onSensor }) {
  const renderer = baseRenderer(host);
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(32, 1.6, 0.1, 100);
  camera.position.set(6.4, 2.6, 6.2);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.45, 0.4); controls.enableDamping = true; controls.enablePan = false;
  controls.minDistance = 4.5; controls.maxDistance = 14; controls.maxPolarAngle = Math.PI * 0.49;
  controls.autoRotate = !matchMedia('(prefers-reduced-motion: reduce)').matches; controls.autoRotateSpeed = 0.9;
  controls.addEventListener('start', () => { controls.autoRotate = false; });

  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(4, 8, 5); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5 });
  scene.add(key, new THREE.HemisphereLight(0xcfe3ff, 0x1a1208, 0.6));
  const floor = new THREE.Mesh(new THREE.CircleGeometry(9, 64), new THREE.ShadowMaterial({ opacity: 0.45 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.6, 3.64, 96), new THREE.MeshBasicMaterial({ color: 0xffb21a, transparent: true, opacity: 0.35 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.002; scene.add(ring);

  const template = await loadCarTemplate();
  const car = makeCar(template, color);
  scene.add(car.group);

  // hotspots projected from car-space anchors
  const tmp = new THREE.Vector3();
  const buttons = sensors.map((s) => {
    const b = document.createElement('button');
    b.className = 'hotspot'; b.textContent = s.label; b.style.setProperty('--c', s.color);
    b.addEventListener('click', () => onSensor(s));
    host.appendChild(b);
    return b;
  });

  const resize = () => {
    const w = host.clientWidth, h = host.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(host); resize();
  const visible = onVisible(host, () => {});
  const clock = new THREE.Clock();
  let idleSpeed = 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!visible()) return;
    controls.update();
    idleSpeed += (18 - idleSpeed) * dt;
    car.update(dt, idleSpeed, Math.sin(clock.elapsedTime * 0.6) * 0.18, 0);
    renderer.render(scene, camera);
    const w = host.clientWidth, h = host.clientHeight;
    const camDir = camera.getWorldDirection(new THREE.Vector3());
    sensors.forEach((s, i) => {
      tmp.set(...s.pos).project(camera);
      const b = buttons[i];
      b.style.left = `${(tmp.x * 0.5 + 0.5) * w}px`;
      b.style.top = `${(-tmp.y * 0.5 + 0.5) * h}px`;
      const facing = new THREE.Vector3(...s.pos).sub(camera.position).normalize().dot(camDir);
      b.style.opacity = facing > 0 ? 1 : 0;
    });
  });
  host.querySelector('.loading')?.remove();
  return { setColor: (c) => car.setColor(c) };
}

// ------------------------------------------------------------------ circuit replay
export async function trackScene(host, race, ref) {
  const renderer = baseRenderer(host);
  const scene = new THREE.Scene();
  const horizon = new THREE.Color(0x6f8aa3);
  scene.fog = new THREE.Fog(horizon, 300, 1700);
  {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x1c3552) }, bottom: { value: horizon } },
      vertexShader: 'varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vp; void main(){ float h = clamp(vp.y*2.2, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, pow(h, 0.7)), 1.0); }',
    }));
    scene.add(dome);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.3, 4000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enabled = false; controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.48;

  const sun = new THREE.DirectionalLight(0xfff1dc, 2.4); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 120 });
  scene.add(sun, sun.target, new THREE.HemisphereLight(0xbcd6ff, 0x1d2a18, 0.9));

  // --- coordinates: FastF1 X/Y in metres -> world (x, -y), elevation z -> y
  const n = ref.n;
  let cx = 0, cy = 0, zmin = Infinity;
  for (let i = 0; i < n; i++) { cx += ref.x[i]; cy += ref.y[i]; zmin = Math.min(zmin, ref.z[i]); }
  cx /= n; cy /= n;
  const toWorld = (x, y, z) => new THREE.Vector3(x - cx, (z - zmin) * 1.0, -(y - cy));
  // smoothed closed centreline
  const raw = []; for (let i = 0; i < n; i++) raw.push(toWorld(ref.x[i], ref.y[i], ref.z[i]));
  const pts = raw.map((_, i) => {
    const acc = new THREE.Vector3(); let k = 0;
    for (let j = -3; j <= 3; j++) { acc.add(raw[(i + j + n) % n]); k++; }
    return acc.divideScalar(k);
  });
  const W = 13;
  const tangents = pts.map((p, i) => pts[(i + 1) % n].clone().sub(pts[(i - 1 + n) % n]).setY(0).normalize());
  const normals = tangents.map((t) => new THREE.Vector3(-t.z, 0, t.x));

  function ribbon(offA, offB, y, color, opts = {}) {
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= n; i++) {
      const k = i % n, p = pts[k], nm = normals[k];
      const a = p.clone().addScaledVector(nm, offA), b = p.clone().addScaledVector(nm, offB);
      pos.push(a.x, a.y + y, a.z, b.x, b.y + y, b.z);
      uv.push(0, i / 4, 1, i / 4);
      if (i < n) { const o = i * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, ...opts }));
    m.receiveShadow = true; scene.add(m); return m;
  }
  ribbon(-W / 2, W / 2, 0.02, 0x2a2d33);
  ribbon(W / 2, W / 2 + 0.35, 0.04, 0xe8e8e8);
  ribbon(-W / 2 - 0.35, -W / 2, 0.04, 0xe8e8e8);
  ribbon(W / 2 + 0.35, W / 2 + 7, 0.0, 0x3b3f36);     // run-off
  ribbon(-W / 2 - 7, -W / 2 - 0.35, 0.0, 0x3b3f36);

  // kerbs at each braking zone
  const kerbTex = (() => {
    const c = document.createElement('canvas'); c.width = 8; c.height = 64; const g = c.getContext('2d');
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#f2f2f2' : '#d61f26'; g.fillRect(0, i * 8, 8, 8); }
    const t = new THREE.CanvasTexture(c); t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; return t;
  })();
  for (const c of race.corners) {
    const i0 = Math.round((c.d - 110) / race.ds), i1 = Math.round((c.d + 70) / race.ds);
    for (const side of [1, -1]) {
      const pos = [], uv = [], idx = [];
      for (let i = i0, k = 0; i <= i1; i++, k++) {
        const q = ((i % n) + n) % n, p = pts[q], nm = normals[q];
        const a = p.clone().addScaledVector(nm, side * (W / 2 + 0.35)), b = p.clone().addScaledVector(nm, side * (W / 2 + 1.6));
        pos.push(a.x, a.y + 0.05, a.z, b.x, b.y + 0.05, b.z); uv.push(0, k * 1.2, 1, k * 1.2);
        if (i < i1) { const o = k * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: kerbTex, roughness: 0.7, side: THREE.DoubleSide })));
    }
  }
  // start / finish chequer
  {
    const c = document.createElement('canvas'); c.width = 64; c.height = 8; const g = c.getContext('2d');
    for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#eee'; g.fillRect(i * 4, j * 4, 4, 4); }
    const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(W, 1.6), new THREE.MeshStandardMaterial({ map: t }));
    m.rotation.x = -Math.PI / 2; m.position.copy(pts[0]).setY(pts[0].y + 0.05);
    m.rotation.z = Math.atan2(tangents[0].x, tangents[0].z);
    scene.add(m);
  }

  // TV camera poles every ~300 m on the outside of the track
  const poles = [];
  for (let i = 0; i < n; i += 30) {
    const side = i % 60 === 0 ? 1 : -1;
    poles.push(pts[i].clone().addScaledVector(normals[i], side * 38).setY(pts[i].y + 9));
  }

  // Île Notre-Dame: grass island (expanded convex hull) in the St. Lawrence
  {
    const flat = pts.map((p) => [p.x, p.z]);
    const hull = convexHull(flat);
    const cxh = hull.reduce((s, p) => s + p[0], 0) / hull.length, czh = hull.reduce((s, p) => s + p[1], 0) / hull.length;
    const shape = new THREE.Shape(hull.map(([x, z]) => {
      const dx = x - cxh, dz = z - czh, L = Math.hypot(dx, dz) || 1;
      return new THREE.Vector2(x + (dx / L) * 110, -(z + (dz / L) * 110));
    }));
    const island = new THREE.Mesh(new THREE.ShapeGeometry(shape, 24), new THREE.MeshStandardMaterial({ color: 0x24341f, roughness: 1 }));
    island.rotation.x = -Math.PI / 2; island.position.y = -0.05; island.receiveShadow = true; scene.add(island);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshStandardMaterial({ color: 0x0f2a3a, roughness: 0.25, metalness: 0.4 }));
    water.rotation.x = -Math.PI / 2; water.position.y = -1.2; scene.add(water);
    // trees, kept off the track
    const treeGeo = new THREE.ConeGeometry(3.2, 11, 7); treeGeo.translate(0, 5.5, 0);
    const trees = new THREE.InstancedMesh(treeGeo, new THREE.MeshStandardMaterial({ color: 0x1d3a22, roughness: 0.95 }), 700);
    const mtx = new THREE.Matrix4(); let placed = 0, tries = 0;
    const xs = hull.map((p) => p[0]), zs = hull.map((p) => p[1]);
    const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    while (placed < 700 && tries < 20000) {
      tries++;
      const x = x0 - 60 + Math.random() * (x1 - x0 + 120), z = z0 - 60 + Math.random() * (z1 - z0 + 120);
      if (!inPoly([x, z], hull.map(([hx, hz]) => { const dx = hx - cxh, dz = hz - czh, L = Math.hypot(dx, dz) || 1; return [hx + dx / L * 95, hz + dz / L * 95]; }))) continue;
      let near = Infinity; for (let i = 0; i < n; i += 2) near = Math.min(near, Math.hypot(pts[i].x - x, pts[i].z - z));
      if (near < 22) continue;
      if (poles.some((p) => Math.hypot(p.x - x, p.z - z) < 75) && near < 48) continue;   // keep TV sight lines clear
      const s = 0.7 + Math.random() * 0.8;
      mtx.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion(), new THREE.Vector3(s, s * (0.8 + Math.random() * 0.5), s));
      trees.setMatrixAt(placed++, mtx);
    }
    trees.count = placed; scene.add(trees);
  }

  // cars
  const template = await loadCarTemplate();
  const carA = makeCar(template, '#3671C6');
  const carB = makeCar(template, '#ff5252', { ghost: true });
  scene.add(carA.group, carB.group);
  const lod = await loadLodTemplate();
  const proxies = new Map();
  const lanes = [-3.8, 3.8, -1.9, 1.9, -4.8, 4.8, -2.9, 2.9, -1.2, 1.2];
  const laneOf = new Map([...race.drivers].sort((a, b) => a.lapTime - b.lapTime).map((d, i) => [d.num, lanes[i % lanes.length]]));
  for (const d of race.drivers) { const p = makeProxy(lod, d.color); p.visible = false; scene.add(p); proxies.set(d.num, p); }


  const worldAt = (d, fi) => {
    const i = Math.max(0, Math.min(d.n - 2, Math.floor(fi))), f = fi - i;
    return toWorld(d.x[i] + (d.x[i + 1] - d.x[i]) * f, d.y[i] + (d.y[i + 1] - d.y[i]) * f, d.z[i] + (d.z[i + 1] - d.z[i]) * f);
  };
  const headingAt = (d, fi) => {
    const a = worldAt(d, Math.max(0, fi - 1.2)), b = worldAt(d, Math.min(d.n - 1.001, fi + 1.2));
    return Math.atan2(b.x - a.x, b.z - a.z);
  };
  const place = (obj, d, fi, st, lane = 0) => {
    const p = worldAt(d, fi);
    const h = headingAt(d, fi);
    let dh = h - (st.h ?? h); dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    st.h = (st.h ?? h) + dh * 0.35; obj.rotation.y = st.h;
    obj.position.set(p.x + Math.cos(st.h) * lane, p.y + 0.02, p.z - Math.sin(st.h) * lane);
    return dh;
  };

  let mode = 'chase';
  const setCam = (m) => { mode = m; controls.enabled = m === 'orbit'; if (m === 'orbit') controls.target.copy(carA.group.position); };
  let camYaw = 0;
  camera.position.set(0, 400, 400);

  const resize = () => {
    const w = host.clientWidth, h = host.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(host); resize();
  const visible = onVisible(host, () => {});
  host.querySelector('.loading')?.remove();

  const stA = {}, stB = {}, stP = new Map();
  function frame(dt, s) {
    // s: { A, B, fiA, fiB, fiAll: Map(num -> fi), stateA, stateB, showOthers }
    if (!visible()) return;
    const dhA = place(carA.group, s.A, s.fiA, stA);
    const vA = s.stateA.speed;
    const steer = THREE.MathUtils.clamp(dhA * 6, -0.35, 0.35);
    const moving = s.simDt > 0 && s.fiA < s.A.n - 1;
    carA.update(s.simDt, moving ? vA : 0, steer, s.stateA.brake);
    if (s.B && s.B !== s.A) { place(carB.group, s.B, s.fiB, stB); carB.group.visible = mode !== 'chase' || carB.group.position.distanceTo(camera.position) > 7; carB.update(s.simDt, s.fiB < s.B.n - 1 ? s.stateB.speed : 0, 0, s.stateB.brake); }
    else carB.group.visible = false;
    for (const d of race.drivers) {
      const p = proxies.get(d.num);
      const show = d !== s.A && d !== s.B;
      p.visible = show;
      if (show) {
        if (!stP.has(d.num)) stP.set(d.num, {});
        place(p, d, s.fiAll.get(d.num), stP.get(d.num), laneOf.get(d.num));
        const dist = p.position.distanceTo(camera.position);
        // in the chase view, cars between the camera and car A would block it: hide those
        p.visible = mode !== 'chase' || dist > 12;
      }
    }
    const car = carA.group.position, h = stA.h || 0;
    sun.position.copy(car).add(new THREE.Vector3(30, 60, 20)); sun.target.position.copy(car);
    // chase and heli cameras are rigidly attached to the car; only their yaw is smoothed,
    // so they never fall behind a car doing 330 km/h
    let dy = h - camYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    camYaw += dy * (1 - Math.exp(-dt * 4));
    const back = new THREE.Vector3(Math.sin(camYaw), 0, Math.cos(camYaw));
    if (mode === 'chase') {
      camera.position.copy(car).addScaledVector(back, -8.5).setY(car.y + 2.5);
      camera.fov = 55; camera.lookAt(car.clone().addScaledVector(back, 5).setY(car.y + 0.9));
    } else if (mode === 'tv') {
      let best = poles[0], bd = Infinity;
      for (const p of poles) { const dd = p.distanceTo(car); if (dd < bd) { bd = dd; best = p; } }
      camera.position.copy(best); camera.lookAt(car);
      camera.fov = THREE.MathUtils.clamp(2 * Math.atan(9 / Math.max(bd, 1)) * 180 / Math.PI, 8, 50);
    } else if (mode === 'heli') {
      camera.position.copy(car).addScaledVector(back, -60).setY(car.y + 80);
      camera.lookAt(car.clone().addScaledVector(back, 25)); camera.fov = 45;
    } else {
      const delta = car.clone().sub(controls.target); controls.target.add(delta); camera.position.add(delta);
      controls.update(); camera.fov = 50;
    }
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }
  return { frame, setCam, setColors(a, b) { carA.setColor(a); carB.setColor(b); }, debug: { camera, carA: carA.group, carB: carB.group } };
}

function convexHull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
function inPoly([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
