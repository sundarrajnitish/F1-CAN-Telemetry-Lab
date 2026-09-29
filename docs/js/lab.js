// Frame lab (encode), bus arbitration + load, receiver mapping.
import * as CAN from './can.js';
import { fit, C, MONO } from './charts.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const SIGCOL = { Speed: C.speed, RPM: C.rpm, Throttle: C.throttle, Gear: C.gear, Brake: C.brake, DRS: C.drs, AliveCounter: '#8a94a6', CRC8: '#e9edf3' };
const V1_SIGNALS = [
  { name: 'Speed', start: 0, len: 8 }, { name: 'Throttle', start: 8, len: 8 }, { name: 'Brake', start: 16, len: 8 },
  { name: 'Gear', start: 24, len: 8 }, { name: 'RPM', start: 32, len: 16 },
];

export function initLab(app) {
  initEncode(app);
  initBus(app);
  initReceive(app);
}

// ================================================================= ENCODE
function initEncode(app) {
  let layout = 'v2', frozen = null, flips = new Set(), highlight = null, lastKey = '';
  const seg = $$('#layoutSeg button');
  seg.forEach((b) => b.onclick = () => { seg.forEach((x) => x.setAttribute('aria-pressed', x === b)); layout = b.dataset.l; flips.clear(); render(true); });
  const freezeBtn = $('#freeze');
  const setFrozen = (f) => { frozen = f ? { ...app.stateA } : null; freezeBtn.setAttribute('aria-pressed', !!f); freezeBtn.textContent = f ? 'Follow replay' : 'Freeze sample'; render(true); };
  freezeBtn.onclick = () => setFrozen(!frozen);
  $('#resetBits').onclick = () => { flips.clear(); render(true); };
  app.on('signal', (key) => { highlight = key; if (layout !== 'v2') seg[0].click(); render(true); });

  const grid = $('#bitgrid');
  const flipCell = (e) => {
    const cell = e.target.closest('.bit'); if (!cell) return;
    if (e.type === 'keydown') { if (e.key !== 'Enter' && e.key !== ' ') return; e.preventDefault(); }
    if (!frozen) setFrozen(true);
    const i = +cell.dataset.i; flips.has(i) ? flips.delete(i) : flips.add(i); render(true);
  };
  grid.addEventListener('click', flipCell);
  grid.addEventListener('keydown', flipCell);

  function currentFrame(s) {
    if (layout === 'v2') {
      const bytes = CAN.encodeTelemetry(s, app.counter);
      return { id: CAN.ID.TELEMETRY, bytes, signals: CAN.MESSAGES[CAN.ID.TELEMETRY].signals };
    }
    return { id: CAN.ID.LEGACY, bytes: CAN.legacyEncode(s), signals: V1_SIGNALS };
  }

  function render(force = false) {
    const s = frozen || app.stateA; if (!s) return;
    const key = `${layout}|${Math.round(s.speed * 10)}|${Math.round(s.rpm)}|${s.gear}|${Math.round(s.throttle)}|${s.brake}|${s.drs}|${app.counter}`;
    if (!force && key === lastKey) return;
    lastKey = key;
    const f = currentFrame(s);
    const sent = f.bytes.slice();
    const wire = f.bytes.slice();
    flips.forEach((i) => { wire[i >> 3] ^= 1 << (i & 7); });
    const bits = CAN.bytesToBits(wire);
    const owner = new Array(64).fill(null);
    f.signals.forEach((sg) => { for (let k = 0; k < sg.len; k++) owner[sg.start + k] = sg.name; });

    // bit grid: cells are created once and updated in place so clicks never land on a detached node
    if (!grid.dataset.built) {
      let html = '<span></span>' + [7, 6, 5, 4, 3, 2, 1, 0].map((b) => `<span class="h">${b}</span>`).join('') + '<span class="h">hex</span>';
      for (let byte = 0; byte < 8; byte++) {
        html += `<span class="rowh">B${byte}</span>`;
        for (let b = 7; b >= 0; b--) html += `<span class="bit" role="button" tabindex="0" data-i="${byte * 8 + b}"></span>`;
        html += `<span class="hexb" data-byte="${byte}"></span>`;
      }
      grid.innerHTML = html; grid.dataset.built = '1';
    }
    grid.querySelectorAll('.bit').forEach((cell) => {
      const i = +cell.dataset.i, v = bits[i], o = owner[i], col = o ? SIGCOL[o] : '#3a4658';
      cell.className = `bit${v ? ' one' : ''}${flips.has(i) ? ' flipped' : ''}`;
      cell.style.background = v ? col : `color-mix(in srgb, ${col} 22%, #141a24)`;
      cell.style.opacity = highlight && o !== highlight ? 0.25 : 1;
      cell.title = `bit ${i}${o ? ' · ' + o : ' · unused'} (click to flip)`;
      if (cell.textContent !== String(v)) cell.textContent = v;
    });
    grid.querySelectorAll('.hexb').forEach((h) => { h.textContent = wire[+h.dataset.byte].toString(16).toUpperCase().padStart(2, '0'); });
    $('#bitLegend').innerHTML = f.signals.map((sg) => `<span><i class="swatch" style="background:${SIGCOL[sg.name]}"></i>${sg.name}</span>`).join('');
    $('#bytesHex').textContent = `${CAN.hex3(f.id)}#${CAN.hex(wire)}`;
    $('#encMsgName').textContent = layout === 'v2' ? 'F1_CarTelemetry · 0x101' : 'Speed_Throttle_Brake_RPM · 0x123';
    $('#encSource').textContent = frozen ? `frozen at ${frozen.distance.toFixed(0)} m, car #${frozen.driver}` : `following car #${s.driver} in the replay`;

    const pill = $('#crcPill');
    if (layout === 'v2') {
      const dec = CAN.decode(f.id, wire);
      pill.hidden = false;
      pill.className = `pill ${dec.ok ? 'ok' : 'bad'}`;
      pill.textContent = dec.ok ? `CRC-8 0x${dec.raw.CRC8.toString(16).toUpperCase().padStart(2, '0')} ok` : `CRC-8 fails: expected 0x${dec.expected.toString(16).toUpperCase().padStart(2, '0')}, frame rejected`;
      const phys = { Speed: s.speed, RPM: s.rpm, Throttle: s.throttle, Gear: s.gear, Brake: s.brake, DRS: s.drs, AliveCounter: app.counter & 15, CRC8: sent[7] };
      $('#sigtable').innerHTML = '<tr><th>Signal</th><th>Bits</th><th>Scale</th><th class="r">Car value</th><th class="r">Raw</th><th class="r">Receiver</th></tr>' +
        f.signals.map((sg) => {
          const recv = dec.ok ? fmt(sg.name, dec.values[sg.name]) : '<span style="color:var(--bad)">rejected</span>';
          const hl = highlight === sg.name ? ' style="background:#1d2635"' : '';
          return `<tr${hl}><td><i class="swatch" style="background:${SIGCOL[sg.name]}"></i> ${sg.name}</td><td class="mono">${sg.start}–${sg.start + sg.len - 1}</td><td class="mono">${sg.scale}${sg.unit ? ' ' + sg.unit : ''}</td><td class="r">${fmt(sg.name, phys[sg.name])}</td><td class="r">${dec.raw[sg.name]}</td><td class="r">${recv}</td></tr>`;
        }).join('');
      $('#v1compare').hidden = true;
    } else {
      pill.hidden = false; pill.className = 'pill bad'; pill.textContent = 'no integrity check';
      const mat = CAN.legacyMatlab(wire), cal = CAN.legacyCanalyzer(wire);
      $('#sigtable').innerHTML = '<tr><th>Signal</th><th>Bits</th><th class="r">Car value</th><th class="r">Sent</th><th class="r">MATLAB</th><th class="r">CANalyzer</th></tr>' + [
        ['Speed', '0–7', s.speed.toFixed(1), sent[0], mat.speed, cal.Speed],
        ['Throttle', '8–15', Math.round(s.throttle), sent[1], mat.throttle, cal.Throttle],
        ['Brake', '16–23', s.brake ? 'on' : 'off', sent[2], mat.brake, cal.Brake],
        ['Gear', '24–31', s.gear, sent[3], '—', cal.Gear],
        ['RPM', '32–47', Math.round(s.rpm), `${sent[4]}·${sent[5]} (BE)`, mat.rpm, cal.RPM],
      ].map(([n, b, v, se, m, c]) => {
        const bad = (x) => (n === 'Speed' && s.speed > 255.5) || (n === 'Gear' && s.gear !== 0) || (n === 'RPM' && Math.abs(x - s.rpm) > 1);
        return `<tr><td><i class="swatch" style="background:${SIGCOL[n]}"></i> ${n}</td><td class="mono">${b}</td><td class="r">${v}</td><td class="r">${se}</td><td class="r" style="color:${bad(m) ? 'var(--bad)' : 'inherit'}">${m}</td><td class="r" style="color:${bad(c) ? 'var(--bad)' : 'inherit'}">${c}</td></tr>`;
      }).join('');
      $('#v1compare').hidden = false;
      $('#v1cells').innerHTML = [
        ['Real RPM', Math.round(s.rpm).toLocaleString('en-US'), 'ok'],
        ['MATLAB saw', mat.rpm.toLocaleString('en-US'), 'bad'],
        ['CANalyzer saw', cal.RPM.toLocaleString('en-US'), 'bad'],
      ].map(([k, v, c]) => `<div class="cell ${c}"><span class="label">${k}</span><b>${v}</b></div>`).join('');
    }
    drawWire(f.id, wire);
  }
  const fmt = (n, v) => (n === 'Speed' ? v.toFixed(1) : n === 'RPM' ? Math.round(v).toLocaleString('en-US') : n === 'Throttle' ? Math.round(v) : n === 'CRC8' ? '0x' + v.toString(16).toUpperCase().padStart(2, '0') : v);

  const wireCv = $('#wireCanvas');
  const FIELD = { SOF: '#8a94a6', ID: C.signal, RTR: '#8a94a6', IDE: '#8a94a6', r0: '#8a94a6', DLC: C.drs, DATA: C.speed, CRC: C.rpm, 'CRC delim': C.throttle, ACK: C.throttle, 'ACK delim': C.throttle, EOF: '#5d6a7d', IFS: '#3a4658' };
  function drawWire(id, data) {
    const wf = CAN.wireFrame(id, data);
    const bw = 8.5, pad = 12, W = Math.ceil(wf.total * bw + pad * 2), H = 200;
    wireCv.style.width = W + 'px'; wireCv.setAttribute('height', H);
    const dpr = Math.min(devicePixelRatio || 1, 2); wireCv.width = W * dpr; wireCv.height = H * dpr; wireCv.style.height = H + 'px';
    const ctx = wireCv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const yv = (v) => 150 - (v - 1.5) * 50;   // 1.5 V .. 3.5 V
    // field bands + labels
    let start = 0;
    for (let i = 0; i <= wf.bits.length; i++) {
      const f = wf.bits[i]?.field;
      if (i === wf.bits.length || f !== wf.bits[start].field) {
        const name = wf.bits[start].field, x0 = pad + start * bw, x1 = pad + i * bw;
        ctx.fillStyle = FIELD[name] || '#3a4658'; ctx.globalAlpha = 0.14; ctx.fillRect(x0, 22, x1 - x0, 150); ctx.globalAlpha = 1;
        ctx.fillRect(x0, 22, x1 - x0, 3);
        if (x1 - x0 > 20) { ctx.font = MONO; ctx.fillStyle = FIELD[name]; ctx.textAlign = 'left'; ctx.fillText(name.replace(' delim', '·d'), x0 + 2, 16); }
        start = i;
      }
    }
    // stuff bits
    wf.bits.forEach((b, i) => { if (b.stuff) { ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(pad + i * bw, 25, bw, 147); ctx.fillStyle = C.fg; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('▲', pad + i * bw + bw / 2, 188); } });
    // levels
    const drawLevel = (hi, lo, color) => {
      ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.beginPath();
      wf.bits.forEach((b, i) => {
        const v = b.b === 0 ? hi : lo, x0 = pad + i * bw;
        if (i === 0) ctx.moveTo(x0, yv(v)); else ctx.lineTo(x0, yv(v));
        ctx.lineTo(x0 + bw, yv(v));
      });
      ctx.stroke();
    };
    drawLevel(3.5, 2.5, '#ffb21a'); drawLevel(1.5, 2.5, '#2fd3e0');
    ctx.font = MONO; ctx.textAlign = 'left'; ctx.fillStyle = '#ffb21a'; ctx.fillText('CAN_H', 2, yv(3.5) - 4);
    ctx.fillStyle = '#2fd3e0'; ctx.fillText('CAN_L', 2, yv(1.5) + 12);
    $('#wireStats').textContent = `${wf.total} bits · ${wf.stuffCount} stuff bits · CRC-15 0x${wf.crc.toString(16).toUpperCase()} · ${(wf.total / 500).toFixed(0)} µs`;
  }

  app.on('frame', () => { if (!frozen) render(); });
  app.on('cars', () => render(true));
}

// ================================================================= BUS
function initBus(app) {
  const base = [
    { id: 0x010, name: 'SessionCtrl' }, { id: 0x101, name: 'CarTelemetry' },
    { id: 0x102, name: 'LapContext' }, { id: 0x103, name: 'Position' },
  ];
  let nodes, k, timer = null;
  const arb = $('#arb'), note = $('#arbNote');
  const parse = (s) => { const v = /^0x/i.test(s.trim()) ? parseInt(s, 16) : parseInt(s, 10); return Number.isFinite(v) && v >= 0 && v < 2048 ? v : null; };
  function reset() {
    stop();
    const cid = parse($('#arbCustom').value);
    nodes = base.map((n) => ({ ...n, lost: null }));
    if (cid !== null) nodes.push({ id: cid, name: 'Your node', lost: null, custom: true });
    k = 0; render();
    note.textContent = cid === null ? 'Enter an 11-bit identifier (0x000–0x7FF) for your node.' : 'Press Step to put the first identifier bit on the bus.';
  }
  const bitOf = (id, i) => (id >> (10 - i)) & 1;
  function step() {
    if (k >= 11) return false;
    const active = nodes.filter((n) => n.lost === null);
    const bus = Math.min(...active.map((n) => bitOf(n.id, k)));
    active.forEach((n) => { if (bitOf(n.id, k) === 1 && bus === 0) n.lost = k; });
    k++;
    const still = nodes.filter((n) => n.lost === null);
    if (k === 11) {
      if (still.length > 1) note.innerHTML = `<b style="color:var(--bad)">Collision.</b> ${still.length} nodes share ID 0x${CAN.hex3(still[0].id)}. Both win arbitration, then their data bits clash and the bus fills with error frames. IDs must be unique.`;
      else {
        const order = [...nodes].sort((a, b) => a.id - b.id).map((n) => `0x${CAN.hex3(n.id)}`).join(' → ');
        const ids = nodes.map((n) => n.id), dup = ids.find((id, i) => ids.indexOf(id) !== i);
        note.innerHTML = `<b style="color:var(--ok)">0x${CAN.hex3(still[0].id)} ${still[0].name}</b> wins and sends its data untouched. The others retry as soon as the bus is idle, so the frames leave in ID order: ${order}.` +
          (dup !== undefined ? ` <b style="color:var(--bad)">But 0x${CAN.hex3(dup)} is used twice:</b> when those two nodes contend they both win arbitration and corrupt each other's data field. IDs must be unique.` : '');
      }
    } else note.textContent = `Bit ${k - 1} (ID bit ${10 - (k - 1)}): bus reads ${bus ? 'recessive 1' : 'dominant 0'}. ${active.length - still.length ? `${active.length - still.length} node(s) sent 1, read 0 and backed off.` : 'Nobody dropped out.'}`;
    render(); return k < 11;
  }
  function render() {
    let h = '<span class="nm"></span>' + Array.from({ length: 11 }, (_, i) => `<span class="c" style="background:none;color:var(--faint)">${10 - i}</span>`).join('') + '<span></span>';
    for (const n of nodes) {
      h += `<span class="nm" title="${n.name}">${n.custom ? '★ ' : ''}0x${CAN.hex3(n.id)} ${n.name}</span>`;
      for (let i = 0; i < 11; i++) {
        const b = bitOf(n.id, i), shown = i < k;
        const cls = ['c', shown ? (b ? 'r' : 'd') : '', n.lost !== null && i > n.lost ? 'lost' : '', i === k - 1 ? 'cur' : ''].join(' ');
        h += `<span class="${cls}">${shown || true ? b : ''}</span>`;
      }
      const st = n.lost !== null ? `<span class="st lose">lost @${10 - n.lost}</span>` : k === 11 && nodes.filter((x) => x.lost === null).length === 1 ? '<span class="st win">WINS</span>' : '<span class="st">…</span>';
      h += st;
    }
    h += '<span class="nm" style="color:var(--signal)">BUS (wired-AND)</span>';
    for (let i = 0; i < 11; i++) {
      if (i < k) { const act = nodes.filter((n) => n.lost === null || n.lost >= i); const b = Math.min(...act.map((n) => bitOf(n.id, i))); h += `<span class="c ${b ? 'busr' : 'bus'}">${b}</span>`; }
      else h += '<span class="c"></span>';
    }
    h += '<span></span>';
    arb.innerHTML = h;
  }
  function stop() { clearInterval(timer); timer = null; $('#arbRun').textContent = 'Run'; }
  $('#arbStep').onclick = () => { stop(); if (k >= 11) reset(); step(); };
  $('#arbRun').onclick = () => {
    if (timer) return stop();
    if (k >= 11) reset();
    $('#arbRun').textContent = 'Pause';
    timer = setInterval(() => { if (!step()) stop(); }, 650);
  };
  $('#arbReset').onclick = reset;
  $('#arbCustom').addEventListener('change', reset);
  reset();

  // ---- bus load from real frames
  const rates = [125000, 250000, 500000, 1000000];
  let bitsPerSample = 0;
  const measure = () => {
    const d = app.A; let total = 0, cnt = 0;
    for (let i = 0; i < d.n; i += 3) {
      const s = { driver: d.numInt, lap: d.lap, lapTime: d.t[i], distance: i * app.race.ds, speed: d.v[i], rpm: d.rpm[i], throttle: d.thr[i], gear: d.g[i], brake: d.brk[i], drs: d.drs[i], x: d.x[i], y: d.y[i], z: d.z[i] };
      for (const f of CAN.encodeSample(s, cnt)) total += CAN.wireFrame(f.id, f.data).total;
      cnt++;
    }
    bitsPerSample = total / cnt;
  };
  const update = () => {
    const br = rates[+$('#blRate').value], hz = +$('#blHz').value, cars = +$('#blCars').value;
    $('#blRateV').textContent = br >= 1e6 ? '1 Mbit/s' : `${br / 1000} kbit/s`;
    $('#blHzV').textContent = `${hz} Hz`; $('#blCarsV').textContent = cars;
    const load = (cars * hz * bitsPerSample) / br;
    const g = $('#gauge'); g.querySelector('i').style.width = `${Math.min(100, load * 100)}%`;
    g.className = `gauge ${load > 0.9 ? 'crit' : load > 0.7 ? 'warn' : ''}`;
    const pill = $('#loadPill'); pill.textContent = `${(load * 100).toFixed(1)} % load`; pill.className = `pill ${load > 0.9 ? 'bad' : load > 0.7 ? '' : 'ok'}`;
    const maxHz = Math.floor((0.7 * br) / (cars * bitsPerSample));
    $('#loadKv').innerHTML = [
      ['Bits per sample (3 frames, stuffed)', bitsPerSample.toFixed(1)],
      ['Time on the wire per sample', `${((bitsPerSample / br) * 1e6).toFixed(0)} µs`],
      ['Frames per second', (cars * hz * 3).toLocaleString('en-US')],
      ['Max rate per car at 70 % load', `${maxHz.toLocaleString('en-US')} Hz`],
      ['v1 for comparison (1 frame, 10 Hz)', `${((10 * 117) / br * 100).toFixed(2)} %`],
    ].map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
  };
  ['blRate', 'blHz', 'blCars'].forEach((id) => $('#' + id).addEventListener('input', update));
  app.on('cars', () => { measure(); update(); });
}

// ================================================================= RECEIVE
function initReceive(app) {
  const legacy = ['55', '1', '16', '63', '11', '23', '81', '44', '4', '14', '22', '40', '27', '77', '2', '24', '10', '31', '20', '18'];
  const raced = new Set(app.race.drivers.map((d) => d.num));
  const sent = legacy.filter((n) => raced.has(n));
  let wrong = 0;
  const rows = sent.map((n, i) => {
    const d = app.race.byNum[n], filed = legacy[i], bad = filed !== n; wrong += bad;
    return `<tr><td><span class="team" style="background:${d.color}"></span><b>${d.abbr}</b> #${n}</td><td style="color:var(--faint)">→</td><td class="mono" style="color:${bad ? 'var(--bad)' : 'var(--ok)'}">driver_${filed}_telemetry.csv ${bad ? '✗' : '✓'}</td></tr>`;
  });
  $('#mapLines').outerHTML = `<div class="scroll-x scroll-y"><table class="results"><thead><tr><th>Car actually sent</th><th></th><th>Saved as</th></tr></thead><tbody>${rows.join('')}
    <tr><td colspan="3" style="color:var(--muted);white-space:normal">#40 was in the list but did not race, so the sender skipped it. #21 (De Vries) raced but was never requested.</td></tr></tbody></table></div>`;
  $('#wrongCount').textContent = `${wrong} of ${sent.length} files mislabelled`;

  const ber = [0, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1];
  const slider = $('#ber');
  slider.oninput = () => { const p = ber[+slider.value]; app.corruptP = p; $('#berV').textContent = p ? `${(p * 100).toFixed(1)} % of frames` : 'off'; };
  const states = $$('#stateRow span');
  const upd = () => {
    const r = app.rx;
    $('#rxKv').innerHTML = [
      ['Frames received', r.frames.toLocaleString('en-US')], ['Samples logged', r.samples.toLocaleString('en-US')],
      ['Rejected by CRC-8', r.crc], ['Corrupted frames that got through', r.undetected],
    ].map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
    const s = !app.playing && app.tau === 0 ? 'idle' : app.tau < 0.1 ? 'start' : app.tau < app.A.lapTime ? 'stream' : app.tau < app.race.maxLap ? 'end' : 'done';
    states.forEach((x) => x.classList.toggle('hi', x.dataset.s === s));
  };
  let t = 0;
  app.on('frame', () => { if (++t % 10 === 0) upd(); });
  app.on('rx', () => {});
  upd();
}
