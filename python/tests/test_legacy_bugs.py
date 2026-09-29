"""Regression evidence: measure the v1 defects on the real Canadian GP data, and show v2 fixes them."""
from pathlib import Path

import numpy as np
import pytest

from f1can import codec
from f1can.legacy import (LEGACY_DRIVER_ORDER, legacy_dbc_decode, legacy_distance, legacy_encode,
                          legacy_matlab_decode)
from f1can.source import load_csv

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def laps():
    return load_csv()


def test_bundled_dataset_is_complete(laps):
    assert len(laps) == 20
    for df in laps.values():
        assert df["distance_m"].max() > 4250          # Circuit Gilles Villeneuve is 4.361 km
        assert 74 < df["time_s"].max() < 79


def test_v1_speed_saturates(laps):
    ver = laps[1]
    above = (ver["speed_kph"] > 255).mean()
    assert above > 0.25                                # more than a quarter of the lap is above 255 km/h
    sent = [legacy_encode(v, 100, False, False, 7, 11000)[0] for v in ver["speed_kph"]]
    assert max(sent) == 255


def test_v1_rpm_is_garbage_in_matlab_and_canalyzer():
    rpm = 11718
    data = legacy_encode(300, 100, False, False, 8, rpm)
    assert legacy_matlab_decode(data)["rpm"] == rpm & 0xFF          # only the low byte survives
    assert legacy_dbc_decode(data)["RPM"] == ((rpm & 0xFF) << 8) | (rpm >> 8)  # bytes swapped
    assert legacy_dbc_decode(data)["RPM"] != rpm


def test_v1_gear_always_zero(laps):
    tel_columns = ["Speed", "RPM", "nGear", "Throttle", "Brake"]  # real FastF1 column names
    assert "Gear" not in tel_columns
    data = legacy_encode(200, 50, False, "Gear" in tel_columns, 5, 10000)
    assert data[3] == 0


def test_v1_distance_integrated_on_wall_clock(laps):
    """Every 10th ~4 Hz sample, replayed at 10 Hz and integrated over receiver time."""
    ver = laps[1]
    raw4hz = ver.iloc[::2]                              # merged car+pos telemetry is ~8 Hz -> ~4 Hz car rows
    decimated = raw4hz["speed_kph"].to_numpy()[::10].clip(0, 255)
    d = legacy_distance(decimated)
    assert d < 400                                      # vs 4 361 m in reality
    assert len(decimated) < 40                          # ~30 points describe a 75 s lap


def test_v1_driver_labels_shift():
    raced = {'1', '14', '44', '16', '55', '11', '23', '31', '18', '77', '81', '10', '4', '22', '27', '24', '20', '21', '63', '2'}
    sent = [d for d in LEGACY_DRIVER_ORDER if d in raced]        # sender skips cars that did not race
    labels = LEGACY_DRIVER_ORDER[: len(sent)]                     # receiver labels by list position
    mislabeled = sum(a != b for a, b in zip(sent, labels))
    assert mislabeled == 8                                        # everything after '40' is off by one
    assert '21' not in LEGACY_DRIVER_ORDER


def test_v2_preserves_the_lap(laps):
    ver = laps[1]
    errs = []
    for r in ver.itertuples():
        s = codec.CarSample(1, 68, r.time_s, r.distance_m, r.speed_kph, r.rpm, r.gear, r.throttle_pct, r.brake, r.drs, r.x_m, r.y_m, r.z_m)
        v = codec.decode(*codec.encode_sample(s, 0)[2])[1]
        errs.append(abs(v["Speed"] - r.speed_kph))
        assert v["RPM"] == round(r.rpm) and v["Gear"] == r.gear
    assert max(errs) <= 0.05 + 1e-9
