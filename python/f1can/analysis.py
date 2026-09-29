"""Distance-aligned driver comparison (Python twin of matlab/CAN_Driver_Analysis.m)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Tuple

import numpy as np
import pandas as pd


@dataclass
class Comparison:
    distance: np.ndarray
    a: pd.DataFrame
    b: pd.DataFrame
    delta_s: np.ndarray          # + means driver B is behind driver A at that point
    minisector_winner: np.ndarray  # 0 = A faster, 1 = B faster, per mini-sector
    minisector_edges: np.ndarray


def _on_grid(df: pd.DataFrame, grid: np.ndarray) -> pd.DataFrame:
    d = np.maximum.accumulate(df["distance_m"].to_numpy(float))
    d = d + np.arange(len(d)) * 1e-9  # strictly increasing for np.interp
    time_col = "lap_time_s" if "lap_time_s" in df else "time_s"
    out = {"distance_m": grid, "time_s": np.interp(grid, d, df[time_col].to_numpy(float))}
    for c in ("speed_kph", "rpm", "throttle_pct"):
        out[c] = np.interp(grid, d, df[c].to_numpy(float))
    idx = np.clip(np.searchsorted(d, grid), 0, len(d) - 1)
    for c in ("gear", "brake", "drs"):
        out[c] = df[c].to_numpy()[idx]
    return pd.DataFrame(out)


def compare(a: pd.DataFrame, b: pd.DataFrame, step_m: float = 5.0, n_minisectors: int = 25) -> Comparison:
    end = min(a["distance_m"].max(), b["distance_m"].max())
    grid = np.arange(0.0, end, step_m)
    A, B = _on_grid(a, grid), _on_grid(b, grid)
    delta = B["time_s"].to_numpy() - A["time_s"].to_numpy()
    edges = np.linspace(0, end, n_minisectors + 1)
    winners = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        ta = np.interp(hi, grid, A["time_s"]) - np.interp(lo, grid, A["time_s"])
        tb = np.interp(hi, grid, B["time_s"]) - np.interp(lo, grid, B["time_s"])
        winners.append(0 if ta <= tb else 1)
    return Comparison(grid, A, B, delta, np.array(winners), edges)


def braking_zones(df: pd.DataFrame) -> Tuple[np.ndarray, np.ndarray]:
    """Distances where the brake flag switches on / off."""
    b = df["brake"].to_numpy().astype(int)
    d = df["distance_m"].to_numpy(float)
    on = d[1:][(b[1:] == 1) & (b[:-1] == 0)]
    off = d[1:][(b[1:] == 0) & (b[:-1] == 1)]
    return on, off


def plot(cmp: Comparison, label_a: str, label_b: str, color_a: str = "#1f77b4", color_b: str = "#d62728", path=None):
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(5, 1, figsize=(12, 11), sharex=True,
                           gridspec_kw={"height_ratios": [3, 1.4, 1.4, 1, 1.6]})
    d = cmp.distance
    ax[0].plot(d, cmp.a["speed_kph"], color=color_a, label=label_a, lw=1.4)
    ax[0].plot(d, cmp.b["speed_kph"], color=color_b, label=label_b, lw=1.4)
    ax[0].set_ylabel("Speed [km/h]"); ax[0].legend(loc="lower right")
    ax[1].plot(d, cmp.a["throttle_pct"], color=color_a, lw=1.1); ax[1].plot(d, cmp.b["throttle_pct"], color=color_b, lw=1.1)
    ax[1].set_ylabel("Throttle [%]")
    ax[2].step(d, cmp.a["gear"], color=color_a, lw=1.1, where="post"); ax[2].step(d, cmp.b["gear"], color=color_b, lw=1.1, where="post")
    ax[2].set_ylabel("Gear")
    ax[3].fill_between(d, 0, cmp.a["brake"], color=color_a, alpha=.45, step="post")
    ax[3].fill_between(d, 0, -cmp.b["brake"], color=color_b, alpha=.45, step="post")
    ax[3].set_ylabel("Brake"); ax[3].set_yticks([])
    ax[4].plot(d, cmp.delta_s, color="k", lw=1.3); ax[4].axhline(0, color="grey", lw=.6)
    ax[4].set_ylabel(f"Δt {label_b}−{label_a} [s]"); ax[4].set_xlabel("Lap distance [m]")
    for a in ax:
        a.grid(alpha=.25)
    fig.suptitle(f"{label_a} vs {label_b} - fastest laps, aligned on lap distance")
    fig.tight_layout()
    if path:
        fig.savefig(path, dpi=130)
    return fig
