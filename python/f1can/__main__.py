"""Command line entry point: ``python -m f1can {demo,send,receive,compare,dump}``."""
from __future__ import annotations

import argparse
import threading
from pathlib import Path

import can

from . import codec
from .source import BUNDLED_CSV, load_csv, load_fastf1


def _bus(args, receive_own=False) -> can.BusABC:
    kw = {"interface": args.interface, "channel": args.channel}
    if args.interface in ("vector", "pcan", "kvaser", "socketcan", "ixxat"):
        kw["bitrate"] = args.bitrate
    if args.interface == "vector":
        kw["app_name"] = args.app_name
    if args.interface == "virtual":
        kw["receive_own_messages"] = receive_own
    return can.Bus(**kw)


def _laps(args):
    drivers = [d.strip() for d in args.drivers.split(",")] if args.drivers else None
    if args.fastf1:
        return load_fastf1(args.year, args.gp, args.session, drivers, cache_dir=args.cache)
    return load_csv(args.csv, [int(d) for d in drivers] if drivers else None)


def cmd_send(args):
    from .sender import Streamer
    with _bus(args) as bus:
        Streamer(bus, rate_hz=args.rate, speedup=args.speedup).stream_session(_laps(args))


def cmd_receive(args):
    from .receiver import TelemetryLogger, receive
    with _bus(args) as bus:
        receive(bus, TelemetryLogger(out_dir=Path(args.out)), idle_timeout=args.timeout)


def cmd_demo(args):
    """Sender and receiver in one process on a python-can virtual bus - no hardware, no drivers."""
    from .receiver import TelemetryLogger, receive
    from .sender import Streamer
    args.interface, args.channel = "virtual", "f1-demo"
    rx_bus, tx_bus = _bus(args), _bus(args)
    logger = TelemetryLogger(out_dir=Path(args.out))
    rx = threading.Thread(target=receive, args=(rx_bus, logger, 5.0), daemon=True)
    rx.start()
    Streamer(tx_bus, rate_hz=args.rate, speedup=args.speedup, gap_s=0.2).stream_session(_laps(args))
    rx.join(timeout=10)
    tx_bus.shutdown(); rx_bus.shutdown()


def cmd_compare(args):
    import pandas as pd
    from .analysis import compare, plot
    a, b = pd.read_csv(args.a), pd.read_csv(args.b)
    la, lb = (f"#{int(df['driver'].iloc[0])}" if "driver" in df else Path(f).stem
              for df, f in ((a, args.a), (b, args.b)))
    cmp = compare(a, b)
    print(f"final gap {lb} - {la}: {cmp.delta_s[-1]:+.3f} s over {cmp.distance[-1]:.0f} m; "
          f"{la} wins {int((cmp.minisector_winner == 0).sum())}/{len(cmp.minisector_winner)} mini-sectors")
    plot(cmp, la, lb, path=args.png)
    print(f"saved {args.png}")


def cmd_dump(args):
    """Write a candump-format log of the bundled data (input for matlab/CAN_Replay_Offline.m)."""
    from .source import iter_samples, resample
    laps = _laps(args)
    t, counter, lines = 0.0, 0, []
    for df in laps.values():
        drv = int(df["driver"].iloc[0])
        fid, data = codec.encode_session(codec.CMD_START_STREAM, drv)
        lines.append(f"({t:017.6f}) {args.channel} {fid:03X}#{data.hex().upper()}")
        for s in iter_samples(resample(df, args.rate)):
            t_s = t + s.lap_time
            for fid, data in codec.encode_sample(s, counter):
                lines.append(f"({t_s:017.6f}) {args.channel} {fid:03X}#{data.hex().upper()}")
            counter = (counter + 1) & 0xF
        t = t_s + 0.5
        fid, data = codec.encode_session(codec.CMD_END_STREAM, drv)
        lines.append(f"({t:017.6f}) {args.channel} {fid:03X}#{data.hex().upper()}")
    fid, data = codec.encode_session(codec.CMD_END_SESSION, 0)
    lines.append(f"({t:017.6f}) {args.channel} {fid:03X}#{data.hex().upper()}")
    Path(args.out).write_text("\n".join(lines) + "\n")
    print(f"wrote {len(lines)} frames to {args.out}")


def main(argv=None):
    p = argparse.ArgumentParser(prog="f1can", description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    def common(sp, bus=True):
        sp.add_argument("--csv", default=str(BUNDLED_CSV), help="bundled fastest-lap CSV (default)")
        sp.add_argument("--fastf1", action="store_true", help="download with FastF1 instead of using the CSV")
        sp.add_argument("--year", type=int, default=2023); sp.add_argument("--gp", default="Canada")
        sp.add_argument("--session", default="R"); sp.add_argument("--cache", default="f1_cache")
        sp.add_argument("--drivers", help="comma-separated car numbers, e.g. 1,14,44")
        sp.add_argument("--rate", type=float, default=10.0, help="samples per second on the bus")
        sp.add_argument("--speedup", type=float, default=1.0, help="play faster than real time")
        if bus:
            sp.add_argument("--interface", default="udp_multicast",
                            help="python-can interface: udp_multicast (two terminals, no hardware), virtual, vector, socketcan, pcan ...")
            sp.add_argument("--channel", default="239.74.163.2", help="bus channel (Vector: 0, SocketCAN: can0)")
            sp.add_argument("--bitrate", type=int, default=500_000)
            sp.add_argument("--app-name", default="CANalyzer", dest="app_name")

    sp = sub.add_parser("send", help="stream laps onto a bus"); common(sp); sp.set_defaults(fn=cmd_send)
    sp = sub.add_parser("receive", help="log laps from a bus"); common(sp)
    sp.add_argument("--out", default="logs"); sp.add_argument("--timeout", type=float, default=10.0); sp.set_defaults(fn=cmd_receive)
    sp = sub.add_parser("demo", help="send + receive on an in-process virtual bus"); common(sp)
    sp.add_argument("--out", default="logs"); sp.set_defaults(fn=cmd_demo, speedup=20.0)
    sp = sub.add_parser("compare", help="compare two logged laps")
    sp.add_argument("a"); sp.add_argument("b"); sp.add_argument("--png", default="comparison.png"); sp.set_defaults(fn=cmd_compare)
    sp = sub.add_parser("dump", help="write a candump log"); common(sp, bus=False)
    sp.add_argument("--channel", default="vcan0"); sp.add_argument("--out", default="trace.log"); sp.set_defaults(fn=cmd_dump)

    args = p.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    main()
