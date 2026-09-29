"""Stream fastest-lap telemetry onto a CAN bus in (scaled) real time."""
from __future__ import annotations

import time
from typing import Callable, Dict, Optional

import can
import pandas as pd

from . import codec
from .source import iter_samples, resample


class Streamer:
    """Sends each driver's lap as SessionCtrl(START) -> samples -> SessionCtrl(END).

    Scheduling uses absolute deadlines on ``time.perf_counter`` so per-frame jitter never
    accumulates into drift (v1 slept a fixed 0.1 s *after* printing and sending).
    """

    def __init__(self, bus: can.BusABC, rate_hz: float = 10.0, speedup: float = 1.0,
                 gap_s: float = 0.5, on_sample: Optional[Callable[[codec.CarSample], None]] = None):
        if rate_hz <= 0 or speedup <= 0:
            raise ValueError("rate and speedup must be positive")
        self.bus, self.rate_hz, self.speedup, self.gap_s = bus, rate_hz, speedup, gap_s
        self.on_sample = on_sample
        self.counter = 0
        self.frames_sent = 0

    def _send(self, arbitration_id: int, data: bytes) -> None:
        self.bus.send(can.Message(arbitration_id=arbitration_id, data=data, is_extended_id=False))
        self.frames_sent += 1

    def stream_driver(self, df: pd.DataFrame) -> int:
        driver = int(df["driver"].iloc[0])
        self._send(*codec.encode_session(codec.CMD_START_STREAM, driver))
        period = 1.0 / (self.rate_hz * self.speedup)
        t0 = time.perf_counter()
        n = 0
        for n, sample in enumerate(iter_samples(resample(df, self.rate_hz)), start=1):
            deadline = t0 + (n - 1) * period
            delay = deadline - time.perf_counter()
            if delay > 0:
                time.sleep(delay)
            for fid, data in codec.encode_sample(sample, self.counter):
                self._send(fid, data)
            self.counter = (self.counter + 1) & 0xF
            if self.on_sample:
                self.on_sample(sample)
        self._send(*codec.encode_session(codec.CMD_END_STREAM, driver))
        return n

    def stream_session(self, laps: Dict[int, pd.DataFrame]) -> None:
        for i, (driver, df) in enumerate(laps.items()):
            if i:
                time.sleep(self.gap_s / self.speedup)
            n = self.stream_driver(df)
            print(f"[sender] #{driver:<2} {df['abbr'].iloc[0]}: {n} samples, lap {int(df['lap'].iloc[0])}")
        self._send(*codec.encode_session(codec.CMD_END_SESSION, 0))
        print(f"[sender] session complete - {self.frames_sent} frames")
