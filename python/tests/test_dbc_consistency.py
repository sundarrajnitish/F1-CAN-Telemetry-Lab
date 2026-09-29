"""The pure-Python codec and dbc/f1_telemetry.dbc must describe exactly the same frames."""
from pathlib import Path

import pytest

cantools = pytest.importorskip("cantools")

from f1can import codec  # noqa: E402
from f1can.codec import CarSample, encode_sample  # noqa: E402

DBC = Path(__file__).resolve().parents[2] / "dbc" / "f1_telemetry.dbc"


@pytest.fixture(scope="module")
def db():
    return cantools.database.load_file(str(DBC))


def test_layouts_match(db):
    for fid, msg in codec.CATALOGUE.items():
        m = db.get_message_by_frame_id(fid)
        assert m.name == msg.name and m.length == msg.dlc
        dbc_sigs = {s.name: s for s in m.signals}
        assert set(dbc_sigs) == {s.name for s in msg.signals}
        for s in msg.signals:
            d = dbc_sigs[s.name]
            assert (d.start, d.length, d.byte_order, d.is_signed) == (s.start, s.length, "little_endian", s.signed), s.name
            assert d.scale == pytest.approx(s.scale) and d.offset == pytest.approx(s.offset), s.name


def test_cantools_decodes_our_frames(db):
    s = CarSample(driver=14, lap=50, lap_time=61.234, distance=3500, speed=302.7, rpm=11890, gear=7,
                  throttle=100, brake=0, drs=1, x=-120.5, y=880.2, z=15.0)
    for fid, data in encode_sample(s, 9):
        ours = codec.decode(fid, data)[1]
        theirs = db.decode_message(fid, data, decode_choices=False)
        for k, v in ours.items():
            assert theirs[k] == pytest.approx(v, abs=1e-6), (hex(fid), k)


def test_cantools_encoded_frames_decode_with_ours(db):
    msg = db.get_message_by_name("F1_LapContext")
    data = bytearray(msg.encode({"DriverNumber": 63, "LapNumber": 12, "LapDistance": 4000, "LapTime": 70.5,
                                 "AliveCounter": 4, "CRC8": 0}))
    data[7] = codec.crc8_sae_j1850(data[:7])   # a DBC tool fills the CRC the same way
    v = codec.decode(msg.frame_id, bytes(data))[1]
    assert v["DriverNumber"] == 63 and v["LapDistance"] == 4000 and v["LapTime"] == pytest.approx(70.5)
