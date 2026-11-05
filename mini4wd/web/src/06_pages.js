// ============================================================ analysis helpers
function ap({ S, O, D: Dt }) {   // AIAG-VDA FMEA Action Priority (Handbook 2019, simplified table)
  if (S >= 9) { if (O >= 6) return 'H'; if (O >= 4) return Dt >= 2 ? 'H' : 'M'; if (O >= 2) return Dt >= 7 ? 'H' : Dt >= 5 ? 'M' : 'L'; return 'L'; }
  if (S >= 7) { if (O >= 8) return 'H'; if (O >= 6) return Dt >= 2 ? 'H' : 'M'; if (O >= 4) return Dt >= 7 ? 'H' : 'M'; if (O >= 2) return Dt >= 5 ? 'M' : 'L'; return 'L'; }
  if (S >= 4) { if (O >= 8) return Dt >= 5 ? 'H' : 'M'; if (O >= 6) return Dt >= 2 ? 'M' : 'L'; if (O >= 4) return Dt >= 7 ? 'M' : 'L'; return 'L'; }
  if (S >= 2) return O >= 8 && Dt >= 5 ? 'M' : 'L';
  return 'L';
}
const apTag = f => { const a = ap(f); return `<span class="st ${a === 'H' ? 's-bad' : a === 'M' ? 's-warn' : 's-ok'}">${a === 'H' ? 'H 高' : a === 'M' ? 'M 中' : 'L 低'}</span>`; };
function cpk(c) { const up = (c.usl - c.mean) / (3 * c.sd); return c.lsl == null ? up : Math.min(up, (c.mean - c.lsl) / (3 * c.sd)); }
const cpkCls = k => k >= 1.67 ? 'ok' : k >= 1.33 ? 'wa' : 'ng';
const NOW = D.meta.now_week;
const page = id => document.getElementById('pg-' + id);
const box_ = (title, body, cls = '', sub = '') => `<div class="box ${cls}"><h2>${title}${sub ? ` <small>${sub}</small>` : ''}</h2>${body}</div>`;
const kpi = (name, val, note = '', cls = '') => `<div class="kpi"><span>${name}</span><b class="${cls}">${val}</b><em>${note}</em></div>`;
const table = (head, rows) => `<table><tr>${head.map(h => `<th${h.startsWith('#') ? ' class="num"' : ''}>${h.replace(/^#/, '')}</th>`).join('')}</tr>${rows.join('')}</table>`;

// ============================================================ CFD page
const CFDUI = { mode: 'speed', run: true, queue: ['STD', 'AERO', 'LOW'], want: 'STD' };
function buildCFDPage() {
  page('cfd').innerHTML = `<h1>空力 CFD（2D 格子ボルツマン法・ライブ解析）</h1>
  <p class="lead">車体中心断面の 2 次元流れをブラウザ内で解いています（D2Q9 BGK、${LBM.NX}×${LBM.NY} 格子、1 格子 ${LBM.DX} mm、ムービンググラウンド）。3 種類のボディを自動で順に解析し、得られた相対 Cd を走行性能シミュレーションに反映します。</p>
  <div id="cfdWrap"><div class="box"><canvas id="cfdCanvas" width="960" height="360"></canvas>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px" id="cfdBtns">
      ${D.bodies.map(b => `<button data-b="${b.id}">${esc(b.name)}</button>`).join('')}
      <span style="flex:1"></span><button data-m="speed">速度場</button><button data-m="vort">渦度</button><button id="cfdRun">⏸ 一時停止</button><button id="cfdReset">↺ リセット</button></div>
    <div id="cfdLegend" style="margin-top:8px"></div></div>
    <div class="box"><h2>解析結果 <small id="cfdStat"></small></h2><div id="cfdTable"></div>
      <div class="sec">条件</div><div class="kv"><span>格子レイノルズ数</span><b id="cfdRe"></b><span>実車レイノルズ数（6 m/s）</span><b>${(LBM.reReal / 1e4).toFixed(1)}×10⁴</b><span>緩和時間 τ</span><b>0.55</b><span>流入速度（格子単位）</span><b>${LBM.U}</b></div>
      <p class="disc">2 次元・低レイノルズ数での定性的な比較です。絶対値は風洞（DV-12）と相関を取り、標準ボディ Cd ${TT.cd} を基準に<b>相対値のみ</b>を性能計算に使用しています。ボディ断面は車幅方向に一様と仮定しているため、ウィングの翼端渦やホイールハウス内の 3 次元流れは表現されません。</p></div></div>`;
  const P = page('cfd');
  P.querySelectorAll('[data-b]').forEach(b => b.onclick = () => { CFDUI.queue = []; CFDUI.want = b.dataset.b; LBM.setBody(b.dataset.b); paintCFDBtns(); });
  P.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { CFDUI.mode = b.dataset.m; paintCFDBtns(); });
  P.querySelector('#cfdRun').onclick = () => { CFDUI.run = !CFDUI.run; paintCFDBtns(); };
  P.querySelector('#cfdReset').onclick = () => LBM.reset();
  paintCFDBtns();
}
function paintCFDBtns() {
  const P = page('cfd');
  P.querySelectorAll('[data-b]').forEach(b => b.classList.toggle('on', b.dataset.b === LBM.body));
  P.querySelectorAll('[data-m]').forEach(b => b.classList.toggle('on', b.dataset.m === CFDUI.mode));
  P.querySelector('#cfdRun').textContent = CFDUI.run ? '⏸ 一時停止' : '▶ 再開';
  P.querySelector('#cfdLegend').innerHTML = CFDUI.mode === 'speed'
    ? `<div style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--mut)">流速 0<span style="flex:1;max-width:260px;height:8px;border-radius:4px;background:linear-gradient(90deg,#0e121a,#5a7fb0,#bad cff)"></span>1.45 U　<span>白点＝流跡トレーサー</span></div>`.replace('#bad cff', '#badcff')
    : `<div style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--mut)">時計回り<span style="flex:1;max-width:260px;height:8px;border-radius:4px;background:linear-gradient(90deg,#3987e5,#2e343c,#eb6834)"></span>反時計回り</div>`;
}
function cfdTick(nSteps) {
  if (!CFDUI.run) return;
  for (let i = 0; i < nSteps; i++) LBM.step();
  if (CFDUI.queue.length && LBM.steps >= 4400) {          // automatic sweep across the three bodies
    CFDUI.queue.shift();
    LBM.setBody(CFDUI.queue[0] || CFDUI.want);
    if (VIEW === 'cfd') paintCFDBtns();
  }
}
function cfdDraw() {
  const c = document.getElementById('cfdCanvas'), v = VAR[{ STD: 'KST-STD', AERO: 'KST-AERO', LOW: 'KST-LOW' }[LBM.body]];
  LBM.draw(c, CFDUI.mode, v.color);
  const g = c.getContext('2d'); g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(8, 8, 300, 46); g.fillStyle = '#fff'; g.font = '600 15px sans-serif';
  g.fillText(`${BODY[LBM.body].name}`, 16, 28); g.font = '13px sans-serif'; g.fillStyle = '#c9ced4'; g.fillText(`step ${LBM.steps}  Cd₂ᴅ ${LBM.cd.toFixed(3)}  Cl₂ᴅ ${LBM.cl.toFixed(3)}`, 16, 46);
  g.fillStyle = 'rgba(255,255,255,.7)'; g.font = '12px sans-serif'; g.fillText('→ 流入 U', 14, c.height - 20);
  document.getElementById('cfdRe').textContent = LBM.re.toFixed(0);
  document.getElementById('cfdStat').textContent = CFDUI.queue.length ? `自動スイープ中（${BODY[LBM.body].name.replace('KESTREL ', '')}）` : LBM.steps < 4000 ? '収束待ち' : '定常';
  const ref = LBM.results.STD;
  document.getElementById('cfdTable').innerHTML = table(['ボディ', '#Cd₂ᴅ', '#Cl₂ᴅ', '#抗力比', '#性能用 Cd', '#最高速'], D.bodies.map(b => {
    const r = LBM.results[b.id], v = VARIANTS.find(x => x.body === b.id), p = perf(v.motor, v.gear, b.id, carMassKg(v));
    return `<tr><td>${b.id}</td><td class="num">${r ? r.cd.toFixed(3) : '—'}</td><td class="num">${r ? r.cl.toFixed(3) : '—'}</td><td class="num">${r && ref ? (r.cd * r.h / (ref.cd * ref.h)).toFixed(3) : '—'}</td><td class="num">${(CD[b.id]).toFixed(3)}</td><td class="num">${p.kmh.toFixed(1)} km/h</td></tr>`;
  })) + `<p class="disc">Cd₂ᴅ・Cl₂ᴅ は各ボディの断面高さ・長さ基準。抗力比は同一動圧での抗力の比（STD＝1）で、これを性能計算の Cd に反映。Cl が正＝揚力、負＝ダウンフォース。値は 4,000 ステップ以降の移動平均。</p>`;
}
function cfdScreen() {   // campus CAE-room screen
  LBM.draw(cfdScreenTex.image, 'speed', VAR[{ STD: 'KST-STD', AERO: 'KST-AERO', LOW: 'KST-LOW' }[LBM.body]].color); cfdScreenTex.needsUpdate = true;
}

// ============================================================ process page (APQP / DR / PPAP / V-model / ECN)
function gantt() {
  const W = 1100, rowH = 30, top = 34, L = 150, ph = D.apqp, H = top + ph.length * rowH + 64, x = w => L + (w - 1) / 52 * (W - L - 16);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="min-width:760px" role="img" aria-label="APQP 日程">`;
  for (let w = 1; w <= 52; w += 4) s += `<line x1="${x(w)}" x2="${x(w)}" y1="${top - 6}" y2="${H - 50}" stroke="rgba(255,255,255,.06)"/><text x="${x(w)}" y="${top - 12}" font-size="10" fill="#909aa6" text-anchor="middle">W${w}</text>`;
  ph.forEach((p, i) => {
    const y = top + i * rowH, done = p.end < NOW, act = p.start <= NOW && p.end >= NOW;
    s += `<text x="8" y="${y + 19}" font-size="12" fill="#e8ecf1">${p.id} ${esc(p.name)}</text>`;
    s += `<rect x="${x(p.start)}" y="${y + 7}" width="${x(p.end + 1) - x(p.start)}" height="16" rx="4" fill="${done ? '#2b5f9e' : act ? '#3987e5' : 'rgba(57,135,229,.25)'}"/>`;
    if (act) s += `<rect x="${x(p.start)}" y="${y + 7}" width="${x(NOW) - x(p.start)}" height="16" rx="4" fill="#3987e5"/>`;
    const g = p.gate; if (g) { const gx = x(g.week + 1), passed = g.week < NOW; const right = gx > W - 170; s += `<path d="M${gx} ${y + 4} l9 11 -9 11 -9 -11z" fill="${passed ? '#3ddc84' : '#fab219'}" stroke="#0e1115"/><text x="${right ? gx - 12 : gx + 12}" text-anchor="${right ? 'end' : 'start'}" y="${y + 19}" font-size="10.5" fill="${passed ? '#7ee8ac' : '#ffd27a'}">${g.id} ${esc(g.name)}${passed ? ' ✓' : ''}</text>`; }
  });
  const yd = top + ph.length * rowH + 8;
  s += `<text x="8" y="${yd + 14}" font-size="12" fill="#e8ecf1">デザインレビュー</text>`;
  for (const d of D.design_reviews) { const dx = x(d.week + 0.5), ok = /完了/.test(d.status); s += `<circle cx="${dx}" cy="${yd + 10}" r="7" fill="${ok ? '#3ddc84' : '#fab219'}"/><text x="${dx}" y="${yd + 32}" font-size="10" fill="#c9ced4" text-anchor="middle">${d.id} W${d.week}</text>`; }
  s += `<line x1="${x(NOW + 0.5)}" x2="${x(NOW + 0.5)}" y1="${top - 8}" y2="${H - 12}" stroke="#ff5a52" stroke-width="2"/><text x="${x(NOW + 0.5) + 4}" y="${H - 14}" font-size="11" fill="#ff9a93">現在 W${NOW}</text>`;
  s += `</svg><div style="display:flex;gap:14px;font-size:10.5px;color:#909aa6;margin-top:4px;flex-wrap:wrap"><span><i style="display:inline-block;width:12px;height:8px;background:#2b5f9e;border-radius:2px"></i> 完了フェーズ</span><span><i style="display:inline-block;width:12px;height:8px;background:#3987e5;border-radius:2px"></i> 進行中</span><span><i style="display:inline-block;width:12px;height:8px;background:rgba(57,135,229,.25);border-radius:2px"></i> 計画</span><span style="color:#7ee8ac">◆ 通過ゲート</span><span style="color:#ffd27a">◆ 次ゲート</span></div>`;
  return s;
}
function vmodel() {
  const L = [['製品要求（PRD）', '完了'], ['システム設計（電装・FW）', '完了'], ['回路・SW アーキテクチャ', '完了'], ['詳細設計・コーディング', '完了']];
  const R2 = [['単体試験（MISRA 静的解析・UT）', '完了'], ['結合試験（HILS 相当ジグ）', '完了'], ['システム試験（DV-08〜11）', '実施中'], ['受入（PV・技適相当確認）', '予定']];
  const W = 640, H = 230, s0 = [];
  s0.push(`<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="V字モデル">`);
  const col = st => /完了/.test(st) ? '#3ddc84' : /実施中/.test(st) ? '#3987e5' : '#5d646c';
  L.forEach(([n, st], i) => { const x = 10 + i * 58, y = 14 + i * 46; s0.push(`<rect x="${x}" y="${y}" width="190" height="30" rx="6" fill="#20262f" stroke="${col(st)}"/><text x="${x + 10}" y="${y + 19}" font-size="11" fill="#e8ecf1">${n}</text>`); });
  R2.forEach(([n, st], i) => { const x = W - 200 - (3 - i) * 58, y = 14 + (3 - i) * 46; s0.push(`<rect x="${x}" y="${y}" width="190" height="30" rx="6" fill="#20262f" stroke="${col(st)}"/><text x="${x + 10}" y="${y + 19}" font-size="11" fill="#e8ecf1">${n}</text>`); });
  for (let i = 0; i < 4; i++) { const y = 29 + i * 46; s0.push(`<line x1="${200 + i * 58}" x2="${W - 200 - (3 - i) * 58}" y1="${y}" y2="${y}" stroke="rgba(255,255,255,.18)" stroke-dasharray="4 4"/>`); }
  s0.push(`<text x="${W / 2}" y="${H - 6}" font-size="10.5" fill="#909aa6" text-anchor="middle">左：設計（分解）　点線：検証の対応関係　右：検証（統合）　枠色 緑＝完了 / 青＝実施中 / 灰＝予定</text></svg>`);
  return s0.join('');
}
function buildProcessPage() {
  const nextGate = D.apqp.map(p => p.gate).filter(Boolean).find(g => g.week >= NOW);
  const ppapDone = D.ppap.filter(p => /承認/.test(p.status)).length;
  page('process').innerHTML = `<h1>開発プロセス（APQP・ステージゲート）</h1>
  <p class="lead">自動車業界の APQP（先行製品品質計画）を玩具スケールに適用。5 フェーズ・6 ゲート・5 回のデザインレビューで、企画から量産（SOP W46）までを管理しています。現在は <b>W${NOW}</b>、${nextGate ? `次のゲートは <b>${nextGate.id} ${esc(nextGate.name)}（W${nextGate.week}）</b>` : ''}。</p>
  <div class="kpis">${kpi('現在週', `W${NOW}`, '全 52 週')}${kpi('次ゲート', nextGate ? nextGate.id : '—', nextGate ? `W${nextGate.week} ${esc(nextGate.name)}` : '')}${kpi('PPAP 承認', `${ppapDone} / 18`, '要素', ppapDone < 18 ? 'wa' : 'ok')}${kpi('DR 完了', `${D.design_reviews.filter(d => /完了/.test(d.status)).length} / ${D.design_reviews.length}`, '')}${kpi('ECN 件数', D.ecn.length, `未完了 ${D.ecn.filter(e => !/完了/.test(e.status)).length}`)}</div>
  <div class="grid">
  ${box_('APQP 日程', `<div style="overflow-x:auto">${gantt()}</div>`, 'wide', '週次・赤線＝現在')}
  ${nextGate ? box_(`${nextGate.id} ${esc(nextGate.name)} 判定基準`, `<ul style="margin:0;padding-left:18px;line-height:1.8">${nextGate.criteria.map(c => `<li>${esc(c)}</li>`).join('')}</ul>`, '', `W${nextGate.week}`) : ''}
  ${box_('デザインレビュー', table(['DR', '週', '範囲', '判定'], D.design_reviews.map(d => `<tr><td>${d.id}<br>${stTag(d.status)}</td><td>W${d.week}</td><td>${esc(d.scope)}</td><td>${esc(d.decision)}</td></tr>`)))}
  ${box_('PPAP 18 要素', `<div class="scroll">${table(['#', '要素', '担当', '状態'], D.ppap.map(p => `<tr><td>${p.no}</td><td>${esc(p.name)}${p.note ? `<br><small style="color:var(--mut)">${esc(p.note)}</small>` : ''}</td><td>${esc(p.owner)}</td><td>${stTag(p.status)}</td></tr>`))}</div>`, '', '提出レベル 3 相当')}
  ${box_('電装・ファームウェア V 字プロセス', vmodel(), '', esc(D.firmware.aspice_target))}
  ${box_('設計変更（ECN）', table(['ECN', '件名', '理由', '影響', '処置', '状態'], D.ecn.map(e => `<tr><td>${e.id}<br><small style="color:var(--mut)">W${e.week}</small></td><td>${esc(e.title)}</td><td>${esc(e.reason)}</td><td>${e.affected.join('<br>')}</td><td>${esc(e.disposition)}</td><td>${stTag(e.status)}</td></tr>`)), 'wide')}
  ${box_('設計変更フロー', `<div class="vs">${D.value_streams.find(v => v.id === 'CHG').steps.map(s => `<div class="step"><b>${esc(s[0])}</b><small>${esc(DEPT[s[1]]?.name || s[1])} · ${esc(s[2])}</small><small>${esc(s[3])}</small></div>`).join('<span style="align-self:center;color:var(--mut)">→</span>')}</div>`, 'wide')}
  </div><p class="disc">${esc(D.meta.disclaimer)}</p>`;
}

// ============================================================ quality page
const SPC = { cp: D.control_plan.find(c => c.no === 'CP-04'), pts: [], r: rng(37) };
for (let i = 0; i < 40; i++) SPC.pts.push(spcPoint());
function spcPoint() { const c = SPC.cp, n = 5; let s = 0; for (let k = 0; k < n; k++) s += c.mean + gauss(SPC.r) * c.sd; return s / n; }
function spcChart() {
  const c = SPC.cp, W = 640, H = 210, L = 46, B = 20, T = 10, Rr = 70, se = c.sd / Math.sqrt(5), ucl = c.mean + 3 * se, lcl = c.mean - 3 * se;
  const lo = c.lsl - (c.usl - c.lsl) * 0.08, hi = c.usl + (c.usl - c.lsl) * 0.08, y = v => T + (hi - v) / (hi - lo) * (H - T - B), x = i => L + i / 39 * (W - L - Rr);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:900px;display:block" role="img" aria-label="X̄ 管理図">`;
  for (const [v, n, col, dash] of [[c.usl, 'USL', '#ff5a52', ''], [c.lsl, 'LSL', '#ff5a52', ''], [ucl, 'UCL', '#fab219', '5 4'], [lcl, 'LCL', '#fab219', '5 4'], [c.mean, 'CL', '#909aa6', '2 3']])
    s += `<line x1="${L}" x2="${W - Rr}" y1="${y(v)}" y2="${y(v)}" stroke="${col}" stroke-dasharray="${dash}"/><text x="${W - Rr + 6}" y="${y(v) + 4}" font-size="10" fill="${col}">${n} ${v.toFixed(3)}</text>`;
  s += `<polyline fill="none" stroke="#3987e5" stroke-width="1.6" points="${SPC.pts.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/>`;
  SPC.pts.forEach((v, i) => { const out = v > ucl || v < lcl; s += `<circle cx="${x(i)}" cy="${y(v)}" r="${out ? 4 : 2.6}" fill="${out ? '#ff5a52' : '#3987e5'}"/>`; });
  s += `<text x="${L - 6}" y="${T + 8}" font-size="10" fill="#909aa6" text-anchor="end">mm</text></svg>`;
  const k = cpk(c);
  return s + `<div class="kv" style="max-width:420px"><span>${c.no} ${esc(c.process)} ${esc(c.char)}（${esc(c.spec)}）</span><b></b><span>Cpk（工程能力）</span><b class="${cpkCls(k)}">${k.toFixed(2)}（目標 ≥ 1.67）</b><span>サンプリング</span><b>${esc(c.sample)} / ${esc(c.freq)}・X̄ 管理図</b></div>`;
}
function buildQualityPage() {
  const ks = D.control_plan.map(cpk), low = D.control_plan.filter(c => cpk(c) < 1.67);
  const fm = [...D.dfmea, ...D.pfmea], H = fm.filter(f => ap(f) === 'H').length;
  const d8 = D.eightd[0];
  page('quality').innerHTML = `<h1>品質保証（FMEA・コントロールプラン・SPC・DVP&R・8D）</h1>
  <p class="lead">AIAG-VDA FMEA のアクションプライオリティ（AP）を S/O/D から自動判定し、コントロールプランの工程能力指数 Cpk を実績平均・標準偏差から算出しています。管理図はライン稼働に合わせてライブ更新されます。</p>
  <div class="kpis">${kpi('FMEA 項目', fm.length, `AP=H ${H} 件`, H ? 'wa' : 'ok')}${kpi('管理特性', D.control_plan.length, `Cpk<1.67：${low.length} 件`, low.length ? 'wa' : 'ok')}${kpi('最小 Cpk', Math.min(...ks).toFixed(2), low.map(c => c.no).join(' '), cpkCls(Math.min(...ks)))}${kpi('DV 試験', `${D.dvpr.filter(d => /合格/.test(d.status)).length} / ${D.dvpr.length}`, '合格')}${kpi('8D 進行中', D.eightd.length, d8.id)}</div>
  <div class="grid">
  ${box_('ライブ SPC', `<div id="spcBox">${spcChart()}</div>`, 'wide', `${SPC.cp.no} — 8D-0037 対象特性`)}
  ${box_('DFMEA（設計）', `<div class="scroll">${table(['品目', '故障モード', '影響', '#S', '原因', '#O', '予防 / 検出', '#D', 'AP', '状態'], D.dfmea.map(f => `<tr><td>${esc(f.item)}</td><td>${esc(f.fm)}</td><td>${esc(f.effect)}</td><td class="num">${f.S}</td><td>${esc(f.cause)}</td><td class="num">${f.O}</td><td>${esc(f.prev)}<br><small style="color:var(--mut)">${esc(f.det)}</small></td><td class="num">${f.D}</td><td>${apTag(f)}</td><td>${stTag(f.status)}${f.action ? `<br><small style="color:var(--mut)">${esc(f.action)}</small>` : ''}</td></tr>`))}</div>`, 'wide')}
  ${box_('PFMEA（工程）', `<div class="scroll">${table(['工程', '故障モード', '影響', '#S', '原因', '#O', '予防 / 検出', '#D', 'AP', '処置'], D.pfmea.map(f => `<tr><td>${esc(f.item)}</td><td>${esc(f.fm)}</td><td>${esc(f.effect)}</td><td class="num">${f.S}</td><td>${esc(f.cause)}</td><td class="num">${f.O}</td><td>${esc(f.prev)}<br><small style="color:var(--mut)">${esc(f.det)}</small></td><td class="num">${f.D}</td><td>${apTag(f)}</td><td>${stTag(f.status)}${f.action ? `<br><small style="color:var(--mut)">${esc(f.action)}</small>` : ''}</td></tr>`))}</div>`, 'wide')}
  ${box_('コントロールプラン', `<div class="scroll">${table(['No', '工程', '特性', '区分', '規格', '#平均', '#σ', '#Cpk', '測定', '頻度', '異常時処置'], D.control_plan.map(c => { const k = cpk(c); return `<tr><td>${c.no}</td><td>${esc(c.process)}</td><td>${esc(c.char)}</td><td>${ccTags({ cc: [{ cls: c.cls }] })}</td><td>${esc(c.spec)}</td><td class="num">${c.mean}</td><td class="num">${c.sd}</td><td class="num ${cpkCls(k)}">${k.toFixed(2)}</td><td>${esc(c.method)}</td><td>${esc(c.sample)} / ${esc(c.freq)}</td><td>${esc(c.reaction)}</td></tr>`; }))}</div>`, 'wide', 'Cpk = min(USL−μ, μ−LSL) / 3σ')}
  ${box_('DVP&R（設計検証計画・報告）', `<div class="scroll">${table(['ID', '試験', '規格', '判定基準', '#n', '結果', '状態'], D.dvpr.map(d => `<tr><td>${d.id}</td><td>${esc(d.test)}</td><td>${esc(d.std)}</td><td>${esc(d.spec)}</td><td class="num">${d.n}</td><td>${esc(d.result)}</td><td>${stTag(d.status)}</td></tr>`))}</div>`, 'wide', '玩具安全（ST2016 / EN 71 / ASTM F963）・電波法・EMC を含む')}
  ${box_(`${d8.id} ${esc(d8.title)}`, `<div class="vs">${d8.steps.map(s => `<div class="step" style="border-color:${/完了/.test(s.s) ? 'rgba(61,220,132,.5)' : /実施中/.test(s.s) ? 'rgba(57,135,229,.7)' : 'var(--line)'}"><b>${esc(s.d)}</b>${stTag(s.s)}<small style="margin-top:3px">${esc(s.note)}</small></div>`).join('')}</div>`, 'wide', `起票 W${d8.opened_week}`)}
  ${box_('サプライヤー評価', table(['ID', '社名', '品目', '格付', '#納期遵守', '#不良 ppm', '監査'], D.suppliers.map(s => `<tr><td>${s.id}</td><td>${esc(s.name)}</td><td>${esc(s.category)}</td><td>${stTag(s.rating === 'A' ? '合格 A' : '要改善 ' + s.rating)}</td><td class="num ${s.otd < 97 ? 'wa' : ''}">${s.otd}%</td><td class="num ${s.ppm > 100 ? 'wa' : ''}">${s.ppm}</td><td>${esc(s.audit)}</td></tr>`)), 'wide')}
  </div>`;
}

// ============================================================ SCM page (MRP)
function mrp(item) {
  const M_ = D.mrp, n = M_.weeks, rows = { gross: [], sched: [], poh: [], por: [], rel: Array(n).fill(0) }, exc = [];
  let oh = item.on_hand;
  for (let w = 0; w < n; w++) {
    const gross = Math.round(M_.demand[w] * item.per * 1000) / 1000, sch = +(item.receipts[String(w)] || 0);
    oh += sch - gross; let por = 0;
    if (oh < item.safety) { por = Math.ceil((item.safety - oh) / item.lot) * item.lot; oh += por; const rw = w - item.lead_w; if (rw < 0) exc.push(`W${M_.start_week + w} 受入分は発注期限 W${M_.start_week + rw} を過ぎています → 緊急手配・分納交渉`); else rows.rel[rw] += por; }
    rows.gross.push(gross); rows.sched.push(sch); rows.poh.push(oh); rows.por.push(por);
  }
  rows.rel.forEach((q, w) => { if (q && w === 0) exc.push(`今週（W${M_.start_week}）発注が必要：${q.toLocaleString()}`); });
  return { rows, exc };
}
function capacityChart() {
  const M_ = D.mrp, m = D.meta, oee = 0.85, cap1 = Math.round(3600 / TAKT * m.shift_h * m.days_per_week * oee), cap2 = cap1 * 2;
  const W = 640, H = 220, L = 44, B = 26, T = 12, Rr = 10, max = Math.max(cap2, ...M_.demand) * 1.08, bw = (W - L - Rr) / M_.weeks;
  const y = v => H - B - v / max * (H - B - T);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:900px;display:block" role="img" aria-label="需要と能力">`;
  for (let v = 0; v <= max; v += 2000) s += `<line x1="${L}" x2="${W - Rr}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(255,255,255,.07)"/><text x="${L - 5}" y="${y(v) + 3}" font-size="9.5" fill="#909aa6" text-anchor="end">${v / 1000}k</text>`;
  M_.demand.forEach((d, i) => { const x = L + i * bw; s += `<rect x="${x + bw * 0.18}" y="${y(d)}" width="${bw * 0.64}" height="${y(0) - y(d)}" rx="3" fill="${d > cap1 ? '#fab219' : '#3987e5'}"/><text x="${x + bw / 2}" y="${H - B + 14}" font-size="9.5" fill="#909aa6" text-anchor="middle">W${M_.start_week + i}</text>`; });
  for (const [c, n, dash] of [[cap1, '1 直（OEE 85%）', '6 4'], [cap2, '2 直', '2 3']]) s += `<line x1="${L}" x2="${W - Rr}" y1="${y(c)}" y2="${y(c)}" stroke="#e8ecf1" stroke-dasharray="${dash}"/><text x="${L + 4}" y="${y(c) - 5}" font-size="10" fill="#e8ecf1" paint-order="stroke" stroke="#1b2129" stroke-width="3">${n} ${c.toLocaleString()} 台/週</text>`;
  s += `</svg><div style="display:flex;gap:14px;font-size:10.5px;color:#909aa6;flex-wrap:wrap"><span><i style="display:inline-block;width:10px;height:10px;background:#3987e5;border-radius:2px;vertical-align:-1px"></i> 需要（1 直で対応可）</span><span><i style="display:inline-block;width:10px;height:10px;background:#fab219;border-radius:2px;vertical-align:-1px"></i> 需要（1 直能力超過）</span><span>点線＝生産能力</span></div>`;
  return { svg: s, cap1, cap2 };
}
function buildSCMPage() {
  const M_ = D.mrp, cap = capacityChart(), tot = M_.demand.reduce((a, b) => a + b, 0);
  const res = M_.items.map(it => ({ it, ...mrp(it) })), nexc = res.reduce((s, r) => s + r.exc.length, 0);
  const hdr = ['', ...Array.from({ length: M_.weeks }, (_, i) => '#W' + (M_.start_week + i))];
  const fmt = v => v ? (Math.abs(v) < 10 ? v.toFixed(1) : Math.round(v).toLocaleString()) : '';
  page('scm').innerHTML = `<h1>SCM・MRP（資材所要量計画）</h1>
  <p class="lead">販売計画（W${M_.start_week}〜、SOP 後の立上げ）から品目別に総所要量を展開し、手持在庫・入荷予定・安全在庫・ロットサイズ・リードタイムを考慮して計画発注を算出しています（ブラウザ内で計算）。</p>
  <div class="kpis">${kpi('12 週需要', tot.toLocaleString() + ' 台', `構成 STD ${M_.mix['KST-STD'] * 100}% / AERO ${M_.mix['KST-AERO'] * 100}% / LOW ${M_.mix['KST-LOW'] * 100}%`)}${kpi('1 直能力', cap.cap1.toLocaleString(), '台/週（タクト 24 s・OEE 85%）')}${kpi('能力超過週', M_.demand.filter(d => d > cap.cap1).length, '2 直化で対応', 'wa')}${kpi('MRP 例外', nexc, '要手配', nexc ? 'ng' : 'ok')}</div>
  <div class="grid">${box_('需要と生産能力', cap.svg, 'wide')}
  ${box_('販売チャネル構成', table(['チャネル', '#構成比'], D.sales_channels.map(([n, r]) => `<tr><td>${esc(n)}</td><td class="num">${(r * 100).toFixed(0)}%</td></tr>`)))}
  ${box_('MRP 例外メッセージ', res.filter(r => r.exc.length).map(r => `<div style="margin-bottom:6px"><b>${esc(r.it.name)}</b>（${r.it.pn}・LT ${r.it.lead_w} 週）${r.exc.map(e => `<div class="ng" style="font-size:11.5px">⚠ ${esc(e)}</div>`).join('')}</div>`).join('') || '<span class="ok">例外なし</span>')}
  ${res.map(r => box_(`${esc(r.it.name)} <small>${r.it.pn}</small>`, `<div style="overflow-x:auto">${table(hdr, [['総所要量', r.rows.gross], ['入荷予定', r.rows.sched], ['予定在庫', r.rows.poh], ['計画受入', r.rows.por], ['計画発注', r.rows.rel]].map(([n, a]) => `<tr><td style="white-space:nowrap">${n}</td>${a.map(v => `<td class="num ${n === '予定在庫' && v < r.it.safety ? 'wa' : n === '計画発注' && v ? 'ok' : ''}">${fmt(v)}</td>`).join('')}</tr>`))}</div>`, 'wide', `在庫 ${r.it.on_hand.toLocaleString()}・安全在庫 ${r.it.safety.toLocaleString()}・ロット ${r.it.lot.toLocaleString()}・LT ${r.it.lead_w} 週・原単位 ${r.it.per}`)).join('')}
  </div>`;
}

// ============================================================ cost page
function buildCostPage() {
  const C = COST, cm = C.cm, parts = [['材料費（部品）', C.material, '#3987e5'], ['加工・組立労務費', C.labor, '#1baf7a'], ['製造間接費', C.overhead, '#8c6be8'], ['物流費', cm.logistics_per_unit, '#eda100'], ['保証引当', cm.warranty_per_unit, '#e87ba4']];
  const W = 640, H = 120, L = 10, max = Math.max(C.total, cm.target_cost) * 1.1, sx = v => v / max * (W - 2 * L);
  let x = L, bar = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="原価構成">`;
  for (const [n, v, c] of parts) { bar += `<rect x="${x}" y="20" width="${sx(v)}" height="34" fill="${c}"/>`; if (sx(v) > 46) bar += `<text x="${x + sx(v) / 2}" y="41" font-size="11" fill="#fff" text-anchor="middle">${yen(v)}</text>`; x += sx(v); }
  const after = L + sx(C.after);
  bar += `<rect x="${L}" y="66" width="${sx(C.after)}" height="18" fill="rgba(57,135,229,.35)"/><text x="${L + 6}" y="79" font-size="10.5" fill="#e8ecf1">VA/VE 後 ${yen(C.after)}</text>`;
  bar += `<line x1="${L + sx(cm.target_cost)}" x2="${L + sx(cm.target_cost)}" y1="10" y2="96" stroke="#ff5a52" stroke-width="2"/><text x="${L + sx(cm.target_cost)}" y="110" font-size="11" fill="#ff9a93" text-anchor="middle">目標原価 ${yen(cm.target_cost)}</text>`;
  bar += `<text x="${L + sx(C.total) + 4}" y="41" font-size="11" fill="#e8ecf1">${yen(C.total)}</text></svg><div style="display:flex;gap:12px;flex-wrap:wrap;font-size:10.5px;color:#909aa6">${parts.map(([n, , c]) => `<span><i style="display:inline-block;width:10px;height:10px;background:${c};border-radius:2px;vertical-align:-1px"></i> ${n}</span>`).join('')}</div>`;
  const gap = C.total - cm.target_cost;
  page('cost').innerHTML = `<h1>原価企画（積上げ原価 vs 目標原価）</h1>
  <p class="lead">E-BOM 23 行から部品原価を積み上げています。内製成形品は「樹脂（ランナー込）＋成形機チャージ（トン数別 ¥/h × サイクル ÷ 取り数）＋金型償却（型費 ÷ 型寿命 ÷ 取り数）」、基板は「実装部品＋SMT ラインチャージ ÷ 面付け」、購入品は見積単価。組立は「ライン＋作業者チャージ × タクト」。</p>
  <div class="kpis">${kpi('積上げ原価', yen(C.total), `目標 ${yen(cm.target_cost)}`, gap > 0 ? 'wa' : 'ok')}${kpi('目標差', (gap > 0 ? '+' : '') + yen(gap).replace('¥-', '−¥'), `${(gap / cm.target_cost * 100).toFixed(1)}%`, gap > 0 ? 'wa' : 'ok')}${kpi('VA/VE 効果', '−' + yen(C.vave), `${D.vave.length} 施策`)}${kpi('VA/VE 後', yen(C.after), C.after <= cm.target_cost ? '目標達成見込み' : '未達', C.after <= cm.target_cost ? 'ok' : 'ng')}</div>
  <div class="grid">${box_('原価構成（1 台あたり）', bar, 'wide')}
  ${box_('部品別原価（高い順）', `<div class="scroll">${table(['P/N', '品名', '区分', '#員数', '#単価', '#台当り', '#構成比'], C.lines.slice().sort((a, b) => b.ext - a.ext).map(l => `<tr><td>${l.p.pn}</td><td>${esc(l.p.name)}</td><td><span class="tag ${l.p.make_buy === '内製' ? 'in' : 'buy'}">${l.p.make_buy}</span></td><td class="num">${l.p.qty}</td><td class="num">¥${l.u.total.toFixed(1)}</td><td class="num">¥${l.ext.toFixed(1)}</td><td class="num">${(l.ext / C.material * 100).toFixed(1)}%</td></tr>`))}</div>`, 'wide')}
  ${box_('VA/VE 施策', table(['ID', '施策', '担当', '#効果', '状態'], D.vave.map(v => `<tr><td>${v.id}</td><td>${esc(v.title)}</td><td>${esc(v.owner)}</td><td class="num">−¥${v.saving}</td><td>${stTag(v.status)}</td></tr>`)), 'wide')}
  ${box_('バリエーション別 粗利', table(['仕様', '#希望小売（税込）', '#仕切（税抜・流通 40%）', '#原価', '#粗利', '#粗利率'], VARIANTS.map(v => { const n = C.net(v); return `<tr><td>${esc(v.name)}</td><td class="num">${yen(v.msrp)}</td><td class="num">${yen(n)}</td><td class="num">${yen(C.total)}</td><td class="num">${yen(n - C.total)}</td><td class="num">${((n - C.total) / n * 100).toFixed(0)}%</td></tr>`; })), 'wide', 'モーター・ボディ差分は標準原価に含めて簡略化')}
  </div>`;
}

// ============================================================ back office page + department modal
const WIP = Object.fromEntries(D.value_streams.map(v => [v.id, v.steps.map((_, i) => 2 + ((i * 7 + v.id.length) % 9))]));
function buildOfficePage() {
  const hc = D.departments.reduce((s, d) => s + d.hc, 0);
  page('office').innerHTML = `<h1>バックオフィス・組織（${hc} 名・${D.departments.length} 部門）</h1>
  <p class="lead">開発・製造だけでなく、経営企画・購買・SCM・営業・カスタマーサポート・経理・人事・法務（知財・商標・玩具安全法規）・情報システムまでを部門ごとのミッション・システム・KPI で再現。主要な業務プロセス（バリューストリーム）は部門横断のスイムレーンで、各ステップの仕掛り件数がライブで変化します。</p>
  <div class="kpis">${kpi('従業員', hc + ' 名', `社員総数 ${D.people.total}（工場間接含む）`)}${kpi('受注（本日）', '<span id="okOrders">0</span>', '件')}${kpi('発注書（本日）', '<span id="okPOs">0</span>', '件')}${kpi('出荷（本日）', '<span id="okShip">0</span>', 'ケース')}${kpi('問い合わせ', '<span id="okTix">0</span>', '件（I2R）')}</div>
  <div class="box" style="margin-bottom:12px"><h2>業務プロセス（バリューストリーム）<small>右上の数字＝仕掛り件数</small></h2><div id="vsList"></div></div>
  <div class="grid">${D.departments.map(d => `<div class="dept"><h3>${esc(d.name)} <span>${d.hc} 名</span></h3><p>${esc(d.mission)}</p><div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px">${d.systems.map(s => `<span class="tag buy">${esc(s)}</span>`).join('')}</div>${table(['KPI', '#実績', '#目標'], d.kpis.map(k => `<tr><td>${esc(k[0])}</td><td class="num">${esc(k[1])}</td><td class="num" style="color:var(--mut)">${esc(k[2])}</td></tr>`))}</div>`).join('')}</div>`;
  renderVS();
}
function renderVS() {
  const el = document.getElementById('vsList'); if (!el) return;
  el.innerHTML = D.value_streams.map(v => `<div class="sec">${v.id} ${esc(v.name)}</div><div class="vs">${v.steps.map((s, i) => `<div class="step"><span class="wip">${WIP[v.id][i]}</span><b>${esc(s[0])}</b><small>${esc(DEPT[s[1]]?.name || s[1])}</small><small>${esc(s[2])} · ${esc(s[3])}</small></div>`).join('<span style="align-self:center;color:var(--mut)">→</span>')}</div>`).join('');
}
const modal = document.getElementById('deptModal');
function openDept(id) {
  const d = DEPT[id], vs = D.value_streams.flatMap(v => v.steps.filter(s => s[1] === id).map(s => `${v.id}：${s[0]}`));
  modal.innerHTML = `<button style="float:right" id="dmX">✕</button><h2 style="margin:0 0 2px;font-size:16px">${esc(d.name)}</h2><div class="pn" style="color:var(--mut)">${d.hc} 名 · ${d.systems.map(esc).join(' / ')}</div>
  <p style="line-height:1.6">${esc(d.mission)}</p>${table(['KPI', '#実績', '#目標'], d.kpis.map(k => `<tr><td>${esc(k[0])}</td><td class="num">${esc(k[1])}</td><td class="num">${esc(k[2])}</td></tr>`))}
  ${vs.length ? `<div class="sec">担当する業務プロセス</div><div style="display:flex;flex-wrap:wrap;gap:4px">${vs.map(s => `<span class="tag in">${esc(s)}</span>`).join('')}</div>` : ''}`;
  modal.classList.add('show'); document.getElementById('dmX').onclick = () => modal.classList.remove('show');
}

// ============================================================ live business simulation (events → ticker, counters, WIP)
const BIZ = { orders: 0, pos: 0, ship: 0, tix: 0, fg: 1240, backlog: 3860, ncr: 0, next: 1.5, r: rng(101), log: [] };
const tickerEl = document.getElementById('ticker');
const EVC = { O2C: '#3987e5', PR2P: '#8c6be8', MFG: '#1baf7a', QA: '#ff5a52', CHG: '#fab219', I2R: '#56c2e6', FIN: '#9aa3ad' };
function event(kind, text) {
  BIZ.log.unshift([kind, text, clock()]); BIZ.log.length = Math.min(BIZ.log.length, 9);
  tickerEl.innerHTML = BIZ.log.map(([k, t, c]) => `<div><i style="background:${EVC[k]}"></i><em>${c}</em><span>[${k}] ${esc(t)}</span></div>`).join('');
}
function clock() { const m = 8 * 60 + 30 + Math.floor(SIM.t * SCALE / 60); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
const CUSTOMERS = ['ホビーランド横浜（架空）', 'トイパーク梅田（架空）', '模型のサカエ（架空）', 'VELO 公式 EC', 'Asia Hobby Dist.（架空）', 'カワセミ模型（架空）'];
function bizTick(dt) {
  BIZ.next -= dt; if (BIZ.next > 0) return;
  const r = BIZ.r(), pick = a => a[Math.floor(BIZ.r() * a.length)];
  BIZ.next = 2.2 + BIZ.r() * 2.8;
  if (r < 0.28) { const q = 12 * (1 + Math.floor(BIZ.r() * 20)), v = pick(VARIANTS); BIZ.orders++; BIZ.backlog += q; event('O2C', `受注 SO-${26000 + BIZ.orders * 7} ${pick(CUSTOMERS)} ${v.name} ×${q}（与信 OK・ATP 回答 W${NOW + 1 + Math.floor(BIZ.r() * 3)}）`); bump('O2C', 0); }
  else if (r < 0.44) { const it = pick(D.mrp.items); BIZ.pos++; event('PR2P', `発注 PO-${88100 + BIZ.pos} ${it.name} ×${it.lot.toLocaleString()} → ${it.pn.startsWith('U') ? SUP['SUP-04'].name : pick(D.suppliers).name}（承認ワークフロー完了）`); bump('PR2P', 2); }
  else if (r < 0.58) { const q = 48 + Math.floor(BIZ.r() * 6) * 24; BIZ.ship++; BIZ.fg = Math.max(0, BIZ.fg - q); BIZ.backlog = Math.max(0, BIZ.backlog - q); event('O2C', `出荷 DN-${51000 + BIZ.ship} ${q} 台 ${pick(CUSTOMERS)}（請求書 自動発行）`); bump('O2C', 3); }
  else if (r < 0.70) { SPC.pts.push(spcPoint()); SPC.pts.shift(); const v = SPC.pts.at(-1), c = SPC.cp; event('QA', `SPC ${c.no} ${c.char} X̄=${v.toFixed(3)} mm（n=5）${Math.abs(v - c.mean) > 3 * c.sd / Math.sqrt(5) ? ' ⚠ 管理限界外 → 8D-0037 に追記' : ' 管理状態'}`); if (VIEW === 'quality') document.getElementById('spcBox').innerHTML = spcChart(); }
  else if (r < 0.78) { BIZ.tix++; event('I2R', `問い合わせ CS-${7100 + BIZ.tix}「${pick(['アプリとの BLE 接続方法', 'ギヤ比の変更方法', 'ローラー交換部品の購入', '電池の推奨銘柄', 'FW 更新が途中で止まる'])}」→ ${pick(['FAQ で解決', '技術窓口へエスカレーション', '交換部品手配'])}`); bump('I2R', 1); }
  else if (r < 0.86) { event('PR2P', `受入検査 ${pick(['モーター 無負荷回転数 n=32 合格', 'ベアリング 外観・回転トルク n=50 合格', '車軸 軸径 n=20 合格（Cpk 1.73）', 'パッケージ 色差 ΔE 1.2 合格'])}`); bump('PR2P', 3); }
  else if (r < 0.92) { event('FIN', `${pick(['3-way match 照合完了 PO-88' + (100 + BIZ.pos) + '（差異 ¥0）', '月次原価差異 材料費 −0.8%（樹脂単価改定）', '売掛金 入金消込 18 件', '設備投資稟議 金型温調追加 ¥1.9M 承認待ち'])}`); bump('R2R', 1); }
  else { event('CHG', `${pick(['ECR-0219 タイヤ金型 温調回路追加 → CCB 審議', 'ECN-0431 図面改訂 Rev C 発行準備', 'DR5 資料：PPAP 18 要素中 15 承認'])}`); bump('CHG', 1); }
  for (const v of Object.values(WIP)) for (let i = 0; i < v.length; i++) if (BIZ.r() < 0.2) v[i] = Math.max(0, v[i] + (BIZ.r() < 0.5 ? -1 : 1));
  if (VIEW === 'office') { renderVS(); for (const [id, k] of [['okOrders', 'orders'], ['okPOs', 'pos'], ['okShip', 'ship'], ['okTix', 'tix']]) document.getElementById(id).textContent = BIZ[k]; }
}
function bump(vs, i) { if (WIP[vs]) WIP[vs][i] = (WIP[vs][i] || 0) + 1; }
