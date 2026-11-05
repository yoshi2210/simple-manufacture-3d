import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

window.addEventListener('error', e => { const m = document.getElementById('loadmsg'); if (m) m.textContent = 'エラー: ' + e.message; });

// ============================================================ data
const D = __DATA__;                                         // mini4wd/data/company.json, inlined by web/build.py
const PART = Object.fromEntries(D.parts.map(p => [p.pn, p]));
const SUP = Object.fromEntries(D.suppliers.map(s => [s.id, s]));
const DEPT = Object.fromEntries(D.departments.map(d => [d.id, d]));
const MOTOR = Object.fromEntries(D.motors.map(m => [m.id, m]));
const GEAR = Object.fromEntries(D.gears.map(g => [g.id, g]));
const BODY = Object.fromEntries(D.bodies.map(b => [b.id, b]));
const TAKT = D.meta.takt_s, SCALE = D.meta.demo_time_scale, CYC = TAKT / SCALE;   // demo seconds per assembly cycle
const yen = v => '¥' + Math.round(v).toLocaleString();
const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const lerp = (a, b, f) => a + (b - a) * f;
const mod = (a, n) => ((a % n) + n) % n;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function gauss(r) { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

// ============================================================ renderer
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const pmrem = new THREE.PMREMGenerator(renderer);
const ENV = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

// ============================================================ materials & geometry helpers
const std = (color, metalness = 0.2, roughness = 0.5, extra = {}) => new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });
const M = {
  dark: std(0x2c3037, 0.4, 0.55), grey: std(0x5d646c, 0.4, 0.55), light: std(0xc9ced4, 0.1, 0.7), white: std(0xeceef0, 0.05, 0.6),
  steel: std(0xa4abb2, 0.9, 0.3), chrome: std(0xe5e8ea, 1, 0.15), black: std(0x141518, 0.2, 0.6), rubber: std(0x18191b, 0, 0.85),
  blue: std(0x2f6fb3, 0.35, 0.45), orange: std(0xff8a3d, 0.3, 0.45), yellow: std(0xf2c230, 0.2, 0.5), green: std(0x2f8f5b, 0.2, 0.6),
  wood: std(0x9c7b58, 0, 0.8), floor: std(0x3c4148, 0.1, 0.9), carpet: std(0x2b3440, 0, 0.95), glass: new THREE.MeshPhysicalMaterial({ color: 0xbfe3ff, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
  screen: std(0x0a0c10, 0, 0.3, { emissive: 0x6aa8ff, emissiveIntensity: 0.25 }), lamp: std(0xffffff, 0, 0.4, { emissive: 0xfff5e0, emissiveIntensity: 1.6 }),
  pcb: std(0x1f6b3a, 0.1, 0.5), chip: std(0x111214, 0.2, 0.4), copper: std(0xc98a4b, 0.9, 0.3), brass: std(0xc7a14a, 0.9, 0.3),
  frp: std(0x2a2d31, 0.2, 0.35), pom: std(0xf0eee6, 0, 0.45), canopy: new THREE.MeshPhysicalMaterial({ color: 0x111820, metalness: 0.3, roughness: 0.08, clearcoat: 1 }),
  glow: std(0x220000, 0, 0.4, { emissive: 0xff5a1a, emissiveIntensity: 1.4 }), led: std(0x002200, 0, 0.3, { emissive: 0x33ff88, emissiveIntensity: 1.6 }),
};
const GEO = new Map();
const boxGeo = (w, h, d) => { const k = `b${w},${h},${d}`; if (!GEO.has(k)) GEO.set(k, new THREE.BoxGeometry(w, h, d)); return GEO.get(k); };
const cylGeo = (rt, rb, h, s) => { const k = `c${rt},${rb},${h},${s}`; if (!GEO.has(k)) GEO.set(k, new THREE.CylinderGeometry(rt, rb, h, s)); return GEO.get(k); };
function box(w, h, d, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(boxGeo(w, h, d), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; return m; }
function cyl(rt, rb, h, mat, s = 16, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(cylGeo(rt, rb, h, s), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; return m; }
const rX = (o, a) => { o.rotation.x = a; return o; }, rZ = (o, a) => { o.rotation.z = a; return o; }, rY = (o, a) => { o.rotation.y = a; return o; };
function mergeObj(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), byMat = new Map();
  root.traverse(o => {
    if (!o.isMesh) return;
    let g = o.geometry.clone(); if (g.index) g = g.toNonIndexed();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!byMat.has(o.material)) byMat.set(o.material, []); byMat.get(o.material).push(g);
  });
  const mats = [], parts = [];
  for (const [mat, list] of byMat) { mats.push(mat); parts.push(mergeGeometries(list, false)); }
  const mesh = new THREE.Mesh(mergeGeometries(parts, true), mats); mesh.castShadow = mesh.receiveShadow = true; return mesh;
}
function canvasTex(w, h, draw, repeat = false) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.userData.canvas = cv; return t;
}
function staticMerge(scene, build, shadow = true) { const g = new THREE.Group(); build(g); const m = mergeObj(g); m.castShadow = shadow; scene.add(m); return m; }
