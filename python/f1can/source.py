"""Telemetry sources: live FastF1 download or the bundled CSV (no internet needed).

Both return one :class:`pandas.DataFrame` per driver with the same standard columns, so the
sender does not care where the data came from.
"""
from __future__ import annotations

from pathlib import Path
from typing import Dict, Iterable, Iterator, Optional

import numpy as np
import pandas as pd

from .codec import CarSample

REPO_ROOT = Path(__file__).resolve().parents[2]
BUNDLED_CSV = REPO_ROOT / "data" / "canada2023_fastest_laps.csv"

COLUMNS = ["driver", "abbr", "team", "lap", "time_s", "distance_m", "speed_kph", "rpm", "gear",
           "throttle_pct", "brake", "drs", "x_m", "y_m", "z_m"]
CONTINUOUS = ["distance_m", "speed_kph", "rpm", "throttle_pct", "x_m", "y_m", "z_m"]
DISCRETE = ["gear", "brake", "drs"]


def _standardise(tel: pd.DataFrame, driver: str, abbr: str, team: str, lap: int) -> pd.DataFrame:
    """FastF1 telemetry -> standard columns. Note the real column names: nGear, Brake is bool, DRS is a code."""
    df = pd.DataFrame({
        "driver": int(driver),
        "abbr": abbr,
        "team": team,
        "lap": int(lap),
        "time_s": tel["Time"].dt.total_seconds().to_numpy(),
        "distance_m": np.maximum.accumulate(tel["Distance"].to_numpy(float)),
        "speed_kph": tel["Speed"].to_numpy(float),
        "rpm": tel["RPM"].to_numpy(float),
        "gear": tel["nGear"].to_numpy(int),
        "throttle_pct": np.clip(tel["Throttle"].to_numpy(float), 0, 100),
        "brake": tel["Brake"].astype(bool).astype(int).to_numpy(),
        # FastF1 DRS codes: 10, 12, 14 = flap open; 0-8 = closed / eligible
        "drs": (tel["DRS"].to_numpy(float) >= 10).astype(int),
        "x_m": tel["X"].to_numpy(float) / 10.0,
        "y_m": tel["Y"].to_numpy(float) / 10.0,
        "z_m": tel["Z"].to_numpy(float) / 10.0,
    })
    return df[COLUMNS]


def load_fastf1(year: int = 2023, gp: str = "Canada", session: str = "R",
                drivers: Optional[Iterable[str]] = None, cache_dir: str | Path = "f1_cache",
                offline: bool = False) -> Dict[int, pd.DataFrame]:
    """Fastest-lap telemetry (car + position merged) for every driver who set a timed lap."""
    import fastf1  # imported lazily so the rest of the package works without it

    Path(cache_dir).mkdir(parents=True, exist_ok=True)
    fastf1.Cache.enable_cache(str(cache_dir))
    if offline:
        fastf1.Cache.offline_mode(True)
    ses = fastf1.get_session(year, gp, session)
    ses.load(laps=True, telemetry=True, weather=False, messages=False)
    wanted = [str(d) for d in drivers] if drivers else list(ses.drivers)
    out: Dict[int, pd.DataFrame] = {}
    for num in wanted:
        if num not in ses.drivers:
            print(f"[source] driver {num} did not take part in this session - skipped")
            continue
        lap = ses.laps.pick_drivers(num).pick_fastest()
        if lap is None or pd.isna(lap["LapTime"]):
            print(f"[source] driver {num} has no timed lap - skipped")
            continue
        info = ses.get_driver(num)
        tel = lap.get_telemetry()
        out[int(num)] = _standardise(tel, num, info["Abbreviation"], info["TeamName"], int(lap["LapNumber"]))
    return out


def load_csv(path: str | Path = BUNDLED_CSV, drivers: Optional[Iterable[int]] = None) -> Dict[int, pd.DataFrame]:
    df = pd.read_csv(path)
    keep = {int(d) for d in drivers} if drivers else None
    out: Dict[int, pd.DataFrame] = {}
    for num, grp in df.groupby("driver", sort=False):
        if keep is None or int(num) in keep:
            out[int(num)] = grp.reset_index(drop=True)
    return out


def resample(df: pd.DataFrame, rate_hz: float) -> pd.DataFrame:
    """Uniform time grid. Continuous channels are interpolated, discrete ones use zero-order hold.

    FastF1 car data arrives at roughly 4 Hz, so any rate above that interpolates between real
    samples; it does not add information.
    """
    t = df["time_s"].to_numpy(float)
    grid = np.arange(t[0], t[-1] + 1e-9, 1.0 / rate_hz)
    out = {c: df[c].iloc[0] for c in ("driver", "abbr", "team", "lap")}
    res = pd.DataFrame({"time_s": grid})
    for c, v in out.items():
        res[c] = v
    for c in CONTINUOUS:
        res[c] = np.interp(grid, t, df[c].to_numpy(float))
    idx = np.clip(np.searchsorted(t, grid, side="right") - 1, 0, len(t) - 1)
    for c in DISCRETE:
        res[c] = df[c].to_numpy()[idx]
    return res[COLUMNS]


def iter_samples(df: pd.DataFrame) -> Iterator[CarSample]:
    for r in df.itertuples(index=False):
        yield CarSample(driver=int(r.driver), lap=int(r.lap), lap_time=float(r.time_s), distance=float(r.distance_m),
                        speed=float(r.speed_kph), rpm=float(r.rpm), gear=int(r.gear), throttle=float(r.throttle_pct),
                        brake=int(r.brake), drs=int(r.drs), x=float(r.x_m), y=float(r.y_m), z=float(r.z_m))
