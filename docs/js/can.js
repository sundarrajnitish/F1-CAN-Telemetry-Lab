// CAN codec for the browser: identical layouts to python/f1can/codec.py and dbc/f1_telemetry.dbc.
// Also: the CAN 2.0A wire format (CRC-15, bit stuffing) used by the frame lab.

export const ID = { SESSION: 0x010, TELEMETRY: 0x101, LAP: 0x102, POSITION: 0x103 };

const S = (name, start, len, scale = 1, signed = false, min = null, max = null, unit = '') =>
  ({ name, start, len, scale, signed, min, max, unit });

export const MESSAGES = {
  [ID.SESSION]: { id: ID.SESSION, name: 'F1_SessionCtrl', dlc: 2, signals: [
    S('Command', 0, 8, 1, false, 0, 3), S('DriverNumber', 8, 8, 1, false, 0, 99)] },
  [ID.TELEMETRY]: { id: ID.TELEMETRY, name: 'F1_CarTelemetry', dlc: 8, signals: [
    S('Speed', 0, 16, 0.1, false, 0, 400, 'km/h'), S('RPM', 16, 16, 1, false, 0, 16000, 'rpm'),
    S('Throttle', 32, 8, 1, false, 0, 100, '%'), S('Gear', 40, 4, 1, false, 0, 8),
    S('Brake', 44, 1, 1, false, 0, 1), S('DRS', 45, 1, 1, false, 0, 1),
    S('AliveCounter', 48, 4, 1, false, 0, 15), S('CRC8', 56, 8, 1, false, 0, 255)] },
  [ID.LAP]: { id: ID.LAP, name: 'F1_LapContext', dlc: 8, signals: [
    S('DriverNumber', 0, 8, 1, false, 0, 99), S('LapNumber', 8, 8, 1, false, 0, 255),
    S('LapDistance', 16, 16, 1, false, 0, 65535, 'm'), S('LapTime', 32, 20, 0.001, false, 0, 1048.575, 's'),
    S('AliveCounter', 52, 4, 1, false, 0, 15), S('CRC8', 56, 8, 1, false, 0, 255)] },
  [ID.POSITION]: { id: ID.POSITION, name: 'F1_Position', dlc: 8, signals: [
    S('PosX', 0, 16, 0.1, true, -3276.8, 3276.7, 'm'), S('PosY', 16, 16, 0.1, true, -3276.8, 3276.7, 'm'),
    S('PosZ', 32, 12, 0.1, false, 0, 409.5, 'm'), S('AliveCounter', 44, 4, 1, false, 0, 15),
    S('DriverNumber', 48, 8, 1, false, 0, 99), S('CRC8', 56, 8, 1, false, 0, 255)] },
};

export function crc8(bytes) {           // CRC-8 SAE J1850
  let crc = 0xff;
  for (const b of bytes) {
    crc ^= b & 0xff;
    for (let i = 0; i < 8; i++) crc = crc & 0x80 ? ((crc << 1) ^ 0x1d) & 0xff : (crc << 1) & 0xff;
  }
  return crc ^ 0xff;
}

function toRaw(sig, value) {
  let v = Number(value) || 0;
  if (sig.min !== null) v = Math.max(sig.min, v);
  if (sig.max !== null) v = Math.min(sig.max, v);
  let raw = v / sig.scale;
  raw = raw >= 0 ? Math.floor(raw + 0.5) : -Math.floor(-raw + 0.5);
  const lo = sig.signed ? -(2 ** (sig.len - 1)) : 0;
  const hi = sig.signed ? 2 ** (sig.len - 1) - 1 : 2 ** sig.len - 1;
  return Math.max(lo, Math.min(hi, raw));
}

// bits[] is little-endian: bits[0] = LSB of byte 0 (Intel numbering)
export function bytesToBits(bytes) {
  const bits = [];
  for (const b of bytes) for (let i = 0; i < 8; i++) bits.push((b >> i) & 1);
  return bits;
}
export function bitsToBytes(bits) {
  const out = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let k = 0; k < 8; k++) b |= (bits[i + k] & 1) << k;
    out.push(b);
  }
  return out;
}

export function pack(msg, values) {
  const bits = new Array(msg.dlc * 8).fill(0);
  for (const sig of msg.signals) {
    let raw = toRaw(sig, values[sig.name] ?? 0);
    if (raw < 0) raw += 2 ** sig.len;
    for (let k = 0; k < sig.len; k++) bits[sig.start + k] = Math.floor(raw / 2 ** k) % 2;
  }
  return bitsToBytes(bits);
}

export function unpack(msg, bytes) {
  const bits = bytesToBits(bytes.slice(0, msg.dlc));
  const out = {}, raw = {};
  for (const sig of msg.signals) {
    let r = 0;
    for (let k = 0; k < sig.len; k++) r += bits[sig.start + k] * 2 ** k;
    if (sig.signed && r >= 2 ** (sig.len - 1)) r -= 2 ** sig.len;
    raw[sig.name] = r;
    out[sig.name] = +(r * sig.scale).toFixed(6);
  }
  return { values: out, raw };
}

export function packProtected(msg, values) {
  const b = pack(msg, values);
  b[7] = crc8(b.slice(0, 7));
  return b;
}

export function encodeTelemetry(s, counter) {
  return packProtected(MESSAGES[ID.TELEMETRY], {
    Speed: s.speed, RPM: s.rpm, Throttle: s.throttle, Gear: s.gear,
    Brake: s.brake ? 1 : 0, DRS: s.drs ? 1 : 0, AliveCounter: counter & 15 });
}

export function encodeSample(s, counter) {
  const c = counter & 15;
  return [
    { id: ID.LAP, data: packProtected(MESSAGES[ID.LAP], { DriverNumber: s.driver, LapNumber: s.lap, LapDistance: s.distance, LapTime: s.lapTime, AliveCounter: c }) },
    { id: ID.POSITION, data: packProtected(MESSAGES[ID.POSITION], { PosX: s.x, PosY: s.y, PosZ: s.z, DriverNumber: s.driver, AliveCounter: c }) },
    { id: ID.TELEMETRY, data: encodeTelemetry(s, c) },
  ];
}

export function decode(id, bytes) {
  const msg = MESSAGES[id];
  if (!msg) return { ok: false, err: `unknown id 0x${id.toString(16)}` };
  const { values, raw } = unpack(msg, bytes);
  if ('CRC8' in raw) {
    const expected = crc8(bytes.slice(0, 7));
    if (expected !== raw.CRC8) return { ok: false, name: msg.name, values, raw, err: 'CRC', expected };
  }
  return { ok: true, name: msg.name, values, raw };
}

// ---------------------------------------------------------------- CAN 2.0A wire format
export function crc15(bits) {
  let crc = 0;
  for (const b of bits) {
    const nxt = b ^ ((crc >> 14) & 1);
    crc = (crc << 1) & 0x7fff;
    if (nxt) crc ^= 0x4599;
  }
  return crc;
}
const msb = (v, w) => Array.from({ length: w }, (_, i) => (v >> (w - 1 - i)) & 1);

export function wireFrame(id, data) {
  const fields = [
    ['SOF', [0]], ['ID', msb(id, 11)], ['RTR', [0]], ['IDE', [0]], ['r0', [0]], ['DLC', msb(data.length, 4)],
    ['DATA', data.flatMap((b) => msb(b, 8))],
  ];
  const crcIn = fields.flatMap((f) => f[1]);
  const crc = crc15(crcIn);
  fields.push(['CRC', msb(crc, 15)]);
  // stuffing over SOF..CRC
  const seq = [];
  fields.forEach(([name, bits]) => bits.forEach((b, i) => seq.push({ b, field: name, i })));
  const out = [];
  let run = null, len = 0;
  for (const bit of seq) {
    out.push({ ...bit, stuff: false });
    if (bit.b === run) len++; else { run = bit.b; len = 1; }
    if (len === 5) { const s = 1 - bit.b; out.push({ b: s, field: bit.field, stuff: true }); run = s; len = 1; }
  }
  const tail = [['CRC delim', 1], ['ACK', 0], ['ACK delim', 1], ...Array(7).fill(['EOF', 1]), ...Array(3).fill(['IFS', 1])];
  tail.forEach(([f, b]) => out.push({ b, field: f, stuff: false }));
  return { bits: out, crc, stuffCount: out.filter((x) => x.stuff).length, total: out.length };
}

export const hex = (bytes) => bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
export const hex3 = (id) => id.toString(16).toUpperCase().padStart(3, '0');
