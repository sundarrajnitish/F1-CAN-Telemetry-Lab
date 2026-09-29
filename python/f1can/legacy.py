"""Faithful re-implementation of the original (v1, May 2025) pipeline so its defects can be measured.

Nothing here should be used for real work. It exists so the test-suite and the website can show,
with real 2023 Canadian GP data, exactly what the first version transmitted and what MATLAB
received.
"""
from __future__ import annotations

from typing import Dict

import numpy as np

LEGACY_ID = 0x123

# The driver list hard-coded in CAN_Send.py / CAN_Receive_Performance.m.
# 40 (Lawson) did not race in Canada 2023 and 21 (De Vries) is missing.
LEGACY_DRIVER_ORDER = ['55', '1', '16', '63', '11', '23', '81', '44', '4', '14',
                       '22', '40', '27', '77', '2', '24', '10', '31', '20', '18']


def legacy_encode(speed: float, throttle: float, brake_bool: bool, gear_column_present: bool, gear: int, rpm: float) -> bytes:
    """What CAN_Send.py put on the bus."""
    speed = max(0, min(int(speed), 255))                       # 8-bit clamp: 255 km/h ceiling
    throttle = max(0, min(int(throttle), 100))
    brake = max(0, min(int(brake_bool * 100), 100))
    g = int(gear) if gear_column_present else 0                 # 'Gear' in tel -> False, column is 'nGear'
    rpm = int(rpm)
    return bytes([speed, throttle, brake, g & 0xFF, (rpm >> 8) & 0xFF, rpm & 0xFF, 0, 0])  # RPM big-endian


def legacy_matlab_decode(data: bytes) -> Dict[str, float]:
    """What CAN_Receive*.m computed: bitshift(uint8, 8) saturates/overflows to 0 in MATLAB."""
    b = list(data)
    hi = np.uint8(b[4])
    shifted = int(hi) << 8
    shifted_uint8 = shifted & 0xFF  # MATLAB keeps the uint8 class: bits shifted past bit 7 are lost
    rpm = min(shifted_uint8 + b[5], 255)  # uint8 + uint8 saturates at 255
    return {"speed": b[0], "throttle": b[1], "brake": b[2], "rpm": rpm}


def legacy_dbc_decode(data: bytes) -> Dict[str, float]:
    """What CANalyzer / CAN Explorer showed using the v1 DBC (RPM declared little-endian @ bit 32)."""
    b = list(data)
    return {"Speed": b[0], "Throttle": b[1], "Brake": b[2], "Gear": b[3], "RPM": b[4] | (b[5] << 8)}


def legacy_distance(speed_kph: np.ndarray, wall_dt: float = 0.1) -> float:
    """v1 analysis: cumtrapz(speed/3.6) over receiver wall-clock time (10 Hz), not car time."""
    v = np.asarray(speed_kph, float) / 3.6
    return float(np.trapezoid(v, dx=wall_dt)) if hasattr(np, "trapezoid") else float(np.trapz(v, dx=wall_dt))
