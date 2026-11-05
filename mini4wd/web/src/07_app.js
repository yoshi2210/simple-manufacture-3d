// ============================================================ track cars (one per variant, real-time speeds from the performance model)
const TRACK_CARS = VARIANTS.map((v, k) => {
  const c = buildCar(v, { merged: true }); c.root.scale.setScalar(MM); scene.add(c.root);
  return { v, c, lane0: k, s: k * TRACK.L / 3, best: null, last: null, lapStart: 0, laps: 0 };
});
function trackSpeed(v) { const p = perf(v.motor, v.gear, v.body, carMassKg(v)); return { vmax: p.vmax, avg: p.vmax * TT.corner_factor }; }
function drawBoard() {
  const cv = TRACK.board.image, g = cv.getContext('2d'), W = cv.width, H = cv.height;
  g.fillStyle = '#0b0e12'; g.fillRect(0, 0, W, H); g.fillStyle = '#ff8a3d'; g.fillRect(0, 0, W, 6);
  g.fillStyle = '#fff'; g.font = 'bold 30px sans-serif'; g.fillText('DV-06 TEST COURSE', 20, 48);
  g.font = '22px sans-serif'; g.fillStyle = '#909aa6'; g.fillText(`1 周 ${TRACK.L.toFixed(1)} m · 3 レーン`, 20, 82);
  TRACK_CARS.forEach((t, i) => {
    const y = 128 + i * 40; g.fillStyle = t.v.color; g.fillRect(20, y - 22, 14, 26);
    g.fillStyle = '#e8ecf1'; g.font = '24px sans-serif'; g.fillText(t.v.name.replace('KESTREL ', ''), 46, y);
    g.font = 'bold 24px monospace'; g.fillText(t.last ? `${t.last.toFixed(2)} s` : '--.-- s', 230, y);
    g.fillStyle = '#909aa6'; g.font = '20px monospace'; g.fillText(`L${t.laps}`, 400, y);
  });
  TRACK.board.needsUpdate = true;
}
drawBoard();

// ============================================================ camera presets
const CAMS = [
  ['全景', [2, 118, 108], [2, 0, 4]],
  ['設計事務所', [-43, 34, 40], [-43, 0, 0]],
  ['デザインレビュー室', [-68, 5.5, -20], [-68, 2, -40]],
  ['CAE 室', [-47, 5, -22], [-47, 1.8, -40]],
  ['テストコース', [-21.8, 1.1, -33.4], [-19.4, 0.08, -35]],
  ['走行追従カメラ', null, null, 'follow'],
  ['試作・品質ラボ', [-47, 20, 52], [-47, 0, 31]],
  ['射出成形', [43, 16, -12], [43, 1, -31]],
  ['SMT', [36, 7, -4], [36, 1, -13]],
  ['組立ライン', [stX(1.5), 1.75, 2.3], [stX(4), 0.85, -0.2]],
  ['ロボット接写', [stX(1) + 0.32, ASM.y + 0.42, ASM.z + 0.52], [stX(1), ASM.y + 0.05, ASM.z - 0.12]],
  ['EOL・梱包', [stX(7) - 0.4, 1.5, 1.5], [stX(8) + 1, 0.85, -0.1]],
  ['倉庫・出荷', [70, 22, 52], [70, 0, 28]],
];
const camsEl = document.getElementById('cams');
let tween = null;
camsEl.innerHTML = CAMS.map((c, i) => `<button data-i="${i}">${c[0]}</button>`).join('');
camsEl.querySelectorAll('button').forEach(b => b.onclick = () => goCam(+b.dataset.i));
let FOLLOW = null;
controls.addEventListener('start', () => { if (FOLLOW && !FOLLOW.auto) FOLLOW = null; });
function goCam(i, instant = false) {
  const [, p, t, mode] = CAMS[i]; camsEl.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === i));
  FOLLOW = null; if (mode === 'follow') { FOLLOW = { car: TRACK_CARS[(TRACK_CARS.indexOf(FOLLOW?.car) + 1) % TRACK_CARS.length] }; tween = null; return; }
  if (instant) { camera.position.set(...p); controls.target.set(...t); controls.update(); return; }
  tween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: V(...p), t1: V(...t), u: 0 };
}

// ============================================================ views
let VIEW = 'campus';
const tabs = document.getElementById('tabs'), hud = document.getElementById('hud'), ds = document.getElementById('ds');
const BUILT = {};
function setView(v) {
  VIEW = v; tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  const campus = v === 'campus', st = v === 'studio';
  hud.style.display = tickerEl.style.display = camsEl.style.display = campus ? '' : 'none';
  ds.classList.toggle('show', st); controls.enabled = campus; sCtl.enabled = st;
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('show', p.id === 'pg-' + v));
  modal.classList.remove('show');
  const build = { cfd: buildCFDPage, process: buildProcessPage, quality: buildQualityPage, scm: buildSCMPage, cost: buildCostPage, office: buildOfficePage }[v];
  if (build && (!BUILT[v] || v !== 'cfd')) { build(); BUILT[v] = true; }
  if (st) { renderCard(); }
  for (const l of labels) if (l.view !== v) l.el.style.display = 'none';
}
tabs.querySelectorAll('button').forEach(b => b.onclick = () => setView(b.dataset.view));

// ============================================================ simulation state & update
const SIM = { t: 40 * CYC + 1, frame: 0, done: 0, fails: 0 };
const PHASE = D.apqp.find(p => p.start <= NOW && p.end >= NOW) || D.apqp.at(-1);
document.getElementById('hScale').textContent = SCALE;
document.getElementById('hTakt').textContent = `${TAKT} s（デモ ${CYC.toFixed(1)} s）`;
document.getElementById('hPhase').textContent = `${PHASE.id} ${PHASE.name} · W${NOW}`;
const hash = n => { let x = (n * 2654435761) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; return (x >>> 0) / 4294967296; };
const BODY_PNS = new Set(D.bodies.map(b => b.pn));
const tmpV = V(0, 0, 0), tmpV2 = V(0, 0, 0);
const MOVE = 0.18;                                    // fraction of the cycle used for indexing
let lastPack = -1;

function updateLine(t) {
  const C = Math.floor(t / CYC), u = t / CYC - C, mv = smooth(u / MOVE), dwell = clamp((u - MOVE - 0.02) / (1 - MOVE - 0.04), 0, 1);
  for (const pool of Object.values(POOL)) for (const c of pool) c.root.visible = false;
  const used = Object.fromEntries(VARIANTS.map(v => [v.id, 0]));
  for (let i = 0; i < LINE_N; i++) {
    const s = C - i; if (s < 0) continue;
    const vid = MIX[s % MIX.length], car = POOL[vid][used[vid]++], body = BODY[VAR[vid].body].pn;
    car.root.visible = true;
    const x = u < MOVE ? stX(i - 1) + ASM.sp * mv : stX(i);
    car.root.position.set(x, ASM.y + 0.01, ASM.z); car.root.rotation.set(0, 0, 0);
    // which parts are on the car: stations < i, plus station i once the robot has placed (or the operator fitted) them
    const placed = u >= MOVE && dwell > 0.7;
    for (const [pn, g] of Object.entries(car.groups)) g.visible = false;
    for (let k = 0; k <= i; k++) {
      if (k === i && !placed) continue;
      for (let pn of STATION_PARTS[k]) { if (pn === 'VW-BDY-110') pn = body; const g = car.groups[pn]; if (g) g.visible = true; }
    }
    if (ASM.stations[i].id === 'A80' && u >= MOVE) car.root.position.y += Math.sin(dwell * Math.PI) * 0.004;   // dyno lift
    if (ASM.stations[i].id === 'A90' && dwell > 0.55) car.root.visible = false;                           // into the case
  }
  // robots
  for (const { rb, i } of ROBOTS) {
    const s = C - i, active = s >= 0 && u >= MOVE, ur = active ? dwell : 0;
    const place = tmpV2.set(stX(i), ASM.y + 0.058, ASM.z);
    pp(ur, rb.home, rb.pick, place, tmpV); rb.reach(tmpV);
    rb.carry.visible = active && ur > 0.24 && ur < 0.7;
  }
  // EOL
  const eolActive = C - 7 >= 0 && u >= MOVE;
  for (const r of EOL_ROLLERS) r.rotation.y += eolActive ? 0.9 : 0;
  // packed cases on the outfeed
  for (let k = 0; k < BOXES.length; k++) {
    const s = C - 8 - k; const b = BOXES[k];
    if (s < 0) { b.visible = false; continue; }
    const age = (t - (s + 8) * CYC - CYC * 0.6) / CYC;          // cycles since packing
    if (age < 0) { b.visible = false; continue; }
    const x = OUTFEED.x0 + age * 0.9; b.visible = x < OUTFEED.x1; b.position.set(Math.min(x, OUTFEED.x1), ASM.y + 0.045, ASM.z);
  }
  const done = Math.max(0, C - 8 + (u > 0.6 ? 1 : 0));
  if (done !== SIM.done) {
    for (let s = SIM.done; s < done; s++) { if (hash(s + 11) < 0.016) { SIM.fails++; event('MFG', `EOL NG S/N VX${String(s + 1).padStart(6, '0')} 待機電流 ${(26 + hash(s) * 4).toFixed(1)} µA > 25 µA → 修理工程（基板交換）`); } else if (s % 6 === 0) event('MFG', `完成 S/N VX${String(s + 1).padStart(6, '0')} ${VAR[MIX[s % MIX.length]].name}（EOL 最高速 ${(trackSpeed(VAR[MIX[s % MIX.length]]).vmax * 3.6 * (0.98 + hash(s) * 0.04)).toFixed(1)} km/h・合格）`); }
    SIM.done = done;
  }
  PALLET_STACK.scale.y = Math.max(0.001, (done % 48) / 48); PALLET_STACK.position.y = 0.15 + PALLET_STACK.scale.y / 2;
  // EOL screen (every cycle)
  if (C !== lastPack) {
    lastPack = C; const s = C - 7, cv = eolScreen.material.map.image, g = cv.getContext('2d');
    g.fillStyle = '#0b0e12'; g.fillRect(0, 0, cv.width, cv.height);
    if (s >= 0) {
      const v = VAR[MIX[s % MIX.length]], sp = trackSpeed(v).vmax * 3.6 * (0.98 + hash(s) * 0.04), ng = hash(s + 11) < 0.016;
      g.fillStyle = '#909aa6'; g.font = '16px monospace'; g.fillText(`EOL  VX${String(s + 1).padStart(6, '0')}`, 12, 26);
      g.fillStyle = '#e8ecf1'; g.font = 'bold 22px monospace'; g.fillText(`${sp.toFixed(1)} km/h`, 12, 60);
      g.font = '16px monospace'; g.fillText(`SS 120±10ms ${(118 + hash(s + 3) * 5).toFixed(0)}`, 12, 88); g.fillText(`Iq ${ng ? (26 + hash(s) * 4).toFixed(1) : (12 + hash(s + 5) * 6).toFixed(1)} uA`, 12, 112);
      g.fillStyle = ng ? '#ff5a52' : '#3ddc84'; g.font = 'bold 24px sans-serif'; g.fillText(ng ? 'NG' : 'OK', 190, 146);
    }
    eolScreen.material.map.needsUpdate = true;
  }
}
function updateMolding(t) {
  for (const m of MOLD) {
    const tt = t / m.cycle + m.phase, k = Math.floor(tt), u = tt - k;
    const close = u < 0.12 ? smooth(u / 0.12) : u < 0.72 ? 1 : u < 0.84 ? 1 - smooth((u - 0.72) / 0.12) : 0;
    const xo = m.x - m.L * 0.3, xc = m.x - m.L * 0.05 - 0.27; m.moving.position.x = lerp(xo, xc, close);
    m.lamp.material.emissive.setHex(u > 0.12 && u < 0.72 ? 0xfab219 : 0x33ff66);
    m.drops.forEach((d, j) => { const f = (u - 0.84 - j * 0.015) / 0.12; d.position.y = f > 0 && f < 1 ? lerp(1.35, 0.5, f * f) : -5; d.position.x = m.x - m.L * 0.23 + (j - 2.5) * 0.06; });
    m.fill.scale.y = 1 + (k % 40) * 4; m.fill.position.y = 0.45 + (k % 40) * 0.002;
  }
}
function updateSMT(t) {
  const n = D.smt.steps.length, per = D.smt.panel_cycle_s / SCALE, span = (SMT.x1 - SMT.x0) / n, travel = n * per;
  const k0 = Math.floor(t / per);
  SMT.boards.forEach((b, j) => {
    const k = k0 - j, age = t - k * per; b.visible = k >= 0 && age < travel;
    const st = Math.floor(age / per), f = age / per - st, x = SMT.x0 + span * (st + (f < 0.25 ? smooth(f / 0.25) : 1) - 0.5);
    b.position.set(x, SMT.y + 0.03, SMT.z);
  });
  SMT.reflow.material.emissiveIntensity = 1.2 + Math.sin(t * 3) * 0.3;
  SMT.aoi.material.emissiveIntensity = (t / per) % 1 > 0.3 && (t / per) % 1 < 0.6 ? 2.2 : 0;
}
function updateMisc(t, dt) {
  PRINTERS.forEach(p => { const u = (t * 0.4 + p.ph) % 30 / 30; p.head.position.set(p.px + Math.sin(t * 7 + p.ph) * 0.3, 0.84 + u * 0.06, p.pz + Math.cos(t * 5.3 + p.ph) * 0.3); p.part.scale.y = 1 + u * 60; p.part.position.y = 0.81 + u * 0.03; });
  PRESSES.forEach(p => { const u = (t / CYC + p.ph) % 1; p.ram.position.y = 1.6 - (u > 0.4 && u < 0.6 ? Math.sin((u - 0.4) / 0.2 * Math.PI) * 0.45 : 0); });
  for (const a of AGVS) { const u = mod(t * 1.2 / a.len + a.off, 1), p = a.path.getPointAt(u), tg = a.path.getTangentAt(u); a.m.position.set(p.x, 0, p.z); a.m.rotation.y = Math.atan2(-tg.z, tg.x); }
  for (const w of WALKERS) { const d = w.a.distanceTo(w.b), ph = mod(t * w.sp / d + w.off, 2), f = ph < 1 ? ph : 2 - ph; w.m.position.lerpVectors(w.a, w.b, f); w.m.rotation.y = ph < 1 ? 0 : Math.PI; }
  // test course
  let board = false;
  for (const tc of TRACK_CARS) {
    const sp = trackSpeed(tc.v), u0 = tc.s / TRACK.L; tc.s += sp.avg * dt * (0.97 + 0.06 * Math.sin(t * 0.7 + tc.lane0));
    const laps = Math.floor(tc.s / TRACK.L - 0.22) + 1, lane = (tc.lane0 + laps) % 3;
    const lp = TRACK.at(tc.s, lane);
    tc.c.root.position.set(lp.x, lp.y + 0.002, lp.z); tc.c.root.rotation.y = lp.yaw;
    if (Math.floor(tc.s / TRACK.L) > Math.floor(u0)) { tc.laps++; if (tc.lapStart) tc.last = t - tc.lapStart; tc.lapStart = t; board = true; }
  }
  if (board) drawBoard();
}

// ============================================================ labels
const projV = V(0, 0, 0);
function updateLabels(cam) {
  const W = innerWidth, H = innerHeight;
  for (const l of labels) {
    if (l.view !== VIEW || l.el.dataset.hide) { if (l.el.style.display !== 'none') l.el.style.display = 'none'; continue; }
    projV.copy(l.p); if (l.obj) projV.applyMatrix4(l.obj.matrixWorld);
    const d = cam.position.distanceTo(projV); projV.project(cam);
    const vis = projV.z < 1 && Math.abs(projV.x) < 1.1 && Math.abs(projV.y) < 1.1 && d < l.maxDist;
    if (l === cgLabel) { if (!cgMark.visible) { l.el.style.display = 'none'; continue; } }
    else if (sLabels.includes(l) && !S.env) { l.el.style.display = 'none'; continue; }
    l.el.style.display = vis ? '' : 'none';
    if (vis) l.el.style.transform = `translate(-50%,-100%) translate(${((projV.x + 1) / 2 * W).toFixed(1)}px,${((1 - projV.y) / 2 * H).toFixed(1)}px)`;
  }
}

// ============================================================ main loop
function hudUpdate() {
  document.getElementById('hDone').textContent = `${SIM.done.toLocaleString()} 台`;
  document.getElementById('hFpy').textContent = SIM.done ? `${((1 - SIM.fails / SIM.done) * 100).toFixed(1)}%` : '—';
  document.getElementById('hOee').textContent = `${(86.4 + Math.sin(SIM.t / 40) * 1.3).toFixed(1)}%`;
  document.getElementById('hFg').textContent = `${(BIZ.fg + SIM.done).toLocaleString()} 台`;
  document.getElementById('hBl').textContent = `${BIZ.backlog.toLocaleString()} 台`;
}
LBM.setBody('STD');
SIM.done = Math.max(0, Math.floor(SIM.t / CYC) - 8);
buildStudioCar(VARIANTS[0]);
goCam(0, true);
const clockT = new THREE.Clock();
let paused = false;
function frame() {
  const dt = Math.min(clockT.getDelta(), 0.1);
  if (!paused) SIM.t += dt;
  const t = SIM.t; SIM.frame++;
  bizTick(paused ? 0 : dt);
  cfdTick(VIEW === 'cfd' ? 10 : 2);
  if (VIEW === 'campus') {
    if (tween) { tween.u = Math.min(1, tween.u + dt / 1.4); const f = smooth(tween.u); camera.position.lerpVectors(tween.p0, tween.p1, f); controls.target.lerpVectors(tween.t0, tween.t1, f); if (tween.u >= 1) tween = null; }
    if (FOLLOW) {
      const r = FOLLOW.car.c.root, yaw = r.rotation.y, want = V(r.position.x - Math.cos(yaw) * 0.62, r.position.y + 0.3, r.position.z + Math.sin(yaw) * 0.62);
      camera.position.copy(want); controls.target.set(r.position.x + Math.cos(yaw) * 0.3, r.position.y + 0.02, r.position.z - Math.sin(yaw) * 0.3);
    }
    controls.update();
    updateLine(t); updateMolding(t); updateSMT(t); updateMisc(t, paused ? 0 : dt);
    if (SIM.frame % 3 === 0) renderDR(t);
    if (SIM.frame % 6 === 0) cfdScreen();
    if (SIM.frame % 15 === 0) hudUpdate();
    renderer.render(scene, camera); updateLabels(camera);
  } else if (VIEW === 'studio') {
    if (S.spin) turn.rotation.y += dt * 0.35;
    sCtl.update(); turn.updateMatrixWorld(true);
    renderer.render(studio, sCam); updateLabels(sCam);
  } else if (VIEW === 'cfd') { if (SIM.frame % 2 === 0) cfdDraw(); }
  requestAnimationFrame(frame);
}
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  for (const c of [camera, sCam]) { c.aspect = innerWidth / innerHeight; c.updateProjectionMatrix(); }
  fitStudio();
});
addEventListener('keydown', e => { if (e.key === 'Escape') modal.classList.remove('show'); });
// deep links: ?view=studio&cam=8&t=120
{
  const q = new URLSearchParams(location.search);
  if (q.get('t')) SIM.t = +q.get('t');
  if (q.get('cam')) goCam(+q.get('cam'), true);
  setView(q.get('view') || 'campus');
}
window.__sim = { camera, controls, POOL, TRACK_CARS, SIM, setView, goCam, LBM, CFDUI, COST, selectPart, S, applyExplode, updateCG, pause: v => paused = v, get view() { return VIEW; } };
event('MFG', `1 直 稼働開始：組立ライン A10–A90・成形 6 台・SMT（${PHASE.id} 量産試作ロット）`);
hudUpdate();
requestAnimationFrame(() => { document.getElementById('load').style.display = 'none'; frame(); });
