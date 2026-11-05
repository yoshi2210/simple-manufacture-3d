// ============================================================ campus scene (metres; x east, z south)
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1f26); scene.fog = new THREE.Fog(0x1a1f26, 140, 280); scene.environment = ENV;
scene.add(new THREE.HemisphereLight(0xe2ecff, 0x2a2f36, 0.85));
const sun = new THREE.DirectionalLight(0xfff3e2, 2.0); sun.position.set(40, 80, 30); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -95, right: 95, top: 60, bottom: -60, near: 10, far: 200 }); sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.12;
scene.add(sun);
const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.02, 600);
const controls = new OrbitControls(camera, canvas); controls.enableDamping = true; controls.dampingFactor = 0.08; controls.maxPolarAngle = Math.PI * 0.49; controls.minDistance = 0.4; controls.maxDistance = 220;

const labels = [];
function label(text, p, cls = '', maxDist = 999, onClick = null) {
  const el = document.createElement('div'); el.className = 'label ' + cls; el.textContent = text; document.body.appendChild(el);
  if (onClick) el.addEventListener('click', onClick);
  labels.push({ el, p, maxDist, view: 'campus' }); return el;
}
const OFFICE = { x0: -80, x1: -6, z0: -42, z1: 42 }, FAC = { x0: 6, x1: 84, z0: -42, z1: 42 };
const MM = 0.001;   // car model units -> metres

// ---------------------------------------------------------------- ground, buildings
{
  const tex = canvasTex(1700, 1000, (g, W, H) => {
    const k = W / 170, P = (x, z) => [(x + 85) * k, (z + 50) * k];
    g.fillStyle = '#30353b'; g.fillRect(0, 0, W, H);
    // office carpet
    { const [a, b] = P(OFFICE.x0, OFFICE.z0), [c, d] = P(OFFICE.x1, OFFICE.z1); g.fillStyle = '#36404c'; g.fillRect(a, b, c - a, d - b); }
    // factory epoxy
    { const [a, b] = P(FAC.x0, FAC.z0), [c, d] = P(FAC.x1, FAC.z1); g.fillStyle = '#4c5359'; g.fillRect(a, b, c - a, d - b); }
    g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 1.5;
    for (let x = FAC.x0; x <= FAC.x1; x += 6) { const [a, b] = P(x, FAC.z0), [, d] = P(x, FAC.z1); g.beginPath(); g.moveTo(a, b); g.lineTo(a, d); g.stroke(); }
    // walkways (green) and lines (yellow) in the factory
    g.fillStyle = 'rgba(70,170,110,.5)';
    for (const z of [-19.5, 8.5, 19.5]) { const [a, b] = P(FAC.x0 + 1, z - 0.9), [c, d] = P(FAC.x1 - 1, z + 0.9); g.fillRect(a, b, c - a, d - b); }
    g.strokeStyle = '#f2c230'; g.lineWidth = 4;
    const zone = (x0, z0, x1, z1, col = '#f2c230') => { const [a, b] = P(x0, z0), [c, d] = P(x1, z1); g.strokeStyle = col; g.strokeRect(a, b, c - a, d - b); };
    zone(8, -41, 76, -22); zone(8, -17.5, 64, -9); zone(10, -3.2, 38, 3.2); zone(8, 10, 46, 17); zone(8, 21, 34, 41); zone(48, 21, 83, 41);
    // office corridor
    g.fillStyle = 'rgba(255,255,255,.06)'; { const [a, b] = P(-6, -10), [c, d] = P(6, 10); g.fillRect(a, b, c - a, d - b); }
    g.fillStyle = 'rgba(255,255,255,.04)'; for (const z of [-20.5, 21]) { const [a, b] = P(OFFICE.x0, z - 1), [c, d] = P(OFFICE.x1, z + 1); g.fillRect(a, b, c - a, d - b); }
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(170, 100), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const out = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), std(0x24292f, 0, 1)); out.rotation.x = -Math.PI / 2; out.position.y = -0.02; scene.add(out);
  // office glass walls + factory walls
  for (const [x0, x1, z0, z1] of [[OFFICE.x0, OFFICE.x1, OFFICE.z0, OFFICE.z0], [OFFICE.x0, OFFICE.x1, OFFICE.z1, OFFICE.z1], [OFFICE.x0, OFFICE.x0, OFFICE.z0, OFFICE.z1]]) {
    const len = Math.hypot(x1 - x0, z1 - z0), w = new THREE.Mesh(new THREE.PlaneGeometry(len, 4), M.glass);
    w.position.set((x0 + x1) / 2, 2, (z0 + z1) / 2); w.rotation.y = x0 === x1 ? Math.PI / 2 : 0; scene.add(w);
  }
  staticMerge(scene, g => {
    for (let x = OFFICE.x0; x <= OFFICE.x1; x += 8) for (const z of [OFFICE.z0, OFFICE.z1]) g.add(box(0.25, 4, 0.25, M.grey, x, 2, z));
    for (let z = OFFICE.z0; z <= OFFICE.z1; z += 8) g.add(box(0.25, 4, 0.25, M.grey, OFFICE.x0, 2, z));
    g.add(box(OFFICE.x1 - OFFICE.x0, 0.2, 0.3, M.grey, (OFFICE.x0 + OFFICE.x1) / 2, 4, OFFICE.z0), box(OFFICE.x1 - OFFICE.x0, 0.2, 0.3, M.grey, (OFFICE.x0 + OFFICE.x1) / 2, 4, OFFICE.z1));
    // factory walls (north & east tall, others low)
    g.add(box(FAC.x1 - FAC.x0, 9, 0.4, M.light, (FAC.x0 + FAC.x1) / 2, 4.5, FAC.z0), box(0.4, 9, FAC.z1 - FAC.z0, M.light, FAC.x1, 4.5, 0));
    for (let x = FAC.x0; x <= FAC.x1; x += 12) g.add(box(0.5, 9.5, 0.5, M.blue, x, 4.75, FAC.z0 + 0.3));
    g.add(box(FAC.x1 - FAC.x0, 0.4, 0.4, M.blue, (FAC.x0 + FAC.x1) / 2, 9.4, FAC.z0 + 0.3));
    // corridor bridge office <-> factory
    g.add(box(12, 0.15, 20, M.grey, 0, 0.07, 0));
    for (const z of [-10, 10]) g.add(box(12, 3.2, 0.15, M.light, 0, 1.6, z));
  });
  const signTex = canvasTex(1024, 128, (g, W, H) => { g.fillStyle = '#121820'; g.fillRect(0, 0, W, H); g.fillStyle = '#ff8a3d'; g.fillRect(0, H - 10, W, 10); g.fillStyle = '#fff'; g.font = 'bold 64px sans-serif'; g.textBaseline = 'middle'; g.fillText('VELO WORKS  ·  PLANT 1', 40, H / 2); });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(24, 3), new THREE.MeshBasicMaterial({ map: signTex })); sign.position.set(45, 6.5, FAC.z0 + 0.25); scene.add(sign);
}

// ---------------------------------------------------------------- screen textures for office monitors
const SCREENS = {
  cad: canvasTex(256, 160, (g, W, H) => { g.fillStyle = '#0d1520'; g.fillRect(0, 0, W, H); g.strokeStyle = '#59a6ff'; g.lineWidth = 1.5; const top = TOP.std; g.beginPath(); for (let x = -79; x <= 79; x += 2) { const px = 20 + (79 - x) / 158 * 210, py = 120 - top(x) * 2.2; x === -79 ? g.moveTo(px, py) : g.lineTo(px, py); } g.stroke(); for (const cx of [64, 177]) { g.beginPath(); g.arc(cx, 120 - 28, 28, 0, 7); g.stroke(); } g.strokeStyle = '#ff8a3d'; g.beginPath(); g.moveTo(20, 140); g.lineTo(230, 140); g.stroke(); g.fillStyle = '#ff8a3d'; g.font = '10px sans-serif'; g.fillText('158.0', 112, 154); }),
  code: canvasTex(256, 160, (g, W, H) => { g.fillStyle = '#10131a'; g.fillRect(0, 0, W, H); const r = rng(3), cols = ['#7ee8ac', '#8cbcf5', '#ffd27a', '#c9ced4', '#ff9a93']; for (let y = 8; y < H; y += 9) { let x = 8 + Math.floor(r() * 4) * 10; while (x < W - 20 && r() > 0.18) { const w = 10 + r() * 40; g.fillStyle = cols[Math.floor(r() * 5)]; g.fillRect(x, y, w, 4); x += w + 6; } } }),
  sheet: canvasTex(256, 160, (g, W, H) => { g.fillStyle = '#f4f6f8'; g.fillRect(0, 0, W, H); g.strokeStyle = '#cfd5dc'; for (let x = 0; x < W; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); } for (let y = 0; y < H; y += 12) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); } g.fillStyle = '#2f6fb3'; g.fillRect(0, 0, W, 12); const r = rng(5); g.fillStyle = '#333'; for (let y = 16; y < H; y += 12) for (let x = 4; x < W; x += 32) g.fillRect(x, y + 3, 6 + r() * 20, 4); }),
  dash: canvasTex(256, 160, (g, W, H) => { g.fillStyle = '#121820'; g.fillRect(0, 0, W, H); const r = rng(9); for (let i = 0; i < 9; i++) { const h = 20 + r() * 90; g.fillStyle = i === 6 ? '#fab219' : '#3987e5'; g.fillRect(16 + i * 25, 140 - h, 16, h); } g.strokeStyle = '#e8ecf1'; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(10, 50); g.lineTo(246, 50); g.stroke(); }),
};
const SCREEN_MAT = Object.fromEntries(Object.entries(SCREENS).map(([k, t]) => [k, new THREE.MeshBasicMaterial({ map: t })]));
const cfdScreenTex = new THREE.CanvasTexture(Object.assign(document.createElement('canvas'), { width: 640, height: 240 })); cfdScreenTex.colorSpace = THREE.SRGBColorSpace;
SCREEN_MAT.cfd = new THREE.MeshBasicMaterial({ map: cfdScreenTex });
const DEPT_SCREEN = { EXP: 'dash', PMK: 'dash', DSN: 'cad', MEC: 'cad', ELE: 'code', CAE: 'cfd', QA: 'dash', PE: 'cad', PUR: 'sheet', SCM: 'sheet', SAL: 'sheet', CS: 'dash', FIN: 'sheet', HR: 'sheet', LEG: 'sheet', IT: 'code' };
const DEPT_COLOR = { EXP: 0x8c6be8, PMK: 0xe87ba4, DSN: 0xff8a3d, MEC: 0x3987e5, ELE: 0x1baf7a, CAE: 0x56c2e6, PRT: 0xc98500, QA: 0xe34948, PE: 0x6250d6, MFG: 0x2f6fb3, PUR: 0x9aa3ad, SCM: 0xd95926, SAL: 0x199e70, CS: 0xeda100, FIN: 0x4a5562, HR: 0xb0789e, LEG: 0x7d8796, IT: 0x2a7de1 };

// ---------------------------------------------------------------- people
const personGeo = { body: new THREE.CapsuleGeometry(0.2, 0.55, 4, 10), head: new THREE.SphereGeometry(0.13, 14, 10) };
const skin = std(0xd8b49a, 0, 0.7), PERSON_MATS = {};
function person(g, x, z, color, seated = true, rot = 0) {
  const mat = PERSON_MATS[color] ||= std(color, 0.05, 0.7);
  const b = new THREE.Mesh(personGeo.body, mat), h = new THREE.Mesh(personGeo.head, skin), y0 = seated ? 0.45 : 0.55;
  b.position.set(x, y0 + 0.47, z); h.position.set(x + Math.sin(rot) * 0.02, y0 + 1.05, z + Math.cos(rot) * 0.02);
  b.castShadow = h.castShadow = true; g.add(b, h);
}

// ---------------------------------------------------------------- office: department zones
const ZONES = [];
{
  const depts = ['EXP', 'PMK', 'DSN', 'MEC', 'ELE', 'CAE', 'QA', 'PE', 'PUR', 'SCM', 'SAL', 'CS', 'FIN', 'HR', 'LEG', 'IT'];
  const cols = 4, rows = 4, x0 = OFFICE.x0 + 2, w = (OFFICE.x1 - OFFICE.x0 - 4) / cols, z0 = -19.5, h = 39 / rows;
  depts.forEach((id, i) => {
    const cx = x0 + w * (i % cols) + w / 2, cz = z0 + h * Math.floor(i / cols) + h / 2, d = DEPT[id];
    const seats = Math.min(d.hc, 12), deskRows = Math.ceil(seats / 8);
    const screens = [];
    staticMerge(scene, g => {
      g.add(box(w - 1.2, 0.02, h - 1.2, std(DEPT_COLOR[id], 0, 0.95, { transparent: true, opacity: 0.18 }), cx, 0.01, cz));
      for (let r = 0; r < deskRows; r++) for (let c = 0; c < 2; c++) {
        const dx = cx - 3.2 + c * 6.4, dz = cz - (deskRows - 1) * 1.1 + r * 2.2;
        g.add(box(4.8, 0.05, 1.4, M.wood, dx, 0.74, dz));
        for (const lx of [-2.3, 2.3]) for (const lz of [-0.6, 0.6]) g.add(box(0.05, 0.72, 0.05, M.grey, dx + lx, 0.36, dz + lz));
        g.add(box(4.8, 0.35, 0.03, M.grey, dx, 0.95, dz));
        for (let s = 0; s < 2; s++) for (const side of [-1, 1]) {
          const sx = dx - 1.2 + s * 2.4, sz = dz + side * 0.42;
          g.add(box(0.55, 0.34, 0.03, M.black, sx, 1.0, sz - side * 0.05), box(0.08, 0.18, 0.08, M.dark, sx, 0.85, sz - side * 0.05));
          screens.push([sx, 1.0, sz - side * 0.068, side]);
          g.add(box(0.5, 0.06, 0.5, M.black, sx, 0.48, sz + side * 0.55), box(0.5, 0.5, 0.06, M.black, sx, 0.75, sz + side * 0.8));
        }
      }
    });
    // screens (shared texture)
    const sm = SCREEN_MAT[DEPT_SCREEN[id]];
    const geoms = screens.map(([x, y, z, s]) => { const pg = new THREE.PlaneGeometry(0.5, 0.29); pg.rotateY(s > 0 ? 0 : Math.PI); pg.translate(x, y, z); return pg; });
    if (geoms.length) scene.add(new THREE.Mesh(mergeGeometries(geoms), sm));
    // people at the desks
    const pg = new THREE.Group(); let n = 0;
    for (const [x, , z, s] of screens) { if (n++ >= seats) break; person(pg, x, z + s * 0.62, DEPT_COLOR[id], true, s > 0 ? Math.PI : 0); }
    scene.add(mergeObj(pg));
    const lp = V(cx, 2.6, cz);
    ZONES.push({ id, cx, cz, w, h });
    label(`${d.name}（${d.hc}）`, lp, 'dept', 175, () => openDept(id));
  });
}

// ---------------------------------------------------------------- office: special rooms (north strip)
// design review room with a large LED wall fed by the studio turntable render target
const DR_RT = new THREE.WebGLRenderTarget(1024, 440, { samples: 4 }); DR_RT.texture.colorSpace = THREE.SRGBColorSpace;
{
  const x = -68, z = -31;
  staticMerge(scene, g => {
    g.add(box(22, 0.03, 18, M.carpet, x, 0.015, z), box(7.6, 3.5, 0.3, M.black, x, 2.1, -41.4));
    g.add(box(6, 0.06, 2.4, M.wood, x, 0.76, z + 1)); for (const sx of [-2.8, 2.8]) for (const sz of [-1, 1]) g.add(box(0.06, 0.74, 0.06, M.grey, x + sx, 0.37, z + 1 + sz));
    for (let i = 0; i < 6; i++) for (const s of [-1, 1]) g.add(box(0.5, 0.06, 0.5, M.black, x - 2.5 + i, 0.48, z + 1 + s * 1.7));
    for (const sx of [-11, 11]) g.add(box(0.12, 3, 18, M.light, x + sx, 1.5, z));
  });
  const led = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 3.1), new THREE.MeshBasicMaterial({ map: DR_RT.texture })); led.position.set(x, 2.15, -41.2); scene.add(led);
  const pg = new THREE.Group(); for (let i = 0; i < 6; i++) person(pg, x - 2.5 + i, z + (i % 2 ? 2.7 : -0.7), [0xff8a3d, 0x3987e5, 0xe34948, 0x6250d6, 0x1baf7a, 0xe87ba4][i], true, i % 2 ? Math.PI : 0); scene.add(mergeObj(pg));
  label('デザインレビュー室（DR5 準備中）', V(x, 4.2, -40), '', 160);
}
// CFD / simulation room
{
  const x = -47, z = -31;
  staticMerge(scene, g => { g.add(box(20, 0.03, 18, M.carpet, x, 0.015, z), box(5.6, 2.2, 0.25, M.black, x, 1.9, -41.4)); for (const sx of [-10]) g.add(box(0.12, 3, 18, M.light, x + sx, 1.5, z)); for (let i = 0; i < 3; i++) g.add(box(2.6, 0.05, 1.2, M.wood, x - 5 + i * 5, 0.74, z + 2)); });
  const s = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 2.02), SCREEN_MAT.cfd); s.position.set(x, 1.95, -41.24); scene.add(s);
  const pg = new THREE.Group(); for (let i = 0; i < 3; i++) person(pg, x - 5 + i * 5, z + 2.7, DEPT_COLOR.CAE, true, Math.PI); scene.add(mergeObj(pg));
  label('CAE・空力解析室（ライブ CFD）', V(x, 3.6, -40), '', 160);
}
// test course room (3-lane course with lane changer)
const TRACK = (() => {
  const cx = -21, cz = -31, W = 14.55, H = 8, r = 1.8, laneW = 0.115, wallH = 0.05, baseY = 0.08;
  // centre path: rounded rectangle, sampled
  const pts = [];
  const seg = (ax, az, bx, bz, n) => { for (let i = 0; i < n; i++) pts.push([lerp(ax, bx, i / n), lerp(az, bz, i / n)]); };
  const arc = (ox, oz, a0, a1, n) => { for (let i = 0; i < n; i++) { const a = lerp(a0, a1, i / n); pts.push([ox + Math.cos(a) * r, oz + Math.sin(a) * r]); } };
  const hx = W / 2 - r, hz = H / 2 - r;
  seg(cx - hx, cz - H / 2, cx + hx, cz - H / 2, 120); arc(cx + hx, cz - hz, -Math.PI / 2, 0, 40);
  seg(cx + W / 2, cz - hz, cx + W / 2, cz + hz, 60); arc(cx + hx, cz + hz, 0, Math.PI / 2, 40);
  seg(cx + hx, cz + H / 2, cx - hx, cz + H / 2, 120); arc(cx - hx, cz + hz, Math.PI / 2, Math.PI, 40);
  seg(cx - W / 2, cz + hz, cx - W / 2, cz - hz, 60); arc(cx - hx, cz - hz, Math.PI, 1.5 * Math.PI, 40);
  const n = pts.length, cum = [0];
  for (let i = 1; i <= n; i++) { const a = pts[i - 1], b = pts[i % n]; cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const L = cum[n];
  const LC = [0.12, 0.22];          // lane-changer section (fraction of the lap, on the north straight)
  const laneOff = k => (k - 1) * laneW * 1.15;
  function at(s, lane) {             // -> {x, y, z, yaw}
    s = mod(s, L); let i = 0; while (cum[i + 1] < s) i++;
    const a = pts[i], b = pts[(i + 1) % n], f = (s - cum[i]) / (cum[i + 1] - cum[i]);
    const x = lerp(a[0], b[0], f), z = lerp(a[1], b[1], f), dx = b[0] - a[0], dz = b[1] - a[1], ln = Math.hypot(dx, dz);
    const nx = dz / ln, nz = -dx / ln; // outward normal (path is clockwise in screen space)
    const u = s / L; let off = laneOff(lane), y = baseY;
    if (u > LC[0] && u < LC[1]) {
      const t = (u - LC[0]) / (LC[1] - LC[0]), tgt = lane === 2 ? laneOff(0) : laneOff(lane + 1);
      off = lerp(laneOff(lane), tgt, smooth(t)); if (lane === 2) y += Math.sin(Math.PI * t) * 0.13;   // outer lane crosses over the bridge
    }
    return { x: x + nx * off, y, z: z + nz * off, yaw: Math.atan2(-dz, dx) };
  }
  // geometry: lane floors + walls
  const laneMats = [0x5b6f8c, 0x6d5b8c, 0x5b8c75].map(c => std(c, 0.05, 0.55, { side: THREE.DoubleSide }));
  for (let k = 0; k < 3; k++) {
    const pos = [], idx = [];
    for (let i = 0; i <= n; i++) {
      const s = cum[i]; {
        const p = at(s, k), q = at(s + 0.05, k), dx = q.x - p.x, dz = q.z - p.z, ln = Math.hypot(dx, dz) || 1, nx = dz / ln, nz = -dx / ln;
        pos.push(p.x - nx * laneW * 0.58, baseY + 0.002, p.z - nz * laneW * 0.58, p.x + nx * laneW * 0.58, baseY + 0.002, p.z + nz * laneW * 0.58);
      }
      if (i) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); gg.setIndex(idx); gg.computeVertexNormals();
    const m = new THREE.Mesh(gg, laneMats[k]); m.receiveShadow = true; scene.add(m);
  }
  const wallGeo = [];
  for (const off of [-1.5, -0.5, 0.5, 1.5].map(v => v * laneW * 1.15)) {
    for (let i = 0; i < n; i += 2) {
      const s = cum[i], u = s / L; if (u > LC[0] && u < LC[1]) continue;
      const a = at(s, 1), b = at(cum[(i + 2) % n] || L, 1), dx = b.x - a.x, dz = b.z - a.z, ln = Math.hypot(dx, dz) || 1, nx = dz / ln, nz = -dx / ln;
      const gb = new THREE.BoxGeometry(ln, wallH, 0.008); gb.rotateY(Math.atan2(-dz, dx)); gb.translate((a.x + b.x) / 2 + nx * off, baseY + wallH / 2, (a.z + b.z) / 2 + nz * off); wallGeo.push(gb);
    }
  }
  scene.add(new THREE.Mesh(mergeGeometries(wallGeo), M.white));
  // lane changer bridge
  {
    const pos = [], idx = [], N = 40;
    for (let i = 0; i <= N; i++) {
      const u = lerp(LC[0], LC[1], i / N), p = at(u * L, 2), q = at(u * L + 0.05, 2), dx = q.x - p.x, dz = q.z - p.z, ln = Math.hypot(dx, dz) || 1, nx = dz / ln, nz = -dx / ln;
      pos.push(p.x - nx * laneW / 2, p.y - 0.002, p.z - nz * laneW / 2, p.x + nx * laneW / 2, p.y - 0.002, p.z + nz * laneW / 2);
      if (i) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); gg.setIndex(idx); gg.computeVertexNormals();
    scene.add(new THREE.Mesh(gg, std(0xd9dde2, 0.1, 0.4, { side: THREE.DoubleSide })));
  }
  staticMerge(scene, g => { g.add(box(W + 3, baseY, H + 3, std(0x23282f, 0, 0.9), cx, baseY / 2, cz)); g.add(box(3, 0.9, 0.8, M.wood, cx, 0.45, cz + H / 2 + 2.2)); for (let i = 0; i < 4; i++) g.add(box(1.6, 0.05, 0.8, M.wood, cx - 6 + i * 4, 0.74, cz + H / 2 + 3.4)); });
  const pg = new THREE.Group(); for (let i = 0; i < 5; i++) person(pg, cx - 7 + i * 3.5, cz + H / 2 + 1.6, [0x3987e5, 0xe34948, 0x1baf7a, 0xff8a3d, 0x56c2e6][i], false, Math.PI); scene.add(mergeObj(pg));
  // scoreboard
  const board = canvasTex(512, 256, () => {}); const bm = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.6), new THREE.MeshBasicMaterial({ map: board })); bm.position.set(cx + 4.5, 1.6, cz + H / 2 + 2.21); scene.add(bm);
  label('テストコース（3 レーン・社内 DV-06）', V(cx, 1.8, cz - H / 2), '', 140);
  return { at, L, cx, cz, W, H, board };
})();

// ---------------------------------------------------------------- office: labs (south strip)
const PRINTERS = [];
{
  // prototype lab
  const x = -68, z = 31;
  staticMerge(scene, g => {
    g.add(box(22, 0.03, 18, std(0x3a3f46, 0, 0.9), x, 0.015, z));
    for (let i = 0; i < 6; i++) { const px = x - 7.5 + (i % 3) * 3.2, pz = z - 4 + Math.floor(i / 3) * 3; g.add(box(1.0, 0.8, 1.0, M.grey, px, 0.4, pz), box(1.0, 0.9, 0.06, M.light, px, 1.25, pz - 0.47), box(0.06, 0.9, 1, M.light, px - 0.47, 1.25, pz), box(0.06, 0.9, 1, M.light, px + 0.47, 1.25, pz)); }
    g.add(box(3.2, 1.0, 2.2, M.blue, x + 6, 0.5, z - 3), box(3.4, 0.2, 2.4, M.grey, x + 6, 1.4, z - 3));   // CNC router
    g.add(box(2.2, 1.0, 1.4, M.dark, x + 6, 0.5, z + 2.5));                                                   // laser cutter
    for (let i = 0; i < 2; i++) g.add(box(3, 0.05, 1.2, M.wood, x - 7 + i * 4, 0.9, z + 6));
  });
  for (let i = 0; i < 6; i++) { const px = x - 7.5 + (i % 3) * 3.2, pz = z - 4 + Math.floor(i / 3) * 3; const head = box(0.12, 0.08, 0.12, M.orange, px, 1.25, pz); scene.add(head); const part = box(0.18, 0.001, 0.08, std([0xd23b2f, 0x1f5fbf, 0xe8b10e][i % 3], 0, 0.5), px, 0.81, pz); scene.add(part); PRINTERS.push({ head, part, px, pz, ph: i * 1.7 }); }
  const pg = new THREE.Group(); for (let i = 0; i < 4; i++) person(pg, x - 7 + i * 2.2, z + 7.2, DEPT_COLOR.PRT, false, Math.PI); scene.add(mergeObj(pg));
  label('試作ラボ（3D プリンタ ×6・CNC・レーザー）', V(x, 3, z - 8), '', 140, () => openDept('PRT'));
  // electronics lab
  const ex = -47, ez = 31;
  staticMerge(scene, g => {
    g.add(box(20, 0.03, 18, std(0x3a3f46, 0, 0.9), ex, 0.015, ez));
    for (let i = 0; i < 4; i++) { const bx_ = ex - 6 + (i % 2) * 8, bz = ez - 3 + Math.floor(i / 2) * 5; g.add(box(4, 0.05, 1.2, M.light, bx_, 0.9, bz), box(0.6, 0.35, 0.4, M.dark, bx_ - 1.2, 1.1, bz - 0.2), box(0.5, 0.25, 0.35, M.blue, bx_ + 0.6, 1.05, bz - 0.2)); }
    g.add(box(3, 2.4, 3, std(0x8a929b, 0.5, 0.4), ex + 6, 1.2, ez + 4.5));    // EMC shield box
  });
  const pg2 = new THREE.Group(); for (let i = 0; i < 4; i++) person(pg2, ex - 6 + (i % 2) * 8, ez - 2.2 + Math.floor(i / 2) * 5, DEPT_COLOR.ELE, true, Math.PI); scene.add(mergeObj(pg2));
  label('電気・ファームラボ（EMC 簡易シールド）', V(ex, 3, ez - 8), '', 140);
  // quality lab: CMM + drop tester + climate chamber
  const qx = -26, qz = 31;
  staticMerge(scene, g => {
    g.add(box(20, 0.03, 18, std(0x3a3f46, 0, 0.9), qx, 0.015, qz));
    g.add(box(2.4, 0.8, 1.8, std(0x2d2f33, 0.2, 0.3), qx - 5, 0.4, qz - 3)); for (const s of [-1, 1]) g.add(box(0.12, 1.4, 0.12, M.light, qx - 5 + s * 1.1, 1.5, qz - 3)); g.add(box(2.4, 0.15, 0.2, M.light, qx - 5, 2.25, qz - 3));
    g.add(box(1.4, 2.0, 1.4, M.white, qx + 2, 1.0, qz - 3), box(0.06, 0.8, 0.6, M.glass, qx + 2.71, 1.2, qz - 3));
    g.add(box(0.8, 2.2, 0.8, M.grey, qx + 6, 1.1, qz - 3), box(0.6, 0.02, 0.6, M.light, qx + 6, 1.0, qz - 2.6));
    for (let i = 0; i < 3; i++) g.add(box(3, 0.05, 1.2, M.light, qx - 6 + i * 4.5, 0.9, qz + 4));
  });
  const pg3 = new THREE.Group(); for (let i = 0; i < 3; i++) person(pg3, qx - 6 + i * 4.5, qz + 4.8, DEPT_COLOR.QA, true, Math.PI); scene.add(mergeObj(pg3));
  label('品質ラボ（三次元測定機・環境試験・落下試験）', V(qx, 3, qz - 8), '', 140, () => openDept('QA'));
  // wind tunnel (DV-12 correlation) + lobby showcase
  const wx = -11, wz = 31;
  staticMerge(scene, g => { g.add(box(8, 1.2, 1.6, M.glass, wx, 1.4, wz - 4), box(1.6, 2.2, 2.2, M.dark, wx - 4.6, 1.3, wz - 4), box(1.6, 1.6, 1.6, M.grey, wx + 4.6, 1.3, wz - 4), box(8, 0.8, 1.6, M.grey, wx, 0.4, wz - 4)); g.add(box(1.2, 0.9, 1.2, M.white, wx, 0.45, wz + 4)); });
  label('風洞（CFD 相関 DV-12）', V(wx, 2.6, wz - 4), '', 120);
  label('ロビー・製品展示', V(wx, 2.0, wz + 4), '', 120);
}

// ---------------------------------------------------------------- factory: injection molding
const MOLD = [];
D.molding.forEach((mc, i) => {
  const x = 13 + i * 10.5, z = -31, big = mc.tonnage >= 100, L = big ? 6.4 : 5.2;
  staticMerge(scene, g => {
    g.add(box(L, 1.0, 1.6, std(0x2f6fb3, 0.3, 0.45), x, 0.5, z), box(L * 0.42, 0.5, 0.5, M.steel, x + L * 0.25, 1.3, z), box(0.7, 0.9, 0.7, M.grey, x + L * 0.42, 1.55, z));
    g.add(cyl(0.35, 0.18, 0.8, M.light, 12, x + L * 0.42, 2.35, z));                                              // hopper
    g.add(box(0.25, 1.3, 1.5, M.grey, x - L * 0.05, 1.65, z), box(0.25, 1.3, 1.5, M.grey, x - L * 0.42, 1.65, z));   // fixed platens
    for (const dy of [-0.5, 0.5]) for (const dz of [-0.55, 0.55]) g.add(rZ(cyl(0.05, 0.05, L * 0.4, M.chrome, 8, x - L * 0.235, 1.65 + dy, z + dz), Math.PI / 2));
    g.add(box(0.9, 0.9, 0.9, std(0x8a929b, 0.4, 0.4), x - L * 0.23, 0.9, z + 1.4), box(1.2, 0.7, 0.9, M.grey, x - L * 0.23, 0.35, z + 2.6));   // chute + bin
    g.add(box(0.8, 1.6, 0.4, M.dark, x + L * 0.1, 0.8, z - 1.1));
  });
  const moving = box(0.28, 1.2, 1.4, M.orange, x - L * 0.3, 1.65, z); scene.add(moving);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), std(0x111111, 0, 0.4, { emissive: 0x33ff66, emissiveIntensity: 1.5 })); lamp.position.set(x + L * 0.1, 1.75, z - 1.1); scene.add(lamp);
  const drops = []; const pm = std(new THREE.Color(mc.color), 0.1, 0.5);
  for (let k = 0; k < 6; k++) { const d = box(0.12, 0.03, 0.08, pm, x - L * 0.23, -5, z + 1.4); scene.add(d); drops.push(d); }
  const fill = box(1.1, 0.01, 0.8, pm, x - L * 0.23, 0.45, z + 2.6); scene.add(fill);
  const p0 = PART[mc.parts[0]];
  MOLD.push({ mc, x, z, L, moving, lamp, drops, fill, cycle: p0.cycle_s / SCALE, shots: 0, phase: i * 0.37 });
  label(`${mc.id} ${mc.tonnage}t ${mc.parts.map(pn => PART[pn].name.replace(/（.*?）/g, '')).join('・')}（${p0.cavities}個取り / ${p0.cycle_s}s）`, V(x, 3.2, z), 'small', 30);
});
label('射出成形エリア（6 台）', V(43, 5.2, -31), '', 200);

// ---------------------------------------------------------------- factory: SMT line
const SMT = { boards: [], x0: 10, x1: 62, z: -13.2, y: 0.92 };
{
  const n = D.smt.steps.length, span = (SMT.x1 - SMT.x0) / n;
  staticMerge(scene, g => {
    g.add(box(SMT.x1 - SMT.x0 + 4, 0.06, 0.5, M.grey, (SMT.x0 + SMT.x1) / 2, 0.88, SMT.z));
    D.smt.steps.forEach((st, i) => { const x = SMT.x0 + span * (i + 0.5); g.add(box(span * 0.62, 1.5, 1.6, i === 4 ? std(0x6b7078, 0.4, 0.4) : M.white, x, 0.75, SMT.z), box(span * 0.62, 0.12, 1.65, M.blue, x, 1.56, SMT.z)); });
  });
  D.smt.steps.forEach((st, i) => label(`${st.id} ${st.name}`, V(SMT.x0 + span * (i + 0.5), 2.0, SMT.z), 'small', 22));
  SMT.reflow = new THREE.Mesh(new THREE.BoxGeometry(span * 0.6, 0.05, 1.2), M.glow); SMT.reflow.position.set(SMT.x0 + span * 4.5, 1.2, SMT.z); scene.add(SMT.reflow);
  SMT.aoi = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), std(0x111111, 0, 0.4, { emissive: 0x33aaff, emissiveIntensity: 0 })); SMT.aoi.position.set(SMT.x0 + span * 5.5, 1.75, SMT.z); scene.add(SMT.aoi);
  const bm = [M.pcb, M.chip];
  for (let i = 0; i < 10; i++) { const g = new THREE.Group(); g.add(box(0.28, 0.008, 0.12, M.pcb, 0, 0, 0)); for (let k = 0; k < 8; k++) g.add(box(0.012, 0.004, 0.012, M.chip, -0.12 + (k % 4) * 0.08, 0.005, -0.03 + Math.floor(k / 4) * 0.06)); const m = mergeObj(g); m.visible = false; scene.add(m); SMT.boards.push(m); }
  label('SMT ライン（8 面付け・45 s/パネル）', V((SMT.x0 + SMT.x1) / 2, 3.0, SMT.z), '', 200);
}

// ---------------------------------------------------------------- factory: assembly line (A10–A90), desktop SCARA robots
// Real toy-assembly scale: 1.5 m station pitch, 180 mm pallet conveyor, 0.36 m reach SCARAs on 0.86 m benches.
const ASM = { x0: 14, sp: 1.5, z: 0, y: 0.9, stations: D.assembly.stations };
const stX = i => ASM.x0 + i * ASM.sp;
const BENCH_Y = ASM.y - 0.04;
class Scara {
  constructor(x, z, facing = 1, k = 0.55) {
    this.k = k; this.root = new THREE.Group(); this.root.position.set(x, BENCH_Y, z); this.root.scale.setScalar(k); scene.add(this.root);
    this.root.add(cyl(0.11, 0.13, 0.5, M.white, 16, 0, 0.25, 0), cyl(0.1, 0.1, 0.06, M.dark, 16, 0, 0.53, 0), box(0.3, 0.03, 0.3, M.grey, 0, 0.015, 0));
    this.j1 = new THREE.Group(); this.j1.position.y = 0.56; this.root.add(this.j1);
    this.j1.add(box(0.36, 0.09, 0.12, M.white, 0.18, 0, 0), cyl(0.075, 0.075, 0.12, M.dark, 14, 0.36, 0, 0), box(0.12, 0.02, 0.06, M.orange, 0.2, 0.055, 0));
    this.j2 = new THREE.Group(); this.j2.position.x = 0.36; this.j1.add(this.j2);
    this.j2.add(box(0.3, 0.07, 0.1, M.white, 0.15, 0, 0), cyl(0.05, 0.05, 0.16, M.dark, 12, 0.3, 0, 0));
    this.quill = new THREE.Group(); this.quill.position.x = 0.3; this.j2.add(this.quill);
    this.quill.add(cyl(0.015, 0.015, 0.36, M.chrome, 8, 0, -0.08, 0), box(0.06, 0.03, 0.06, M.dark, 0, -0.27, 0), box(0.012, 0.04, 0.05, M.steel, -0.03, -0.3, 0), box(0.012, 0.04, 0.05, M.steel, 0.03, -0.3, 0));
    this.tip = new THREE.Group(); this.tip.position.y = -0.29; this.quill.add(this.tip);
    this.facing = facing; this.base = V(x, BENCH_Y + 0.56 * k, z);
  }
  reach(p) {   // planar 2-link IK (robot units) + vertical quill stroke
    const k = this.k, dx = (p.x - this.base.x) / k, dz = (p.z - this.base.z) / k, L1 = 0.36, L2 = 0.3, d = clamp(Math.hypot(dx, dz), 0.08, L1 + L2 - 0.005);
    const e = Math.acos(clamp((d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1, 1)) * this.facing, a = Math.atan2(-dz, dx) - Math.atan2(L2 * Math.sin(e), L1 + L2 * Math.cos(e));
    this.j1.rotation.y = a; this.j2.rotation.y = e; this.quill.position.y = clamp((p.y - this.base.y) / k + 0.29, -0.2, 0.06);
  }
}
const KEYS = [[0, 'home'], [0.14, 'ap'], [0.22, 'p'], [0.3, 'p'], [0.38, 'ap'], [0.58, 'aq'], [0.64, 'q'], [0.72, 'q'], [0.8, 'aq'], [1, 'home']];
function pp(u, home, pick, place, out) {
  const pt = { home, p: pick, ap: pick.clone().add(V(0, 0.05, 0)), q: place, aq: place.clone().add(V(0, 0.05, 0)) };
  for (let i = 0; i < KEYS.length - 1; i++) if (u < KEYS[i + 1][0]) { const f = smooth((u - KEYS[i][0]) / (KEYS[i + 1][0] - KEYS[i][0])); return out.lerpVectors(pt[KEYS[i][1]], pt[KEYS[i + 1][1]], f); }
  return out.copy(home);
}
// one reference car per variant (for carried parts)
const VARIANTS = D.variants, MIX = ['KST-STD', 'KST-AERO', 'KST-STD', 'KST-LOW'];
const VAR = Object.fromEntries(VARIANTS.map(v => [v.id, v]));
const REFCAR = Object.fromEntries(VARIANTS.map(v => [v.id, buildCar(v, { merged: true })]));
// line pallets (jig plates) and car pools
const LINE_N = ASM.stations.length;
const JIG = std(0x2f6fb3, 0.4, 0.4);
const POOL = Object.fromEntries(VARIANTS.map(v => [v.id, Array.from({ length: LINE_N + 2 }, () => { const c = buildCar(v, { merged: true }); c.root.add(box(172, 5, 112, JIG, 0, -2.5, 0), box(30, 6, 6, M.yellow, -70, 1, 50)); c.root.scale.setScalar(MM); scene.add(c.root); c.root.visible = false; return c; })]));
const STATION_PARTS = ASM.stations.map(st => D.installs[st.id]);
staticMerge(scene, g => {
  const L0 = stX(-1), L1x = stX(LINE_N) + 0.2;
  g.add(box(L1x - L0, 0.04, 0.18, M.dark, (L0 + L1x) / 2, ASM.y - 0.04, ASM.z), box(L1x - L0, 0.03, 0.02, M.steel, (L0 + L1x) / 2, ASM.y - 0.01, ASM.z - 0.1), box(L1x - L0, 0.03, 0.02, M.steel, (L0 + L1x) / 2, ASM.y - 0.01, ASM.z + 0.1));
  for (let i = -1; i <= LINE_N; i++) {
    const x = stX(i);
    g.add(box(1.36, BENCH_Y - 0.03, 0.55, M.light, x, (BENCH_Y - 0.03) / 2, ASM.z - 0.4), box(1.36, BENCH_Y - 0.03, 0.4, M.light, x, (BENCH_Y - 0.03) / 2, ASM.z + 0.33));
    g.add(box(1.38, 0.03, 0.58, M.grey, x, BENCH_Y - 0.015, ASM.z - 0.4), box(1.38, 0.03, 0.42, M.grey, x, BENCH_Y - 0.015, ASM.z + 0.33));
    if (i >= 0 && i < LINE_N) {
      g.add(box(0.26, 0.025, 0.16, M.yellow, x - 0.16, BENCH_Y + 0.012, ASM.z - 0.5));                            // parts tray
      for (const sx of [-0.66, 0.66]) g.add(box(0.03, 0.9, 0.03, M.yellow, x + sx, BENCH_Y + 0.45, ASM.z - 0.66)); // guard posts
      g.add(box(1.36, 0.03, 0.03, M.yellow, x, BENCH_Y + 0.9, ASM.z - 0.66), box(0.5, 0.32, 0.03, M.black, x + 0.35, BENCH_Y + 0.7, ASM.z - 0.66));
      g.add(cyl(0.025, 0.025, 0.3, M.grey, 8, x + 0.6, BENCH_Y + 1.05, ASM.z - 0.66));                            // andon post
    }
  }
});
// station andon lights + HMI screens
const ANDON = ASM.stations.map((st, i) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.07, 12), std(0x111111, 0, 0.4, { emissive: 0x33ff66, emissiveIntensity: 1.4 })); m.position.set(stX(i) + 0.6, BENCH_Y + 1.24, ASM.z - 0.66); scene.add(m); return m; });
const ROBOTS = [];
ASM.stations.forEach((st, i) => {
  label(`${st.id} ${st.name}`, V(stX(i), BENCH_Y + 1.38, ASM.z - 0.66), 'small', 9);
  const human = st.id === 'A70' || st.id === 'A90';
  if (st.id === 'A80') return;
  if (human) { const pg = new THREE.Group(); person(pg, stX(i), ASM.z - 1.0, DEPT_COLOR.MFG, false, 0); scene.add(mergeObj(pg)); return; }
  const n = /×2/.test(st.resource) ? 2 : 1;
  for (let k = 0; k < n; k++) {
    const rb = new Scara(stX(i) + (n === 2 ? (k ? 0.3 : -0.3) : 0), ASM.z - 0.36, k ? -1 : 1);
    const pns = STATION_PARTS[i].filter((_, j) => j % n === k);
    const carry = new THREE.Group(), inner = new THREE.Group(); carry.add(inner);
    for (const pn of pns) { const src = REFCAR['KST-STD'].groups[pn]; if (src) inner.add(src.clone()); }
    const bb = new THREE.Box3().setFromObject(inner), c = bb.isEmpty() ? V(0, 0, 0) : bb.getCenter(V(0, 0, 0)); inner.position.set(-c.x, bb.isEmpty() ? 0 : -bb.max.y, -c.z);
    carry.scale.setScalar(MM / rb.k); rb.tip.add(carry); carry.visible = false;
    rb.carry = carry; rb.pick = V(stX(i) - 0.16 + (n === 2 ? (k ? 0.12 : -0.12) : 0), BENCH_Y + 0.03, ASM.z - 0.5); rb.home = V(stX(i) + (n === 2 ? (k ? 0.18 : -0.18) : 0), ASM.y + 0.1, ASM.z - 0.18);
    ROBOTS.push({ rb, i });
  }
});
// EOL roller dyno (A80)
const EOL = { x: stX(7) };
staticMerge(scene, g => { g.add(box(0.5, 0.22, 0.34, std(0x2d2f33, 0.2, 0.4), EOL.x, BENCH_Y + 0.11, ASM.z - 0.45), box(0.36, 0.24, 0.03, M.black, EOL.x - 0.3, BENCH_Y + 0.4, ASM.z - 0.5)); });
const eolScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.22), new THREE.MeshBasicMaterial({ map: canvasTex(256, 160, () => {}) })); eolScreen.position.set(EOL.x - 0.3, BENCH_Y + 0.4, ASM.z - 0.483); scene.add(eolScreen);
const EOL_ROLLERS = []; for (const dx of [-0.041, 0.041]) for (const dz of [-0.04, 0.04]) { const r = rX(cyl(0.008, 0.008, 0.03, M.steel, 10, EOL.x + dx, ASM.y - 0.01, ASM.z + dz), Math.PI / 2); scene.add(r); EOL_ROLLERS.push(r); }
// packing (A90) → outfeed → palletizer
const BOXES = []; const boxMat = canvasTex(256, 128, (g, W, H) => { g.fillStyle = '#121820'; g.fillRect(0, 0, W, H); g.fillStyle = '#ff8a3d'; g.fillRect(0, H - 18, W, 18); g.fillStyle = '#fff'; g.font = 'bold 34px sans-serif'; g.fillText('VELO-32', 18, 58); g.font = '20px sans-serif'; g.fillText('KESTREL', 20, 90); });
const BOXM = new THREE.MeshStandardMaterial({ map: boxMat, roughness: 0.6 });
for (let i = 0; i < 26; i++) { const b = new THREE.Mesh(boxGeo(0.21, 0.07, 0.13), BOXM); b.castShadow = true; b.visible = false; scene.add(b); BOXES.push(b); }
const OUTFEED = { x0: stX(8) + 0.7, x1: stX(8) + 7.5, z: ASM.z };
const PAL = { x: OUTFEED.x1 + 1.2 };
staticMerge(scene, g => {
  g.add(box(OUTFEED.x1 - OUTFEED.x0, 0.05, 0.26, M.grey, (OUTFEED.x0 + OUTFEED.x1) / 2, ASM.y - 0.03, ASM.z));
  for (let x = OUTFEED.x0; x < OUTFEED.x1; x += 0.08) g.add(rX(cyl(0.012, 0.012, 0.24, M.steel, 8, x, ASM.y - 0.005, ASM.z), Math.PI / 2));
  for (let x = OUTFEED.x0 + 0.3; x < OUTFEED.x1; x += 1.2) for (const z of [-0.12, 0.12]) g.add(box(0.04, ASM.y - 0.05, 0.04, M.grey, x, (ASM.y - 0.05) / 2, ASM.z + z));
  g.add(box(1.0, 0.55, 0.7, M.white, stX(8) + 2.2, ASM.y + 0.24, ASM.z), box(1.02, 0.08, 0.72, M.orange, stX(8) + 2.2, ASM.y + 0.5, ASM.z));   // shrink tunnel
  g.add(box(1.2, 0.14, 1.0, M.wood, PAL.x, 0.07, ASM.z));
  for (const sx of [-0.9, 0.9]) g.add(box(0.12, 2.4, 0.12, M.orange, PAL.x + sx, 1.2, ASM.z - 0.9), box(0.12, 2.4, 0.12, M.orange, PAL.x + sx, 1.2, ASM.z + 0.9));
  g.add(box(1.92, 0.12, 0.12, M.orange, PAL.x, 2.4, ASM.z - 0.9), box(1.92, 0.12, 0.12, M.orange, PAL.x, 2.4, ASM.z + 0.9));
});
const PALLET_STACK = new THREE.Mesh(boxGeo(1.2, 1, 1.0), BOXM); PALLET_STACK.position.set(PAL.x, 0.15, ASM.z); PALLET_STACK.scale.y = 0.001; scene.add(PALLET_STACK);
label('組立ライン #1（A10–A90・タクト 24 s）', V(stX(4), 2.6, ASM.z), '', 200);
label('シュリンク・出荷ケース・パレタイズ', V(PAL.x - 2, 2.0, ASM.z), 'small', 60);
// reserved floor for line #2 (two-shift / second line decision, see SCM capacity)
staticMerge(scene, g => { for (let x = 44; x <= 74; x += 3) g.add(box(1.5, 0.01, 0.1, M.yellow, x, 0.006, -5.5), box(1.5, 0.01, 0.1, M.yellow, x, 0.006, 5.5)); });
label('組立ライン #2 増設予定地（W47 能力超過対応・投資審議中）', V(59, 1.2, 0), 'small', 120);

// sub-assembly cells (wheel+tyre press, pinion press, CNC stays)
const PRESSES = [];
[['SA-WHL ホイール＋タイヤ圧入', 14], ['SA-MTR ピニオン圧入（モーター）', 24], ['SA-STY ステー CNC ルーター', 36]].forEach(([name, x], i) => {
  staticMerge(scene, g => { g.add(box(2.4, 0.9, 1.4, M.light, x, 0.45, 13.5), box(0.5, 1.4, 0.5, M.blue, x, 1.6, 13.0), box(0.9, 0.2, 0.6, M.blue, x, 2.25, 13.2)); });
  const ram = box(0.16, 0.4, 0.16, M.chrome, x, 1.6, 13.4); scene.add(ram); PRESSES.push({ ram, ph: i * 0.9 });
  const pg = new THREE.Group(); person(pg, x, 14.9, DEPT_COLOR.MFG, false, Math.PI); scene.add(mergeObj(pg));
  label(name, V(x, 2.7, 13.5), 'small', 30);
});
// receiving & incoming inspection, warehouse, shipping
staticMerge(scene, g => {
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) { const x = 11 + c * 5.5, z = 24 + r * 5.5; g.add(box(4.4, 0.08, 1.2, M.orange, x, 0.9, z), box(4.4, 0.08, 1.2, M.orange, x, 1.9, z)); for (const sx of [-2.1, 2.1]) g.add(box(0.08, 2.5, 1.2, M.blue, x + sx, 1.25, z)); for (let k = 0; k < 3; k++) g.add(box(1.1, 0.5, 0.9, std([0x8a6b4a, 0x5d646c, 0x2a5bd7][(r + c + k) % 3], 0, 0.7), x - 1.3 + k * 1.3, 1.2, z)); }
  g.add(box(3, 0.05, 1.2, M.light, 31, 0.9, 38), box(0.6, 0.4, 0.4, M.dark, 30.4, 1.1, 38));
  for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) { const x = 52 + c * 6, z = 24 + r * 4.4; for (const lv of [0.1, 1.6, 3.1]) g.add(box(5.2, 0.08, 1.3, M.orange, x, lv, z)); for (const sx of [-2.6, 2.6]) g.add(box(0.1, 4.2, 1.3, M.blue, x + sx, 2.1, z)); for (const lv of [0.1, 1.6, 3.1]) for (let k = 0; k < 2; k++) g.add(box(1.2, 1.0, 1.0, BOXM, x - 1.3 + k * 2.6, lv + 0.55, z)); }
  g.add(box(13, 3.6, 3.2, M.white, 91, 2.2, 30), box(3, 3, 3, M.blue, 83.5, 1.9, 30), box(0.2, 4, 4, M.grey, FAC.x1 + 0.1, 2, 30));
  for (const z of [28.2, 31.8]) for (const x of [86, 89, 95]) g.add(rX(cyl(0.55, 0.55, 0.4, M.rubber, 18, x, 0.55, z), Math.PI / 2));
});
const pgR = new THREE.Group(); person(pgR, 31, 38.9, DEPT_COLOR.QA, false, Math.PI); person(pgR, 76, 30, DEPT_COLOR.MFG, false, -Math.PI / 2); scene.add(mergeObj(pgR));
label('受入・受入検査（購入品）', V(20, 3.2, 31), '', 120, () => openDept('PUR'));
label('完成品倉庫', V(64, 5, 31), '', 140, () => openDept('SCM'));
label('出荷ドック', V(84, 4.2, 30), 'small', 80);

// AGVs
const AGVS = [];
[[[12, -24.5], [74, -24.5], [74, -20.5], [12, -20.5]], [[37, 2.2], [42, 2.2], [42, 20.5], [37, 20.5]], [[12, 20.5], [40, 20.5], [40, 9.5], [12, 9.5]]].forEach((route, ri) => {
  const path = new THREE.CurvePath(); for (let i = 0; i < route.length; i++) { const a = route[i], b = route[(i + 1) % route.length]; path.add(new THREE.LineCurve3(V(a[0], 0, a[1]), V(b[0], 0, b[1]))); }
  const len = path.getLength();
  for (let k = 0; k < 2; k++) { const m = staticMerge(scene, g => { g.add(box(1.2, 0.3, 0.8, M.white, 0, 0.2, 0), box(1.22, 0.05, 0.82, M.orange, 0, 0.34, 0), box(0.9, 0.4, 0.6, std(0x8a6b4a, 0, 0.7), 0, 0.57, 0)); }); AGVS.push({ m, path, len, off: k / 2 + ri * 0.13 }); }
});
// walkers
const WALKERS = [];
[[[-60, -20.5], [-10, -20.5]], [[-60, 21], [-10, 21]], [[-6, 0], [40, 8.5]], [[20, -19.5], [70, -19.5]], [[20, 8.5], [70, 8.5]], [[30, 19.5], [76, 19.5]]].forEach(([a, b], i) => {
  for (let k = 0; k < 2; k++) { const g = new THREE.Group(); person(g, 0, 0, [0x3987e5, 0xe34948, 0x1baf7a, 0xff8a3d, 0x6250d6, 0x2f6fb3][i], false); const m = mergeObj(g); scene.add(m); WALKERS.push({ m, a: V(a[0], 0, a[1]), b: V(b[0], 0, b[1]), sp: 1.1 + k * 0.2, off: k * 0.5 + i * 0.17 }); }
});
// department labels in the factory
label(`${DEPT.MFG.name}（${DEPT.MFG.hc}）`, V(24, 5.2, -4), 'dept', 220, () => openDept('MFG'));
label(`${DEPT.PE.name}・保全`, V(52, 2.6, 13.5), 'dept', 120, () => openDept('PE'));
