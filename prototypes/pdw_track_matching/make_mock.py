"""Mock data for the PDW ↔ track matching prototype — closer to real
conditions. One 10-second recording:

  pdw.csv     what the receiver measured, pulse by pulse
  tracks.csv  what the sensor reported, in the intercept (track) format
  truth.csv   which emitter each PDW really came from — for scoring only

Emitters (amplitudes in dBFS at the peak of the main beam):
  A  fixed PRI 1000 ±1 µs, RF 9400, PW 1.0; circular scan 2.5 s; strong, with
     a multipath echo 7.3 µs later and 9 dB weaker
  B  fixed PRI 1100 ±0.5 µs, RF 9400, PW 1.0 — A's twin on RF and PW; a
     tracking radar (no scan)
  C  5-position stagger 610/700/655/820/745 µs, RF agile over 16 values
     (9200–9600), PW adaptive by position (0.5/1.2/0.5/2.0/1.2)
  D  fixed PRI 1250 ±60 µs (heavy jitter), RF 9450, PW 0.7; circular scan
     4 s and weak, so it's only heard in the main beam: bursts
  E  dwell-switch: 64 pulses at 520, 64 at 580, 64 at 640 µs, repeating;
     RF 9550, PW 0.6
  F  fixed PRI 2000 ±0.5 µs, RF 9400, PW 1.0 — exactly 2× A's PRI, same RF/PW
  G  high PRF: PRI 80 µs, RF 9480, PW 0.3, on from 3 to 6 s
  H  stagger 400/450 µs, RF 3050, PW 0.5, near the receiver's sensitivity;
     never tracked
  clutter  2,000 random pulses a second

Receiver: sensitivity −72 dBFS (weaker pulses are lost; near it, many are),
saturation at −5 dBFS, noise on every measurement that grows for weak
pulses, pulse on pulse (the weaker lost, or the two merged).

Sensor (tracks.csv): each emitter is tracked after its own delay (longer
for harder signals), reported every 100 ms while heard, and dropped after
1.5 s of silence — so D gets a new track number at every sweep. Its
mistakes: C's stagger reported starting from another position and its PW
as an average (1.1, which no pulse has); D's PRI as its mean; E's PRI as
whichever dwell was current; and a ghost track — a PRI of 550 µs at
9400 MHz, half of B's, a deinterleaving error — for 1.2 s.
"""

import csv
import math
import random
from datetime import datetime, timedelta

random.seed(11)
DURATION = 10_000_000  # µs
START = datetime(2025, 12, 1, 11, 10, 8)
SENSITIVITY, SATURATION = -72.0, -5.0


def circular_scan(period, beam_ms, phase):
    """Antenna gain (dB) at time t: a main beam once a period, sidelobes around −30 dB."""
    def gain(t):
        x = ((t / period + phase) % 1.0) - 0.5  # −0.5..0.5, main beam at 0
        main = -12 * (x * period / (beam_ms * 1000)) ** 2  # −3 dB at ±half the beam width
        side = -30 + 3 * math.sin(x * 40)
        return max(main, side)
    return gain


def steady(t):
    return 0.0


def slow_fade(t):
    return 2 * math.sin(t / 700_000)

EMITTERS = {
    "A": dict(kind="fixed", pris=lambda i: 1000.0, jitter=1.0, rf=lambda i: 9400.0, pw=lambda i: 1.0, peak=-30, gain=circular_scan(2_500_000, 60, 0.13),
              echo=(7.3, -9.0), on=(0, DURATION), delay=30_000),
    "B": dict(kind="fixed", pris=lambda i: 1100.0, jitter=0.5, rf=lambda i: 9400.0, pw=lambda i: 1.0, peak=-38, gain=slow_fade, on=(400_000, 9_000_000), delay=60_000),
    "C": dict(kind="stagger", positions=[610.0, 700.0, 655.0, 820.0, 745.0], jitter=0.3,
              rf=lambda i: 9200.0 + 25 * random.randrange(17), pw=lambda i: [0.5, 1.2, 0.5, 2.0, 1.2][i % 5], peak=-33, gain=slow_fade,
              on=(1_200_000, 9_500_000), delay=320_000),
    "D": dict(kind="fixed", pris=lambda i: 1250.0, jitter=60.0, rf=lambda i: 9450.0, pw=lambda i: 0.7, peak=-49, gain=circular_scan(4_000_000, 80, 0.61),
              on=(0, DURATION), delay=90_000),
    "E": dict(kind="fixed", pris=lambda i: [520.0, 580.0, 640.0][(i // 64) % 3], jitter=0.2, rf=lambda i: 9550.0, pw=lambda i: 0.6, peak=-31, gain=slow_fade,
              on=(800_000, 8_800_000), delay=140_000),
    "F": dict(kind="fixed", pris=lambda i: 2000.0, jitter=0.5, rf=lambda i: 9400.0, pw=lambda i: 1.0, peak=-41, gain=steady, on=(2_000_000, 7_000_000), delay=70_000),
    "G": dict(kind="fixed", pris=lambda i: 80.0, jitter=0.0, rf=lambda i: 9480.0, pw=lambda i: 0.3, peak=-36, gain=steady, on=(3_000_000, 6_000_000), delay=20_000),
    "H": dict(kind="stagger", positions=[400.0, 450.0], jitter=0.2, rf=lambda i: 3050.0, pw=lambda i: 0.5, peak=-69, gain=steady, on=(500_000, 7_500_000), delay=None),
}


def emit():
    """Every pulse sent, as [toa µs, rf, pw, amplitude at the receiver, emitter]."""
    pulses = []
    for name, e in EMITTERS.items():
        t, i = e["on"][0] + random.uniform(0, 300), 0
        while t < e["on"][1]:
            amp = e["peak"] + e["gain"](t)
            pulses.append([t, e["rf"](i), e["pw"](i), amp, name])
            if "echo" in e:
                pulses.append([t + e["echo"][0] + random.gauss(0, 0.03), pulses[-1][1], pulses[-1][2], amp + e["echo"][1], name + "-echo"])
            step = e["positions"][i % len(e["positions"])] if e["kind"] == "stagger" else e["pris"](i)
            t += step + random.uniform(-e["jitter"], e["jitter"])
            i += 1
    t = 0.0
    while t < DURATION:
        t += random.expovariate(2000 / 1e6)
        pulses.append([t, random.uniform(2000, 18000), random.uniform(0.1, 8), random.uniform(-75, -45), "clutter"])
    return sorted(pulses)


def receive(pulses):
    """What the receiver makes of them."""
    out, pop = [], 0
    for p in pulses:
        amp = p[3] + random.gauss(0, 1.0)
        if amp < SENSITIVITY:
            continue
        # Near the sensitivity limit many pulses are lost; a few anywhere.
        if random.random() < (0.35 if amp < SENSITIVITY + 4 else 0.02):
            continue
        p = [p[0], p[1], p[2], min(amp, SATURATION), p[4]]
        if out and p[0] < out[-1][0] + out[-1][2]:  # pulse on pulse
            last = out[-1]
            pop += 1
            if random.random() < 0.5:
                if p[3] > last[3]:
                    out[-1] = p + [""]
                continue
            stronger = p if p[3] > last[3] else last
            end = max(last[0] + last[2], p[0] + p[2])
            out[-1] = [last[0], stronger[1], end - last[0], max(last[3], p[3]), f"{last[4]}+{p[4]}", "merged"]
            continue
        out.append(p + [""])
    received = []
    for toa, rf, pw, amp, who, note in out:
        weak = 3.0 if amp < SENSITIVITY + 8 else 1.0  # weak pulses are measured worse
        received.append((round(toa + random.gauss(0, 0.05 * weak), 3), round(rf + random.gauss(0, 1.0 * weak), 2),
                         round(max(0.05, pw + random.gauss(0, 0.03 * weak)), 3), round(amp, 1), who, note))
    return received, pop


def mission_time(us):
    return (START + timedelta(microseconds=us)).strftime("%Y%m%d-%H%M%S.%f")


def report_row(t, number, name, pri_class, rf, pri_ns, pw_ns, jitter_ns, positions_ns, power):
    row = {
        "MissionTime": mission_time(t), "TrackNumber": number, "ModeTrackNumber": number * 10, "ModeAmbiguityCount": 1,
        "ModeIdAmbiguities_0_ModeName": f"Mode {name}", "ReceivedPower": round(power, 1), "Parameters_RF": round(rf, 1),
        "Parameters_PRIClass": pri_class, "Parameters_BasePRI": pri_ns, "Parameters_PulseWidth": pw_ns,
        "Parameters_Parameters_Simple_Jitter": jitter_ns if pri_class == "Fixed" else "",
        "Parameters_Parameters_Stagger_Count": len(positions_ns) if positions_ns else "",
    }
    for i in range(5):
        row[f"Parameters_Parameters_Stagger_Position{i}"] = positions_ns[i] if positions_ns and i < len(positions_ns) else ""
    return row


def tracks(received):
    """The sensor: heard pulses → tracks, after a delay, reported every 100 ms,
    dropped after 1.5 s of silence (and a new number given when it's heard again)."""
    rows, number = [], 1
    for name, e in EMITTERS.items():
        if e["delay"] is None:
            continue
        heard = [p for p in received if p[4] == name]
        # Bursts: runs of heard pulses with no silence over 1.5 s.
        bursts, current = [], [heard[0]]
        for p in heard[1:]:
            if p[0] - current[-1][0] > 1_500_000:
                bursts.append(current)
                current = []
            current.append(p)
        bursts.append(current)
        for burst in bursts:
            if len(burst) < 20:
                continue
            t = burst[0][0] + e["delay"]
            while t <= burst[-1][0] + 100_000:
                recent = [p for p in burst if t - 100_000 <= p[0] <= t] or [min(burst, key=lambda p: abs(p[0] - t))]
                rf = sum(p[1] for p in recent) / len(recent)
                power = sum(p[3] for p in recent) / len(recent) - 30 + random.gauss(0, 0.7)  # dBm: its own scale
                if name == "C":  # stagger reported from another position; PW averaged
                    pos = e["positions"][2:] + e["positions"][:2]
                    rows.append(report_row(t, number, name, "Stagger", rf, round(sum(pos) * 1000), 1100, None, [round(v * 1000) for v in pos], power))
                elif name == "E":  # the current dwell's PRI
                    i = sum(1 for p in heard if p[0] <= t)
                    pri = e["pris"](i)
                    rows.append(report_row(t, number, name, "Fixed", rf, round(pri * 1000), 600, 400, None, power))
                else:
                    pri = e["pris"](0)
                    rows.append(report_row(t, number, name, "Fixed", rf, round(pri * 1000), round(e["pw"](0) * 1000), round(e["jitter"] * 2000), None, power))
                t += 100_000
            number += 1
    # The ghost: half of B's PRI, at B's RF and PW, for 1.2 s.
    t = 4_200_000
    while t < 5_400_000:
        rows.append(report_row(t, number, "ghost", "Fixed", 9400.0 + random.gauss(0, 0.5), 550_000, 1000, 1000, None, -68 + random.gauss(0, 0.7)))
        t += 100_000
    return sorted(rows, key=lambda r: r["MissionTime"])


if __name__ == "__main__":
    sent = emit()
    received, pop = receive(sent)
    with open("pdw.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["Index", "TOA_ns", "Channel", "RF_MHz", "AOA_deg", "PW_ns", "Amplitude_dBFS", "Quality", "Flags"])
        for i, (toa, rf, pw, amp, who, note) in enumerate(received):
            w.writerow([i, round(toa * 1000), random.randint(1, 8), rf, round(random.uniform(0, 360), 1), round(pw * 1000), amp, random.randint(0, 3), "0x00"])
    with open("truth.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["Index", "Emitter", "Note"])
        for i, (toa, rf, pw, amp, who, note) in enumerate(received):
            w.writerow([i, who, note])
    rows = tracks(received)
    with open("tracks.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    per = {}
    for *_, who, _note in received:
        per[who.split("+")[0]] = per.get(who.split("+")[0], 0) + 1
    tracks_by = {}
    for r in rows:
        tracks_by.setdefault(r["ModeIdAmbiguities_0_ModeName"], set()).add(r["TrackNumber"])
    print(f"PDWs: {len(received):,} {dict(sorted(per.items()))}\npulse on pulse: {pop:,}; track reports: {len(rows)}; tracks: "
          + ", ".join(f"{k.split()[-1]}={sorted(v)}" for k, v in tracks_by.items()))
