// Small canvas helpers: DPR-aware sizing, linear scales, grids and tick labels in theme colours.

export const C = {
  grid: '#222b39', axis: '#3a4658', text: '#93a0b3', faint: '#5d6a7d', fg: '#e9edf3',
  speed: '#4f8dff', throttle: '#35d07f', brake: '#ff5252', rpm: '#d27bff', gear: '#ffb21a', drs: '#2fd3e0',
  signal: '#ffb21a', a: '#4f8dff', b: '#ff5252',
};
export const MONO = '500 11px "JetBrains Mono", ui-monospace, monospace';

export function fit(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (!canvas.dataset.h) canvas.dataset.h = canvas.getAttribute('height') || '300';
  const w = canvas.clientWidth || canvas.parentElement.clientWidth;
  const h = +canvas.dataset.h;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

export const scale = (d0, d1, r0, r1) => {
  const k = (r1 - r0) / (d1 - d0 || 1);
  const f = (v) => r0 + (v - d0) * k;
  f.inv = (p) => d0 + (p - r0) / k;
  return f;
};

export function niceTicks(lo, hi, n = 5) {
  const span = hi - lo || 1;
  const step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) || mag * 10;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

// draw horizontal grid + y labels on the left of a band
export function yAxis(ctx, y, x0, x1, ticks, fmt = (v) => v) {
  ctx.font = MONO; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (const t of ticks) {
    const py = Math.round(y(t)) + 0.5;
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, py); ctx.lineTo(x1, py); ctx.stroke();
    ctx.fillStyle = C.faint; ctx.fillText(fmt(t), x0 - 6, py);
  }
}

export function xAxis(ctx, x, yBase, ticks, fmt = (v) => v, yTop = null) {
  ctx.font = MONO; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = C.faint;
  for (const t of ticks) {
    const px = Math.round(x(t)) + 0.5;
    if (yTop !== null) { ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(px, yTop); ctx.lineTo(px, yBase); ctx.stroke(); }
    ctx.fillText(fmt(t), px, yBase + 5);
  }
}

export function line(ctx, xs, ys, color, width = 1.5, step = false) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < xs.length; i++) {
    if (i === 0) ctx.moveTo(xs[i], ys[i]);
    else if (step) { ctx.lineTo(xs[i], ys[i - 1]); ctx.lineTo(xs[i], ys[i]); }
    else ctx.lineTo(xs[i], ys[i]);
  }
  ctx.stroke();
}

export function label(ctx, text, x, y, color = C.text, align = 'left') {
  ctx.font = '600 11px "JetBrains Mono", ui-monospace, monospace';
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y);
}
