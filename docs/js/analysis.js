// Sampling explorer, driver comparison, and the v1 findings.
import { fit, scale, C, MONO, line, label, niceTicks, yAxis, xAxis } from './charts.js';
import { fmtLap, signed } from './data.js';

const $ = (s, r = document) => r.querySelector(s);

export function initAnalysis(app) {
  initSampling(app);
  initCompare(app);
  initFixes(app);
}

// ================================================================= SAMPLING
function initSampling(app) {
  const cv = $('#sampleChart');
  let N = 10, clamp = true;
  const dec = $('#decim'), clampBtn = $('#clamp');
  const ord = (n) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
  dec.oninput = () => { N = +dec.value; $('#decimV').textContent = N === 1 ? 'sample' : ord(N); draw(); };
  clampBtn.onclick = () => { clamp = !clamp; clampBtn.setAttribute('aria-pressed', clamp); draw(); };
  $('#presetV1').onclick = () => { N = 10; dec.value = 10; clamp = true; clampBtn.setAttribute('aria-pressed', true); dec.oninput(); };
  $('#presetV2').onclick = () => { N = 1; dec.value = 1; clamp = false; clampBtn.setAttribute('aria-pressed', false); dec.oninput(); };

  function draw() {
    const d = app.A; if (!d) return;
    $('#sampleTitle').textContent = `Speed trace, ${d.abbr} fastest lap (lap ${d.lap})`;
    const raw = d.raw, t0 = raw.t[0];
    const T = raw.t.map((t) => t - t0), V = raw.v;
    const keep = []; for (let i = 0; i < T.length; i += N) keep.push(i);
    const vk = keep.map((i) => (clamp ? Math.min(255, Math.trunc(V[i])) : V[i]));
    const { ctx, w, h } = fit(cv);
    ctx.clearRect(0, 0, w, h);
    const m = { l: 40, r: 12, t: 12, b: 26 };
    const x = scale(0, T[T.length - 1], m.l, w - m.r), y = scale(0, 360, h - m.b, m.t);
    yAxis(ctx, y, m.l, w - m.r, [0, 100, 200, 255, 300], (v) => v);
    xAxis(ctx, x, h - m.b, niceTicks(0, T[T.length - 1], 8), (v) => `${v}s`);
    // 255 ceiling
    ctx.setLineDash([4, 4]); ctx.strokeStyle = C.brake; ctx.globalAlpha = clamp ? 0.9 : 0.35;
    ctx.beginPath(); ctx.moveTo(m.l, y(255)); ctx.lineTo(w - m.r, y(255)); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    label(ctx, '8-bit ceiling 255 km/h', w - m.r - 4, y(255) - 6, C.brake, 'right');
    // true signal
    ctx.globalAlpha = 0.5; line(ctx, T.map(x), V.map(y), C.speed, 1.2); ctx.globalAlpha = 1;
    ctx.fillStyle = C.speed; T.forEach((t, i) => { ctx.beginPath(); ctx.arc(x(t), y(V[i]), 1.6, 0, 7); ctx.fill(); });
    // what the receiver gets
    line(ctx, keep.map((i) => x(T[i])), vk.map(y), C.signal, 2.2);
    ctx.fillStyle = C.signal; keep.forEach((i, k) => { ctx.beginPath(); ctx.arc(x(T[i]), y(vk[k]), 3.2, 0, 7); ctx.fill(); });
    // hairpin marker
    const hp = app.race.corners.find((c) => /pingle/.test(c.name));
    if (hp) {
      const ti = d.t[Math.round(hp.d / app.race.ds)];
      label(ctx, 'hairpin', x(ti), y(40), C.faint, 'center');
    }
    // stats
    const trueTop = Math.max(...V), gotTop = Math.max(...vk);
    const hpT = hp ? d.t[Math.round(hp.d / app.race.ds)] : 0;
    const win = T.map((t, i) => [t, V[i]]).filter(([t]) => Math.abs(t - hpT) < 4);
    const trueMin = Math.min(...win.map((p) => p[1]));
    const winK = keep.filter((i) => Math.abs(T[i] - hpT) < 4).map((i) => (clamp ? Math.min(255, V[i]) : V[i]));
    const gotMin = winK.length ? Math.min(...winK) : NaN;
    let dist = 0; for (let k = 1; k < vk.length; k++) dist += ((vk[k] + vk[k - 1]) / 2 / 3.6) * 0.1;  // v1: 10 Hz receiver clock
    const cells = [
      ['Samples reaching the receiver', `${keep.length} of ${T.length}`, keep.length / T.length > 0.9 ? 'ok' : 'bad'],
      ['Top speed recorded', `${gotTop.toFixed(0)} / ${trueTop.toFixed(0)} km/h`, gotTop >= trueTop - 1 ? 'ok' : 'bad'],
      ['Hairpin minimum recorded', `${isFinite(gotMin) ? gotMin.toFixed(0) : 'none'} / ${trueMin.toFixed(0)} km/h`, Math.abs(gotMin - trueMin) < 3 ? 'ok' : 'bad'],
    ];
    $('#sampleStats').innerHTML = cells.map(([k, v, c]) => `<div class="cell ${c}"><span class="label">${k}</span><b>${v}</b></div>`).join('') +
      `<div class="cell ${N === 10 && clamp ? 'bad' : ''}" style="grid-column:1/-1"><span class="label">Lap length if the receiver integrates speed on its own 10 Hz clock (v1 method)</span><b>${(dist).toFixed(0)} m</b><span class="label">real lap: ${d.lapLen.toFixed(0)} m · v2 reads the car's LapDistance instead</span></div>`;
  }
  new ResizeObserver(draw).observe(cv);
  app.on('cars', draw);
}

// ================================================================= COMPARE
function initCompare(app) {
  const r = app.race, cv = $('#anChart'), ms = $('#msMap');
  const opts = [...r.drivers].sort((a, b) => a.pos - b.pos).map((d) => `<option value="${d.num}">${d.abbr} · ${fmtLap(d.lapTime)}</option>`).join('');
  $('#anA').innerHTML = opts; $('#anB').innerHTML = opts;
  $('#anA').onchange = (e) => { const d = r.byNum[e.target.value]; if (d === app.B) app.B = app.A; app.A = d; app.emit('cars'); };
  $('#anB').onchange = (e) => { const d = r.byNum[e.target.value]; if (d === app.A) app.A = app.B; app.B = d; app.emit('cars'); };
  $('#anSwap').onclick = () => { [app.A, app.B] = [app.B, app.A]; app.emit('cars'); };
  let hoverD = null, cmp = null;

  function compute() {
    const A = app.A, B = app.B, n = Math.min(A.n, B.n), ds = r.ds;
    const delta = new Float32Array(n);
    for (let i = 0; i < n; i++) delta[i] = B.t[i] - A.t[i];
    const K = 25, edges = Array.from({ length: K + 1 }, (_, k) => Math.round((k / K) * (n - 1)));
    const win = edges.slice(0, -1).map((e0, k) => ((B.t[edges[k + 1]] - B.t[e0]) < (A.t[edges[k + 1]] - A.t[e0]) ? 1 : 0));
    const corners = r.corners.map((c) => {
      const i = Math.round(c.d / ds), lo = Math.max(0, i - 25), hi = Math.min(n - 1, i + 10);
      const brakeAt = (d) => { for (let j = lo; j <= i; j++) if (d.brk[j] && !d.brk[j - 1]) return j * ds; return null; };
      const minV = (d) => { let m = 1e9; for (let j = i - 8; j <= i + 8; j++) m = Math.min(m, d.v[Math.max(0, Math.min(n - 1, j))]); return m; };
      const w0 = Math.max(0, i - 20), w1 = Math.min(n - 1, i + 15);
      const tA = A.t[w1] - A.t[w0], tB = B.t[w1] - B.t[w0];
      return { c, bA: brakeAt(A), bB: brakeAt(B), vA: minV(A), vB: minV(B), dt: tB - tA };
    });
    cmp = { A, B, n, delta, edges, win, corners };
  }

  function draw() {
    if (!cmp) return;
    const { A, B, n, delta } = cmp, ds = r.ds;
    const { ctx, w, h } = fit(cv);
    ctx.clearRect(0, 0, w, h);
    const m = { l: 44, r: 10, t: 8, b: 24 };
    const bands = [['Speed km/h', 0.34], ['Throttle %', 0.15], ['Brake', 0.07], ['Gear', 0.14], ['Δt s', 0.2]];
    const gap = 12, total = h - m.t - m.b - gap * (bands.length - 1);
    const x = scale(0, (n - 1) * ds, m.l, w - m.r);
    let top = m.t;
    const X = Array.from({ length: n }, (_, i) => x(i * ds));
    // corner guides
    for (const c of r.corners) { ctx.fillStyle = 'rgba(255,255,255,.03)'; ctx.fillRect(x(c.d - 120), m.t, x(c.d + 60) - x(c.d - 120), h - m.t - m.b); }
    bands.forEach(([name, frac], bi) => {
      const bh = total * frac, y0 = top, y1 = top + bh;
      let y;
      if (bi === 0) { y = scale(40, 350, y1, y0); yAxis(ctx, y, m.l, w - m.r, [100, 200, 300]); line(ctx, X, Array.from(A.v.subarray(0, n), y), C.a, 1.6); line(ctx, X, Array.from(B.v.subarray(0, n), y), C.b, 1.3); }
      if (bi === 1) { y = scale(0, 100, y1, y0); yAxis(ctx, y, m.l, w - m.r, [0, 100]); line(ctx, X, Array.from(A.thr.subarray(0, n), y), C.a, 1.3); line(ctx, X, Array.from(B.thr.subarray(0, n), y), C.b, 1.1); }
      if (bi === 2) {
        const mid = (y0 + y1) / 2;
        for (let i = 0; i < n - 1; i++) {
          if (A.brk[i]) { ctx.fillStyle = C.a; ctx.fillRect(X[i], y0, X[i + 1] - X[i] + 0.5, mid - y0 - 1); }
          if (B.brk[i]) { ctx.fillStyle = C.b; ctx.fillRect(X[i], mid + 1, X[i + 1] - X[i] + 0.5, y1 - mid - 1); }
        }
      }
      if (bi === 3) { y = scale(0, 8.5, y1, y0); yAxis(ctx, y, m.l, w - m.r, [2, 4, 6, 8]); line(ctx, X, Array.from(A.g.subarray(0, n), y), C.a, 1.3, true); line(ctx, X, Array.from(B.g.subarray(0, n), y), C.b, 1.1, true); }
      if (bi === 4) {
        let lo = 0, hi = 0; for (const v of delta) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
        const pad = Math.max(0.05, (hi - lo) * 0.12); y = scale(lo - pad, hi + pad, y1, y0);
        yAxis(ctx, y, m.l, w - m.r, niceTicks(lo - pad, hi + pad, 4), (v) => v.toFixed(2));
        ctx.strokeStyle = C.axis; ctx.beginPath(); ctx.moveTo(m.l, y(0)); ctx.lineTo(w - m.r, y(0)); ctx.stroke();
        ctx.fillStyle = 'rgba(79,141,255,.12)'; ctx.beginPath(); ctx.moveTo(X[0], y(0)); for (let i = 0; i < n; i++) ctx.lineTo(X[i], y(Math.max(0, delta[i]))); ctx.lineTo(X[n - 1], y(0)); ctx.fill();
        ctx.fillStyle = 'rgba(255,82,82,.12)'; ctx.beginPath(); ctx.moveTo(X[0], y(0)); for (let i = 0; i < n; i++) ctx.lineTo(X[i], y(Math.min(0, delta[i]))); ctx.lineTo(X[n - 1], y(0)); ctx.fill();
        line(ctx, X, Array.from(delta, y), C.fg, 1.5);
      }
      label(ctx, name, m.l + 4, y0 + 11, C.text);
      if (bi === 4) { label(ctx, `${B.abbr} behind ↑`, w - m.r - 4, y0 + 11, C.a, 'right'); label(ctx, `${B.abbr} ahead ↓`, w - m.r - 4, y1 - 4, C.b, 'right'); }
      cmp[`y${bi}`] = { y0, y1, y };
      top = y1 + gap;
    });
    xAxis(ctx, x, h - m.b, niceTicks(0, (n - 1) * ds, 8), (v) => `${v} m`);
    for (const c of r.corners) label(ctx, c.label, x(c.d - 30), cmp.y0.y1 - 6, C.faint, 'center');
    // crosshair
    if (hoverD !== null) {
      const i = Math.min(n - 1, Math.max(0, Math.round(hoverD / ds))), px = X[i];
      ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.beginPath(); ctx.moveTo(px, m.t); ctx.lineTo(px, h - m.b); ctx.stroke();
      const txt = [`${(i * ds).toFixed(0)} m`, `${A.abbr} ${A.v[i].toFixed(0)} km/h g${A.g[i]}`, `${B.abbr} ${B.v[i].toFixed(0)} km/h g${B.g[i]}`, `Δ ${signed(delta[i])} s`];
      ctx.font = MONO; const bw = Math.max(...txt.map((t) => ctx.measureText(t).width)) + 16;
      const bx = px + bw + 12 > w ? px - bw - 8 : px + 8;
      ctx.fillStyle = 'rgba(10,13,18,.92)'; ctx.fillRect(bx, m.t + 30, bw, 68);
      txt.forEach((t, k) => label(ctx, t, bx + 8, m.t + 47 + k * 15, [C.fg, C.a, C.b, C.signal][k]));
    }
    drawMs();
  }

  function drawMs() {
    const { A, B, edges, win } = cmp, ref = app.mapRef;
    const { ctx, w, h } = fit(ms); ctx.clearRect(0, 0, w, h);
    const P = app.mapProject(w, h);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let k = 0; k < win.length; k++) {
      ctx.strokeStyle = win[k] ? C.b : C.a; ctx.lineWidth = 7; ctx.beginPath();
      for (let i = edges[k]; i <= edges[k + 1] && i < ref.n; i++) { const [px, py] = P(ref.x[i], ref.y[i]); i === edges[k] ? ctx.moveTo(px, py) : ctx.lineTo(px, py); }
      ctx.stroke();
    }
    if (hoverD !== null) { const i = Math.min(ref.n - 1, Math.round(hoverD / r.ds)); const [px, py] = P(ref.x[i], ref.y[i]); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(px, py, 5, 0, 7); ctx.fill(); }
    const a = win.filter((x) => !x).length;
    $('#msCount').innerHTML = `<span style="color:${C.a}">${A.abbr} ${a}</span> · <span style="color:${C.b}">${B.abbr} ${win.length - a}</span>`;
  }

  function table() {
    const { A, B, corners } = cmp;
    const g = (x) => (x === null ? '—' : x.toFixed(0));
    $('#cornerTbl').innerHTML = `<tr><th>Corner</th><th>Brake ${A.abbr}</th><th>Brake ${B.abbr}</th><th>Min ${A.abbr}</th><th>Min ${B.abbr}</th><th>Gained, s</th></tr>` +
      corners.map((k) => `<tr title="${k.c.name}"><td>${k.c.label}</td><td>${g(k.bA)} m</td><td>${g(k.bB)} m</td><td>${k.vA.toFixed(0)}</td><td>${k.vB.toFixed(0)}</td><td><span class="who" style="color:${k.dt > 0 ? C.a : C.b}">${k.dt > 0 ? A.abbr : B.abbr} ${Math.abs(k.dt).toFixed(3)}</span></td></tr>`).join('');
    const d = B.lapTime - A.lapTime;
    $('#anGap').textContent = `${B.abbr} ${signed(d)} s vs ${A.abbr} (official ${fmtLap(A.lapTime)} / ${fmtLap(B.lapTime)})`;
  }

  cv.addEventListener('mousemove', (e) => {
    const rect = cv.getBoundingClientRect();
    const x = scale(44, rect.width - 10, 0, (cmp.n - 1) * r.ds);
    hoverD = Math.max(0, x(e.clientX - rect.left)); draw();
  });
  cv.addEventListener('mouseleave', () => { hoverD = null; draw(); });
  new ResizeObserver(draw).observe(cv);
  app.on('cars', () => { $('#anA').value = app.A.num; $('#anB').value = app.B.num; compute(); draw(); table(); });
}

// ================================================================= FIXES
function initFixes(app) {
  const r = app.race;
  const ver = r.byNum['1'];
  const above = ver.raw.v.filter((v) => v > 255).length / ver.raw.v.length;
  const topAll = r.drivers.reduce((a, d) => { const m = Math.max(...d.v); return m > a.v ? { v: m, d } : a; }, { v: 0 });
  const rawHz = ver.rawHz;
  const cards = [
    ['h', 'Speed capped at 255 km/h', `Speed was one byte with a factor of 1. ${(above * 100).toFixed(0)} % of Verstappen's fastest lap is above 255 km/h, and ${topAll.d.abbr} peaked at ${topAll.v.toFixed(1)} km/h.`, '8 bits, 1 km/h, max 255', '16 bits × 0.1 km/h, max 400'],
    ['h', 'RPM in the wrong byte order', 'CAN_Send.py packed RPM high byte first. The DBC declared the signal little-endian, so CAN Explorer showed 11 718 rpm as 50 733.', 'big-endian bytes, little-endian DBC', 'every signal Intel; codec checked against the DBC with cantools'],
    ['h', 'RPM truncated to one byte in MATLAB', 'bitshift(data(5), 8) runs on a uint8, so the high byte is shifted out and lost. The live plots showed RPM between 0 and 255.', 'uint8 arithmetic', 'bytes cast to double; one decoder for live and offline'],
    ['m', 'Gear always 0', "The sender tested for a column called 'Gear'. FastF1 calls it 'nGear', so the byte was 0 for the whole race. Brake, an on/off flag, was sent as a fake 0/100 %.", "tel['Gear'] (missing)", 'nGear in 4 bits; brake as a 1-bit flag'],
    ['h', 'One sample every 2.4 seconds', `FastF1 car data arrives at about ${rawHz} Hz. Keeping every 10th row left ~30 points for a 75 s lap and skipped most braking zones.`, 'tel[::10]', 'every sample, resampled to a steady 10 Hz'],
    ['h', 'Distance rebuilt from the receiver clock', 'MATLAB integrated speed over its own 10 Hz arrival times, 24× faster than the car time the samples covered, with timestamps saved at 1 s resolution.', 'cumtrapz(receiver time, speed)', 'LapDistance and LapTime sent by the car'],
    ['h', 'Drivers filed under the wrong number', 'Cars were identified by pauses and a fixed list that included #40 (not in the race) and missed #21. 8 of 19 logs got another driver\'s number.', '1.5 s gap + list position', 'SessionCtrl frames and driver number on the bus'],
    ['m', 'No way to spot a bad frame', 'Nothing in the payload could reveal a corrupted or dropped frame, so errors turned into wrong values in the log.', 'no counter, no checksum', 'alive counter + CRC-8 SAE J1850 in every data frame'],
    ['l', '30 near-duplicate scripts', 'Direct_Fix, Direct_Fix_v2, v3, UDP_Fix, logs, Simulink caches and an empty .slx sat side by side, with no tests to say which one worked.', 'copies and caches', 'one sender, receiver and analysis per language; 30 Python + 7 MATLAB tests'],
  ];
  const sev = { h: ['sev-h', 'Data was wrong'], m: ['sev-m', 'Data was missing'], l: ['sev-l', 'Maintainability'] };
  $('#fixList').innerHTML = cards.map(([s, t, p, b, a]) => `<article class="fix"><span class="tag ${sev[s][0]}">${sev[s][1]}</span><h3>${t}</h3><p>${p}</p><div class="ba"><div class="b4"><b>v1</b>${b}</div><div class="af"><b>v2</b>${a}</div></div></article>`).join('');
}
