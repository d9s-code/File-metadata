# PDW ↔ track matching — prototype

A standalone prototype, not part of the app: it pairs a recording's PDWs
(what the receiver measured, pulse by pulse) with the sensor's track file
(what it concluded — the intercept format) and shows, per track, what the
pulses really were against what the sensor reported. See the "Sensor
analysis" entry in [docs/ROADMAP.md](../../docs/ROADMAP.md) for the idea,
what it would give, and the open questions.

It runs on **mock data** only, so far: the matcher has never seen a real
recording, and its thresholds were tuned on the mock.

Plain Python 3, no packages. In this folder:

```
python3 make_mock.py   # writes pdw.csv, tracks.csv and truth.csv (a 10 s mock recording)
python3 score.py       # matches, then scores the result against truth.csv
python3 report.py      # writes report.html: the sensor at a glance, per track, unexplained signals, the score
```

- `make_mock.py` — the mock recording and its known truth: scanning antennas,
  multipath, a twin on the same RF and PW, a PRI harmonic, heavy jitter, a
  dwell switch, an agile and adaptive 5-position stagger, high PRF, a weak
  untracked emitter, clutter, pulse on pulse; and a sensor with delays by
  signal type, reporting mistakes and a ghost track.
- `match.py` — the matching: per track, the pulse train whose arrival-time
  gaps repeat its PRI(s) or stagger (amplitude and PW pick between
  candidates); then, across tracks, echoes (multipath) and borrowed runs
  (harmonics, ghost tracks); then what each train really was, the scan
  from the amplitude envelope, and whether ReceivedPower follows the pulses.
- `score.py` — compares the result with `truth.csv`, which `match.py` never reads.
- `report.py` — the HTML report.

The mock PDW file has only TOA, RF, PW and amplitude (plus a few ignored
columns); a real PDW file's layout, and its collects (the receiver's tuning
over time), aren't handled yet — see the roadmap entry.
