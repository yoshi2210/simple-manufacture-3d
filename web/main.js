import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

window.addEventListener('error', e => { const m = document.getElementById('loadmsg'); if (m) m.textContent = 'エラー: ' + e.message; });

// ============================================================ constants
const C = 9.0, IDX = 2.2, DW = C - IDX;          // cycle, index move, dwell (s)
const G = 0.26, R = 0.68;                          // grip / release fraction of a pick-place op
const ES = 0.8;                                    // engine scale
const BELT_Y = 0.8;                                // V8 conveyor top
const PAL_TOP = BELT_Y + 0.12;                     // engine origin height on pallet
const V8 = { x0: -22, S: 48, R: 3.5, zt: -5 };
V8.zb = V8.zt - 2 * V8.R; V8.cz = V8.zt - V8.R; V8.L = 2 * V8.S + 2 * Math.PI * V8.R;
const NP = 24, DP = V8.L / NP;
const slotS = q => DP * (q + 0.5), slotX = q => V8.x0 + slotS(q);
const CL = { x0: -58, sp: 6.5, z: 8 };
const carX = s => CL.x0 + s * CL.sp;
const Y_SKID = 0.35, Y_HANG = 1.5, Y_DIP = 0.75, RAIL_Y = 5.6;
const XU = slotX(9);
const STAND = new THREE.Vector3(XU, 0.95, -1.4);
const PAINTS = [0xb3121b, 0x1d4f91, 0xeeeeee, 0x15171b, 0x9ea6ae, 0xd39b16, 0x2c6e49, 0x6b2d8c];
const ST_NAMES = ['ST10 ブロック投入', 'ST20 クランクシャフト', 'ST30 ピストン L', 'ST40 ピストン R', 'ST50 シリンダーヘッド L', 'ST60 シリンダーヘッド R', 'ST70 インテーク', 'ST80 カバー類', 'ST90 ビジョン検査', 'ST100 払出し'];
const AMR_ROUTES = [
  [[-30, -15.6], [32, -15.6], [32, -17.6], [-30, -17.6]],
  [[-60, 2.4], [-6, 2.4], [-6, 0.6], [-60, 0.6]],
];
const BELT_PTS = [
  new THREE.Vector3(XU, STAND.y, STAND.z), new THREE.Vector3(XU, 0.6, 0.6), new THREE.Vector3(XU, 0.6, 3.2),
  new THREE.Vector3(carX(9) + 1.55, 0.6, 3.2), new THREE.Vector3(carX(9) + 1.55, 0.6, CL.z),
];
const BELT_M = 3;                                  // cycles an engine spends on the belt

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const lerp = (a, b, f) => a + (b - a) * f;
const mod = (a, n) => ((a % n) + n) % n;
const win = (x, a, b) => smooth((x - a) / (b - a));

// ============================================================ renderer / scene
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b2028);
scene.fog = new THREE.Fog(0x1b2028, 120, 240);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.1, 500);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.49; controls.minDistance = 2.5; controls.maxDistance = 170;

scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x2a2f36, 0.8));
const sun = new THREE.DirectionalLight(0xfff3e2, 2.0);
sun.position.set(30, 60, 25); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 45, bottom: -45, near: 10, far: 160 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
scene.add(sun);

// ============================================================ materials & helpers
const std = (color, metalness = 0.3, roughness = 0.5, extra = {}) => new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });
const M = {
  alu: std(0x9ea4ab, 0.7, 0.42), dark: std(0x3a3e44, 0.55, 0.5), steel: std(0x9aa1a8, 0.9, 0.28),
  chrome: std(0xe9ecef, 1.0, 0.14), red: std(0xb3121b, 0.25, 0.42), black: std(0x17191c, 0.2, 0.62),
  rust: std(0x7a5d50, 0.6, 0.5), frame: std(0x2f6fb3, 0.4, 0.45), yellow: std(0xf2c230, 0.2, 0.5),
  grey: std(0x5d646c, 0.4, 0.55), rubber: std(0x1c1e21, 0.0, 0.8), wall: std(0xc4c9ce, 0.1, 0.8),
  column: std(0x34567a, 0.5, 0.5), white: std(0xe8eaec, 0.1, 0.5),
  glass: new THREE.MeshPhysicalMaterial({ color: 0x1e2b38, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.6 }),
  booth: new THREE.MeshPhysicalMaterial({ color: 0xdfe8f0, metalness: 0, roughness: 0.15, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
  cellGlass: new THREE.MeshPhysicalMaterial({ color: 0xbfe6ff, metalness: 0, roughness: 0.1, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide }),
  lamp: std(0xffffff, 0, 0.4, { emissive: 0xfff6e0, emissiveIntensity: 2.0 }),
  head: std(0xffffff, 0, 0.3, { emissive: 0xeaf4ff, emissiveIntensity: 1.4 }),
  tail: std(0x550000, 0, 0.3, { emissive: 0xff1a1a, emissiveIntensity: 1.1 }),
  laser: new THREE.MeshBasicMaterial({ color: 0x33ff88, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  lightArch: std(0xffffff, 0, 0.3, { emissive: 0xffffff, emissiveIntensity: 2.5 }),
};
const GEO = new Map();
const boxGeo = (w, h, d) => { const k = `b${w},${h},${d}`; if (!GEO.has(k)) GEO.set(k, new THREE.BoxGeometry(w, h, d)); return GEO.get(k); };
const cylGeo = (rt, rb, h, s) => { const k = `c${rt},${rb},${h},${s}`; if (!GEO.has(k)) GEO.set(k, new THREE.CylinderGeometry(rt, rb, h, s)); return GEO.get(k); };
function box(w, h, d, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(boxGeo(w, h, d), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; return m; }
function cyl(rt, rb, h, mat, s = 16, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(cylGeo(rt, rb, h, s), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; return m; }
const rotX = (o, a) => { o.rotation.x = a; return o; }, rotZ = (o, a) => { o.rotation.z = a; return o; }, rotY = (o, a) => { o.rotation.y = a; return o; };

function mergeObj(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMat = new Map();
  root.traverse(o => {
    if (!o.isMesh) return;
    let g = o.geometry.clone();
    if (g.index) g = g.toNonIndexed();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(g);
  });
  const mats = [], parts = [];
  for (const [mat, list] of byMat) { mats.push(mat); parts.push(mergeGeometries(list, false)); }
  const mesh = new THREE.Mesh(mergeGeometries(parts, true), mats);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
function staticGroup(build, shadow = true) { const g = new THREE.Group(); build(g); const m = mergeObj(g); m.castShadow = shadow; scene.add(m); return m; }

function canvasTex(w, h, draw, repeat = false) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function ribbon(samples, width, mat, uvScale = 1) {
  const pos = [], uv = [], idx = []; let acc = 0;
  samples.forEach((s, i) => {
    if (i > 0) acc += Math.hypot(s.x - samples[i - 1].x, s.y - samples[i - 1].y, s.z - samples[i - 1].z);
    const nx = -s.dz, nz = s.dx;
    pos.push(s.x - nx * width / 2, s.y, s.z - nz * width / 2, s.x + nx * width / 2, s.y, s.z + nz * width / 2);
    uv.push(acc * uvScale, 0, acc * uvScale, 1);
    if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; return m;
}
function wallStrip(samples, off, h0, h1, mat) {
  const pos = [], idx = [];
  samples.forEach((s, i) => {
    const nx = -s.dz, nz = s.dx, x = s.x + nx * off, z = s.z + nz * off;
    pos.push(x, s.y + h0, z, x, s.y + h1, z);
    if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; return m;
}

// ============================================================ V8 loop path
function loopPos(s) {
  s = mod(s, V8.L); const { x0, S, R: r, zt, zb, cz } = V8; const A = Math.PI * r;
  if (s < S) return { x: x0 + s, z: zt, yaw: 0 };
  s -= S; if (s < A) { const f = s / r; return { x: x0 + S + r * Math.sin(f), z: cz + r * Math.cos(f), yaw: f }; }
  s -= A; if (s < S) return { x: x0 + S - s, z: zb, yaw: Math.PI };
  s -= S; const f = s / r; return { x: x0 - r * Math.sin(f), z: cz - r * Math.cos(f), yaw: Math.PI + f };
}
const loopSamples = (y) => { const out = []; for (let s = 0; s <= V8.L + 0.001; s += 0.3) { const p = loopPos(s); out.push({ x: p.x, y, z: p.z, dx: Math.cos(p.yaw), dz: -Math.sin(p.yaw) }); } return out; };

// ============================================================ building / floor
const FW = 140, FD = 48;
{
  const tex = canvasTex(2100, 720, (g, W, H) => {
    const k = W / FW, P = (x, z) => [(x + FW / 2) * k, (z + FD / 2) * k];
    g.fillStyle = '#4c5158'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 30000; i++) { const v = 58 + Math.random() * 44 | 0; g.fillStyle = `rgba(${v},${v + 4},${v + 8},.35)`; g.fillRect(Math.random() * W, Math.random() * H, 2, 2); }
    g.strokeStyle = 'rgba(0,0,0,.22)'; g.lineWidth = 2;
    for (let x = -FW / 2; x <= FW / 2; x += 6) { const [a] = P(x, 0); g.beginPath(); g.moveTo(a, 0); g.lineTo(a, H); g.stroke(); }
    for (let z = -FD / 2; z <= FD / 2; z += 6) { const [, b] = P(0, z); g.beginPath(); g.moveTo(0, b); g.lineTo(W, b); g.stroke(); }
    { const [a, b] = P(33, -2.8), [c, d] = P(58.5, 18.8); g.fillStyle = '#2a2d32'; g.fillRect(a, b, c - a, d - b); }
    g.strokeStyle = '#e6e6e6'; g.lineWidth = 4;
    for (let i = 0; i <= 6; i++) { const x = 35.25 + i * 3.5; for (const [z0, z1] of [[-1.8, 3.6], [12.4, 17.8]]) { const [a, b] = P(x, z0), [, d] = P(x, z1); g.beginPath(); g.moveTo(a, b); g.lineTo(a, d); g.stroke(); } }
    const zone = (x0, z0, x1, z1, col = '#f2c230') => { const [a, b] = P(x0, z0), [c, d] = P(x1, z1); g.strokeStyle = col; g.lineWidth = 7; g.strokeRect(a, b, c - a, d - b); };
    zone(V8.x0 - V8.R - 2.4, V8.zb - 2.2, V8.x0 + V8.S + V8.R + 2.4, V8.zt + 1.4);
    zone(CL.x0 - 6, CL.z - 4.3, carX(13) + 3.6, CL.z + 4.3);
    zone(XU - 2.6, -3.9, XU + 2.0, 0.4, '#ff6b3d');
    g.fillStyle = 'rgba(70,170,110,.5)';
    for (const z of [-20.4, 20.6]) { const [a, b] = P(-68, z - 0.8), [c, d] = P(31, z + 0.8); g.fillRect(a, b, c - a, d - b); }
    g.setLineDash([18, 12]); g.strokeStyle = 'rgba(80,170,255,.8)'; g.lineWidth = 5;
    for (const r of AMR_ROUTES) { g.beginPath(); r.forEach(([x, z], i) => { const [a, b] = P(x, z); i ? g.lineTo(a, b) : g.moveTo(a, b); }); g.closePath(); g.stroke(); }
    g.setLineDash([]);
    g.fillStyle = 'rgba(242,194,48,.9)'; g.font = 'bold 34px sans-serif';
    const txt = (s, x, z) => { const [a, b] = P(x, z); g.fillText(s, a, b); };
    txt('V8 ENGINE LINE', V8.x0 - 4, V8.zb - 2.8 + 6.5); txt('BODY / PAINT / FINAL', CL.x0 - 5, CL.z + 5.8); txt('FINISHED VEHICLES', 36, 10.6);
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(FW, FD), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0.05 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0x262b31, roughness: 1 }));
  outer.rotation.x = -Math.PI / 2; outer.position.y = -0.02; scene.add(outer);

  const wallTex = canvasTex(1024, 128, (g, W, H) => {
    g.fillStyle = '#c3c8cd'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(0,0,0,.12)'; g.lineWidth = 2; for (let x = 0; x < W; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    g.fillStyle = '#2f6fb3'; g.fillRect(0, H * 0.78, W, H * 0.06);
  }, true);
  wallTex.repeat.set(10, 1);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.85 });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(FW, 14), wallMat); back.position.set(0, 7, -FD / 2); back.receiveShadow = true; scene.add(back);
  const left = new THREE.Mesh(new THREE.PlaneGeometry(FD, 14), wallMat); left.rotation.y = Math.PI / 2; left.position.set(-FW / 2, 7, 0); scene.add(left);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(26, 2.6), new THREE.MeshBasicMaterial({ map: canvasTex(1300, 130, (g, W, H) => {
    g.fillStyle = '#16324f'; g.fillRect(0, 0, W, H); g.fillStyle = '#fff'; g.font = 'bold 74px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('V8 ENGINE & VEHICLE ASSEMBLY · LINE 1', W / 2, H / 2 + 4);
  }) }));
  sign.position.set(2, 10.4, -FD / 2 + 0.05); scene.add(sign);

  staticGroup(g => {
    for (let x = -66; x <= 66; x += 12) {
      g.add(box(0.5, 14, 0.5, M.column, x, 7, -23.4), box(0.9, 0.3, 0.9, M.column, x, 0.15, -23.4));
      g.add(box(0.3, 0.7, 6, M.column, x, 13.6, -20.6));
    }
    g.add(box(FW - 6, 0.35, 0.25, M.column, 0, 13.9, -23.4), box(FW - 6, 0.25, 0.25, M.column, 0, 13.6, -17.6));
  });
  // safety fences (yellow posts) around V8 line return side
  staticGroup(g => {
    for (let x = V8.x0 - 6; x <= V8.x0 + V8.S + 6; x += 2.4) { g.add(box(0.08, 1.4, 0.08, M.yellow, x, 0.7, V8.zb - 3.0)); }
    g.add(box(V8.S + 12, 0.06, 0.04, M.yellow, V8.x0 + V8.S / 2, 1.35, V8.zb - 3.0));
    g.add(box(V8.S + 12, 0.06, 0.04, M.yellow, V8.x0 + V8.S / 2, 0.75, V8.zb - 3.0));
  });
}

// ============================================================ particles
const dotTex = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
class Particles {
  constructor(n, size, additive, gravity, opacity = 1) {
    this.fade = additive; this.n = n; this.g = gravity; this.i = 0;
    this.pos = new Float32Array(n * 3).fill(-999); this.col = new Float32Array(n * 3); this.base = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n).fill(1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo = geo;
    this.pts = new THREE.Points(geo, new THREE.PointsMaterial({ size, map: dotTex, vertexColors: true, transparent: true, opacity, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
    this.pts.frustumCulled = false; scene.add(this.pts);
  }
  emit(p, count, speed, color, life = 0.6, up = 0.5) {
    const c = new THREE.Color(color);
    for (let k = 0; k < count; k++) {
      const i = this.i = (this.i + 1) % this.n, j = i * 3;
      this.pos[j] = p.x; this.pos[j + 1] = p.y; this.pos[j + 2] = p.z;
      const th = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random() * 0.8);
      this.vel[j] = Math.cos(th) * v; this.vel[j + 2] = Math.sin(th) * v; this.vel[j + 1] = (Math.random() - 0.3 + up) * v;
      this.base[j] = c.r; this.base[j + 1] = c.g; this.base[j + 2] = c.b;
      this.life[i] = this.max[i] = life * (0.5 + Math.random() * 0.8);
    }
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      const j = i * 3; this.life[i] -= dt;
      if (this.life[i] <= 0) { this.pos[j + 1] = -999; continue; }
      this.vel[j + 1] -= this.g * dt;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      if (this.pos[j + 1] < 0.03) { this.pos[j + 1] = 0.03; this.vel[j + 1] *= -0.3; this.vel[j] *= 0.5; this.vel[j + 2] *= 0.5; }
      const f = this.fade ? this.life[i] / this.max[i] : 1;
      this.col[j] = this.base[j] * f; this.col[j + 1] = this.base[j + 1] * f; this.col[j + 2] = this.base[j + 2] * f;
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true;
  }
}
const sparks = new Particles(900, 0.09, true, 9.8);
const mist = new Particles(700, 0.22, false, 0.4, 0.55);
const smoke = new Particles(160, 0.5, false, -0.6, 0.35);

// ============================================================ robot
class Robot {
  constructor(x, z, o = {}) {
    const { color = 0xf08a24, baseH = 0.9, L1 = 1.8, L2 = 1.7, Lt = 0.55, tool = 'grip', pedestal = 0 } = o;
    Object.assign(this, { baseH: baseH + pedestal, L1, L2, Lt, tool });
    this.pos = new THREE.Vector3(x, 0, z);
    const lm = std(color, 0.35, 0.42);
    const root = this.root = new THREE.Group(); root.position.copy(this.pos); scene.add(root);
    if (pedestal) root.add(box(0.8, pedestal, 0.8, M.grey, 0, pedestal / 2, 0));
    root.add(box(0.95, 0.1, 0.95, M.dark, 0, pedestal + 0.05, 0));
    root.add(cyl(0.34, 0.42, baseH - 0.1, lm, 20, 0, pedestal + 0.1 + (baseH - 0.1) / 2, 0));
    const tu = this.turret = new THREE.Group(); tu.position.y = this.baseH; root.add(tu);
    tu.add(cyl(0.42, 0.42, 0.18, M.dark, 20, 0, 0.09, 0));
    tu.add(box(0.55, 0.32, 0.62, lm, 0, 0.3, 0));
    const sh = this.sh = new THREE.Group(); sh.position.y = 0.3; tu.add(sh);
    sh.add(rotX(cyl(0.24, 0.24, 0.72, M.dark, 20), Math.PI / 2));
    sh.add(box(L1, 0.3, 0.3, lm, L1 / 2, 0, 0.2)); sh.add(box(L1 * 0.7, 0.12, 0.06, M.dark, L1 / 2, 0, 0.37));
    const el = this.el = new THREE.Group(); el.position.x = L1; sh.add(el);
    el.add(rotX(cyl(0.19, 0.19, 0.62, M.dark, 18), Math.PI / 2));
    el.add(box(0.5, 0.36, 0.34, lm, -0.12, 0.05, -0.05));
    el.add(box(L2, 0.22, 0.24, lm, L2 / 2, 0.0, -0.05));
    const wr = this.wr = new THREE.Group(); wr.position.x = L2; el.add(wr);
    wr.add(rotX(cyl(0.12, 0.12, 0.34, M.dark, 16), Math.PI / 2));
    const tool_ = this.toolG = new THREE.Group(); wr.add(tool_);
    tool_.add(cyl(0.09, 0.09, 0.16, lm, 14, 0, -0.08, 0));
    if (tool === 'grip') {
      tool_.add(box(0.36, 0.07, 0.14, M.steel, 0, -0.3, 0));
      this.fingers = [box(0.04, 0.22, 0.1, M.dark, -0.14, -0.43, 0), box(0.04, 0.22, 0.1, M.dark, 0.14, -0.43, 0)];
      this.fingers.forEach(f => tool_.add(f)); tool_.add(cyl(0.05, 0.05, 0.2, M.steel, 10, 0, -0.18, 0));
    } else if (tool === 'weld') {
      tool_.add(box(0.12, 0.42, 0.12, M.dark, 0, -0.28, 0)); tool_.add(box(0.36, 0.08, 0.08, M.steel, 0.14, -0.5, 0));
      tool_.add(box(0.06, 0.2, 0.06, M.chrome, 0.3, -0.42, 0)); tool_.add(cyl(0.03, 0.01, 0.12, M.chrome, 8, 0, -0.52, 0));
      tool_.add(rotZ(cyl(0.025, 0.025, 1.0, M.black, 6, -0.25, -0.1, 0), 0.6));
    } else if (tool === 'spray') {
      tool_.add(box(0.14, 0.3, 0.14, M.white, 0, -0.24, 0)); tool_.add(cyl(0.05, 0.02, 0.18, M.chrome, 10, 0, -0.46, 0));
    } else if (tool === 'vac') {
      tool_.add(cyl(0.05, 0.05, 0.3, M.steel, 10, 0, -0.25, 0)); tool_.add(box(0.7, 0.05, 0.5, M.dark, 0, -0.42, 0));
      for (const [a, b] of [[-0.28, -0.18], [0.28, -0.18], [-0.28, 0.18], [0.28, 0.18]]) tool_.add(cyl(0.07, 0.05, 0.08, M.black, 10, a, -0.5, b));
    }
    this.tip = new THREE.Group(); this.tip.position.y = -Lt; tool_.add(this.tip);
    this.home = new THREE.Vector3(x, this.baseH + 1.8, z);
    this.target = new THREE.Vector3();
    this.keys = null; this.active = false;
  }
  reach(p) {
    const lx = p.x - this.pos.x, lz = p.z - this.pos.z;
    const yaw = Math.atan2(-lz, lx);
    let r = Math.hypot(lx, lz), h = p.y + this.Lt - (this.baseH + 0.3);
    const { L1, L2 } = this; let d = Math.hypot(r, h); const mx = L1 + L2 - 0.02, mn = Math.abs(L1 - L2) + 0.2;
    if (d > mx) { r *= mx / d; h *= mx / d; d = mx; }
    if (d < mn) { const f = mn / Math.max(d, 1e-3); r *= f; h *= f; d = mn; }
    const e = Math.acos(clamp((d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1, 1));
    const s = Math.atan2(h, r) + Math.atan2(L2 * Math.sin(e), L1 + L2 * Math.cos(e));
    this.turret.rotation.y = yaw; this.sh.rotation.z = s; this.el.rotation.z = -e; this.wr.rotation.z = -(s - e);
  }
  grip(closed) { if (this.fingers) { const o = closed ? 0.1 : 0.16; this.fingers[0].position.x = -o; this.fingers[1].position.x = o; } }
  // drive along keyed timeline; returns true if in spark/hold segment
  run(u) {
    if (u === null || !this.keys) { this.target.lerp(this.home, 0.12); this.reach(this.target); this.active = false; return false; }
    this.active = true;
    const sp = keyed(this.keys, u, this.target); this.reach(this.target); return sp;
  }
  tipWorld(v) { return this.tip.getWorldPosition(v); }
}
function keyed(keys, u, out) {
  if (u <= keys[0].t) { out.copy(keys[0].p); return false; }
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (u < b.t) { const f = smooth((u - a.t) / (b.t - a.t)); out.lerpVectors(a.p, b.p, f); if (a.arc) out.y += Math.sin(Math.PI * f) * a.arc; return !!(a.spark && b.spark); }
  }
  out.copy(keys[keys.length - 1].p); return false;
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const up = (p, h) => p.clone().add(V(0, h, 0));
function ppKeys(home, pick, place, t0 = 0, t1 = 1, lift = 0.6) {
  const T = f => t0 + (t1 - t0) * f;
  return [
    { t: T(0), p: home }, { t: T(0.14), p: up(pick, lift) }, { t: T(0.22), p: pick }, { t: T(0.30), p: pick },
    { t: T(0.38), p: up(pick, lift), arc: 0.45 }, { t: T(0.58), p: up(place, lift) }, { t: T(0.64), p: place },
    { t: T(0.72), p: place }, { t: T(0.80), p: up(place, lift) }, { t: T(1), p: home },
  ];
}

// ============================================================ engine model
function bankFrame(side) { const g = new THREE.Group(); g.position.set(0, 0.66, 0.2 * side); g.rotation.x = side * Math.PI / 4; return g; }
function buildEngine() {
  const eng = new THREE.Group(), parts = [];
  // 0 block
  const blk = new THREE.Group();
  blk.add(box(1.2, 0.42, 0.62, M.alu, 0, 0.35, 0), box(1.1, 0.16, 0.5, M.dark, 0, 0.08, 0));
  for (const side of [-1, 1]) {
    const b = bankFrame(side); b.add(box(1.15, 0.46, 0.3, M.alu, 0, 0, 0), box(1.17, 0.04, 0.32, M.alu, 0, 0.21, 0));
    for (let i = 0; i < 5; i++) b.add(box(0.03, 0.4, 0.04, M.alu, -0.5 + i * 0.25, -0.02, -side * 0.0 + (side > 0 ? 0.16 : -0.16)));
    blk.add(b);
  }
  for (const side of [-1, 1]) blk.add(box(0.2, 0.12, 0.12, M.dark, 0.15, 0.4, side * 0.36));
  parts.push(blk);
  // 1 crank + flywheel + pulley
  const cr = new THREE.Group();
  cr.add(rotZ(cyl(0.05, 0.05, 1.36, M.steel, 12, 0, 0.3, 0), Math.PI / 2));
  cr.add(rotZ(cyl(0.3, 0.3, 0.05, M.dark, 28, -0.66, 0.3, 0), Math.PI / 2));
  const pul = new THREE.Group(); pul.position.set(0.7, 0.3, 0);
  pul.add(rotZ(cyl(0.15, 0.15, 0.08, M.black, 24), Math.PI / 2), rotZ(cyl(0.12, 0.12, 0.1, M.steel, 24), Math.PI / 2), box(0.1, 0.06, 0.03, M.chrome, 0.0, 0.11, 0), box(0.1, 0.03, 0.06, M.yellow, 0.0, -0.1, 0));
  cr.add(pul); parts.push(cr);
  // 2,3 pistons
  for (const side of [-1, 1]) {
    const g = bankFrame(side);
    for (let i = 0; i < 4; i++) { const x = -0.42 + i * 0.28 + side * 0.04; g.add(cyl(0.088, 0.088, 0.05, M.chrome, 18, x, 0.25, 0)); g.add(cyl(0.03, 0.03, 0.06, M.dark, 8, x, 0.29, 0)); }
    parts.push(g);
  }
  // 4,5 heads + exhaust
  for (const side of [-1, 1]) {
    const g = bankFrame(side);
    g.add(box(1.15, 0.16, 0.34, M.dark, 0, 0.32, 0));
    for (let i = 0; i < 4; i++) { const x = -0.42 + i * 0.28; g.add(box(0.09, 0.09, 0.14, M.rust, x, 0.2, side * 0.2)); }
    g.add(box(1.0, 0.11, 0.11, M.rust, 0.05, 0.12, side * 0.28));
    g.add(box(0.12, 0.11, 0.11, M.rust, 0.58, 0.04, side * 0.28));
    parts.push(g);
  }
  // 6 intake
  const ik = new THREE.Group();
  ik.add(box(0.9, 0.14, 0.26, M.chrome, 0, 1.0, 0), box(0.82, 0.04, 0.2, M.red, 0, 1.09, 0));
  for (const side of [-1, 1]) for (let i = 0; i < 4; i++) ik.add(rotX(box(0.07, 0.07, 0.22, M.chrome, -0.42 + i * 0.28, 0.94, side * 0.16), side * 0.55));
  ik.add(rotZ(cyl(0.08, 0.08, 0.16, M.chrome, 16, 0.53, 1.0, 0), Math.PI / 2), rotZ(cyl(0.06, 0.06, 0.02, M.black, 16, 0.62, 1.0, 0), Math.PI / 2));
  parts.push(ik);
  // 7 covers / timing / accessories
  const cv = new THREE.Group();
  for (const side of [-1, 1]) {
    const g = bankFrame(side); g.add(box(1.08, 0.1, 0.28, M.red, 0, 0.45, 0));
    for (let i = 0; i < 4; i++) g.add(box(0.2, 0.03, 0.05, M.chrome, -0.36 + i * 0.24, 0.51, 0));
    g.add(cyl(0.035, 0.035, 0.04, M.black, 10, 0.4, 0.52, 0.07));
    cv.add(g);
  }
  cv.add(box(0.06, 0.62, 0.7, M.black, 0.62, 0.55, 0), rotZ(cyl(0.09, 0.09, 0.15, M.steel, 16, 0.62, 0.92, 0.38), Math.PI / 2), rotZ(cyl(0.07, 0.07, 0.14, M.steel, 16, 0.62, 0.92, -0.38), Math.PI / 2));
  parts.push(cv);
  parts.forEach(p => eng.add(p));
  eng.scale.setScalar(ES);
  return { group: eng, parts, pulley: pul };
}
// reference engine for anchors (engine-scaled frame)
const REF = buildEngine(); REF.group.updateMatrixWorld(true);
const ANCH = REF.parts.map(p => { const b = new THREE.Box3().setFromObject(p), c = b.getCenter(V(0, 0, 0)); return { anchor: V(c.x, b.max.y, c.z), minY: b.min.y }; });
const ENG_BOX = new THREE.Box3().setFromObject(REF.group);
const ENG_ANCH = V(0, ENG_BOX.max.y, 0);
const ENG_MERGED_PROTO = mergeObj(buildEngine().group);   // geometry in unscaled engine units
function mergedEngine() { const m = new THREE.Mesh(ENG_MERGED_PROTO.geometry, ENG_MERGED_PROTO.material); m.scale.setScalar(ES); m.castShadow = true; return m; }
// holder that positions a clone so that its anchor sits at the parent origin
const PART_PROTO = REF.parts.map(p => { const w = new THREE.Group(); w.add(p.clone()); return mergeObj(w); });
const partMesh = i => { const m = new THREE.Mesh(PART_PROTO[i].geometry, PART_PROTO[i].material); m.castShadow = m.receiveShadow = true; return m; };
function partHolder(i) { const h = new THREE.Group(); h.position.copy(ANCH[i].anchor).negate(); const inner = new THREE.Group(); inner.scale.setScalar(ES); inner.add(partMesh(i)); h.add(inner); return h; }

// ============================================================ V8 line: conveyor, pallets, engines
{
  const beltTex = canvasTex(128, 64, (g, W, H) => { g.fillStyle = '#1c1f23'; g.fillRect(0, 0, W, H); g.fillStyle = '#2a2e33'; for (let x = 0; x < W; x += 16) g.fillRect(x, 0, 8, H); }, true);
  const beltMat = new THREE.MeshStandardMaterial({ map: beltTex, roughness: 0.8, metalness: 0.2 });
  scene.add(ribbon(loopSamples(BELT_Y - 0.02), 1.6, beltMat, 0.5));
  window.__beltTex = beltTex;
  const smp = loopSamples(BELT_Y - 0.4);
  scene.add(wallStrip(smp, 0.85, 0, 0.36, M.frame), wallStrip(smp, -0.85, 0, 0.36, M.frame));
  staticGroup(g => {
    for (let s = 0; s < V8.L; s += 2.4) { const p = loopPos(s); for (const o of [-0.8, 0.8]) g.add(box(0.1, BELT_Y - 0.4, 0.1, M.grey, p.x - Math.sin(p.yaw) * o * 0, (BELT_Y - 0.4) / 2, p.z + (Math.abs(Math.sin(p.yaw)) < 0.5 ? o : 0))); }
  });
}
const pallets = [];
for (let p = 0; p < NP; p++) {
  const g = new THREE.Group(); scene.add(g);
  const pm = staticGroup(h => { h.add(box(1.9, 0.1, 1.5, M.dark, 0, 0.06, 0)); for (const [a, b] of [[-0.6, -0.4], [0.6, -0.4], [-0.6, 0.4], [0.6, 0.4]]) h.add(box(0.14, 0.08, 0.14, M.yellow, a, 0.14, b)); });
  scene.remove(pm); g.add(pm);
  const eg = new THREE.Group(); eg.scale.setScalar(ES); eg.position.y = 0.12; g.add(eg);
  const parts = REF.parts.map((_, i) => { const m = partMesh(i); eg.add(m); return m; });
  pallets.push({ g, e: { parts } });
}
const palletEnginePos = q => V(slotX(q), PAL_TOP, V8.zt);

// station robots + part tables
const stationBots = [];
for (let i = 0; i < 8; i++) {
  const x = slotX(i), rb = new Robot(x, V8.zt - 2.8, { color: 0xf08a24 });
  const place = palletEnginePos(i).add(ANCH[i].anchor);
  const tbl = V(x - 1.55, 0, V8.zt - 3.7);
  const pick = V(tbl.x, 0.85 + (ANCH[i].anchor.y - ANCH[i].minY), tbl.z);
  staticGroup(g => { g.add(box(1.3, 0.85, 1.0, M.grey, tbl.x, 0.425, tbl.z), box(1.36, 0.05, 1.06, M.yellow, tbl.x, 0.86, tbl.z)); });
  const stock = partHolder(i); stock.position.add(pick); scene.add(stock);
  const carry = partHolder(i); rb.tip.add(carry); carry.visible = false;
  rb.home = V(x - 0.4, 2.6, V8.zt - 1.6);
  rb.keys = ppKeys(rb.home, pick, place);
  stationBots.push({ rb, carry });
}
// inspection gantry (ST90)
const gantry = { x: slotX(8) };
staticGroup(g => {
  for (const z of [V8.zt - 1.3, V8.zt + 1.3]) g.add(box(0.18, 2.8, 0.18, M.frame, gantry.x - 1, 1.4, z), box(0.18, 2.8, 0.18, M.frame, gantry.x + 1, 1.4, z));
  g.add(box(2.4, 0.22, 0.22, M.frame, gantry.x, 2.8, V8.zt - 1.3), box(2.4, 0.22, 0.22, M.frame, gantry.x, 2.8, V8.zt + 1.3), box(0.22, 0.22, 2.8, M.frame, gantry.x - 1, 2.8, V8.zt), box(0.22, 0.22, 2.8, M.frame, gantry.x + 1, 2.8, V8.zt));
  for (const z of [V8.zt - 0.6, V8.zt + 0.6]) g.add(box(0.22, 0.14, 0.3, M.black, gantry.x, 2.62, z));
});
gantry.laser = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7), M.laser); gantry.laser.rotation.y = Math.PI / 2; gantry.laser.position.set(gantry.x, 1.75, V8.zt); scene.add(gantry.laser);
gantry.lampMat = std(0x222222, 0, 0.4, { emissive: 0xffaa00, emissiveIntensity: 1.5 });
{ const l = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), gantry.lampMat); l.position.set(gantry.x + 1, 3.0, V8.zt - 1.3); scene.add(l); }

// unload robot (ST100) + hot test cell
const unload = { rb: new Robot(XU - 1.9, -3.25, { color: 0xf08a24, L1: 1.9, L2: 1.8 }) };
unload.carry = new THREE.Group(); { const m = mergedEngine(); m.position.copy(ENG_ANCH).negate(); unload.carry.add(m); }
unload.rb.tip.add(unload.carry); unload.carry.visible = false;
unload.rb.home = V(XU - 1.0, 2.8, -3.2);
unload.rb.keys = ppKeys(unload.rb.home, palletEnginePos(9).add(ENG_ANCH), STAND.clone().add(ENG_ANCH), 0, 1, 0.5);
staticGroup(g => {
  g.add(box(1.6, 0.75, 1.3, M.dark, XU, 0.4, STAND.z), box(1.7, 0.06, 1.4, M.yellow, XU, 0.8, STAND.z), box(0.3, 0.1, 0.8, M.steel, XU, 0.88, STAND.z));
  g.add(rotZ(cyl(0.38, 0.38, 0.5, M.frame, 24, XU - 1.15, 1.2, STAND.z), Math.PI / 2), box(0.6, 0.9, 0.9, M.frame, XU - 1.2, 0.45, STAND.z));
  for (const x of [XU - 2.3, XU + 1.9]) g.add(box(0.1, 3.0, 0.1, M.grey, x, 1.5, -3.6), box(0.1, 3.0, 0.1, M.grey, x, 1.5, 0.2));
  g.add(box(4.3, 0.14, 0.14, M.grey, XU - 0.2, 3.0, -3.6), box(4.3, 0.14, 0.14, M.grey, XU - 0.2, 3.0, 0.2), box(0.14, 0.14, 3.9, M.grey, XU - 2.3, 3.0, -1.7), box(0.14, 0.14, 3.9, M.grey, XU + 1.9, 3.0, -1.7));
  g.add(box(1.4, 0.5, 1.0, M.steel, XU - 0.2, 3.6, STAND.z));
  g.add(cyl(0.16, 0.16, 6.2, M.steel, 12, XU - 0.2, 7.0, STAND.z));
});
for (const x of [XU - 2.3, XU + 1.9]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 2.9), M.cellGlass); w.rotation.y = Math.PI / 2; w.position.set(x, 1.5, -1.7); scene.add(w); }
const hot = buildEngine(); hot.group.position.copy(STAND); scene.add(hot.group);
const hotRust = M.rust.clone(); hotRust.emissive = new THREE.Color(0xff3a0a); hotRust.emissiveIntensity = 0;
hot.group.traverse(o => { if (o.isMesh && o.material === M.rust) o.material = hotRust; });
const hotLampMat = std(0x111111, 0, 0.4, { emissive: 0x33ff66, emissiveIntensity: 0 });
{ const l = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), hotLampMat); l.position.set(XU + 1.9, 3.2, 0.2); scene.add(l); }
const hotLight = new THREE.PointLight(0xff5a1a, 0, 6, 2); hotLight.position.set(XU, 1.6, STAND.z); scene.add(hotLight);

// engine transfer belt
const beltPath = new THREE.CurvePath(); for (let i = 0; i < BELT_PTS.length - 1; i++) beltPath.add(new THREE.LineCurve3(BELT_PTS[i], BELT_PTS[i + 1]));
const BELT_LEN = beltPath.getLength(), BELT_T = BELT_M * C;
{
  const smp = []; const L = BELT_PTS.slice(1);
  for (let i = 0; i < L.length - 1; i++) { const a = L[i], b = L[i + 1], d = a.distanceTo(b), n = Math.max(2, Math.ceil(d / 0.5)); const dx = (b.x - a.x) / d, dz = (b.z - a.z) / d; for (let k = 0; k <= n; k++) { const f = k / n; smp.push({ x: lerp(a.x, b.x, f), y: 0.56, z: lerp(a.z, b.z, f), dx, dz }); } }
  const tex = canvasTex(64, 32, (g, W, H) => { g.fillStyle = '#23262a'; g.fillRect(0, 0, W, H); g.fillStyle = '#3a3f45'; for (let x = 0; x < W; x += 8) g.fillRect(x, 0, 3, H); }, true);
  window.__rollTex = tex;
  scene.add(ribbon(smp, 1.2, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.5 }), 2));
  const fr = smp.map(s => ({ ...s, y: 0.1 }));
  scene.add(wallStrip(fr, 0.65, 0, 0.5, M.frame), wallStrip(fr, -0.65, 0, 0.5, M.frame));
}
const lift = staticGroup(g => { g.add(box(1.3, 0.08, 1.3, M.yellow, 0, 0, 0)); g.add(box(0.2, 0.6, 0.2, M.steel, 0, -0.32, 0)); });
const LIFT_BASE = BELT_PTS[4].clone().setY(0.56);
const beltEngines = []; for (let i = 0; i < 5; i++) { const m = mergedEngine(); scene.add(m); beltEngines.push(m); }

// ============================================================ cars
function buildCar() {
  const car = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color: 0x8a9096, metalness: 0.55, roughness: 0.5, clearcoat: 0, clearcoatRoughness: 0.08 });
  const shell = new THREE.Group();
  shell.add(box(3.1, 0.3, 1.8, paint, -0.65, 0.4, 0), box(1.1, 0.5, 1.8, paint, -1.7, 0.8, 0));
  for (const s of [-1, 1]) {
    shell.add(box(2.0, 0.5, 0.1, paint, -0.15, 0.8, s * 0.85), box(1.3, 0.42, 0.14, paint, 1.58, 0.8, s * 0.83), box(1.3, 0.16, 0.12, paint, 1.55, 0.42, s * 0.62));
    shell.add(rotZ(box(0.08, 0.62, 0.08, paint, 0.65, 1.28, s * 0.78), 0.73), box(0.1, 0.46, 0.08, paint, -0.3, 1.28, s * 0.8), rotZ(box(0.1, 0.5, 0.08, paint, -1.25, 1.27, s * 0.78), -0.35));
    shell.add(box(0.5, 0.1, 0.1, paint, 1.55, 1.0, s * 0.83));
  }
  shell.add(box(0.14, 0.4, 1.8, paint, 2.25, 0.62, 0), box(0.1, 0.5, 1.6, paint, 0.92, 0.8, 0), box(0.12, 0.12, 1.3, paint, 2.1, 0.45, 0), box(1.7, 0.07, 1.62, paint, -0.42, 1.52, 0));
  const shellM = mergeObj(shell); car.add(shellM);
  const fin = new THREE.Group();
  fin.add(rotZ(box(0.03, 0.66, 1.52, M.glass, 0.63, 1.28, 0), 0.73), rotZ(box(0.03, 0.5, 1.5, M.glass, -1.24, 1.27, 0), -0.35));
  for (const s of [-1, 1]) fin.add(box(1.75, 0.38, 0.03, M.glass, -0.32, 1.27, s * 0.81));
  fin.add(box(1.3, 0.05, 1.62, paint, 1.58, 1.08, 0));
  fin.add(box(0.2, 0.18, 1.84, M.black, 2.3, 0.38, 0), box(0.2, 0.2, 1.84, M.black, -2.3, 0.45, 0));
  for (const s of [-1, 1]) fin.add(box(0.05, 0.1, 0.36, M.head, 2.33, 0.76, s * 0.6), box(0.05, 0.12, 0.4, M.tail, -2.26, 0.92, s * 0.62));
  const finM = mergeObj(fin); car.add(finM);
  const wheelProto = new THREE.Group(); wheelProto.add(rotX(cyl(0.34, 0.34, 0.24, M.rubber, 22), Math.PI / 2), rotX(cyl(0.22, 0.22, 0.25, M.chrome, 14), Math.PI / 2));
  const wheels = WHEEL_POS.map(([x, z]) => { const w = mergeObj(wheelProto); w.position.set(x, 0.34, z); car.add(w); return w; });
  const eng = mergedEngine(); eng.position.set(1.55, 0.1, 0); car.add(eng);
  const skid = staticGroup(g => { g.add(box(4.6, 0.1, 0.16, M.dark, 0, 0.2, -0.55), box(4.6, 0.1, 0.16, M.dark, 0, 0.2, 0.55), box(0.2, 0.08, 1.3, M.dark, 1.6, 0.18, 0), box(0.2, 0.08, 1.3, M.dark, -1.6, 0.18, 0)); });
  scene.remove(skid); car.add(skid);
  const hanger = new THREE.Group();
  const cradle = staticGroup(g => { for (const x of [2.15, -1.95]) g.add(box(0.12, 0.1, 2.2, M.frame, x, 0.18, 0)); }); scene.remove(cradle); hanger.add(cradle);
  const bars = []; for (const x of [2.15, -1.95]) for (const z of [-1.06, 1.06]) { const b = box(0.08, 1, 0.08, M.frame, x, 0, z); hanger.add(b); bars.push(b); }
  const trolley = box(4.5, 0.14, 0.18, M.frame, 0.1, 0, 0); hanger.add(trolley);
  car.add(hanger);
  scene.add(car);
  return { car, paint, shellM, finM, wheels, eng, skid, hanger, bars, trolley };
}
const WHEEL_POS = [[1.4, -0.86], [-1.4, -0.86], [1.4, 0.86], [-1.4, 0.86]];
const CAR_POOL = 30, cars = []; for (let i = 0; i < CAR_POOL; i++) cars.push(buildCar());
const BIW = new THREE.Color(0x8a9096), tmpC = new THREE.Color();

// skid roller bed + overhead rail
{
  const tex = canvasTex(64, 32, (g, W, H) => { g.fillStyle = '#2b2f34'; g.fillRect(0, 0, W, H); g.fillStyle = '#8c949c'; for (let x = 0; x < W; x += 16) g.fillRect(x, 0, 6, H); }, true);
  const x0 = carX(-1) - 3, x1 = carX(8) + 3.25, L = x1 - x0;
  tex.repeat.set(L / 1.2, 1);
  const bed = new THREE.Mesh(new THREE.BoxGeometry(L, 0.08, 1.5), [M.grey, M.grey, new THREE.MeshStandardMaterial({ map: tex, metalness: 0.6, roughness: 0.4 }), M.grey, M.grey, M.grey]);
  bed.position.set((x0 + x1) / 2, 0.48, CL.z); bed.receiveShadow = true; scene.add(bed);
  staticGroup(g => {
    for (let x = x0 + 1; x < x1; x += 3) for (const z of [-0.6, 0.6]) g.add(box(0.12, 0.44, 0.12, M.grey, x, 0.22, CL.z + z));
    const r0 = carX(7) + 1, r1 = carX(13) + 4;
    g.add(box(r1 - r0, 0.36, 0.3, M.column, (r0 + r1) / 2, RAIL_Y + 0.22, CL.z));
    for (let x = r0 + 3.75; x <= r1; x += 6.5) for (const z of [-3.6, 3.6]) g.add(box(0.3, RAIL_Y + 0.6, 0.3, M.column, x, (RAIL_Y + 0.6) / 2, CL.z + z));
    for (let x = r0 + 3.75; x <= r1; x += 6.5) g.add(box(0.3, 0.3, 7.5, M.column, x, RAIL_Y + 0.55, CL.z));
    // geometry/framing gate at slot 4, transfer lift at slot 8
    const gx = carX(4);
    for (const z of [-2.6, 2.6]) g.add(box(0.5, 3.6, 0.5, M.frame, gx, 1.8, CL.z + z));
    g.add(box(0.5, 0.6, 5.7, M.frame, gx, 3.6, CL.z));
    for (const z of [-1.4, 1.4]) g.add(box(0.3, 3.2, 0.3, M.yellow, carX(8) - 2.2, 1.6, CL.z + z), box(0.3, 3.2, 0.3, M.yellow, carX(8) + 2.2, 1.6, CL.z + z));
    // inspection light tunnel at slot 12
    const ix = carX(12);
    for (let k = -1; k <= 1; k++) { for (const z of [-2.2, 2.2]) g.add(box(0.2, 4.6, 0.2, M.dark, ix + k * 1.6, 2.3, CL.z + z)); g.add(box(0.2, 0.2, 4.6, M.dark, ix + k * 1.6, 4.6, CL.z)); }
  });
  staticGroup(g => { const ix = carX(12); for (let k = -1; k <= 1; k++) { for (const z of [-2.05, 2.05]) g.add(box(0.06, 3.8, 0.12, M.lightArch, ix + k * 1.6, 2.4, CL.z + z)); g.add(box(0.06, 0.12, 4.0, M.lightArch, ix + k * 1.6, 4.45, CL.z)); } }, false);
  // paint booth
  const bx0 = carX(5) - 3.1, bx1 = carX(7) + 3.1, bw = bx1 - bx0, bcx = (bx0 + bx1) / 2;
  const shellB = new THREE.Mesh(new THREE.BoxGeometry(bw, 4.6, 6.6), M.booth); shellB.position.set(bcx, 2.3, CL.z); scene.add(shellB);
  staticGroup(g => {
    for (let x = bx0; x <= bx1 + 0.01; x += bw / 4) for (const z of [-3.3, 3.3]) g.add(box(0.14, 4.6, 0.14, M.white, x, 2.3, CL.z + z));
    g.add(box(bw, 0.2, 0.2, M.white, bcx, 4.6, CL.z - 3.3), box(bw, 0.2, 0.2, M.white, bcx, 4.6, CL.z + 3.3));
    g.add(box(bw, 0.4, 6.8, M.white, bcx, 4.85, CL.z));
    for (let x = bx0 + 2; x < bx1; x += 4) g.add(box(1.4, 0.8, 1.4, M.grey, x, 5.45, CL.z));
  });
}

// body shop & paint & final robots
const weldBots = [];
for (let s = 0; s < 4; s++) for (const side of [-1, 1]) {
  const bx = carX(s) + (side < 0 ? -0.6 : 0.6);
  const rb = new Robot(bx, CL.z + side * 2.55, { color: 0xd8432b, L1: 1.6, L2: 1.5, tool: 'weld' });
  rb.home = V(bx, 2.6, CL.z + side * 1.6);
  const pts = [];
  const xs = [[-1.6, -0.6, 0.4, 1.4], [-1.2, -0.2, 0.8, 1.7], [-1.8, -0.9, 0.2, 1.1], [-1.4, -0.4, 0.6, 1.6]][s].map(v => v + (side > 0 ? 0.15 : 0));
  const ys = [0.85, 1.25, 0.7, 1.3];
  const keys = [{ t: 0, p: rb.home }];
  const n = xs.length, span = 0.84 / n;
  xs.forEach((dx, i) => {
    const wp = V(carX(s) + dx, Y_SKID + ys[i], CL.z + side * 0.98), ap = wp.clone().add(V(0, 0.1, side * 0.4));
    const t0 = 0.08 + i * span;
    keys.push({ t: t0, p: ap }, { t: t0 + span * 0.3, p: wp, spark: true }, { t: t0 + span * 0.75, p: wp, spark: true }, { t: t0 + span, p: ap });
  });
  keys.push({ t: 1, p: rb.home });
  rb.keys = keys; weldBots.push(rb);
}
const paintBots = [];
for (const side of [-1, 1]) {
  const x = carX(6), rb = new Robot(x, CL.z + side * 2.5, { color: 0xeeeeee, L1: 1.7, L2: 1.6, tool: 'spray', pedestal: 0.6 });
  rb.home = V(x, 3.0, CL.z + side * 1.5);
  const keys = [{ t: 0, p: rb.home }];
  const passes = [[1.9, side * 0.3], [1.35, side * 1.25], [0.95, side * 1.3]];
  let t = 0.08;
  passes.forEach(([y, dz], k) => {
    const a = V(x - 2.3 * (k % 2 ? -1 : 1), Y_SKID + y + 0.35, CL.z + dz), b = V(x + 2.3 * (k % 2 ? -1 : 1), Y_SKID + y + 0.35, CL.z + dz);
    keys.push({ t, p: a, spark: true }, { t: t + 0.24, p: b, spark: true }); t += 0.27;
  });
  keys.push({ t: 1, p: rb.home }); rb.keys = keys; paintBots.push(rb);
}
const wheelBots = [];
for (const side of [-1, 1]) {
  const x = carX(10), rb = new Robot(x, CL.z + side * 2.75, { color: 0x2a7de1, L1: 1.8, L2: 1.7 });
  const rack = V(x, 0, CL.z + side * 4.0);
  staticGroup(g => { g.add(box(1.2, 0.9, 0.9, M.grey, rack.x, 0.45, rack.z)); for (let k = 0; k < 3; k++) g.add(rotX(cyl(0.34, 0.34, 0.24, M.rubber, 22, rack.x, 1.24 + k * 0.25, rack.z), 0)); });
  const pick = V(rack.x, 1.24 + 0.5 + 0.36, rack.z);
  rb.home = V(x, 2.9, CL.z + side * 1.9);
  const ws = WHEEL_POS.filter(w => Math.sign(w[1]) === side);
  rb.keys = [...ppKeys(rb.home, pick, V(x + ws[0][0], Y_HANG + 0.34 + 0.36, CL.z + ws[0][1]), 0, 0.5, 0.5), ...ppKeys(rb.home, pick, V(x + ws[1][0], Y_HANG + 0.34 + 0.36, CL.z + ws[1][1]), 0.5, 1, 0.5).slice(1)];
  const carry = new THREE.Group(); { const w = new THREE.Group(); w.add(rotX(cyl(0.34, 0.34, 0.24, M.rubber, 22), Math.PI / 2), rotX(cyl(0.22, 0.22, 0.25, M.chrome, 14), Math.PI / 2)); w.position.y = -0.36; carry.add(mergeObj(w)); }
  rb.tip.add(carry); carry.visible = false;
  wheelBots.push({ rb, carry, side });
}
const glassBot = { rb: new Robot(carX(11), CL.z + 2.9, { color: 0x2a7de1, L1: 1.9, L2: 1.8, tool: 'vac' }) };
{
  const x = carX(11), rack = V(x + 1.9, 0, CL.z + 3.9);
  staticGroup(g => { g.add(box(1.4, 1.0, 0.9, M.grey, rack.x, 0.5, rack.z)); for (let k = 0; k < 3; k++) g.add(box(1.2, 0.03, 0.8, M.glass, rack.x, 1.04 + k * 0.08, rack.z)); });
  const pick = V(rack.x, 1.32, rack.z), place = V(x + 0.63, Y_HANG + 1.28 + 0.06, CL.z);
  glassBot.rb.home = V(x, 3.1, CL.z + 2.0);
  glassBot.rb.keys = ppKeys(glassBot.rb.home, pick, place, 0, 1, 0.7);
  const carry = new THREE.Group(); const gl = rotZ(box(0.03, 0.66, 1.52, M.glass, 0, -0.06, 0), 0.73); carry.add(gl);
  glassBot.rb.tip.add(carry); carry.visible = false; glassBot.carry = carry;
}
// marriage station equipment
staticGroup(g => { const x = carX(9); for (const z of [-2.4, 2.4]) g.add(box(0.3, 1.2, 0.3, M.yellow, x + 1.55 + 1.0, 0.6, CL.z + z * 0.5)); });

// ============================================================ AMRs
const amrs = [];
for (const [ri, route] of AMR_ROUTES.entries()) {
  const path = new THREE.CurvePath(); for (let i = 0; i < route.length; i++) { const a = route[i], b = route[(i + 1) % route.length]; path.add(new THREE.LineCurve3(V(a[0], 0, a[1]), V(b[0], 0, b[1]))); }
  const len = path.getLength();
  for (let k = 0; k < 2; k++) {
    const m = staticGroup(g => {
      g.add(box(1.4, 0.32, 0.9, M.white, 0, 0.22, 0), box(1.42, 0.06, 0.92, M.frame, 0, 0.36, 0), box(0.05, 0.1, 0.6, M.head, 0.71, 0.24, 0));
      for (let i = 0; i < 2; i++) g.add(box(0.55, 0.35, 0.75, i ? M.frame : M.yellow, -0.3 + i * 0.6, 0.57, 0));
    });
    amrs.push({ m, path, len, off: k / 2, speed: 1.6 });
  }
}

// ============================================================ lot paths
const LOT = []; for (let i = 0; i < 12; i++) { const col = i % 6, row = Math.floor(i / 6); LOT.push({ x: 37 + col * 3.5, z: row ? 15.2 : 0.8 }); }
const lotPaths = LOT.map(sp => {
  const p = new THREE.CurvePath(), sg = sp.z > CL.z ? 1 : -1, ex = V(carX(13), 0, CL.z);
  p.add(new THREE.LineCurve3(ex, V(sp.x - 3, 0, CL.z)));
  p.add(new THREE.QuadraticBezierCurve3(V(sp.x - 3, 0, CL.z), V(sp.x, 0, CL.z), V(sp.x, 0, CL.z + sg * 3)));
  p.add(new THREE.LineCurve3(V(sp.x, 0, CL.z + sg * 3), V(sp.x, 0, sp.z)));
  const len = p.getLength(); return { p, len, D: len / 4.5 + 1.2 };
});

// ============================================================ simulation state helpers
function clockAt(t) { const n = Math.floor(t / C), ph = t - n * C, moving = ph < IDX; return { n, ph, moving, mv: moving ? smooth(ph / IDX) : 1, dw: moving ? -1 : (ph - IDX) / DW }; }
function palletS(p, k) { const q = mod(p + k.n, NP); return { q, s: k.moving ? DP * (q - 1 + k.mv + 0.5) : slotS(q) }; }
function engineStage(q, k) { // which parts visible on pallet at slot q
  const vis = new Array(8).fill(false);
  if (k.moving) { if (q >= 1 && q <= 9) for (let i = 0; i < Math.min(q, 8); i++) vis[i] = true; return vis; }
  if (q <= 7) { for (let i = 0; i < q; i++) vis[i] = true; if (k.dw >= R) vis[q] = true; }
  else if (q === 8 || (q === 9 && k.dw < G)) vis.fill(true);
  return vis;
}
function carState(c, k, t) {
  const a = k.n - c; if (a < 0 || a >= 26) return null;
  const st = { x: 0, y: 0, z: CL.z, yaw: 0, paint: 0, engine: false, wheels: [false, false, false, false], finish: false, hanger: false, skid: false };
  if (a <= 13) {
    const s = a, yFor = sl => sl <= 7 ? Y_SKID : Y_HANG;
    st.x = k.moving ? lerp(carX(s - 1), carX(s), k.mv) : carX(s);
    st.y = k.moving ? lerp(yFor(s - 1), yFor(s), k.mv) : yFor(s);
    if (!k.moving && s === 9) st.y = Y_HANG - (Y_HANG - Y_DIP) * (win(k.dw, 0.1, 0.45) - win(k.dw, 0.55, 0.9));
    if (!k.moving && s === 13) st.y = Y_HANG * (1 - win(k.dw, 0.1, 0.75));
    st.paint = s > 6 ? 1 : (s === 6 && !k.moving ? win(k.dw, 0.1, 0.85) : 0);
    st.engine = s > 9 || (s === 9 && !k.moving && k.dw >= 0.5);
    for (let w = 0; w < 4; w++) { const op = w % 2; st.wheels[w] = s > 10 || (s === 10 && !k.moving && k.dw * 2 - op >= R); }
    st.finish = s > 11 || (s === 11 && !k.moving && k.dw >= R);
    st.skid = s <= 7 || (s === 8 && k.moving && k.mv < 0.5);
    st.hanger = s >= 8 && !(s === 13 && !k.moving && k.dw > 0.8);
  } else {
    const lp = lotPaths[mod(c, 12)], tau = t - (c + 14) * C, u = smooth(tau / lp.D);
    const p = lp.p.getPointAt(u), tg = lp.p.getTangentAt(Math.min(u, 0.999));
    Object.assign(st, { x: p.x, y: 0, z: p.z, yaw: Math.atan2(-tg.z, tg.x), paint: 1, engine: true, wheels: [true, true, true, true], finish: true, driving: u < 1 });
  }
  return st;
}
function beltEnginePos(b, t, out) { // engine pushed in cycle b
  const tp = b * C + IDX + 0.05 * DW, ta = (b + BELT_M) * C + IDX + 0.5 * DW;
  if (t < tp || t >= ta) return false;
  const tau = t - tp;
  if (tau < BELT_T) out.copy(beltPath.getPointAt(tau / BELT_T));
  else { const dw = (tau - BELT_T) / DW + 0.05; out.copy(BELT_PTS[4]); out.y = 0.6 + (Y_DIP + 0.1 - 0.6) * win(dw, 0.15, 0.45); }
  return true;
}
function hotRpm(t, k) {
  // engine on stand from release (dw=R) until push (next cycle dw=0.05)
  const tRel = k.n * C + IDX + R * DW, tPushNext = (k.n + 1) * C + IDX + 0.05 * DW, tPush = k.n * C + IDX + 0.05 * DW;
  let tau;
  if (t >= tRel) tau = t - tRel; else if (t < tPush) tau = t - ((k.n - 1) * C + IDX + R * DW); else return { on: false, rpm: 0 };
  let rpm;
  if (tau < 0.5) rpm = 220 + 60 * Math.sin(tau * 40);
  else if (tau < 1.25) rpm = lerp(1300, 820, win(tau, 0.55, 1.25));
  else if (tau < 2.3) rpm = lerp(820, 6600, win(tau, 1.25, 2.3) ** 1.3);
  else if (tau < 2.7) rpm = 6600 + 120 * Math.sin(tau * 30);
  else if (tau < 3.5) rpm = lerp(6600, 800, win(tau, 2.7, 3.5));
  else rpm = 800 + 25 * Math.sin(tau * 9);
  return { on: true, rpm, tau };
}

// ============================================================ follow mode
const follow = { on: false, k: 0 };
function followInfo(t, k, out) {
  const e = follow.k, p = mod(-e, NP);
  const tGrip = (e + 9) * C + IDX + G * DW, tRel = (e + 9) * C + IDX + R * DW, tPush = (e + 10) * C + IDX + 0.05 * DW, tAbs = (e + 13) * C + IDX + 0.5 * DW, c = e + 4;
  if (t < tGrip) {
    const g = pallets[p].g; out.copy(g.position); out.y += 1.2;
    const q = mod(p + k.n, NP); return k.moving ? `搬送中 → ${ST_NAMES[q]}` : ST_NAMES[q];
  }
  if (t < tRel) { unload.rb.tipWorld(out); return 'ST100 払出しロボットが搬送中'; }
  if (t < tPush) { out.copy(STAND); out.y += 0.6; return `ホットテスト中（${Math.round(hotRpm(t, k).rpm)} rpm）`; }
  if (t < tAbs) { beltEnginePos(e + 10, t, out); out.y += 0.6; return t < tPush + BELT_T ? 'エンジン搬送コンベア → 最終組立' : 'エンジン搭載（マリッジ）'; }
  const st = carState(c, k, t);
  if (!st) { follow.k = k.n; return '次のエンジンへ'; }
  out.set(st.x, st.y + 1.0, st.z);
  if (k.n - c > 13) { if (!st.driving && t > (c + 16) * C) follow.k = k.n + 1; return st.driving ? '完成車ヤードへ自走中' : '完成車ヤードに到着 ✔'; }
  const s = k.n - c; return ['', '', '', '', '', '', '', '', 'ハンガー移載', 'エンジン搭載（マリッジ）', 'タイヤ装着', 'ガラス・フード装着', '完成検査トンネル', '降車・出荷'][s] || '最終組立';
}

// ============================================================ UI: labels, stations
const labels = [];
function label(text, x, y, z, small = false, maxDist = 999) { const el = document.createElement('div'); el.className = 'label' + (small ? ' small' : ''); el.textContent = text; document.body.appendChild(el); labels.push({ el, p: V(x, y, z), maxDist }); }
label('V8 エンジン組立ライン', V8.x0 + 12, 4.2, V8.zt - 3);
label('ホットテスト', XU, 4.6, STAND.z);
label('エンジン搬送コンベア', 12, 2.2, 3.2);
label('ボディ溶接', carX(1.5), 4.2, CL.z);
label('塗装ブース', carX(6), 5.8, CL.z);
label('エンジン搭載（マリッジ）', carX(9) + 1, 6.8, CL.z);
label('タイヤ / ガラス装着', carX(10.5), 6.8, CL.z);
label('完成検査', carX(12), 5.6, CL.z);
label('完成車ヤード', 46, 3, 8);
ST_NAMES.forEach((n, i) => label(n, slotX(i), 3.2, V8.zt, true, 40));
let showLabels = true;
const stList = document.getElementById('stlist');
ST_NAMES.forEach(n => { const d = document.createElement('div'); d.className = 'st'; d.innerHTML = `<i></i>${n}<em></em>`; stList.appendChild(d); });
const stRows = [...stList.children];

// camera presets
const CAMS = {
  overview: [V(-4, 58, 66), V(-3, 0, 2)], v8: [V(-2, 13, 9), V(4, 0.5, -7)], hot: [V(XU + 7, 5.5, 4.5), V(XU, 1.2, -1.6)],
  weld: [V(carX(1.5) + 2, 6.5, CL.z - 9), V(carX(1.5), 1.2, CL.z)], final: [V(carX(10) + 4, 7, CL.z - 10), V(carX(9.5), 2, CL.z)], yard: [V(32, 16, 32), V(46, 0, 8)],
};
let camAnim = null;
function goCam(name) {
  follow.on = false; document.getElementById('bFollow').classList.remove('on');
  const [p, t] = CAMS[name]; camAnim = { p0: camera.position.clone(), t0: controls.target.clone(), p, t, f: 0 };
}
camera.position.copy(CAMS.overview[0]); controls.target.copy(CAMS.overview[1]);
if (innerWidth < innerHeight) { CAMS.overview = [V(-74, 42, 36), V(-2, 0, 1)]; camera.position.copy(CAMS.overview[0]); controls.target.copy(CAMS.overview[1]); }

// ============================================================ sound (synth V8)
let audio = null;
function initAudio() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const out = ctx.createGain(); out.gain.value = 0; out.connect(ctx.destination);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400; lp.Q.value = 3; lp.connect(out);
  const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; const o2 = ctx.createOscillator(); o2.type = 'square'; const o3 = ctx.createOscillator(); o3.type = 'sawtooth';
  const g1 = ctx.createGain(); g1.gain.value = 0.5; const g2 = ctx.createGain(); g2.gain.value = 0.25; const g3 = ctx.createGain(); g3.gain.value = 0.3;
  o1.connect(g1).connect(lp); o2.connect(g2).connect(lp); o3.connect(g3).connect(lp);
  // cross-plane burble: amplitude modulation at half-order
  const am = ctx.createOscillator(); am.type = 'sine'; const amg = ctx.createGain(); amg.gain.value = 0.25; am.connect(amg).connect(g1.gain);
  [o1, o2, o3, am].forEach(o => o.start());
  audio = { ctx, out, lp, o1, o2, o3, am, on: true };
}
function updateAudio(rpm, on) {
  if (!audio) return; const t = audio.ctx.currentTime;
  const f = Math.max(rpm, 1) / 60 * 4; // firing frequency of a V8
  audio.o1.frequency.setTargetAtTime(f, t, 0.03); audio.o2.frequency.setTargetAtTime(f / 2, t, 0.03); audio.o3.frequency.setTargetAtTime(f * 1.01, t, 0.03);
  audio.am.frequency.setTargetAtTime(f / 4, t, 0.05);
  audio.lp.frequency.setTargetAtTime(250 + rpm * 0.35, t, 0.05);
  const d = camera.position.distanceTo(STAND), prox = clamp(1.25 - d / 70, 0.15, 1);
  audio.out.gain.setTargetAtTime(audio.on && on && rpm > 50 ? 0.16 * prox * (0.6 + rpm / 16000) : 0, t, 0.08);
}

// ============================================================ main loop
let simT = 40 * C, speed = 1, paused = false;
const T0 = simT;
const SPEEDS = [0.25, 0.5, 1, 2, 4, 8]; let spIdx = 2;
const tmp = V(0, 0, 0), tmp2 = V(0, 0, 0);
const clockEl = { eng: document.getElementById('sEng'), car: document.getElementById('sCar'), rob: document.getElementById('sRob'), rpm: document.getElementById('rpm'), bar: document.querySelector('#rpmbar i'), sp: document.getElementById('sSpeed'), fol: document.getElementById('follow') };
let last = performance.now(), uiTick = 0;

function update(t, dt) {
  const k = clockAt(t);
  // V8 belt texture
  window.__beltTex.offset.x = -((k.n + k.mv) * DP) * 0.5;
  // pallets & engines
  pallets.forEach((pl, p) => {
    const { q, s } = palletS(p, k), lp = loopPos(s);
    pl.g.position.set(lp.x, BELT_Y, lp.z); pl.g.rotation.y = lp.yaw;
    const vis = engineStage(q, k); pl.e.parts.forEach((part, i) => part.visible = vis[i]);
  });
  // station robots
  let active = 0;
  stationBots.forEach(({ rb, carry }, i) => {
    const u = k.moving ? null : k.dw; rb.run(u); if (rb.active) active++;
    const hold = !k.moving && k.dw >= G && k.dw < R; carry.visible = hold; rb.grip(hold);
  });
  { const u = k.moving ? null : k.dw; unload.rb.run(u); if (unload.rb.active) active++; const hold = !k.moving && k.dw >= G && k.dw < R; unload.carry.visible = hold; unload.rb.grip(hold); }
  // gantry
  if (!k.moving && k.dw > 0.12 && k.dw < 0.85) { gantry.laser.visible = true; gantry.laser.position.x = gantry.x + Math.sin((k.dw - 0.12) / 0.73 * Math.PI * 2) * 0.55; gantry.lampMat.emissive.setHex(0xffaa00); gantry.lampMat.emissiveIntensity = 1 + Math.sin(t * 14); }
  else { gantry.laser.visible = false; gantry.lampMat.emissive.setHex(k.moving ? 0x2266ff : 0x33ff66); gantry.lampMat.emissiveIntensity = 1.6; }
  // hot test
  const hr = hotRpm(t, k);
  hot.group.visible = hr.on;
  if (hr.on) {
    hot.pulley.rotation.x -= Math.min(hr.rpm / 60 * Math.PI * 2 * dt, 1.1);
    const j = hr.rpm / 6600; hot.group.position.set(STAND.x + (Math.random() - 0.5) * 0.006 * j, STAND.y + (Math.random() - 0.5) * 0.006 * j, STAND.z);
    hotRust.emissiveIntensity = j * j * 2.5; hotLight.intensity = j * j * 6; hotLampMat.emissiveIntensity = 2;
    if (hr.tau > 0.5 && Math.random() < 0.3 * dt * 60) smoke.emit(V(XU - 0.2, 10.2, STAND.z), 1, 0.3, 0x8a8f96, 2.5, 1.5);
  } else { hotRust.emissiveIntensity = 0; hotLight.intensity = 0; hotLampMat.emissiveIntensity = 0; }
  // belt engines
  window.__rollTex.offset.x -= dt * (BELT_LEN / BELT_T) * 2;
  beltEngines.forEach(m => m.visible = false);
  for (let b = k.n - BELT_M - 1; b <= k.n; b++) {
    const m = beltEngines[mod(b, beltEngines.length)];
    if (beltEnginePos(b, t, tmp)) { m.visible = true; m.position.copy(tmp); }
  }
  { const dwM = k.moving ? -1 : k.dw; const yL = 0.56 + (Y_DIP + 0.1 - 0.6) * (win(dwM, 0.15, 0.45) - win(dwM, 0.55, 0.8)); lift.position.set(LIFT_BASE.x, yL, LIFT_BASE.z); }
  // cars
  for (let i = 0; i < CAR_POOL; i++) {
    const c = k.n - mod(k.n - i, CAR_POOL), cr = cars[i], st = carState(c, k, t);
    cr.car.visible = !!st; if (!st) continue;
    cr.car.position.set(st.x, st.y, st.z); cr.car.rotation.y = st.yaw;
    const col = PAINTS[mod(c * 5 + 3, PAINTS.length)];
    tmpC.setHex(col); cr.paint.color.copy(BIW).lerp(tmpC, st.paint);
    cr.paint.metalness = lerp(0.55, 0.45, st.paint); cr.paint.roughness = lerp(0.5, 0.3, st.paint); cr.paint.clearcoat = st.paint;
    cr.eng.visible = st.engine; cr.finM.visible = st.finish; cr.wheels.forEach((w, j) => w.visible = st.wheels[j]);
    cr.skid.visible = st.skid; cr.hanger.visible = st.hanger;
    if (st.hanger) { const h = RAIL_Y - 0.18 - st.y; cr.bars.forEach(b => { b.scale.y = h; b.position.y = 0.18 + h / 2; }); cr.trolley.position.y = RAIL_Y - st.y; }
  }
  // weld robots + sparks
  const emitScale = clamp(dt * 60, 0, 3);
  weldBots.forEach(rb => { const sp = rb.run(k.moving ? null : k.dw); if (rb.active) active++; if (sp && Math.random() < 0.85) sparks.emit(rb.tipWorld(tmp2), Math.ceil(5 * emitScale), 3.2, 0xffb347, 0.55, 0.6); });
  // paint robots + mist (color of car currently in booth)
  { const c6 = k.n - 6, col = PAINTS[mod(c6 * 5 + 3, PAINTS.length)]; paintBots.forEach(rb => { const sp = rb.run(k.moving ? null : k.dw); if (rb.active) active++; if (sp) mist.emit(rb.tipWorld(tmp2).add(V(0, -0.15, 0)), Math.ceil(3 * emitScale), 0.9, col, 0.9, -0.8); }); }
  // wheels
  wheelBots.forEach(({ rb, carry }) => {
    rb.run(k.moving ? null : k.dw); if (rb.active) active++;
    const u = k.moving ? -1 : k.dw * 2, f = u - Math.floor(u), hold = u >= 0 && f >= G && f < R; carry.visible = hold; rb.grip(hold);
  });
  { glassBot.rb.run(k.moving ? null : k.dw); if (glassBot.rb.active) active++; glassBot.carry.visible = !k.moving && k.dw >= G && k.dw < R; }
  // AMRs
  amrs.forEach(a => { const u = mod((t * a.speed) / a.len + a.off, 1), p = a.path.getPointAt(u), tg = a.path.getTangentAt(u); a.m.position.copy(p); a.m.rotation.y = Math.atan2(-tg.z, tg.x); });
  sparks.update(dt); mist.update(dt); smoke.update(dt);
  return { k, hr, active };
}

function frame(now) {
  const rdt = Math.min(0.1, (now - last) / 1000); last = now;
  const dt = paused ? 0 : rdt * speed;
  simT += dt;
  const { k, hr, active } = update(simT, dt);
  // camera
  if (camAnim) { camAnim.f = Math.min(1, camAnim.f + rdt / 1.3); const f = smooth(camAnim.f); camera.position.lerpVectors(camAnim.p0, camAnim.p, f); controls.target.lerpVectors(camAnim.t0, camAnim.t, f); if (camAnim.f >= 1) camAnim = null; }
  let fText = '';
  if (follow.on) { fText = followInfo(simT, k, tmp); const d = tmp.clone().sub(controls.target).multiplyScalar(Math.min(1, rdt * 4)); controls.target.add(d); camera.position.add(d); }
  controls.update();
  renderer.render(scene, camera);
  // labels
  const w = innerWidth, h = innerHeight;
  for (const L of labels) {
    tmp2.copy(L.p); const dist = camera.position.distanceTo(L.p); tmp2.project(camera);
    const vis = showLabels && tmp2.z < 1 && Math.abs(tmp2.x) < 1.1 && Math.abs(tmp2.y) < 1.1 && dist < L.maxDist;
    L.el.style.display = vis ? '' : 'none';
    if (vis) L.el.style.transform = `translate(${(tmp2.x * 0.5 + 0.5) * w}px,${(-tmp2.y * 0.5 + 0.5) * h}px) translate(-50%,-100%)`;
  }
  updateAudio(hr.rpm, hr.on && !paused);
  if (++uiTick % 6 === 0) {
    const relCount = tt => Math.floor((tt - IDX - R * DW) / C);
    clockEl.eng.textContent = Math.max(0, relCount(simT) - relCount(T0)).toLocaleString();
    const carCount = tt => Math.floor(tt / C) - 14;
    clockEl.car.textContent = Math.max(0, carCount(simT) - carCount(T0)).toLocaleString();
    clockEl.rob.textContent = `${active} / ${stationBots.length + 1 + weldBots.length + paintBots.length + wheelBots.length + 1}`;
    clockEl.rpm.textContent = `${Math.round(hr.rpm).toLocaleString()} rpm`; clockEl.bar.style.width = `${clamp(hr.rpm / 7000, 0, 1) * 100}%`;
    clockEl.sp.textContent = paused ? '一時停止' : `×${speed}`;
    clockEl.fol.style.display = follow.on ? 'block' : 'none';
    if (follow.on) clockEl.fol.textContent = `🎯 エンジン #${follow.k} — ${fText}`;
    stRows.forEach((row, i) => {
      const working = !k.moving && (i !== 8 ? true : k.dw < 0.85);
      row.className = 'st ' + (k.moving ? 'move' : working ? 'work' : '');
      row.querySelector('em').textContent = k.moving ? '搬送' : (i === 8 ? (k.dw < 0.85 ? '検査中' : 'OK') : (k.dw < G ? 'ピック' : k.dw < R ? '組付け' : '完了'));
    });
  }
}

// ============================================================ UI wiring
document.querySelectorAll('[data-cam]').forEach(b => b.addEventListener('click', () => { goCam(b.dataset.cam); document.querySelectorAll('[data-cam]').forEach(x => x.classList.toggle('on', x === b)); }));
document.getElementById('bFollow').addEventListener('click', e => {
  follow.on = !follow.on; e.currentTarget.classList.toggle('on', follow.on);
  if (follow.on) { const k = clockAt(simT); follow.k = k.n; document.querySelectorAll('[data-cam]').forEach(x => x.classList.remove('on')); followInfo(simT, k, tmp); camAnim = { p0: camera.position.clone(), t0: controls.target.clone(), p: tmp.clone().add(V(4.5, 4, 6)), t: tmp.clone(), f: 0 }; }
});
const setSpeed = () => { speed = SPEEDS[spIdx]; };
document.getElementById('bSlow').addEventListener('click', () => { spIdx = Math.max(0, spIdx - 1); setSpeed(); });
document.getElementById('bFast').addEventListener('click', () => { spIdx = Math.min(SPEEDS.length - 1, spIdx + 1); setSpeed(); });
document.getElementById('bPause').addEventListener('click', e => { paused = !paused; e.currentTarget.textContent = paused ? '▶︎' : '⏸'; e.currentTarget.classList.toggle('on', paused); });
document.getElementById('bSound').addEventListener('click', e => {
  try { if (!audio) initAudio(); else { audio.on = !audio.on; } audio.ctx.resume(); e.currentTarget.classList.toggle('on', audio.on); if (audio.on && !follow.on) goCam('hot'); } catch (err) { e.currentTarget.textContent = '音声不可'; }
});
document.getElementById('bSt').addEventListener('click', e => { const s = document.getElementById('stations'); s.classList.toggle('show'); e.currentTarget.classList.toggle('on', s.classList.contains('show')); });
document.getElementById('bLab').addEventListener('click', e => { showLabels = !showLabels; e.currentTarget.classList.toggle('on', !showLabels); });
document.getElementById('bInfo').addEventListener('click', e => { const s = document.getElementById('info'); s.classList.toggle('show'); e.currentTarget.classList.toggle('on', s.classList.contains('show')); });
if (innerWidth > 900) { document.getElementById('stations').classList.add('show'); document.getElementById('bSt').classList.add('on'); }
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

update(simT, 0);
document.getElementById('load').remove();
renderer.setAnimationLoop(frame);
window.__sim = { get t() { return simT; }, set t(v) { simT = v; }, setSpeed: v => speed = v, cam: (p, q) => { camAnim = null; camera.position.set(...p); controls.target.set(...q); controls.update(); } };
