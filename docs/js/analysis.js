// Sampling explorer, driver comparison, and the design decisions.
import { fit, scale, C, MONO, line, label, niceTicks, yAxis, xAxis } from './charts.js';
import { fmtLap, signed } from './data.js';

const $ = (s, r = document) => r.querySelector(s);

export function initAnalysis(app) {
  initSampling(app);
  initCompare(app);
  initDesign(app);
}

// ================================================================= SAMPLING
function initSampling(app) {
  const cv = $('#sampleChart');
  let N = 1;
  const dec = $('#decim');
  const ord = (n) => `${n}${n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
  dec.oninput = () => { N = +dec.value; $('#decimV').textContent = N === 1 ? 'sample' : ord(N); draw(); };
  $('#decimReset').onclick = () => { dec.value = 1; dec.oninput(); };

  function draw() {
    const d = app.A; if (!d) return;
    $('#sampleTitle').textContent = `Speed trace, ${d.abbr} fastest lap (lap ${d.lap})`;
    const raw = d.raw, t0 = raw.t[0];
    const T = raw.t.map((t) => t - t0), V = raw.v, B = raw.brk;
    const keep = []; for (let i = 0; i < T.length; i += N) keep.push(i);
    const vk = keep.map((i) => V[i]);
    const { ctx, w, h } = fit(cv);
    ctx.clearRect(0, 0, w, h);
    const m = { l: 40, r: 12, t: 12, b: 26 };
    const x = scale(0, T[T.length - 1], m.l, w - m.r), y = scale(0, 360, h - m.b, m.t);
    yAxis(ctx, y, m.l, w - m.r, [0, 100, 200, 300], (v) => v);
    xAxis(ctx, x, h - m.b, niceTicks(0, T[T.length - 1], 8), (v) => `${v}s`);
    // braking bands from the real data
    ctx.fillStyle = 'rgba(255,82,82,.10)';
    for (let i = 0; i < T.length - 1; i++) if (B[i]) ctx.fillRect(x(T[i]), m.t, x(T[i + 1]) - x(T[i]) + 0.5, h - m.t - m.b);
    // full-rate signal
    ctx.globalAlpha = 0.5; line(ctx, T.map(x), V.map(y), C.speed, 1.2); ctx.globalAlpha = 1;
    ctx.fillStyle = C.speed; T.forEach((t, i) => { ctx.beginPath(); ctx.arc(x(t), y(V[i]), 1.6, 0, 7); ctx.fill(); });
    // what a thinned stream would deliver
    if (N > 1) {
      line(ctx, keep.map((i) => x(T[i])), vk.map(y), C.signal, 2.2);
      ctx.fillStyle = C.signal; keep.forEach((i, k) => { ctx.beginPath(); ctx.arc(x(T[i]), y(vk[k]), 3.2, 0, 7); ctx.fill(); });
    }
    label(ctx, 'braking', x(T[B.indexOf(1)] || 0) + 4, m.t + 12, C.brake);
    const hp = app.race.corners.find((c) => /pingle/.test(c.name));
    const hpT = hp ? d.t[Math.round(hp.d / app.race.ds)] : 0;
    if (hp) label(ctx, 'hairpin', x(hpT), y(30), C.faint, 'center');
    // stats
    const trueTop = Math.max(...V), gotTop = Math.max(...vk);
    const trueMin = Math.min(...T.map((t, i) => (Math.abs(t - hpT) < 4 ? V[i] : 1e9)));
    const winK = keep.filter((i) => Math.abs(T[i] - hpT) < 4).map((i) => V[i]);
    const gotMin = winK.length ? Math.min(...winK) : NaN;
    const zones = []; for (let i = 0; i < B.length; i++) if (B[i] && !B[i - 1]) { let j = i; while (B[j + 1]) j++; zones.push([i, j]); }
    const seen = zones.filter(([a, b]) => keep.some((k) => k >= a && k <= b)).length;
    const interval = (T[T.length - 1] / (T.length - 1)) * N;
    const cells = [
      ['Samples per lap', `${keep.length} of ${T.length}`, keep.length === T.length ? 'ok' : 'bad'],
      ['Time between samples', `${interval.toFixed(2)} s`, N === 1 ? 'ok' : 'bad'],
      ['Braking zones captured', `${seen} of ${zones.length}`, seen === zones.length ? 'ok' : 'bad'],
      ['Top speed / hairpin minimum', `${gotTop.toFixed(0)} / ${isFinite(gotMin) ? gotMin.toFixed(0) : '—'} km/h`, Math.abs(gotTop - trueTop) < 1 && Math.abs(gotMin - trueMin) < 1 ? 'ok' : 'bad'],
    ];
    $('#sampleStats').innerHTML = cells.map(([k, v, c]) => `<div class="cell ${c}"><span class="label">${k}</span><b>${v}</b></div>`).join('');
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

// ================================================================= DESIGN
function initDesign(app) {
  const r = app.race;
  const top = r.drivers.reduce((a, d) => { const m = Math.max(...d.v); return m > a.v ? { v: m, d } : a; }, { v: 0 });
  const rpm = Math.max(...r.drivers.map((d) => Math.max(...d.raw.rpm)));
  const cards = [
    ['Resolution', 'Speed to 400 km/h in 0.1 km/h steps', `The quickest car on the straights in Montréal, ${top.d.abbr}, reached ${top.v.toFixed(1)} km/h. A 16-bit signal at 0.1 km/h per bit covers that with room for any circuit on the calendar.`, 'Speed 0|16 × 0.1 · RPM 16|16 (peak seen: ' + rpm.toLocaleString('en-US') + ')'],
    ['Layout', 'One byte order, one source of truth', 'Every signal is Intel (little-endian), defined once in the DBC. The Python codec is checked against it with cantools; MATLAB and the browser are checked byte for byte against Python.', 'dbc/f1_telemetry.dbc'],
    ['Layout', 'Gear in 4 bits, brake and DRS as flags', 'FastF1 reports gear as 0 to 8 and the brake as on/off, so they take exactly the bits they need. The bytes saved hold the alive counter and the checksum.', 'Gear 40|4 · Brake 44|1 · DRS 45|1'],
    ['Timing', 'Every real sample, on a steady grid', `Car data arrives at about ${r.byNum['1'].rawHz} Hz. The sender keeps every sample, interpolates onto a 10 Hz grid and schedules each frame against an absolute deadline, so a lap never drifts.`, '10 Hz · 3 frames per sample'],
    ['Timing', 'Lap time and distance from the car', 'Each sample carries the lap time (1 ms) and lap distance (1 m) measured on the car. Logs line up on distance straight away, ready for driver comparison.', 'F1_LapContext 0x102'],
    ['Framing', 'Explicit sessions, highest priority', 'A SessionCtrl frame opens and closes every car\'s stream and names the driver. With ID 0x010 it wins arbitration against all telemetry, so the receiver always knows who is talking.', 'F1_SessionCtrl 0x010'],
    ['Integrity', 'End-to-end CRC-8 and alive counter', 'Byte 7 of every data frame is a CRC-8 (SAE J1850) over the other seven, and a 4-bit counter exposes dropped frames. The tests flip each of the 64 bits in all three frames and every flip is caught.', 'CRC-8 poly 0x1D · counter mod 16'],
    ['Capacity', 'Light on the bus', 'Measured on the real frames, bit stuffing included, a sample costs about 351 bits. One car at 10 Hz uses 0.7 % of a 500 kbit/s bus; the whole grid of 20 fits in 14 %.', '≈ 351 bits / sample'],
    ['Tooling', 'Three implementations, one test suite', 'Python streams and logs, MATLAB/Octave decodes live or from a recorded trace, Simulink replays a real lap, and this page runs the same codec in JavaScript. CI runs both test suites on every push.', '27 Python + 7 MATLAB tests'],
  ];
  $('#fixList').innerHTML = cards.map(([tag, t, p, spec]) => `<article class="fix"><span class="tag">${tag}</span><h3>${t}</h3><p>${p}</p><div class="spec mono">${spec}</div></article>`).join('');
}
