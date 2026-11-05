// ============================================================ VELO-32 KESTREL parametric model (millimetres; +x forward, +y up, +z left)
const DES = D.design;
const HALF_L = DES.length / 2;
// body side profile (top line) — shared by the 3D body and the CFD silhouette
const PROFILES = {
  std: [[79, 11], [70, 16], [55, 22], [35, 27], [15, 29.5], [-5, 30], [-30, 30.5], [-55, 30], [-70, 28], [-79, 24]],
  low: [[79, 9], [68, 13], [50, 18], [30, 22], [10, 24.5], [-10, 25], [-35, 25], [-60, 23.5], [-79, 20]],
};
const BODY_BASE = 8.0;                                    // skirt line
function hermite(pts) {                                   // monotone cubic (Fritsch–Carlson) on points sorted by x desc
  const P = [...pts].sort((a, b) => a[0] - b[0]), n = P.length, d = [], m = [];
  for (let i = 0; i < n - 1; i++) d.push((P[i + 1][1] - P[i][1]) / (P[i + 1][0] - P[i][0]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  return x => {
    if (x <= P[0][0]) return P[0][1]; if (x >= P[n - 1][0]) return P[n - 1][1];
    let i = 0; while (x > P[i + 1][0]) i++;
    const h = P[i + 1][0] - P[i][0], t = (x - P[i][0]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * P[i][1] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * P[i + 1][1] + (t3 - t2) * h * m[i + 1];
  };
}
const TOP = { std: hermite(PROFILES.std), low: hermite(PROFILES.low) };
function halfWidth(x) {
  const pod = Math.abs(x) < 27 ? (1 - (x / 27) ** 2) ** 2 : 0;
  const nose = x > 62 ? lerp(1, 0.78, (x - 62) / 17) : x < -70 ? lerp(1, 0.9, (-70 - x) / 9) : 1;
  return (33 + 11 * pod) * nose;
}
const CANOPY = { x: -2, y: 30, rx: 24, ry: 13.5, rz: 16 };
const WING = { x: -66, y: 40, chord: 22, span: 74 };

function bodyShellGeo(kind, band = null, lift = 0) {
  const top = TOP[kind], nx = 72, nz = 26, p = 3, pos = [], idx = [];
  const s0 = band ? -band : -1, s1 = band ? band : 1;
  for (let i = 0; i <= nx; i++) {
    const x = -HALF_L + (DES.length * i) / nx, hw = halfWidth(x), ty = top(x);
    for (let j = 0; j <= nz; j++) {
      const s = lerp(s0, s1, j / nz), y = BODY_BASE + (ty - BODY_BASE) * Math.pow(Math.max(0, 1 - Math.abs(s) ** p), 1 / p);
      pos.push(x, y + lift, s * hw);
    }
  }
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const a = i * (nz + 1) + j, b = a + nz + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  if (!band) {                                            // close nose and tail
    for (const i of [0, nx]) {
      const c = pos.length / 3; const x = -HALF_L + (DES.length * i) / nx; pos.push(x, BODY_BASE, 0);
      for (let j = 0; j < nz; j++) { const a = i * (nz + 1) + j; i === 0 ? idx.push(c, a, a + 1) : idx.push(c, a + 1, a); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function buildCar(variant, opt = {}) {
  const body = BODY[variant.body], kind = body.profile;
  const paint = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(variant.color), metalness: 0.15, roughness: 0.32, clearcoat: 0.8, side: THREE.DoubleSide });
  const root = new THREE.Group(), groups = {}, explode = {};
  const G = (pn, ex) => { const g = new THREE.Group(); g.name = pn; groups[pn] = g; explode[pn] = ex; root.add(g); return g; };
  const wz = DES.track / 2, wx = DES.wheelbase / 2, wr = DES.tire_dia / 2, ay = wr;
  // chassis
  let g = G('VW-CHS-100', V(0, 0, 0));
  g.add(box(124, 2, 62, M.dark, 0, 2.6, 0));
  for (const s of [-1, 1]) g.add(box(124, 12, 2, M.dark, 0, 9, s * 31));
  g.add(box(14, 6, 56, M.dark, 66, 5, 0), box(12, 6, 56, M.dark, -66, 5, 0));
  g.add(box(10, 4, 80, M.dark, 71, 5.5, 0), box(8, 4, 80, M.dark, -71, 5.5, 0));
  g.add(box(26, 16, 2, M.dark, -57, 10, 13), box(26, 16, 2, M.dark, -57, 10, -13), box(56, 1.5, 34, M.dark, 12, 16.2, 0));
  for (const x of [-wx, wx]) for (const s of [-1, 1]) g.add(box(8, 8, 3, M.dark, x, ay, s * 29.5));
  g = G('VW-TRM-101', V(0, -18, 0));
  for (const x of [12 - 26.5, 12 + 26.5]) g.add(box(1, 12, 26, M.steel, x, 9, 0));
  g = G('VW-SW-102', V(0, -28, 0)); g.add(box(8, 3, 6, M.black, 40, 1.8, 0), box(3, 2, 2, M.orange, 40, 0.6, 0));
  // drive train
  g = G('VW-SFT-170', V(0, 0, 0)); for (const x of [-wx, wx]) g.add(rX(cyl(1, 1, 92, M.steel, 10, x, ay, 0), Math.PI / 2));
  g = G('VW-BRG-171', V(0, 0, 0)); for (const x of [-wx, wx]) for (const s of [-1, 1]) g.add(rX(cyl(2.75, 2.75, 2.5, M.chrome, 16, x, ay, s * 31.5), Math.PI / 2));
  g = G('VW-GER-163', V(0, 16, 0)); g.add(rX(cyl(9, 9, 2, M.pom, 32, -wx, ay, -24), Math.PI / 2), rX(cyl(8, 8, 2, M.pom, 32, wx, ay, 20), Math.PI / 2));
  g = G('VW-GER-162', V(0, 20, 0)); g.add(rX(cyl(7, 7, 1.8, M.pom, 32, -wx, ay, 20), Math.PI / 2));
  g = G('VW-GER-161', V(-10, 22, 0)); g.add(rX(cyl(6.5, 6.5, 3, M.pom, 28, -52, 12, -24), Math.PI / 2));
  g = G('VW-PRP-172', V(0, 24, 0)); g.add(rZ(cyl(1, 1, 70, M.steel, 10, 0, 9, 20), Math.PI / 2), rZ(cyl(2.2, 2.2, 4, M.pom, 12, 34, 9, 20), Math.PI / 2), rZ(cyl(2.2, 2.2, 4, M.pom, 12, -34, 9, 20), Math.PI / 2));
  // motor (purchased) + pinion
  g = G('VW-MTR-180', V(-34, 26, 0));
  g.add(rX(cyl(10, 10, 22, M.steel, 24, -57, 12, 0), Math.PI / 2), rX(cyl(10.2, 10.2, 5, M.orange, 24, -57, 12, 3), Math.PI / 2), rX(cyl(8, 8, 3, M.black, 20, -57, 12, 12.5), Math.PI / 2),
    box(1.2, 4, 1, M.copper, -60, 12, 13.5), box(1.2, 4, 1, M.copper, -54, 12, 13.5), rX(cyl(0.8, 0.8, 10, M.steel, 8, -57, 12, -14), Math.PI / 2));
  g = G('VW-PIN-181', V(-38, 30, 0)); g.add(rX(cyl(2.6, 2.6, 4, M.brass, 12, -57, 12, -18), Math.PI / 2));
  // electronics
  g = G('VW-PCB-190', V(0, 38, 0));
  g.add(box(32, 0.8, 14, M.pcb, 34, 17.6, 0), box(7, 1, 7, M.chip, 30, 18.4, 0), box(3, 0.9, 2.6, M.chip, 40, 18.4, 3.5), box(3, 1, 3, M.chip, 41, 18.4, -3.5),
    box(2, 0.7, 2, M.chip, 24, 18.3, 4), box(3.2, 0.9, 1.6, M.light, 48, 18.4, 0), box(1, 0.6, 1, M.led, 22, 18.3, -4.5));
  for (let i = 0; i < 8; i++) g.add(box(1, 0.5, 0.5, M.light, 22 + i * 1.6, 18.2, -1.5 + (i % 2) * 3));
  g = G('VW-MAG-191', V(0, 18, -12)); g.add(rX(cyl(1, 1, 1, M.chrome, 10, -wx, ay + 5, -25.6), Math.PI / 2));
  // wheels & tyres
  const wheelPos = [[wx, wz], [wx, -wz], [-wx, wz], [-wx, -wz]];
  g = G('VW-TIR-130', V(0, 0, 0)); for (const [x, z] of wheelPos) g.add(rX(cyl(wr, wr, DES.tire_width, M.rubber, 32, x, ay, z), Math.PI / 2));
  g = G('VW-WHL-120', V(0, 0, 0));
  for (const [x, z] of wheelPos) {
    const sg = Math.sign(z), face = z + sg * (DES.tire_width / 2 + 0.2);
    g.add(rX(cyl(9, 9, 0.8, paintRim(variant), 28, x, ay, face), Math.PI / 2), rX(cyl(2.6, 2.6, 1.4, M.chrome, 12, x, ay, face + sg * 0.5), Math.PI / 2));
    for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2, s = box(1.4, 7, 0.6, M.black, x + Math.cos(a) * 5, ay + Math.sin(a) * 5, face + sg * 0.45); s.rotation.z = a + Math.PI / 2; g.add(s); }
  }
  // roller stays, rollers, bearings, screws
  const rzc = DES.width_rollers / 2 - DES.roller_dia / 2, rxc = HALF_L - DES.roller_dia / 2;
  g = G('VW-STF-150', V(26, 6, 0)); g.add(box(16, 1.5, 2 * rzc, M.frp, rxc - 2, 7.5, 0));
  g = G('VW-STR-151', V(-26, 6, 0)); g.add(box(16, 1.5, 2 * rzc, M.frp, -rxc + 2, 7.5, 0));
  g = G('VW-ROL-140', V(0, 10, 0)); for (const x of [rxc, -rxc]) for (const s of [-1, 1]) g.add(cyl(6.5, 6.5, 7, M.pom, 24, x, 4, s * rzc));
  g = G('VW-BRG-141', V(0, 16, 0)); for (const x of [rxc, -rxc]) for (const s of [-1, 1]) g.add(cyl(2.6, 2.6, 7.4, M.chrome, 12, x, 4, s * rzc));
  g = G('VW-SCR-195', V(0, 22, 0)); for (const x of [rxc - 2, -rxc + 2]) for (const z of [-30, 0, 30]) g.add(cyl(1.8, 1.8, 1.4, M.steel, 10, x, 9, z));
  // body (+ wing), decals
  g = G(body.pn, V(0, 62, 0));
  const shell = new THREE.Mesh(bodyShellGeo(kind), paint); shell.castShadow = true; g.add(shell);
  const can = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 18), M.canopy); can.scale.set(CANOPY.rx, CANOPY.ry, CANOPY.rz); can.position.set(CANOPY.x, kind === 'low' ? 25.5 : CANOPY.y, 0);
  if (kind === 'low') can.scale.y = 11; g.add(can);
  if (body.wing) {
    g.add(box(WING.chord, 1.6, WING.span, paint, WING.x, WING.y, 0));
    for (const s of [-1, 1]) { g.add(box(WING.chord + 4, 10, 1.2, paint, WING.x, WING.y - 3, s * (WING.span / 2))); g.add(box(4, 12, 2, M.black, WING.x + 2, WING.y - 7, s * 14)); }
  }
  g = G('VW-DCL-196', V(0, 70, 0));
  const stripe = new THREE.Mesh(bodyShellGeo(kind, 0.14, 0.35), M.white); g.add(stripe);
  for (const s of [-1, 1]) { const n = box(14, 7, 0.3, M.white, 10, 18, s * (halfWidth(10) + 0.4)); g.add(n); }
  // batteries (not in BOM — sold separately)
  g = G('BATTERY', V(0, 44, 0)); g.visible = !!opt.batteries;
  for (const s of [-1, 1]) { g.add(rZ(cyl(7.25, 7.25, 50.5, std(0x2a5bd7, 0.4, 0.4), 20, 12, 9, s * 7.5), Math.PI / 2)); g.add(rZ(cyl(2.5, 2.5, 1.5, M.steel, 10, 12 + 25.6, 9, s * 7.5), Math.PI / 2)); }
  // optionally merge each group (factory / track instances)
  if (opt.merged) for (const [pn, grp] of Object.entries(groups)) { const m = mergeObj(grp); m.name = pn; root.remove(grp); root.add(m); groups[pn] = m; }
  for (const [pn, grp] of Object.entries(groups)) grp.traverse(o => { if (o.isMesh) o.userData.pn = pn; });
  return { root, groups, explode, paint, wheels: [groups['VW-TIR-130'], groups['VW-WHL-120']] };
}
const RIM_MATS = {};
function paintRim(v) { return RIM_MATS[v.id] ||= std(v.id === 'KST-LOW' ? 0x222428 : 0xeeeeee, 0.3, 0.4); }

// ============================================================ performance model (DC motor + gear + rolling + aero)
const TT = D.test_track;
const CD = { STD: TT.cd, AERO: TT.cd * 1.14, LOW: TT.cd * 0.84 };       // replaced by CFD results when available
function carMassKg(variant) {
  let g = 0; for (const p of D.parts) if (!p.ship_only) g += p.weight_g * p.qty;
  const m = MOTOR[variant.motor]; g += m.mass_g - PART['VW-MTR-180'].weight_g + (BODY[variant.body].wing ? 1.6 : 0);
  return (g + DES.battery_mass_g * DES.battery_count) / 1000;
}
function perf(motorId, gearId, bodyId, massKg) {
  const mo = MOTOR[motorId], gr = GEAR[gearId].ratio, r = DES.tire_dia / 2000, w0 = mo.no_load_rpm * Math.PI / 30, ts = mo.stall_mNm / 1000;
  const cd = CD[bodyId] ?? TT.cd, A = TT.frontal_area_m2, m = massKg, g = 9.81;
  const force = v => { const wm = (v / r) * gr; return Math.max(0, ts * (1 - wm / w0)) * gr * TT.eta_drive / r - TT.crr * m * g - 0.5 * TT.rho * cd * A * v * v; };
  let v = 0, t = 0; const dt = 0.002, curve = [[0, 0]]; let t90 = null;
  const vNoLoad = w0 / gr * r;
  // terminal speed by bisection
  let lo = 0, hi = vNoLoad; for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; force(mid) > 0 ? lo = mid : hi = mid; }
  const vmax = lo;
  while (t < 3) { v += force(v) / m * dt; t += dt; if (t90 === null && v >= 0.9 * vmax) t90 = t; if (Math.round(t / dt) % 25 === 0) curve.push([t, v]); }
  const vAvg = vmax * TT.corner_factor;
  const wm = vmax / r * gr, amps = mo.no_load_A + (mo.stall_A - mo.no_load_A) * (1 - wm / w0);
  return { vmax, kmh: vmax * 3.6, t90: t90 ?? 3, lap: TT.lap_m / vAvg, amps, curve, cd, runtime_min: 2000 / 1000 / amps * 60 * 0.6 };
}
