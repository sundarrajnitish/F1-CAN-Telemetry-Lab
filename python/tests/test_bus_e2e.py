"""End to end over a python-can virtual bus: sender thread -> receiver -> CSV -> analysis."""
import threading

import can
import pandas as pd
import pytest

from f1can import codec
from f1can.analysis import compare
from f1can.physical import crc15, frame_time_us, stuff, wire_bits
from f1can.receiver import TelemetryLogger, receive
from f1can.sender import Streamer
from f1can.source import load_csv


def test_stream_two_drivers(tmp_path):
    laps = load_csv(drivers=[1, 14])
    rx_bus = can.Bus(interface="virtual", channel="t-e2e")
    tx_bus = can.Bus(interface="virtual", channel="t-e2e")
    logger = TelemetryLogger(out_dir=tmp_path)
    th = threading.Thread(target=receive, args=(rx_bus, logger, 3.0))
    th.start()
    Streamer(tx_bus, rate_hz=10, speedup=400, gap_s=0.05).stream_session(laps)
    th.join(timeout=20)
    tx_bus.shutdown(); rx_bus.shutdown()

    assert logger.finished
    assert logger.stats.crc_errors == 0 and logger.stats.counter_gaps == 0
    assert set(logger.logs) == {1, 14}
    ver = pd.read_csv(tmp_path / "driver_01_telemetry.csv")
    alo = pd.read_csv(tmp_path / "driver_14_telemetry.csv")
    assert ver["speed_kph"].max() > 300 and ver["rpm"].max() > 11000 and ver["gear"].max() == 8
    assert ver["distance_m"].max() > 4250
    cmp = compare(ver, alo)
    # Official fastest laps: VER 1:15.594, ALO 1:15.779 -> ALO 0.185 s slower
    assert cmp.delta_s[-1] == pytest.approx(0.185, abs=0.12)


def test_logger_counts_crc_errors():
    lg = TelemetryLogger()
    s = codec.CarSample(1, 1, 0, 0, 100, 9000, 3, 50, 0, 0)
    fid, data = codec.encode_sample(s, 0)[2]
    bad = bytearray(data); bad[0] ^= 1
    lg.feed(fid, bytes(bad))
    assert lg.stats.crc_errors == 1 and lg.stats.samples == 0


def test_js_and_python_encoders_agree():
    s = codec.CarSample(1, 68, 12.345, 987, 311.4, 11718, 8, 100, 0, 1, 335.3, -206.8, 13.1)
    frames = {fid: data.hex(" ").upper() for fid, data in codec.encode_sample(s, 7)}
    # Output of docs/js/can.js encodeSample() for the same sample (checked with node)
    assert frames == {0x102: "01 44 DB 03 39 30 70 10", 0x103: "19 0D EC F7 83 70 01 8A", 0x101: "2A 0C C6 2D 64 28 07 F0"}


def test_crc15_and_stuffing_reference():
    # Reference frame used by the website's frame lab (docs/js/can.js)
    w = wire_bits(0x101, bytes([0x2C, 0x0C, 0xC6, 0x2D, 0x64, 0x28, 0x07, 0x00]))
    assert w["crc"] == 3672 and w["total_bits"] == 117 and len(w["stuff_positions"]) == 6  # same as can.js
    stuffed, idx = stuff([0, 0, 0, 0, 0, 0, 0])
    assert stuffed == [0, 0, 0, 0, 0, 1, 0, 0] and idx == [5]
    assert crc15([]) == 0
    # a full 8-byte frame takes 111 bits unstuffed; with stuffing at most 135
    assert 111 <= w["total_bits"] <= 135
    assert frame_time_us(0x101, bytes(8), 500_000) >= 222


def test_worst_case_bits_formula():
    assert codec.frame_bits(0x101, bytes(8)) == 135
