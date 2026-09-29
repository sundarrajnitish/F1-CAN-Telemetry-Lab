"""Bit-level view of a classic CAN 2.0A data frame: fields, CRC-15, bit stuffing, NRZ levels.

The website's "frame lab" implements the same algorithm in JavaScript; the unit tests pin a few
reference frames so both implementations stay identical.
"""
from __future__ import annotations

from typing import List, Tuple

CRC15_POLY = 0x4599


def crc15(bits: List[int]) -> int:
    """CAN CRC-15 over the bit sequence SOF..end of data field (ISO 11898-1)."""
    crc = 0
    for b in bits:
        nxt = b ^ ((crc >> 14) & 1)
        crc = (crc << 1) & 0x7FFF
        if nxt:
            crc ^= CRC15_POLY
    return crc


def _bits(value: int, width: int) -> List[int]:
    return [(value >> (width - 1 - i)) & 1 for i in range(width)]


def frame_fields(frame_id: int, data: bytes) -> List[Tuple[str, List[int]]]:
    """Unstuffed fields of a base-format data frame, MSB first, as they appear on the wire."""
    if not 0 <= frame_id < 0x800:
        raise ValueError("base format identifiers are 11 bits")
    if len(data) > 8:
        raise ValueError("classic CAN carries at most 8 data bytes")
    fields = [
        ("SOF", [0]),
        ("ID", _bits(frame_id, 11)),
        ("RTR", [0]),
        ("IDE", [0]),
        ("r0", [0]),
        ("DLC", _bits(len(data), 4)),
        ("DATA", [b for byte in data for b in _bits(byte, 8)]),
    ]
    crc_input = [b for _, bits in fields for b in bits]
    fields.append(("CRC", _bits(crc15(crc_input), 15)))
    return fields


def stuff(bits: List[int]) -> Tuple[List[int], List[int]]:
    """Insert a complementary bit after five identical bits. Returns (stuffed, indices of stuff bits)."""
    out: List[int] = []
    stuffed_at: List[int] = []
    run_bit, run_len = None, 0
    for b in bits:
        out.append(b)
        if b == run_bit:
            run_len += 1
        else:
            run_bit, run_len = b, 1
        if run_len == 5:
            s = 1 - b
            stuffed_at.append(len(out))
            out.append(s)
            run_bit, run_len = s, 1
    return out, stuffed_at


def wire_bits(frame_id: int, data: bytes) -> dict:
    """Complete on-the-wire bit sequence (stuffed region + fixed-form tail) and bookkeeping."""
    fields = frame_fields(frame_id, data)
    raw = [b for _, bits in fields for b in bits]
    stuffed, stuff_idx = stuff(raw)
    # CRC delimiter, ACK slot (dominant when a receiver acknowledges), ACK delimiter, EOF (7), IFS (3)
    tail = [1, 0, 1] + [1] * 7 + [1] * 3
    return {
        "fields": fields,
        "stuffed": stuffed,
        "stuff_positions": stuff_idx,
        "total_bits": len(stuffed) + len(tail),
        "crc": int("".join(map(str, fields[-1][1])), 2),
    }


def frame_time_us(frame_id: int, data: bytes, bitrate: int = 500_000) -> float:
    return wire_bits(frame_id, data)["total_bits"] / bitrate * 1e6
