"""Pure-Python encoder/decoder for the F1 CAN Telemetry Lab message catalogue (v2).

The layouts here mirror ``dbc/f1_telemetry.dbc`` exactly; ``tests/test_dbc_consistency.py``
cross-checks every message against the DBC with cantools, so the two can never drift apart.

Every signal is Intel (little-endian) byte order, which is what ``@1`` means in a DBC file.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Dict, Iterable, Tuple

# --------------------------------------------------------------------------- IDs
ID_SESSION_CTRL = 0x010
ID_CAR_TELEMETRY = 0x101
ID_LAP_CONTEXT = 0x102
ID_POSITION = 0x103

CMD_NONE, CMD_START_STREAM, CMD_END_STREAM, CMD_END_SESSION = 0, 1, 2, 3


@dataclass(frozen=True)
class Signal:
    name: str
    start: int          # start bit, Intel numbering (bit 0 = LSB of byte 0)
    length: int         # bits
    scale: float = 1.0
    offset: float = 0.0
    signed: bool = False
    minimum: float | None = None
    maximum: float | None = None

    @property
    def raw_min(self) -> int:
        return -(1 << (self.length - 1)) if self.signed else 0

    @property
    def raw_max(self) -> int:
        return (1 << (self.length - 1)) - 1 if self.signed else (1 << self.length) - 1


@dataclass(frozen=True)
class Message:
    frame_id: int
    name: str
    dlc: int
    signals: Tuple[Signal, ...]

    def signal(self, name: str) -> Signal:
        for s in self.signals:
            if s.name == name:
                return s
        raise KeyError(name)


SESSION_CTRL = Message(ID_SESSION_CTRL, "F1_SessionCtrl", 2, (
    Signal("Command", 0, 8, minimum=0, maximum=3),
    Signal("DriverNumber", 8, 8, minimum=0, maximum=99),
))

CAR_TELEMETRY = Message(ID_CAR_TELEMETRY, "F1_CarTelemetry", 8, (
    Signal("Speed", 0, 16, 0.1, minimum=0, maximum=400),
    Signal("RPM", 16, 16, minimum=0, maximum=16000),
    Signal("Throttle", 32, 8, minimum=0, maximum=100),
    Signal("Gear", 40, 4, minimum=0, maximum=8),
    Signal("Brake", 44, 1, minimum=0, maximum=1),
    Signal("DRS", 45, 1, minimum=0, maximum=1),
    Signal("AliveCounter", 48, 4, minimum=0, maximum=15),
    Signal("CRC8", 56, 8, minimum=0, maximum=255),
))

LAP_CONTEXT = Message(ID_LAP_CONTEXT, "F1_LapContext", 8, (
    Signal("DriverNumber", 0, 8, minimum=0, maximum=99),
    Signal("LapNumber", 8, 8, minimum=0, maximum=255),
    Signal("LapDistance", 16, 16, minimum=0, maximum=65535),
    Signal("LapTime", 32, 20, 0.001, minimum=0, maximum=1048.575),
    Signal("AliveCounter", 52, 4, minimum=0, maximum=15),
    Signal("CRC8", 56, 8, minimum=0, maximum=255),
))

POSITION = Message(ID_POSITION, "F1_Position", 8, (
    Signal("PosX", 0, 16, 0.1, signed=True, minimum=-3276.8, maximum=3276.7),
    Signal("PosY", 16, 16, 0.1, signed=True, minimum=-3276.8, maximum=3276.7),
    Signal("PosZ", 32, 12, 0.1, minimum=0, maximum=409.5),
    Signal("AliveCounter", 44, 4, minimum=0, maximum=15),
    Signal("DriverNumber", 48, 8, minimum=0, maximum=99),
    Signal("CRC8", 56, 8, minimum=0, maximum=255),
))

CATALOGUE: Dict[int, Message] = {m.frame_id: m for m in (SESSION_CTRL, CAR_TELEMETRY, LAP_CONTEXT, POSITION)}


class DecodeError(ValueError):
    """Raised when a frame fails its length or end-to-end CRC check."""


# --------------------------------------------------------------------------- CRC
def crc8_sae_j1850(data: Iterable[int]) -> int:
    """CRC-8 SAE J1850 (poly 0x1D, init 0xFF, xorout 0xFF). Check value for b'123456789' is 0x4B."""
    crc = 0xFF
    for byte in data:
        crc ^= byte & 0xFF
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1D) & 0xFF if crc & 0x80 else (crc << 1) & 0xFF
    return crc ^ 0xFF


# --------------------------------------------------------------------------- bit packing
def _to_raw(sig: Signal, value: float) -> int:
    """Physical value -> integer raw value, clamped to the DBC [min|max] range first."""
    value = float(value)
    if sig.minimum is not None:
        value = max(sig.minimum, value)
    if sig.maximum is not None:
        value = min(sig.maximum, value)
    raw = (value - sig.offset) / sig.scale
    raw = int(raw + 0.5) if raw >= 0 else -int(-raw + 0.5)
    return max(sig.raw_min, min(sig.raw_max, raw))


def _from_raw(sig: Signal, raw: int) -> float:
    return raw * sig.scale + sig.offset


def pack(msg: Message, values: Dict[str, float]) -> bytes:
    """Pack physical values into ``msg.dlc`` bytes. Missing signals are sent as zero."""
    word = 0
    for sig in msg.signals:
        raw = _to_raw(sig, values.get(sig.name, 0))
        raw &= (1 << sig.length) - 1            # two's complement for signed signals
        word |= raw << sig.start
    return word.to_bytes(msg.dlc, "little")


def unpack(msg: Message, data: bytes) -> Dict[str, float]:
    if len(data) < msg.dlc:
        raise DecodeError(f"{msg.name}: expected {msg.dlc} bytes, got {len(data)}")
    word = int.from_bytes(bytes(data[: msg.dlc]), "little")
    out: Dict[str, float] = {}
    for sig in msg.signals:
        raw = (word >> sig.start) & ((1 << sig.length) - 1)
        if sig.signed and raw & (1 << (sig.length - 1)):
            raw -= 1 << sig.length
        out[sig.name] = _from_raw(sig, raw)
    return out


# --------------------------------------------------------------------------- typed helpers
@dataclass
class CarSample:
    """One telemetry sample as it travels over the bus."""
    driver: int
    lap: int
    lap_time: float     # s since the lap started (car clock, not receiver wall clock)
    distance: float     # m since the start line
    speed: float        # km/h
    rpm: float
    gear: int
    throttle: float     # %
    brake: int          # 0/1
    drs: int            # 0/1
    x: float = 0.0      # m
    y: float = 0.0
    z: float = 0.0

    def as_dict(self) -> dict:
        return asdict(self)


def pack_protected(msg: Message, values: Dict[str, float]) -> bytes:
    """Pack an 8-byte message and write the end-to-end CRC-8 over bytes 0-6 into byte 7."""
    body = bytearray(pack(msg, values))
    body[7] = crc8_sae_j1850(body[:7])
    return bytes(body)


def encode_car_telemetry(s: CarSample, counter: int) -> bytes:
    return pack_protected(CAR_TELEMETRY, {
        "Speed": s.speed, "RPM": s.rpm, "Throttle": s.throttle, "Gear": s.gear,
        "Brake": 1 if s.brake else 0, "DRS": 1 if s.drs else 0, "AliveCounter": counter & 0xF,
    })


def encode_sample(s: CarSample, counter: int) -> Tuple[Tuple[int, bytes], ...]:
    """Return the three frames that describe one sample: (arbitration_id, data) pairs."""
    c = counter & 0xF
    return (
        (ID_LAP_CONTEXT, pack_protected(LAP_CONTEXT, {"DriverNumber": s.driver, "LapNumber": s.lap,
                                                      "LapDistance": s.distance, "LapTime": s.lap_time, "AliveCounter": c})),
        (ID_POSITION, pack_protected(POSITION, {"PosX": s.x, "PosY": s.y, "PosZ": s.z,
                                                "DriverNumber": s.driver, "AliveCounter": c})),
        (ID_CAR_TELEMETRY, encode_car_telemetry(s, c)),
    )


def encode_session(command: int, driver: int = 0) -> Tuple[int, bytes]:
    return ID_SESSION_CTRL, pack(SESSION_CTRL, {"Command": command, "DriverNumber": driver})


def decode(frame_id: int, data: bytes, check_crc: bool = True) -> Tuple[str, Dict[str, float]]:
    """Decode any catalogue frame. Raises DecodeError on unknown IDs or CRC mismatch."""
    msg = CATALOGUE.get(frame_id)
    if msg is None:
        raise DecodeError(f"unknown arbitration id 0x{frame_id:03X}")
    values = unpack(msg, data)
    if check_crc and "CRC8" in values:
        expected = crc8_sae_j1850(bytes(data[:7]))
        if expected != int(values["CRC8"]):
            raise DecodeError(f"CRC mismatch: frame says 0x{int(values['CRC8']):02X}, computed 0x{expected:02X}")
    return msg.name, values


def frame_bits(frame_id: int, data: bytes) -> int:
    """Worst-case length in bits of a classic CAN 2.0A data frame, including stuff bits and IFS.

    47 fixed bits (SOF, 11-bit ID, RTR, IDE, r0, DLC, 15-bit CRC, delimiters, ACK, EOF, 3-bit IFS)
    + 8 bits per data byte + at most one stuff bit per 4 bits of the 34 + 8n stuffable bits.
    """
    n = len(data)
    return 47 + 8 * n + (34 + 8 * n - 1) // 4
