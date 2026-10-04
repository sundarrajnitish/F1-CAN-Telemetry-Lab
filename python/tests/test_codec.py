import math
import random

import pytest

from f1can import codec
from f1can.codec import CarSample, DecodeError, crc8_sae_j1850, decode, encode_sample


def test_crc8_check_value():
    # Standard check value for CRC-8/SAE-J1850
    assert crc8_sae_j1850(b"123456789") == 0x4B


def _sample(**kw):
    base = dict(driver=1, lap=68, lap_time=12.345, distance=987.0, speed=311.4, rpm=11718, gear=8,
                throttle=100, brake=0, drs=1, x=335.3, y=-206.8, z=13.1)
    base.update(kw)
    return CarSample(**base)


def test_roundtrip_single_sample():
    s = _sample()
    decoded = {}
    for fid, data in encode_sample(s, counter=7):
        assert len(data) == 8
        name, v = decode(fid, data)
        decoded[name] = v
    t = decoded["F1_CarTelemetry"]
    assert t["Speed"] == pytest.approx(311.4, abs=0.05)
    assert t["RPM"] == 11718 and t["Gear"] == 8 and t["DRS"] == 1 and t["Brake"] == 0
    assert t["AliveCounter"] == 7
    ctx = decoded["F1_LapContext"]
    assert ctx["DriverNumber"] == 1 and ctx["LapNumber"] == 68 and ctx["LapDistance"] == 987
    assert ctx["LapTime"] == pytest.approx(12.345, abs=5e-4)
    pos = decoded["F1_Position"]
    assert pos["PosY"] == pytest.approx(-206.8, abs=0.05)  # signed signal survives


def test_top_speed_is_carried_exactly():
    """Canada 2023 peaked at 336.9 km/h (SAR); the 16-bit signal must carry it exactly."""
    _, v = decode(*encode_sample(_sample(speed=336.9), 0)[2])
    assert v["Speed"] == pytest.approx(336.9, abs=0.05)


@pytest.mark.parametrize("seed", range(5))
def test_random_roundtrip(seed):
    rng = random.Random(seed)
    for i in range(200):
        s = _sample(driver=rng.randint(1, 99), lap=rng.randint(1, 70), lap_time=rng.uniform(0, 120),
                    distance=rng.uniform(0, 4400), speed=rng.uniform(0, 380), rpm=rng.randint(0, 15000),
                    gear=rng.randint(0, 8), throttle=rng.randint(0, 100), brake=rng.randint(0, 1),
                    drs=rng.randint(0, 1), x=rng.uniform(-3000, 3000), y=rng.uniform(-3000, 3000), z=rng.uniform(0, 400))
        frames = dict((fid, data) for fid, data in encode_sample(s, i))
        _, t = decode(codec.ID_CAR_TELEMETRY, frames[codec.ID_CAR_TELEMETRY])
        _, c = decode(codec.ID_LAP_CONTEXT, frames[codec.ID_LAP_CONTEXT])
        _, p = decode(codec.ID_POSITION, frames[codec.ID_POSITION])
        assert math.isclose(t["Speed"], s.speed, abs_tol=0.05)
        assert t["RPM"] == round(s.rpm) and t["Gear"] == s.gear and t["Throttle"] == round(s.throttle)
        assert c["DriverNumber"] == s.driver and abs(c["LapDistance"] - s.distance) <= 0.5
        assert math.isclose(p["PosX"], s.x, abs_tol=0.05) and math.isclose(p["PosZ"], s.z, abs_tol=0.05)
        assert t["AliveCounter"] == i % 16


def test_values_clamp_to_signal_range():
    _, v = decode(*encode_sample(_sample(speed=9999, throttle=250, gear=20), 0)[2])
    assert v["Speed"] == pytest.approx(400)   # DBC range [0|400]
    assert v["Throttle"] == 100 and v["Gear"] == 8


def test_corrupted_frame_is_rejected():
    fid, data = encode_sample(_sample(), 3)[2]
    bad = bytearray(data)
    bad[1] ^= 0x10  # flip one RPM bit
    with pytest.raises(DecodeError, match="CRC"):
        decode(fid, bytes(bad))


@pytest.mark.parametrize("which", [0, 1, 2])
def test_every_single_bit_flip_is_detected(which):
    """All three 8-byte messages carry CRC-8 in byte 7, so every single-bit error is caught."""
    fid, data = encode_sample(_sample(), 5)[which]
    for byte in range(8):
        for bit in range(8):
            bad = bytearray(data)
            bad[byte] ^= 1 << bit
            with pytest.raises(DecodeError):
                decode(fid, bytes(bad))


def test_unknown_id():
    with pytest.raises(DecodeError, match="unknown"):
        decode(0x7FF, bytes(8))


def test_session_ctrl():
    fid, data = codec.encode_session(codec.CMD_START_STREAM, 44)
    assert fid == 0x010 and data == bytes([1, 44])
    assert decode(fid, data)[1] == {"Command": 1, "DriverNumber": 44}
