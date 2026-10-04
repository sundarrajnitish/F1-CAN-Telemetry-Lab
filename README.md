# F1 CAN Telemetry Lab

Real telemetry from the **2023 Canadian Grand Prix** is streamed over a CAN bus, received at a simulated pit wall, logged and analysed, with Python, MATLAB/Octave and Simulink on the same message catalogue.

**Interactive site:** https://sundarrajnitish.github.io/F1-CAN-Telemetry-Lab/

On the site you can:

- replay all 20 fastest laps as a ghost race in 3D, with a steering-wheel display and a live `candump` trace;
- pack the live sample into a CAN frame bit by bit, flip bits and watch the CRC reject them;
- step through CAN arbitration, work out bus load from real frames, and compare any two drivers on lap distance.

```
FastF1 (live-timing archive)
   │  fastest lap per driver, ~4 Hz car data + positions
   ▼
python -m f1can send ──► CAN bus 500 kbit/s ──► python -m f1can receive    ──► logs/driver_NN.csv ──► compare
  (resample to 10 Hz,     0x010 SessionCtrl     matlab/CAN_Receive_Logger       (lap time + lap distance
   3 frames / sample)     0x101 CarTelemetry    matlab/CAN_Replay_Offline        from the car itself)
                          0x102 LapContext
                          0x103 Position
```

## Quick start (no CAN hardware needed)

```bash
git clone https://github.com/sundarrajnitish/F1-CAN-Telemetry-Lab
cd F1-CAN-Telemetry-Lab/python
pip install -r requirements-dev.txt

python -m f1can demo --drivers 1,14,44          # sender + receiver on an in-process virtual bus
python -m f1can compare logs/driver_01_telemetry.csv logs/driver_14_telemetry.csv
pytest -q                                        # 27 tests
```

The bundled `data/canada2023_fastest_laps.csv` means none of this needs internet. Add `--fastf1` to download any other session with FastF1 instead, for example `--fastf1 --year 2024 --gp Monaco`.

Two terminals, still hardware-free (python-can UDP multicast bus):

```bash
python -m f1can receive                # terminal 1
python -m f1can send --drivers 1,14    # terminal 2
```

With Vector hardware or a Vector virtual channel: `python -m f1can send --interface vector --channel 0`. SocketCAN: `--interface socketcan --channel vcan0`.

### MATLAB / GNU Octave

```matlab
cd matlab
CAN_Replay_Offline                         % decode data/sample_trace_canada2023.log, no toolbox
CAN_Driver_Analysis('logs/driver_01_telemetry.csv', 'logs/driver_14_telemetry.csv')
F1_Telemetry_Model(14)                     % Simulink: replay Alonso's real lap, core blocks only
CAN_Receive_Logger('Vector', 'Virtual 1', 1)   % live, needs Vehicle Network Toolbox
```

`cd matlab/tests; run_tests` runs 7 checks and passes in both MATLAB and Octave.

## Message catalogue

All signals are Intel (little-endian). Byte 7 of every 8-byte frame is a CRC-8 SAE J1850 over bytes 0 to 6. Full definition: [`dbc/f1_telemetry.dbc`](dbc/f1_telemetry.dbc).

| ID | Message | Signals (start bit / length / scale) |
|---|---|---|
| `0x010` | F1_SessionCtrl (2 B) | Command 0/8 (1 = start, 2 = end stream, 3 = end session) · DriverNumber 8/8 |
| `0x101` | F1_CarTelemetry | Speed 0/16 × 0.1 km/h · RPM 16/16 · Throttle 32/8 % · Gear 40/4 · Brake 44/1 · DRS 45/1 · AliveCounter 48/4 · CRC8 56/8 |
| `0x102` | F1_LapContext | DriverNumber 0/8 · LapNumber 8/8 · LapDistance 16/16 m · LapTime 32/20 × 1 ms · AliveCounter 52/4 · CRC8 56/8 |
| `0x103` | F1_Position | PosX 0/16 signed × 0.1 m · PosY 16/16 signed × 0.1 m · PosZ 32/12 × 0.1 m · AliveCounter 44/4 · DriverNumber 48/8 · CRC8 56/8 |

At 10 Hz one car uses 0.7 % of a 500 kbit/s bus. The measured cost, bit stuffing included, is about 351 bits per sample for all three frames.

The same layout lives in three places, and tests keep them identical: `python/f1can/codec.py` (checked against the DBC with cantools), `matlab/f1can_spec.m`, and `docs/js/can.js` (checked byte for byte against Python).

## Design decisions

| Decision | Why |
|---|---|
| Speed in 16 bits × 0.1 km/h (0 to 400) | the field peaked at 336.9 km/h (Sargeant) in Montréal; leaves headroom for any circuit |
| One byte order (Intel) for every signal, defined once in the DBC | Python is checked against the DBC with cantools; MATLAB and JavaScript are checked against Python |
| Gear in 4 bits, brake and DRS as 1-bit flags | FastF1 reports `nGear` 0 to 8 and brake as on/off; the spare bytes carry integrity data |
| Every real sample, resampled to 10 Hz with deadline scheduling | FastF1 car data is ~4.2 Hz; braking zones last 1 to 2 s and must not fall between samples |
| Lap time and lap distance sent by the car (`F1_LapContext`) | logs align on distance immediately, independent of receiver timing |
| `F1_SessionCtrl` at ID `0x010` opens and closes each car's stream | the receiver always knows which car is talking; lowest ID wins arbitration |
| CRC-8 SAE J1850 + 4-bit alive counter in every data frame | every single-bit corruption and every dropped frame is detected (tested on all 64 bits of all three frames) |

`F1_Telemetry_Model.m` builds a Simulink model from core blocks only (any recent release, no toolbox, no hardware) that plays back a real lap on scopes and displays and logs it to the workspace.

## Repository layout

```
dbc/        f1_telemetry.dbc (message catalogue)
python/     f1can package: codec, physical (CRC-15, bit stuffing), source, sender, receiver, analysis
            tests/: codec, DBC consistency, dataset round trip, end-to-end over a virtual bus
matlab/     f1can_decode / f1can_spec / f1can_crc8 / f1can_logger, CAN_Receive_Logger, CAN_Replay_Offline,
            CAN_Driver_Analysis, F1_Telemetry_Model (Simulink), tests/run_tests.m
data/       canada2023_fastest_laps.csv, sample_trace_canada2023.log
tools/      export_dataset.py: FastF1 cache -> CSV + docs/data/race.json
docs/       the interactive site (GitHub Pages, three.js)
```

## Rebuilding the data

```bash
pip install fastf1
python tools/export_dataset.py --cache f1_cache      # downloads the 2023 Canadian GP race session once
```

## Credits

Race data: Formula 1 live timing via [FastF1](https://github.com/theOehrly/Fast-F1). 3D car: *Aston Martin F1 AMR23 2023* by Redgrund, CC BY 4.0, via Wikimedia Commons. Photos and diagrams come from Wikimedia Commons under CC BY / CC BY-SA; the full list is in [`docs/CREDITS.md`](docs/CREDITS.md). three.js is MIT.

This is an independent educational project. It is not associated with Formula 1, the FIA, any team or Vector Informatik.

Code: MIT © Nitish Sundarraj
