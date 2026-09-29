// Race data access: fastest-lap telemetry on a 10 m distance grid (see tools/export_dataset.py).

export async function loadRace(url = 'data/race.json') {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not load ${url} (${res.status})`);
  const race = await res.json();
  for (const d of race.drivers) {
    for (const k of ['t', 'v', 'rpm', 'thr', 'x', 'y', 'z']) d[k] = Float32Array.from(d[k]);
    for (const k of ['g', 'brk', 'drs']) d[k] = Uint8Array.from(d[k]);
    d.n = d.t.length;
    d.lapLen = (d.n - 1) * race.ds;
    d.numInt = parseInt(d.num, 10);
  }
  race.byNum = Object.fromEntries(race.drivers.map((d) => [d.num, d]));
  race.maxLap = Math.max(...race.drivers.map((d) => d.t[d.n - 1]));
  race.fastest = race.drivers.reduce((a, b) => (a.lapTime < b.lapTime ? a : b));
  return race;
}

// fractional grid index at lap time tau (clamped to the lap)
export function idxAtTime(d, tau) {
  const t = d.t;
  if (tau <= t[0]) return 0;
  if (tau >= t[d.n - 1]) return d.n - 1;
  let lo = 0, hi = d.n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] <= tau) lo = m; else hi = m; }
  return lo + (tau - t[lo]) / (t[hi] - t[lo] || 1);
}

export function timeAtIdx(d, fi) {
  const i = Math.min(Math.floor(fi), d.n - 2), f = fi - i;
  return d.t[i] + (d.t[i + 1] - d.t[i]) * f;
}

// full state at fractional index
export function stateAt(d, fi, ds) {
  fi = Math.max(0, Math.min(d.n - 1.0001, fi));
  const i = Math.floor(fi), f = fi - i, j = i + 1;
  const L = (a) => a[i] + (a[j] - a[i]) * f;
  return {
    driver: d.numInt, lap: d.lap, lapTime: L(d.t), distance: fi * ds,
    speed: L(d.v), rpm: L(d.rpm), throttle: L(d.thr), gear: d.g[i], brake: d.brk[i], drs: d.drs[i],
    x: L(d.x), y: L(d.y), z: L(d.z),
  };
}

export const fmtLap = (s) => {
  if (s == null || !isFinite(s)) return '—';
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${r.toFixed(3).padStart(6, '0')}`;
};
export const signed = (x, n = 3) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(n);
