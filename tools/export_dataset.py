"""Build the bundled dataset and the website data from the FastF1 cache.

    python tools/export_dataset.py --cache f1_cache [--offline]

Outputs
  data/canada2023_fastest_laps.csv   native-rate fastest-lap telemetry for every classified car
  docs/data/race.json                compact 10 m distance-grid version + race context for the site
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python"))
from f1can.source import _standardise  # noqa: E402

# Braking zones of Circuit Gilles Villeneuve, located from the speed minima of the fastest laps.
CORNERS = [
    dict(label="T1–T2", name="Virage Senna", d=320),
    dict(label="T3–T4", name="Chicane", d=710),
    dict(label="T6–T7", name="Island chicane", d=1240),
    dict(label="T8–T9", name="Chicane", d=1990),
    dict(label="T10", name="L'Épingle hairpin", d=2670),
    dict(label="T13–T14", name="Final chicane / Wall of Champions", d=3870),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default="f1_cache")
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--ds", type=float, default=10.0)
    args = ap.parse_args()

    import fastf1
    fastf1.set_log_level("ERROR")
    fastf1.Cache.enable_cache(args.cache)
    if args.offline:
        fastf1.Cache.offline_mode(True)
    s = fastf1.get_session(2023, "Canada", "R")
    s.load()
    res = s.results

    rows, drivers = [], []
    for num in s.drivers:
        r = res.loc[num]
        laps = s.laps.pick_drivers(num)
        fl = laps.pick_fastest()
        if fl is None or pd.isna(fl["LapTime"]):
            continue
        tel = fl.get_telemetry()
        std = _standardise(tel, num, r["Abbreviation"], r["TeamName"], int(fl["LapNumber"]))
        rows.append(std)

        d = std["distance_m"].to_numpy() + np.arange(len(std)) * 1e-9
        grid = np.arange(0, d[-1], args.ds)
        lin = lambda c: np.interp(grid, d, std[c].to_numpy(float))
        idx = np.clip(np.searchsorted(d, grid), 0, len(d) - 1)
        hold = lambda c: std[c].to_numpy()[idx]
        raw = fl.get_car_data()
        td = lambda x: None if pd.isna(x) else round(x.total_seconds(), 3)
        drivers.append(dict(
            num=num, abbr=r["Abbreviation"], name=r["FullName"], team=r["TeamName"],
            color="#" + (r["TeamColor"] or "888888"),
            pos=None if pd.isna(r["Position"]) else int(r["Position"]),
            grid=None if pd.isna(r["GridPosition"]) else int(r["GridPosition"]),
            status=r["Status"], points=float(r["Points"]),
            lap=int(fl["LapNumber"]), lapTime=fl["LapTime"].total_seconds(), compound=fl["Compound"],
            tyreLife=None if pd.isna(fl["TyreLife"]) else int(fl["TyreLife"]),
            s1=td(fl["Sector1Time"]), s2=td(fl["Sector2Time"]), s3=td(fl["Sector3Time"]),
            speedTrap=None if pd.isna(fl["SpeedST"]) else float(fl["SpeedST"]),
            rawHz=round(1 / raw["Date"].diff().dt.total_seconds().median(), 2), rawN=len(raw),
            t=np.round(lin("time_s"), 3).tolist(), v=np.round(lin("speed_kph"), 1).tolist(),
            rpm=np.round(lin("rpm")).astype(int).tolist(), g=hold("gear").astype(int).tolist(),
            thr=np.clip(np.round(lin("throttle_pct")), 0, 100).astype(int).tolist(),
            brk=hold("brake").astype(int).tolist(), drs=hold("drs").astype(int).tolist(),
            x=np.round(lin("x_m"), 1).tolist(), y=np.round(lin("y_m"), 1).tolist(), z=np.round(lin("z_m"), 1).tolist(),
            lapTimes=[td(x) for x in laps["LapTime"]], lapNums=laps["LapNumber"].astype(int).tolist(),
            compounds=laps["Compound"].fillna("UNKNOWN").tolist(),
            positions=[None if pd.isna(p) else int(p) for p in laps["Position"]],
            raw=dict(t=np.round(raw["Time"].dt.total_seconds().to_numpy(), 3).tolist(),
                     v=raw["Speed"].astype(float).round(1).tolist(), rpm=raw["RPM"].astype(int).tolist(),
                     g=raw["nGear"].astype(int).tolist(), thr=raw["Throttle"].astype(int).clip(0, 100).tolist(),
                     brk=raw["Brake"].astype(int).tolist()),
        ))
        print(f"{num:>2} {r['Abbreviation']} lap {int(fl['LapNumber'])} {fl['LapTime'].total_seconds():.3f}s")

    csv_path = ROOT / "data" / "canada2023_fastest_laps.csv"
    out = pd.concat(rows, ignore_index=True)
    out["rpm"] = out["rpm"].round().astype(int)
    out["throttle_pct"] = out["throttle_pct"].round().astype(int)
    out.round({"time_s": 3, "distance_m": 2, "speed_kph": 1, "x_m": 1, "y_m": 1, "z_m": 1}).to_csv(csv_path, index=False)

    w = s.weather_data
    rc = s.race_control_messages
    site = dict(
        event="2023 Canadian Grand Prix", circuit="Circuit Gilles Villeneuve, Montréal", date="2023-06-18",
        totalLaps=int(s.laps["LapNumber"].max()), ds=args.ds, corners=CORNERS,
        weather=dict(air=[float(w["AirTemp"].min()), float(w["AirTemp"].max())],
                     track=[float(w["TrackTemp"].min()), float(w["TrackTemp"].max())],
                     humidity=round(float(w["Humidity"].mean()), 1), rain=bool(w["Rainfall"].any())),
        raceControl=[dict(lap=None if pd.isna(m["Lap"]) else int(m["Lap"]), cat=m["Category"], msg=m["Message"])
                     for _, m in rc.iterrows()],
        drivers=drivers,
        source="FastF1 / F1 live-timing, 2023 Canadian Grand Prix race session",
    )
    js = ROOT / "docs" / "data" / "race.json"
    js.parent.mkdir(parents=True, exist_ok=True)
    js.write_text(json.dumps(site, separators=(",", ":"), ensure_ascii=False))
    print(f"wrote {csv_path} ({len(out)} rows) and {js} ({js.stat().st_size / 1e3:.0f} kB)")


if __name__ == "__main__":
    main()
