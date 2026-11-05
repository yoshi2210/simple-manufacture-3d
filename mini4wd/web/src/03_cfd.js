// ============================================================ 2D lattice-Boltzmann CFD (D2Q9, BGK) on the car side silhouette
// Car frame of reference: air enters from the left at U, the ground moves at U (rolling road). Forces by momentum exchange.
const LBM = (() => {
  const NX = 320, NY = 120, DX = 1.4;                          // cells, mm per cell
  const U = 0.08, TAU = 0.55, NU = (TAU - 0.5) / 3, OMEGA = 1 / TAU;
  const CX = [0, 1, 0, -1, 0, 1, -1, -1, 1], CY = [0, 0, 1, 0, -1, 1, 1, -1, -1], W = [4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36], OPP = [0, 3, 4, 1, 2, 7, 8, 5, 6];
  const N = NX * NY, f = new Float32Array(9 * N), ft = new Float32Array(9 * N), solid = new Uint8Array(N);
  const ux = new Float32Array(N), uy = new Float32Array(N), rho = new Float32Array(N);
  const X0 = 70;                                               // nose position (cells from inlet)
  let body = 'STD', steps = 0, fx = 0, fy = 0, cdAvg = 0, clAvg = 0, hCells = 1, lCells = 1;
  const results = {};
  const eq = (i, r, u, v) => { const cu = 3 * (CX[i] * u + CY[i] * v); return W[i] * r * (1 + cu + 0.5 * cu * cu - 1.5 * (u * u + v * v)); };
  function inside(xmm, ymm, bid) {
    const b = BODY[bid], kind = b.profile, top = TOP[kind];
    if (Math.abs(xmm) <= HALF_L && ymm >= DES.ground && ymm <= top(xmm)) return true;
    for (const wx of [DES.wheelbase / 2, -DES.wheelbase / 2]) if ((xmm - wx) ** 2 + (ymm - DES.tire_dia / 2) ** 2 <= (DES.tire_dia / 2) ** 2) return true;
    const cy = kind === 'low' ? 25.5 : CANOPY.y, ry = kind === 'low' ? 11 : CANOPY.ry;
    if (((xmm - CANOPY.x) / CANOPY.rx) ** 2 + ((ymm - cy) / ry) ** 2 <= 1) return true;
    if (b.wing) {
      if (Math.abs(xmm - WING.x) <= WING.chord / 2 && Math.abs(ymm - WING.y) <= 1.2) return true;   // wing (2D section)
      if (Math.abs(xmm - (WING.x + 2)) <= 2 && ymm >= 30 && ymm <= WING.y) return true;              // strut
    }
    return false;
  }
  function setBody(bid) {
    body = bid; solid.fill(0); let maxY = 0, minX = 1e9, maxX = -1e9;
    for (let j = 1; j < NY; j++) for (let i = 0; i < NX; i++) {
      const xmm = HALF_L - (i - X0 + 0.5) * DX, ymm = (j - 0.5) * DX;   // mirrored: nose faces the inlet
      if (inside(xmm, ymm, bid)) { solid[j * NX + i] = 1; maxY = Math.max(maxY, j); minX = Math.min(minX, i); maxX = Math.max(maxX, i); }
    }
    hCells = maxY; lCells = maxX - minX + 1; reset();
  }
  function reset() {
    for (let k = 0; k < N; k++) for (let i = 0; i < 9; i++) f[i * N + k] = eq(i, 1, solid[k] ? 0 : U, 0);
    steps = 0; cdAvg = 0; clAvg = 0;
  }
  function step() {
    // collide
    for (let k = 0; k < N; k++) {
      if (solid[k]) continue;
      let r = 0, u = 0, v = 0;
      for (let i = 0; i < 9; i++) { const fi = f[i * N + k]; r += fi; u += fi * CX[i]; v += fi * CY[i]; }
      u /= r; v /= r; rho[k] = r; ux[k] = u; uy[k] = v;
      for (let i = 0; i < 9; i++) { const o = i * N + k; f[o] += OMEGA * (eq(i, r, u, v) - f[o]); }
    }
    // stream (push) with bounce-back on the car, moving-wall bounce-back on the ground, free-slip top
    let Fx = 0, Fy = 0;
    for (let j = 0; j < NY; j++) for (let x = 0; x < NX; x++) {
      const k = j * NX + x; if (solid[k]) continue;
      for (let i = 0; i < 9; i++) {
        const fi = f[i * N + k]; let xn = x + CX[i], yn = j + CY[i];
        if (xn < 0 || xn >= NX) continue;                        // inlet / outlet set below
        if (yn >= NY) { ft[(i === 2 ? 4 : i === 5 ? 8 : 7) * N + (j * NX + xn)] = fi; continue; }   // free-slip top: mirror cy
        if (yn < 0) { ft[OPP[i] * N + k] = fi - 6 * W[i] * rho[k] * (CX[i] * U); continue; }        // moving ground
        const kn = yn * NX + xn;
        if (solid[kn]) { ft[OPP[i] * N + k] = fi; Fx += 2 * fi * CX[i]; Fy += 2 * fi * CY[i]; continue; }
        ft[i * N + kn] = fi;
      }
    }
    for (let j = 0; j < NY; j++) {                               // inlet equilibrium, outlet zero-gradient
      const ki = j * NX, ko = j * NX + NX - 1, kp = ko - 1;
      for (let i = 0; i < 9; i++) { ft[i * N + ki] = eq(i, 1, U, 0); ft[i * N + ko] = ft[i * N + kp]; }
    }
    f.set(ft); for (let k = 0; k < N; k++) if (solid[k]) for (let i = 0; i < 9; i++) f[i * N + k] = 0;
    steps++; fx = Fx; fy = Fy;
    const q = 0.5 * U * U, cd = Fx / (q * hCells), cl = Fy / (q * lCells), a = steps < 1500 ? 0.02 : 0.004;
    if (steps > 300) { cdAvg += (cd - cdAvg) * a; clAvg += (cl - clAvg) * a; }
    if (steps > 4000 && steps % 200 === 0) { results[body] = { cd: cdAvg, cl: clAvg, steps, h: hCells }; applyToPerf(); }
  }
  function applyToPerf() {
    const ref = results.STD; if (!ref) return;
    for (const [bid, r] of Object.entries(results)) CD[bid] = TT.cd * (r.cd * r.h) / (ref.cd * ref.h);   // drag-force ratio at equal dynamic pressure (frontal area held fixed in perf)
  }
  // ---- rendering
  const field = document.createElement('canvas'); field.width = NX; field.height = NY;
  const fctx = field.getContext('2d'), img = fctx.createImageData(NX, NY);
  const P = 700, px = new Float32Array(P), py = new Float32Array(P), pl = new Float32Array(P); const r0 = rng(7);
  for (let i = 0; i < P; i++) { px[i] = r0() * NX; py[i] = 1 + r0() * (NY - 2); pl[i] = r0() * 200; }
  function sample(arr, x, y) { const i = clamp(Math.floor(x), 0, NX - 2), j = clamp(Math.floor(y), 0, NY - 2), fx_ = x - i, fy_ = y - j, k = j * NX + i; return (arr[k] * (1 - fx_) + arr[k + 1] * fx_) * (1 - fy_) + (arr[k + NX] * (1 - fx_) + arr[k + NX + 1] * fx_) * fy_; }
  function draw(out, mode, color = '#d23b2f') {
    const d = img.data, sc = new THREE.Color(color);
    for (let j = 0; j < NY; j++) for (let x = 0; x < NX; x++) {
      const k = j * NX + x, o = ((NY - 1 - j) * NX + x) * 4;
      if (solid[k]) { d[o] = sc.r * 255; d[o + 1] = sc.g * 255; d[o + 2] = sc.b * 255; d[o + 3] = 255; continue; }
      let r, g, b;
      if (mode === 'vort') {   // diverging: blue (cw) – neutral grey – orange (ccw)
        const kx = clamp(x, 1, NX - 2), ky = clamp(j, 1, NY - 2), w = (uy[ky * NX + kx + 1] - uy[ky * NX + kx - 1] - ux[(ky + 1) * NX + kx] + ux[(ky - 1) * NX + kx]) / (2 * U) * 6;
        const t = clamp(w, -1, 1), m = [46, 52, 60];
        const c = t < 0 ? [57, 135, 229] : [235, 104, 52], a = Math.abs(t);
        r = lerp(m[0], c[0], a); g = lerp(m[1], c[1], a); b = lerp(m[2], c[2], a);
      } else {                 // sequential single hue: dark (still air) -> bright blue (fast)
        const s = clamp(Math.hypot(ux[k], uy[k]) / (U * 1.45), 0, 1);
        r = lerp(14, 186, s ** 1.2); g = lerp(18, 220, s); b = lerp(26, 255, s ** 0.8);
      }
      d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
    }
    fctx.putImageData(img, 0, 0);
    const c = out.getContext('2d'), W_ = out.width, H_ = out.height, sx = W_ / NX, sy = H_ / NY;
    c.imageSmoothingEnabled = true; c.drawImage(field, 0, 0, W_, H_);
    // tracers
    c.fillStyle = 'rgba(255,255,255,.75)';
    for (let i = 0; i < P; i++) {
      const u = sample(ux, px[i], py[i]), v = sample(uy, px[i], py[i]);
      px[i] += u * 9; py[i] += v * 9; pl[i] -= 1;
      if (px[i] >= NX - 1 || py[i] < 1 || py[i] > NY - 2 || pl[i] < 0 || solid[Math.floor(py[i]) * NX + Math.floor(px[i])]) { px[i] = pl[i] < 0 ? r0() * NX : r0() * 4; py[i] = 1 + r0() * (NY - 2); pl[i] = 200 + r0() * 400; }
      c.fillRect(px[i] * sx, H_ - py[i] * sy, Math.max(1.2, sx * 0.5), Math.max(1.2, sx * 0.5));
    }
    // moving ground
    c.fillStyle = '#3a4048'; c.fillRect(0, H_ - sy, W_, sy);
    c.fillStyle = '#6b737d'; const off = (steps * U * 9 * sx) % 24;
    for (let x = -24; x < W_ + 24; x += 24) c.fillRect(x + off, H_ - sy, 10, sy);
  }
  return {
    NX, NY, DX, U, NU, setBody, reset, step, draw, results,
    get steps() { return steps; }, get body() { return body; }, get cd() { return cdAvg; }, get cl() { return clAvg; },
    get re() { return U * lCells / NU; }, get reReal() { return 6.0 * DES.length / 1000 / 1.5e-5; },
  };
})();
