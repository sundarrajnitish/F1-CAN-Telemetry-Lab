"""Receive, validate and log F1 telemetry frames (Python twin of matlab/CAN_Receive_Logger.m)."""
from __future__ import annotations

import csv
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

import can

from . import codec

LOG_COLUMNS = ["driver", "lap", "lap_time_s", "distance_m", "speed_kph", "rpm", "gear", "throttle_pct",
               "brake", "drs", "x_m", "y_m", "z_m"]


@dataclass
class Stats:
    frames: int = 0
    crc_errors: int = 0
    unknown_ids: int = 0
    counter_gaps: int = 0
    samples: int = 0


@dataclass
class TelemetryLogger:
    """State machine fed one frame at a time; keeps one row list per driver.

    A sample is complete when F1_CarTelemetry arrives (it is sent last), and it is joined with the
    latest F1_LapContext / F1_Position frames carrying the same alive counter.
    """
    out_dir: Optional[Path] = None
    logs: Dict[int, List[dict]] = field(default_factory=dict)
    stats: Stats = field(default_factory=Stats)
    current_driver: Optional[int] = None
    finished: bool = False
    _ctx: dict = field(default_factory=dict)
    _pos: dict = field(default_factory=dict)
    _last_counter: Optional[int] = None

    def feed(self, frame_id: int, data: bytes) -> Optional[dict]:
        self.stats.frames += 1
        try:
            name, v = codec.decode(frame_id, data)
        except codec.DecodeError as exc:
            if "CRC" in str(exc):
                self.stats.crc_errors += 1
            else:
                self.stats.unknown_ids += 1
            return None
        if name == "F1_SessionCtrl":
            cmd, drv = int(v["Command"]), int(v["DriverNumber"])
            if cmd == codec.CMD_START_STREAM:
                self.current_driver = drv
                self.logs.setdefault(drv, [])
                self._last_counter = None
            elif cmd == codec.CMD_END_STREAM:
                self._flush(drv)
                self.current_driver = None
            elif cmd == codec.CMD_END_SESSION:
                self.finished = True
            return None
        if name == "F1_LapContext":
            self._ctx = v
            return None
        if name == "F1_Position":
            self._pos = v
            return None
        # F1_CarTelemetry completes a sample
        c = int(v["AliveCounter"])
        if self._last_counter is not None and c != (self._last_counter + 1) & 0xF:
            self.stats.counter_gaps += 1
        self._last_counter = c
        driver = int(self._ctx.get("DriverNumber", self.current_driver or 0))
        row = {
            "driver": driver,
            "lap": int(self._ctx.get("LapNumber", 0)),
            "lap_time_s": round(self._ctx.get("LapTime", 0.0), 3),
            "distance_m": self._ctx.get("LapDistance", 0.0),
            "speed_kph": round(v["Speed"], 1),
            "rpm": int(v["RPM"]),
            "gear": int(v["Gear"]),
            "throttle_pct": int(v["Throttle"]),
            "brake": int(v["Brake"]),
            "drs": int(v["DRS"]),
            "x_m": round(self._pos.get("PosX", 0.0), 1),
            "y_m": round(self._pos.get("PosY", 0.0), 1),
            "z_m": round(self._pos.get("PosZ", 0.0), 1),
        }
        self.logs.setdefault(driver, []).append(row)
        self.stats.samples += 1
        return row

    def _flush(self, driver: int) -> None:
        if self.out_dir is None or not self.logs.get(driver):
            return
        self.out_dir.mkdir(parents=True, exist_ok=True)
        path = self.out_dir / f"driver_{driver:02d}_telemetry.csv"
        with path.open("w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=LOG_COLUMNS)
            w.writeheader()
            w.writerows(self.logs[driver])
        print(f"[receiver] saved {path} ({len(self.logs[driver])} samples)")


def receive(bus: can.BusABC, logger: TelemetryLogger, idle_timeout: float = 5.0) -> TelemetryLogger:
    """Blocking receive loop. Ends on END_SESSION or after ``idle_timeout`` seconds of silence."""
    while not logger.finished:
        msg = bus.recv(timeout=idle_timeout)
        if msg is None:
            print("[receiver] bus idle - stopping")
            break
        if msg.is_error_frame or msg.is_remote_frame:
            continue
        logger.feed(msg.arbitration_id, bytes(msg.data))
    if logger.current_driver is not None:  # stream cut off without END_STREAM
        logger._flush(logger.current_driver)
    s = logger.stats
    print(f"[receiver] frames={s.frames} samples={s.samples} crc_errors={s.crc_errors} "
          f"counter_gaps={s.counter_gaps} unknown_ids={s.unknown_ids}")
    return logger
