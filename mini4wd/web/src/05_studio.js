// ============================================================ design studio (separate scene, units = mm)
const studio = new THREE.Scene();
studio.background = new THREE.Color(0x15191f); studio.environment = ENV;
studio.add(new THREE.HemisphereLight(0xffffff, 0x30343a, 0.9));
{ const k = new THREE.DirectionalLight(0xffffff, 2.2); k.position.set(160, 260, 140); k.castShadow = true; k.shadow.mapSize.set(2048, 2048); Object.assign(k.shadow.camera, { left: -160, right: 160, top: 160, bottom: -160, near: 50, far: 700 }); studio.add(k);
  const r = new THREE.DirectionalLight(0x9cc4ff, 0.9); r.position.set(-200, 120, -160); studio.add(r); }
const sCam = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 2, 6000); sCam.position.set(250, 170, 300);
const sCtl = new OrbitControls(sCam, canvas); sCtl.target.set(0, 22, 0); sCtl.enableDamping = true; sCtl.minDistance = 90; sCtl.maxDistance = 1400; sCtl.maxPolarAngle = Math.PI * 0.52; sCtl.enabled = false;
function fitStudio() {   // frame the car by the horizontal field of view (phones are narrow)
  const asp = innerWidth / innerHeight, narrow = asp < 0.9, hf = Math.atan(Math.tan(THREE.MathUtils.degToRad(sCam.fov / 2)) * asp);
  const d = Math.max(430, (narrow ? 125 : 150) / Math.tan(hf)), dir = V(0.55, 0.38, 0.66).normalize();
  sCtl.target.set(0, narrow ? -d * 0.09 : 22, 0); sCam.position.copy(sCtl.target).addScaledVector(dir, d); sCtl.update();
}
fitStudio();
{
  const disc = new THREE.Mesh(new THREE.CircleGeometry(420, 96), std(0x1d2229, 0.1, 0.8)); disc.rotation.x = -Math.PI / 2; disc.receiveShadow = true; studio.add(disc);
  const grid = new THREE.GridHelper(400, 40, 0x3a4250, 0x262c35); grid.position.y = 0.05; studio.add(grid);
  const ring = new THREE.Mesh(new THREE.RingGeometry(150, 153, 128), new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.5 })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.1; studio.add(ring);
}
const turn = new THREE.Group(); studio.add(turn);
let SCAR = null, curVar = VARIANTS[0], sel = null;
const selBox = new THREE.Box3Helper(new THREE.Box3(), 0xff8a3d); selBox.visible = false; studio.add(selBox);
// regulation envelope (165 × 105 × 70) with dimension labels
const R = D.regulation, DESN = D.design;
const envelope = new THREE.Group(); turn.add(envelope);
{
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(R.length_max, R.height_max, R.width_max)), new THREE.LineBasicMaterial({ color: 0x3ddc84, transparent: true, opacity: 0.7 }));
  e.position.y = R.height_max / 2; envelope.add(e);
  const f = new THREE.Mesh(new THREE.BoxGeometry(R.length_max, R.height_max, R.width_max), new THREE.MeshBasicMaterial({ color: 0x3ddc84, transparent: true, opacity: 0.035, depthWrite: false })); f.position.y = R.height_max / 2; envelope.add(f);
}
const sLabels = [];
function slabel(text, p, cls = '') { const el = document.createElement('div'); el.className = 'label ' + cls; el.textContent = text; document.body.appendChild(el); const o = { el, p, maxDist: 1e9, view: 'studio', obj: turn }; labels.push(o); sLabels.push(o); return o; }
slabel(`全長 ≤ ${R.length_max}（設計 ${DESN.length}）`, V(0, 0, R.width_max / 2 + 6), 'small');
slabel(`全幅 ≤ ${R.width_max}（ローラー ${DESN.width_rollers}）`, V(R.length_max / 2 + 4, 0, 0), 'small');
slabel(`全高 ≤ ${R.height_max}（設計 ${DESN.height}）`, V(R.length_max / 2, R.height_max, R.width_max / 2), 'small');
const cgMark = new THREE.Group(); turn.add(cgMark); cgMark.visible = false;
{ const s = new THREE.Mesh(new THREE.SphereGeometry(3.2, 20, 14), new THREE.MeshBasicMaterial({ color: 0xfab219, depthTest: false })); s.renderOrder = 10; cgMark.add(s);
  for (const ax of ['x', 'y', 'z']) { const len = { x: 190, y: 80, z: 120 }[ax], g = new THREE.BoxGeometry(ax === 'x' ? len : 0.5, ax === 'y' ? len : 0.5, ax === 'z' ? len : 0.5); const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xfab219, transparent: true, opacity: 0.55, depthTest: false })); m.renderOrder = 10; cgMark.add(m); } }
const cgLabel = slabel('', V(0, 0, 0), ''); cgLabel.el.style.display = 'none';

function computeCG(car) {
  const acc = V(0, 0, 0); let mass = 0;
  for (const p of D.parts) {
    const pn = p.pn === 'VW-BDY-110' ? BODY[curVar.body].pn : p.pn, g = car.groups[pn]; if (!g || p.ship_only) continue;
    const b = new THREE.Box3().setFromObject(g); if (b.isEmpty()) continue;
    const w = p.weight_g * p.qty; acc.addScaledVector(b.getCenter(V(0, 0, 0)), w); mass += w;
  }
  if (car.groups.BATTERY.visible) { const b = new THREE.Box3().setFromObject(car.groups.BATTERY), w = DESN.battery_mass_g * DESN.battery_count; acc.addScaledVector(b.getCenter(V(0, 0, 0)), w); mass += w; }
  return { p: acc.multiplyScalar(1 / mass), mass };
}
function buildStudioCar(v) {
  if (SCAR) turn.remove(SCAR.root);
  curVar = v; SCAR = buildCar(v, { batteries: S.bat }); turn.add(SCAR.root);
  SCAR.root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  applyExplode(); updateCG(); renderBOM(); renderCard();
}
const S = { explode: 0, env: true, cg: false, bat: false, spin: false };
function applyExplode() {
  const f = smooth(S.explode);
  for (const [pn, g] of Object.entries(SCAR.groups)) g.position.copy(SCAR.explode[pn] || V(0, 0, 0)).multiplyScalar(f * 1.25);
  if (sel) highlight(sel);
}
function updateCG() {
  const { p } = computeCG(SCAR);
  cgMark.position.copy(p); cgMark.visible = S.cg && S.explode < 0.02;
  cgLabel.p.copy(p).add(V(0, 8, 0)); cgLabel.el.textContent = `重心 前後 ${p.x >= 0 ? '+' : ''}${p.x.toFixed(1)} / 高さ ${p.y.toFixed(1)} mm`;
  cgLabel.el.style.display = cgMark.visible ? '' : 'none';
}
function highlight(pn) {
  const g = SCAR.groups[pn]; if (!g) { selBox.visible = false; return; }
  g.updateMatrixWorld(true); selBox.box.setFromObject(g); selBox.box.expandByScalar(1.2); selBox.visible = true;
}

// ---------------------------------------------------------------- part cost roll-up (identical to tests/test_company_data.py)
const COST = (() => {
  const mrate = D.molding_rate_yen_h;
  function molded(p) {
    const mat = p.weight_g * (1 + p.runner_ratio) / 1000 * p.resin_yen_kg;
    const ton = String(D.molding.find(m => m.id === p.machine).tonnage);
    const machine = mrate[ton] * p.cycle_s / 3600 / p.cavities;
    const mold = p.mold_cost ? p.mold_cost / p.mold_life_shots / p.cavities : 0;
    return { total: mat + machine + mold, mat, machine, mold };
  }
  function unit(p) {
    if (p.make_buy === '購入') return { total: p.unit_cost, buy: p.unit_cost };
    if (p.smt) { const comp = D.pcb_bom.reduce((s, c) => s + c.cost * c.qty, 0), proc = D.smt.line_rate_yen_h * D.smt.panel_cycle_s / 3600 / D.smt.panel_up; return { total: comp + proc, comp, proc }; }
    if ('machine_rate' in p) { const proc = p.machine_rate * p.cycle_s / 3600; return { total: p.sheet_yen + proc, sheet: p.sheet_yen, proc }; }
    return molded(p);
  }
  const lines = D.parts.map(p => ({ p, u: unit(p), ext: unit(p).total * p.qty }));
  const material = lines.reduce((s, l) => s + l.ext, 0), cm = D.cost_model, a = D.assembly;
  const labor = (a.line_rate_yen_h + a.operator_rate_yen_h * a.operators) * TAKT / 3600;
  const overhead = (material + labor) * cm.overhead_rate, total = material + labor + overhead + cm.logistics_per_unit + cm.warranty_per_unit;
  const vave = D.vave.reduce((s, v) => s + v.saving, 0);
  const net = v => v.msrp / (1 + cm.tax_rate) * (1 - cm.channel_margin);
  return { unit, lines, material, labor, overhead, total, vave, after: total - vave, net, cm, byPn: Object.fromEntries(lines.map(l => [l.p.pn, l])) };
})();

// ---------------------------------------------------------------- BOM list (left) and card (right)
const GROUP_NAME = { chassis: 'シャーシ系', drive: '駆動系', electronics: '電装系（独自基板）', wheels: '足回り', rollers: 'ローラー・ステー', body: 'ボディ', motor: 'モーター（購入品）', package: '梱包' };
const bomEl = document.getElementById('dsL'), cardEl = document.getElementById('dsR');
const ccTags = p => [...new Set((p.cc || []).map(c => c.cls))].map(c => `<span class="tag ${c.toLowerCase()}">${c}</span>`).join('');
const partFor = pn => PART[pn] || PART[Object.values(BODY).some(b => b.pn === pn) ? 'VW-BDY-110' : pn];
function renderBOM() {
  const groups = {};
  for (const p of D.parts) (groups[p.group] ||= []).push(p);
  const w = D.parts.filter(p => !p.ship_only).reduce((s, p) => s + p.weight_g * p.qty, 0);
  let h = `<div class="sec" style="margin-top:0">E-BOM ${D.parts.length} 行 · ${curVar.name}</div>`;
  for (const [g, list] of Object.entries(groups)) {
    h += `<div class="sec">${GROUP_NAME[g] || g}</div>`;
    for (const p of list) {
      const pn = p.pn === 'VW-BDY-110' ? BODY[curVar.body].pn : p.pn, name = p.pn === 'VW-BDY-110' ? BODY[curVar.body].name : p.name;
      h += `<div class="bomrow ${sel === pn ? 'sel' : ''}" data-pn="${pn}"><div>${esc(name)}<small>${pn} · ×${p.qty} · ${p.weight_g * p.qty} g</small></div><div>${ccTags(p)}</div><span class="tag ${p.make_buy === '内製' ? 'in' : 'buy'}">${p.make_buy}</span></div>`;
    }
  }
  h += `<div class="sec">合計（電池別）</div><div class="kv"><span>車体重量</span><b>${w.toFixed(1)} g</b><span>部品原価（材料費）</span><b>${yen(COST.material)}</b></div>`;
  bomEl.innerHTML = h;
  bomEl.querySelectorAll('.bomrow').forEach(r => r.onclick = () => selectPart(r.dataset.pn));
}
const statusCls = s => /不合格|NG|停止/.test(s) ? 's-bad' : /要処置|待ち|保留|条件|遅|検討中/.test(s) ? 's-warn' : /実施中|進行|評価中|審査中|対応中|準備|試行中|起票|提出済/.test(s) ? 's-run' : /完了|合格|承認|済|合意/.test(s) ? 's-ok' : 's-none';
const stTag = s => `<span class="st ${statusCls(s)}">${esc(s)}</span>`;
function selectPart(pn) {
  sel = pn === sel ? null : pn; if (sel) highlight(sel); else selBox.visible = false;
  renderBOM(); renderCard();
}
function renderCard() {
  if (!sel) { cardEl.innerHTML = productCard(); bindPerf(); return; }
  const p = partFor(sel), body = Object.values(BODY).find(b => b.pn === sel), l = COST.byPn[p.pn], u = l.u, sup = p.supplier ? SUP[p.supplier] : null;
  const st = D.assembly.stations.find(s => s.id === p.station);
  const ecn = D.ecn.filter(e => e.affected.some(a => a === p.pn || a === p.mold || a === sel));
  const df = D.dfmea.filter(f => f.pn === p.pn), cp = D.control_plan.filter(c => c.pn === p.pn);
  let costRows = '';
  if (u.buy != null) costRows = `<span>購入単価</span><b>${yen(u.buy)}</b>`;
  else if (u.comp != null) costRows = `<span>実装部品（${D.pcb_bom.length} 品目）</span><b>${yen(u.comp)}</b><span>SMT 加工費</span><b>¥${u.proc.toFixed(1)}</b>`;
  else if (u.sheet != null) costRows = `<span>素材（カーボン板）</span><b>${yen(u.sheet)}</b><span>CNC 加工費</span><b>¥${u.proc.toFixed(1)}</b>`;
  else costRows = `<span>樹脂（ランナー ${Math.round(p.runner_ratio * 100)}% 込）</span><b>¥${u.mat.toFixed(2)}</b><span>成形機 ${p.machine}（${p.cycle_s}s / ${p.cavities}個取り）</span><b>¥${u.machine.toFixed(2)}</b><span>金型償却 ${p.mold}</span><b>¥${u.mold.toFixed(2)}</b>`;
  cardEl.innerHTML = `<div class="card">
    <button id="dsBack" style="float:right">← 製品概要</button>
    <div class="pn">${sel} · Rev ${ecn.length ? String.fromCharCode(65 + ecn.length) : 'A'}</div><h2>${esc(body ? body.name : p.name)}</h2><div class="pn">${esc(p.en || '')}</div>
    <div style="margin:6px 0">${ccTags(p)} <span class="tag ${p.make_buy === '内製' ? 'in' : 'buy'}">${p.make_buy}</span></div>
    <div class="kv"><span>材質</span><b>${esc(p.material)}</b><span>工法</span><b>${esc(p.process)}</b><span>員数</span><b>${p.qty}</b><span>重量</span><b>${p.weight_g} g × ${p.qty}</b>
      ${sup ? `<span>サプライヤー</span><b>${esc(sup.name)}（${sup.rating}）</b>` : ''}${st ? `<span>組付工程</span><b>${st.id} ${esc(st.name)}</b>` : p.ship_only ? '<span>工程</span><b>A90 梱包</b>' : ''}</div>
    <div class="sec">単価内訳</div><div class="kv">${costRows}<span><b style="color:var(--txt)">単価 / 台あたり</b></span><b>¥${u.total.toFixed(1)} / ${yen(l.ext)}</b></div>
    ${p.cc?.length ? `<div class="sec">特殊特性（図面指示）</div><table><tr><th>特性</th><th>規格</th><th>区分</th></tr>${p.cc.map(c => `<tr><td>${esc(c.char)}</td><td>${esc(c.spec)} ${esc(c.tol)}</td><td>${ccTags({ cc: [c] })}</td></tr>`).join('')}</table>` : ''}
    ${cp.length ? `<div class="sec">コントロールプラン</div><table><tr><th>No</th><th>特性</th><th class="num">Cpk</th></tr>${cp.map(c => { const k = cpk(c); return `<tr><td>${c.no}</td><td>${esc(c.char)}<br><small style="color:var(--mut)">${esc(c.method)} ${esc(c.sample)}/${esc(c.freq)}</small></td><td class="num ${k >= 1.67 ? 'ok' : k >= 1.33 ? 'wa' : 'ng'}">${k.toFixed(2)}</td></tr>`; }).join('')}</table>` : ''}
    ${df.length ? `<div class="sec">DFMEA</div><table><tr><th>故障モード</th><th>S/O/D</th><th>AP</th></tr>${df.map(f => `<tr><td>${esc(f.fm)}</td><td>${f.S}/${f.O}/${f.D}</td><td>${apTag(f)}</td></tr>`).join('')}</table>` : ''}
    ${ecn.length ? `<div class="sec">設計変更（ECN）</div><table>${ecn.map(e => `<tr><td>${e.id}<br>${stTag(e.status)}</td><td>${esc(e.title)}</td></tr>`).join('')}</table>` : ''}
    ${sel === 'VW-PCB-190' ? pcbBlock() : ''}${sel === 'VW-MTR-180' ? motorBlock() : ''}
  </div>`;
  document.getElementById('dsBack').onclick = () => selectPart(sel);
}
function pcbBlock() {
  const fw = D.firmware;
  return `<div class="sec">基板 BOM（VX-Link）</div><table><tr><th>Ref</th><th>部品</th><th class="num">単価</th><th class="num">LT</th></tr>${D.pcb_bom.map(c => `<tr><td>${c.ref}</td><td>${esc(c.part)}<br><small style="color:var(--mut)">${esc(c.pkg)} ×${c.qty}</small></td><td class="num">¥${c.cost}</td><td class="num ${c.lead_w >= 10 ? 'wa' : ''}">${c.lead_w}w</td></tr>`).join('')}</table>
  <div class="sec">ファームウェア ${fw.id} v${fw.version}</div><ul style="margin:0;padding-left:16px;font-size:11.5px">${fw.features.map(f => `<li>${esc(f)}</li>`).join('')}</ul><div class="disc" style="margin-top:4px">${esc(fw.aspice_target)}</div>`;
}
function motorBlock() {
  return `<div class="sec">モーター（市販品・3 グレード）</div><table><tr><th>型式</th><th class="num">無負荷 rpm</th><th class="num">停動 mN·m</th><th class="num">単価</th></tr>${D.motors.map(m => `<tr><td>${esc(m.name)}</td><td class="num">${m.no_load_rpm.toLocaleString()}</td><td class="num">${m.stall_mNm}</td><td class="num">¥${m.cost}</td></tr>`).join('')}</table><div class="disc">モーターは自社製造せず、130 サイズ DC モーターをサプライヤーから購入（受入検査で無負荷回転数・電流を全ロット抜取）。</div>`;
}
// --- product overview card: regulation checks + performance simulator
let PERF = { motor: null, gear: null };
function regChecks() {
  const w = D.parts.filter(p => !p.ship_only).reduce((s, p) => s + p.weight_g * p.qty, 0) + (MOTOR[curVar.motor].mass_g - PART['VW-MTR-180'].weight_g) + (BODY[curVar.body].wing ? 1.6 : 0), wb = w + DESN.battery_mass_g * DESN.battery_count;
  const size = { x: DESN.length, y: BODY[curVar.body].wing ? Math.max(DESN.height, WING.y + 1) : DESN.height, z: DESN.width_rollers };
  return [
    ['全長', `${size.x.toFixed(1)} mm`, `≤ ${R.length_max}`, size.x <= R.length_max],
    ['全幅（ローラー含む）', `${size.z.toFixed(1)} mm`, `≤ ${R.width_max}`, size.z <= R.width_max],
    ['全高', `${size.y.toFixed(1)} mm`, `≤ ${R.height_max}`, size.y <= R.height_max],
    ['最低地上高', `${DESN.ground} mm`, `≥ ${R.ground_min}`, DESN.ground >= R.ground_min],
    ['タイヤ径', `${DESN.tire_dia} mm`, `${R.tire_dia[0]}–${R.tire_dia[1]}`, DESN.tire_dia >= R.tire_dia[0] && DESN.tire_dia <= R.tire_dia[1]],
    ['タイヤ幅', `${DESN.tire_width} mm`, `${R.tire_width[0]}–${R.tire_width[1]}`, DESN.tire_width >= R.tire_width[0] && DESN.tire_width <= R.tire_width[1]],
    ['重量（電池・モーター込）', `${wb.toFixed(1)} g`, `≥ ${R.weight_min_g}`, wb >= R.weight_min_g],
  ];
}
function productCard() {
  const v = curVar, chk = regChecks();
  PERF.motor ??= v.motor; PERF.gear ??= v.gear;
  return `<div class="card"><div class="pn">${esc(D.meta.product)} · シャーシ ${esc(D.meta.chassis)}</div><h2>${esc(v.name)}</h2>
  <div class="kv" style="margin-top:4px"><span>ボディ</span><b>${esc(BODY[v.body].name)}</b><span>標準モーター</span><b>${esc(MOTOR[v.motor].name)}</b><span>標準ギヤ</span><b>${esc(GEAR[v.gear].name)}</b><span>希望小売価格</span><b>${yen(v.msrp)}（税込）</b></div>
  <div class="sec">規則エンベロープ適合（設計値）</div><div class="chk">${chk.map(([n, val, lim, ok]) => `<span>${n}</span><em>${val} / ${lim}</em><b class="${ok ? 'ok' : 'ng'}">${ok ? '✓ 適合' : '✗ 不適合'}</b>`).join('')}</div>
  <div class="disc" style="margin-top:4px">${esc(R.source)} の寸法・重量枠をコース互換の設計制約として採用。</div>
  <div class="sec">走行性能シミュレーション</div>
  <div style="display:flex;gap:6px;flex-wrap:wrap"><select id="pfM">${D.motors.map(m => `<option value="${m.id}" ${m.id === PERF.motor ? 'selected' : ''}>${esc(m.name.replace('130サイズ DCモーター ', ''))}</option>`).join('')}</select>
  <select id="pfG">${D.gears.map(g => `<option value="${g.id}" ${g.id === PERF.gear ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></div>
  <div id="pfOut"></div>
  <div class="disc">DC モーター線形トルク特性 × 減速比 × 駆動効率 ${TT.eta_drive} − 転がり抵抗（Crr ${TT.crr}）− 空気抵抗（Cd は CFD 相対値で更新）。周回 ${TT.lap_m} m・コーナー係数 ${TT.corner_factor}。</div></div>`;
}
function bindPerf() {
  const run = () => {
    PERF.motor = document.getElementById('pfM').value; PERF.gear = document.getElementById('pfG').value;
    const m = carMassKg({ ...curVar, motor: PERF.motor }), cur = perf(PERF.motor, PERF.gear, curVar.body, m), base = perf(curVar.motor, curVar.gear, curVar.body, carMassKg(curVar));
    document.getElementById('pfOut').innerHTML = `<div class="kv" style="margin:6px 0"><span>最高速</span><b>${cur.kmh.toFixed(1)} km/h（${cur.vmax.toFixed(2)} m/s）</b><span>0→90% 到達</span><b>${cur.t90.toFixed(2)} s</b><span>周回タイム（${TT.lap_m} m）</span><b>${cur.lap.toFixed(2)} s</b><span>巡航電流</span><b>${cur.amps.toFixed(2)} A</b><span>連続走行（2000 mAh 相当）</span><b>${cur.runtime_min.toFixed(0)} 分</b><span>Cd（使用値）</span><b>${cur.cd.toFixed(3)}</b><span>車重</span><b>${(m * 1000).toFixed(1)} g</b></div>${speedChart([['選択構成', cur.curve, '#3987e5'], ['標準構成', base.curve, '#9aa3ad']])}`;
  };
  document.getElementById('pfM').onchange = run; document.getElementById('pfG').onchange = run; run();
}
function speedChart(series) {
  const W = 300, H = 150, L = 34, B = 24, T = 8, Rr = 8, vmax = Math.max(...series.flatMap(s => s[1].map(p => p[1]))) * 1.1, tmax = 3;
  const x = t => L + t / tmax * (W - L - Rr), y = v => H - B - v / vmax * (H - B - T);
  let g = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;margin-top:4px" role="img" aria-label="速度-時間">`;
  for (let v = 0; v <= vmax; v += vmax > 8 ? 2 : 1) g += `<line x1="${L}" x2="${W - Rr}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(255,255,255,.08)"/><text x="${L - 5}" y="${y(v) + 3}" font-size="9" fill="#909aa6" text-anchor="end">${v}</text>`;
  for (let t = 0; t <= tmax; t++) g += `<text x="${x(t)}" y="${H - B + 12}" font-size="9" fill="#909aa6" text-anchor="middle">${t}s</text>`;
  g += `<text x="4" y="${T + 4}" font-size="9" fill="#909aa6">m/s</text>`;
  for (const [, c, col] of series.slice().reverse()) g += `<polyline fill="none" stroke="${col}" stroke-width="2" points="${c.map(p => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ')}"/>`;
  g += `</svg><div style="display:flex;gap:12px;font-size:10.5px;color:#909aa6">${series.map(s => `<span><i style="display:inline-block;width:10px;height:3px;background:${s[2]};vertical-align:middle;margin-right:4px"></i>${s[0]}</span>`).join('')}</div>`;
  return g;
}

// ---------------------------------------------------------------- studio controls & picking
const varSel = document.getElementById('dsVariant');
varSel.innerHTML = VARIANTS.map(v => `<option value="${v.id}">${esc(v.name)}</option>`).join('');
varSel.onchange = () => { sel = null; selBox.visible = false; PERF = { motor: null, gear: null }; buildStudioCar(VAR[varSel.value]); };
document.getElementById('dsExplode').oninput = e => { S.explode = e.target.value / 100; applyExplode(); updateCG(); };
const tog = (id, k, fn) => { const b = document.getElementById(id); b.classList.toggle('on', S[k]); b.onclick = () => { S[k] = !S[k]; b.classList.toggle('on', S[k]); fn(); }; };
tog('dsEnv', 'env', () => { envelope.visible = S.env; sLabels.slice(0, 3).forEach(l => l.el.style.display = S.env ? '' : 'none'); });
tog('dsCg', 'cg', updateCG);
tog('dsBat', 'bat', () => { SCAR.groups.BATTERY.visible = S.bat; updateCG(); if (!sel) renderCard(); });
tog('dsSpin', 'spin', () => {});
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let downAt = null;
canvas.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', e => {
  if (VIEW !== 'studio' || !downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
  ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ndc, sCam);
  const hit = ray.intersectObject(SCAR.root, true).find(h => h.object.userData.pn && h.object.userData.pn !== 'BATTERY' && h.object.visible);
  if (hit) selectPart(hit.object.userData.pn);
});
// design-review LED wall: a turntable camera rendering the studio car into DR_RT
const drCam = new THREE.PerspectiveCamera(26, DR_RT.width / DR_RT.height, 2, 4000);
function renderDR(t) {
  const a = t * 0.25; drCam.position.set(Math.cos(a) * 360, 120, Math.sin(a) * 360); drCam.lookAt(0, 20, 0);
  const env = envelope.visible, cg = cgMark.visible, sb = selBox.visible; envelope.visible = cgMark.visible = selBox.visible = false;
  renderer.setRenderTarget(DR_RT); renderer.render(studio, drCam); renderer.setRenderTarget(null);
  envelope.visible = env; cgMark.visible = cg; selBox.visible = sb;
}
