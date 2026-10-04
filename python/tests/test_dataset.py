"""The bundled 2023 Canadian GP dataset is complete, and every lap survives the CAN round trip intact."""
import pytest

from f1can import codec
from f1can.source import load_csv, resample


@pytest.fixture(scope="module")
def laps():
    return load_csv()


def test_bundled_dataset_is_complete(laps):
    assert len(laps) == 20
    for df in laps.values():
        assert df["distance_m"].max() > 4250          # Circuit Gilles Villeneuve is 4.361 km
        assert 74 < df["time_s"].max() < 79
        assert df["gear"].between(0, 8).all() and df["gear"].max() == 8
        assert set(df["brake"].unique()) <= {0, 1} and set(df["drs"].unique()) <= {0, 1}


def test_signal_ranges_fit_the_catalogue(laps):
    """Real peaks must sit inside the DBC ranges with headroom."""
    top = max(df["speed_kph"].max() for df in laps.values())
    rpm = max(df["rpm"].max() for df in laps.values())
    assert 330 < top < codec.CAR_TELEMETRY.signal("Speed").maximum
    assert 12000 < rpm < codec.CAR_TELEMETRY.signal("RPM").maximum


def test_every_lap_round_trips(laps):
    for num, df in laps.items():
        for r in df.itertuples():
            s = codec.CarSample(num, int(r.lap), r.time_s, r.distance_m, r.speed_kph, r.rpm, r.gear, r.throttle_pct,
                                r.brake, r.drs, r.x_m, r.y_m, r.z_m)
            frames = dict(codec.encode_sample(s, 0))
            t = codec.decode(codec.ID_CAR_TELEMETRY, frames[codec.ID_CAR_TELEMETRY])[1]
            p = codec.decode(codec.ID_POSITION, frames[codec.ID_POSITION])[1]
            assert abs(t["Speed"] - r.speed_kph) <= 0.05 + 1e-9
            assert t["RPM"] == round(r.rpm) and t["Gear"] == r.gear and t["Brake"] == r.brake
            assert abs(p["PosX"] - r.x_m) <= 0.05 + 1e-9 and abs(p["PosY"] - r.y_m) <= 0.05 + 1e-9


def test_resampling_keeps_every_braking_zone(laps):
    """At the 10 Hz streaming rate no braking event of the fastest lap is lost."""
    for df in laps.values():
        native = int(((df["brake"].diff() == 1)).sum())
        streamed = resample(df, 10.0)
        assert int(((streamed["brake"].diff() == 1)).sum()) == native
