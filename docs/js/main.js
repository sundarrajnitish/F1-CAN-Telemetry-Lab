// F1 CAN Telemetry Lab - page controller: shared state, race table, ghost-race replay.
import { loadRace, idxAtTime, stateAt, timeAtIdx, fmtLap, signed } from './data.js';
import { fit, scale, C, MONO, line, label, niceTicks, yAxis, xAxis } from './charts.js';
import * as CAN from './can.js';
import { initLab } from './lab.js';
import { initAnalysis } from './analysis.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- tiny event hub
const listeners = {};
export const app = {
  race: null, A: null, B: null, tau: 0, playing: false, rate: 1, stateA: null, stateB: null,
  counter: 0, rx: { frames: 0, samples: 0, crc: 0, gaps: 0, undetected: 0 }, corruptP: 0,
  on(ev, fn) { (listeners[ev] ||= []).push(fn); },
  emit(ev, ...a) { (listeners[ev] || []).forEach((fn) => fn(...a)); },
};

// ---------------------------------------------------------------- nav highlighting
function initNav() {
  const links = new Map($$('.chain a').map((a) => [a.getAttribute('href').slice(1), a]));
  const io = new IntersectionObserver((es) => {
    es.forEach((e) => { if (e.isIntersecting) { links.forEach((a) => a.classList.remove('on')); links.get(e.target.id)?.classList.add('on'); } });
  }, { rootMargin: '-45% 0px -50% 0px' });
  links.forEach((_, id) => { const s = document.getElementById(id); if (s) io.observe(s); });
}

// ---------------------------------------------------------------- selection
function setCar(which, d) {
  if (!d) return;
  if (which === 'A') { if (d === app.B) app.B = app.A; app.A = d; } else { if (d === app.A) app.A = app.B; app.B = d; }
  app.emit('cars');
}

// ---------------------------------------------------------------- hero
const SENSORS = [
  { key: 'Speed', label: 'Speed', color: C.speed, pos: [1.05, 1.0, 2.1], text: '<b>Speed</b> comes from wheel-speed sensors. On the bus: bits 0–15 of 0x101, 0.1 km/h per bit, so 336.9 km/h fits with room to spare.' },
  { key: 'RPM', label: 'RPM', color: C.rpm, pos: [0, 0.95, -0.55], text: '<b>RPM</b> is the power-unit crankshaft speed. Bits 16–31 of 0x101, little-endian like every other signal.' },
  { key: 'Throttle', label: 'Throttle · Brake', color: C.throttle, pos: [0, 0.72, 0.95], text: '<b>Throttle</b> (bits 32–39, 0–100 %) and <b>brake</b> (bit 44, on/off) are the pedal sensors in the footwell.' },
  { key: 'Gear', label: 'Gear', color: C.gear, pos: [0, 0.45, -1.75], text: '<b>Gear</b> is reported by the gearbox controller: 4 bits at bit 40, 0 = neutral, 1–8.' },
  { key: 'DRS', label: 'DRS', color: C.drs, pos: [0, 1.2, -2.05], text: '<b>DRS</b> opens the rear-wing flap on the straights. One bit (45) in 0x101.' },
  { key: 'PosX', label: 'Timing · GPS', color: C.signal, pos: [0, 1.35, 0.2], text: '<b>Position and lap timing</b> come from the car\'s transponder and positioning. They ride in 0x103 (X/Y/Z, 0.1 m) and 0x102 (lap time in ms, lap distance in m).' },
];

async function initHero() {
  const top = Math.max(...app.race.drivers.map((d) => Math.max(...d.v)));
  const rpm = Math.max(...app.race.drivers.map((d) => Math.max(...d.raw.rpm)));
  $('#stTop').textContent = top.toFixed(1);
  $('#stRpm').textContent = rpm.toLocaleString('en-US');
  const paint = $('#paint');
  const teams = [...new Map(app.race.drivers.map((d) => [d.team, d.color])).entries()];
  let viewer;
  teams.forEach(([team, color], i) => {
    const b = document.createElement('button');
    b.style.background = color; b.title = team; b.setAttribute('aria-label', `Paint in ${team} colours`);
    b.setAttribute('aria-pressed', team === 'Aston Martin' ? 'true' : 'false');
    b.onclick = () => { $$('button', paint).forEach((x) => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); viewer?.setColor(color); };
    paint.appendChild(b);
  });
  try {
    const { heroViewer } = await import('./scene3d.js');
    viewer = await heroViewer($('#heroStage'), {
      color: teams.find((t) => t[0] === 'Aston Martin')?.[1] || '#358C75', sensors: SENSORS,
      onSensor: (s) => { $('#sensorNote').innerHTML = s.text + ' <a href="#encode">See the bits ↓</a>'; app.emit('signal', s.key); },
    });
  } catch (e) {
    console.error(e);
    $('#heroLoading').textContent = 'WebGL is not available in this browser; the rest of the page still works.';
  }
}

// ---------------------------------------------------------------- race
function initRace() {
  const r = app.race, tbody = $('#results tbody');
  const fastest = r.fastest;
  const winner = r.drivers.find((d) => d.pos === 1);
  const sc = r.raceControl.filter((m) => /SAFETY CAR DEPLOYED|VIRTUAL SAFETY CAR DEPLOYED/.test(m.msg));
  $('#raceChips').innerHTML = [
    ['Winner', `${winner.abbr}`], ['Fastest lap', `${fastest.abbr} ${fmtLap(fastest.lapTime)}`],
    ['Air / track', `${r.weather.air[1]}° / ${r.weather.track[1]}°C`],
    ['Safety car', sc.length ? `lap ${sc.map((m) => m.lap).join(', ')}` : 'none'],
  ].map(([k, v]) => `<div class="chip"><b>${v}</b><span>${k}</span></div>`).join('');
  const rows = [...r.drivers].sort((a, b) => a.pos - b.pos);
  tbody.innerHTML = rows.map((d) => `<tr data-num="${d.num}" tabindex="0">
    <td>${d.pos}</td><td><span class="team" style="background:${d.color}"></span><b>${d.abbr}</b> <span style="color:var(--faint)">#${d.num}</span></td>
    <td>${d.team}</td><td class="${d === fastest ? 'fl' : ''}">${fmtLap(d.lapTime)}</td><td>${d.lap}</td>
    <td><span class="tyre ${(d.compound || 'U')[0]}" title="${d.compound || 'unknown'}">${(d.compound || '?')[0]}</span></td>
    <td>${d.speedTrap ? d.speedTrap.toFixed(0) : '—'}</td><td>${d.status}</td></tr>`).join('');
  let next = 'A';
  const pick = (tr) => { const d = r.byNum[tr.dataset.num]; setCar(next, d); next = next === 'A' ? 'B' : 'A'; };
  $$('tr', tbody).forEach((tr) => {
    tr.onclick = () => pick(tr);
    tr.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(tr); } };
  });
  app.on('cars', () => $$('tr', tbody).forEach((tr) => {
    tr.classList.toggle('sel-a', tr.dataset.num === app.A.num); tr.classList.toggle('sel-b', tr.dataset.num === app.B.num);
  }));
  initLapChart();
}

function initLapChart() {
  const cv = $('#lapChart'), r = app.race;
  let hover = null;
  const draw = () => {
    const { ctx, w, h } = fit(cv);
    ctx.clearRect(0, 0, w, h);
    const m = { l: 34, r: 46, t: 10, b: 24 };
    const x = scale(1, r.totalLaps, m.l, w - m.r), y = scale(1, 20, m.t, h - m.b);
    yAxis(ctx, y, m.l, w - m.r, [1, 5, 10, 15, 20], (v) => `P${v}`);
    xAxis(ctx, x, h - m.b, niceTicks(1, r.totalLaps, 7), (v) => `L${v}`);
    const sc = r.raceControl.filter((mm) => /SAFETY CAR DEPLOYED/.test(mm.msg) && mm.lap);
    for (const s of sc) {
      ctx.fillStyle = 'rgba(255,178,26,.10)'; ctx.fillRect(x(s.lap), m.t, x(s.lap + 3) - x(s.lap), h - m.t - m.b);
      label(ctx, 'SC', x(s.lap) + 3, m.t + 12, C.signal);
    }
    const order = [...r.drivers].sort((a, b) => (a === hover) - (b === hover) || (a === app.A || a === app.B) - (b === app.A || b === app.B));
    for (const d of order) {
      const xs = [], ys = [];
      d.positions.forEach((p, i) => { if (p) { xs.push(x(d.lapNums[i])); ys.push(y(p)); } });
      const focus = d === hover || d === app.A || d === app.B;
      ctx.globalAlpha = hover && !focus ? 0.18 : focus ? 1 : 0.55;
      line(ctx, xs, ys, d.color, focus ? 2.6 : 1.3);
      if (xs.length) label(ctx, d.abbr, xs[xs.length - 1] + 5, ys[ys.length - 1] + 4, d.color);
    }
    ctx.globalAlpha = 1;
  };
  cv.addEventListener('mousemove', (e) => {
    const rect = cv.getBoundingClientRect(), w = rect.width, h = rect.height;
    const x = scale(34, w - 46, 1, r.totalLaps), y = scale(10, h - 24, 1, 20);
    const lap = Math.round(x(e.clientX - rect.left)), pos = y(e.clientY - rect.top);
    let best = null, bd = 0.8;
    for (const d of r.drivers) { const i = d.lapNums.indexOf(lap); if (i >= 0 && d.positions[i] && Math.abs(d.positions[i] - pos) < bd) { bd = Math.abs(d.positions[i] - pos); best = d; } }
    if (best !== hover) { hover = best; draw(); $('#lapChartHint').textContent = best ? `${best.name} · ${best.team} · finished ${best.status === 'Finished' || best.status === 'Lapped' ? 'P' + best.pos : best.status}` : 'Hover a line to follow a car'; }
  });
  cv.addEventListener('mouseleave', () => { hover = null; draw(); });
  cv.addEventListener('click', () => hover && setCar('A', hover));
  new ResizeObserver(draw).observe(cv);
  app.on('cars', draw);
}

// ---------------------------------------------------------------- replay
function initReplay() {
  const r = app.race;
  const opts = [...r.drivers].sort((a, b) => a.pos - b.pos).map((d) => `<option value="${d.num}">${d.abbr} · #${d.num}</option>`).join('');
  $('#selA').innerHTML = opts; $('#selB').innerHTML = opts;
  $('#selA').onchange = (e) => setCar('A', r.byNum[e.target.value]);
  $('#selB').onchange = (e) => setCar('B', r.byNum[e.target.value]);
  const scrub = $('#scrub'); scrub.max = (r.maxLap + 1).toFixed(2);
  scrub.oninput = () => { app.tau = +scrub.value; app.emit('seek'); };
  $('#rate').onchange = (e) => { app.rate = +e.target.value; };
  const playBtn = $('#play');
  const setPlaying = (p) => { app.playing = p; playBtn.textContent = p ? '❚❚ Pause' : '▶ Play'; playBtn.setAttribute('aria-pressed', p); };
  playBtn.onclick = () => setPlaying(!app.playing);
  $$('#camSeg button').forEach((b) => b.onclick = () => {
    $$('#camSeg button').forEach((x) => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); track?.setCam(b.dataset.cam);
  });
  // rev lights
  $('#revs').innerHTML = Array.from({ length: 15 }, () => '<i></i>').join('');
  const leds = $$('#revs i');

  let track = null;
  import('./scene3d.js').then(({ trackScene }) => trackScene($('#trackStage'), r, r.byNum['1'] || r.drivers[0]))
    .then((t) => { track = t; app.track = t; track.setColors(app.A.color, app.B.color); })
    .catch((e) => { console.error(e); $('#trackLoading').textContent = 'WebGL is not available; the map and dashboard below still run.'; });

  app.on('cars', () => {
    $('#selA').value = app.A.num; $('#selB').value = app.B.num;
    track?.setColors(app.A.color, app.B.color);
    const bn = $('#banner'); bn.querySelector('i').style.background = app.A.color; bn.querySelector('span').textContent = `${app.A.name} · ${app.A.team}`;
    app.traceLines = []; app.emit('seek');
  });

  // candump trace for car A: 3 frames per 0.1 s of replay time
  const traceEl = $('#trace'); app.traceLines = [];
  let lastEmit = -1;
  const pushFrame = (id, data, note = '') => {
    const cls = note ? 'err' : `id${CAN.hex3(id)}`;
    app.traceLines.push(`<span class="${cls}">(${app.tau.toFixed(3).padStart(8, '0')}) vcan0 ${CAN.hex3(id)}#${CAN.hex(data).replace(/ /g, '')}${note}</span>`);
    if (app.traceLines.length > 10) app.traceLines.shift();
  };
  function emitSample(s) {
    const frames = CAN.encodeSample(s, app.counter);
    let lapCounter = null;
    for (const f of frames) {
      let data = f.data.slice(), note = '';
      app.rx.frames++;
      if (Math.random() < app.corruptP) {
        const bit = Math.floor(Math.random() * 64); data[bit >> 3] ^= 1 << (bit & 7);
        const dec = CAN.decode(f.id, data);
        if (!dec.ok) { note = `  ✗ CRC-8 mismatch (bit ${bit} flipped), dropped`; app.rx.crc++; }
        else { app.rx.undetected++; note = '  ! corrupted frame passed'; }
      } else if (f.id === CAN.ID.TELEMETRY) app.rx.samples++;
      pushFrame(f.id, data, note);
      if (f.id === CAN.ID.LAP) lapCounter = app.counter;
    }
    app.counter = (app.counter + 1) & 15;
    traceEl.innerHTML = app.traceLines.join('\n');
    $('#traceStats').textContent = `${app.rx.frames.toLocaleString()} frames · ${app.rx.crc + app.rx.gaps} rejected`;
    app.emit('rx');
    return lapCounter;
  }

  function updateDash(s, fiA) {
    $('#wSpeed').textContent = Math.round(s.speed);
    $('#wRpm').textContent = Math.round(s.rpm).toLocaleString('en-US');
    $('#wGear').textContent = s.gear === 0 ? 'N' : s.gear;
    $('#wThr').style.width = `${s.throttle}%`; $('#wThrV').textContent = Math.round(s.throttle);
    $('#wBrk').style.width = s.brake ? '100%' : '0%';
    $('#wDrs').classList.toggle('on', !!s.drs);
    $('#wLap').textContent = `${fmtLap(Math.min(app.tau, app.A.lapTime))}`;
    const lit = Math.max(0, Math.min(15, Math.round(((s.rpm - 9800) / (11900 - 9800)) * 15)));
    const revs = $('#revs');
    revs.classList.toggle('flash', s.rpm > 11950);
    leds.forEach((l, i) => { l.className = i < lit ? (i < 5 ? 'g' : i < 10 ? 'r' : 'b') : ''; });
    // live delta: where was B when it reached A's current distance
    const dA = fiA * r.ds;
    const fiB = Math.min(dA / r.ds, app.B.n - 1);
    const delta = app.tau >= app.A.lapTime ? app.B.lapTime - app.A.lapTime : timeAtIdx(app.B, fiB) - timeAtIdx(app.A, fiA);
    const el = $('#wDelta'); el.textContent = signed(delta); el.className = `delta num ${delta >= 0 ? 'up' : 'down'}`;
  }

  function updateBoard(fiAll) {
    const leader = [...r.drivers].sort((a, b) => fiAll.get(b.num) - fiAll.get(a.num) || a.lapTime - b.lapTime)[0];
    const rows = r.drivers.map((d) => {
      const fi = fiAll.get(d.num), fin = app.tau >= d.lapTime;
      const gap = fin ? d.lapTime - r.fastest.lapTime : app.tau - timeAtIdx(leader, Math.min(fi, leader.n - 1));
      return { d, fi, fin, gap };
    }).sort((a, b) => (a.fin && b.fin ? a.d.lapTime - b.d.lapTime : b.fi - a.fi));
    $('#board').innerHTML = rows.map((x, i) => `<li class="${x.d === app.A ? 'a' : x.d === app.B ? 'b' : ''}"><span class="num">${i + 1}</span><i style="background:${x.d.color}"></i><b>${x.d.abbr}</b><span></span><span class="gap">${i === 0 ? (x.fin ? fmtLap(x.d.lapTime) : 'LEADER') : signed(Math.max(0, x.gap))}</span></li>`).join('');
  }

  // map
  const mapCv = $('#mapCanvas');
  const ref = r.byNum['1'];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < ref.n; i++) { minX = Math.min(minX, ref.x[i]); maxX = Math.max(maxX, ref.x[i]); minY = Math.min(minY, ref.y[i]); maxY = Math.max(maxY, ref.y[i]); }
  // rotate the long circuit to lie horizontally
  const project = (w, h) => {
    const pad = 22, sx = (w - 2 * pad) / (maxY - minY), sy = (h - 2 * pad) / (maxX - minX), s = Math.min(sx, sy);
    const ox = (w - (maxY - minY) * s) / 2, oy = (h - (maxX - minX) * s) / 2;
    return (x, y) => [ox + (y - minY) * s, oy + (x - minX) * s];
  };
  app.mapProject = project; app.mapRef = ref;
  function drawMap(fiAll) {
    const { ctx, w, h } = fit(mapCv);
    ctx.clearRect(0, 0, w, h);
    const P = project(w, h);
    ctx.lineWidth = 9; ctx.strokeStyle = '#1f2835'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); for (let i = 0; i < ref.n; i++) { const [px, py] = P(ref.x[i], ref.y[i]); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.closePath(); ctx.stroke();
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#3a4658'; ctx.stroke();
    for (const c of r.corners) {
      const i = Math.round(c.d / r.ds), [px, py] = P(ref.x[i], ref.y[i]);
      label(ctx, c.label, px + 8, py - 8, C.faint);
    }
    const [sx, sy] = P(ref.x[0], ref.y[0]); ctx.fillStyle = C.fg; ctx.fillRect(sx - 1.5, sy - 8, 3, 16);
    const order = [...r.drivers].sort((a, b) => (a === app.A || a === app.B) - (b === app.A || b === app.B));
    for (const d of order) {
      const fi = fiAll.get(d.num), i = Math.min(d.n - 1, Math.round(fi));
      const [px, py] = P(d.x[i], d.y[i]);
      const big = d === app.A || d === app.B;
      ctx.beginPath(); ctx.arc(px, py, big ? 7 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = d.color; ctx.fill();
      ctx.lineWidth = big ? 2 : 1; ctx.strokeStyle = big ? '#fff' : '#0c1016'; ctx.stroke();
      if (big) label(ctx, d.abbr, px + 10, py + 4, d === app.A ? C.a : C.b);
    }
  }

  // main loop
  let last = performance.now();
  function tick(now) {
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    if (app.playing) {
      app.tau += dt * app.rate;
      if (app.tau > r.maxLap + 1.5) { app.tau = 0; app.counter = 0; }
      scrub.value = app.tau;
    }
    const fiAll = new Map(r.drivers.map((d) => [d.num, idxAtTime(d, app.tau)]));
    const fiA = fiAll.get(app.A.num), fiB = fiAll.get(app.B.num);
    app.stateA = stateAt(app.A, fiA, r.ds); app.stateB = stateAt(app.B, fiB, r.ds);
    $('#clock').textContent = fmtLap(app.tau);
    if (app.playing && app.tau < app.A.lapTime && Math.floor(app.tau * 10) !== lastEmit) { lastEmit = Math.floor(app.tau * 10); emitSample(app.stateA); }
    updateDash(app.stateA, fiA);
    if (!tick.boardAt || now - tick.boardAt > 250) { updateBoard(fiAll); tick.boardAt = now; }
    drawMap(fiAll);
    track?.frame(dt, { simDt: app.playing ? dt * app.rate : 0, A: app.A, B: app.B, fiA, fiB, fiAll, stateA: app.stateA, stateB: app.stateB });
    app.emit('frame');
    requestAnimationFrame(tick);
  }
  app.on('seek', () => { lastEmit = -1; });
  requestAnimationFrame(tick);
  // start playing once the replay scrolls into view (unless the viewer prefers less motion)
  if (!reduceMotion) {
    const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) { setPlaying(true); io.disconnect(); } }, { threshold: 0.5 });
    io.observe($('#trackStage'));
  }
  app.emitSample = emitSample;
}

// ---------------------------------------------------------------- boot
(async function boot() {
  initNav();
  try {
    app.race = await loadRace();
  } catch (e) {
    document.querySelector('main').insertAdjacentHTML('afterbegin', `<p class="wrap note" style="padding:20px 0;color:var(--bad)">Could not load race data (${e.message}). If you opened the file directly, serve the docs folder with any static server, for example <code>python -m http.server</code>.</p>`);
    return;
  }
  app.A = app.race.byNum['1']; app.B = app.race.byNum['14'];
  window.f1lab = app;
  initRace();
  initReplay();
  initLab(app);
  initAnalysis(app);
  app.emit('cars');
  initHero();
})();
