"""PDW ↔ track matching prototype, second version.

For each track (the sensor's reports with one TrackNumber), find the pulse
train behind it: pulses, within a generous window before and during the
track, whose arrival-time gaps repeat the track's PRI(s) or stagger. RF and
PW pre-filter loosely; the timing pattern decides, and among pulses that
fit the timing, the one whose amplitude (and, for a fixed PRI, PW)
continues the train's is taken.

Then, using every track's runs together:
  - echoes: a run at a constant time offset from another, consistently
    weaker — multipath, not the emitter;
  - borrowed runs: runs made mostly of another track's pulses, where that
    track explains them better (fires more often, or misses fewer) — a PRI
    harmonic, or a sensor deinterleaving error (a ghost track);
and measures what each train really was: RF and PW values, jitter, odd
pulses (pulse on pulse, or another emitter's), the scan from the amplitude
envelope, and whether the track's ReceivedPower follows the pulses.

Only TOA, RF, PW and amplitude are read from the PDW file.
"""

import bisect
import csv
import statistics
import sys
from dataclasses import dataclass, field
from datetime import datetime

LOOKBACK_US = {"fixed": 600_000, "stagger": 1_000_000}  # an upper bound, not the sensor's delay
MAX_MISSES = 3
MIN_CYCLES = 4
AMP_STEP_DB = 12  # a train's amplitude doesn't jump more than this from pulse to pulse


@dataclass(eq=False)
class Pulse:
    toa: float  # µs
    rf: float
    pw: float  # µs
    amp: float  # dBFS
    index: int
    trains: list = field(default_factory=list)  # track numbers whose train has it
    role: str = ""  # "echo" once it's known to be one


@dataclass
class Report:
    t: float
    pri_class: str
    pattern: list  # µs
    jitter: float  # µs, peak to peak
    rf: float
    pw: float
    power: float  # dBm


@dataclass
class Track:
    number: str
    name: str
    reports: list

    @property
    def pri_class(self):
        return self.reports[-1].pri_class

    @property
    def gaps(self):
        """Fixed: every PRI it reported (a dwell switch reports several);
        stagger: the positions, in order."""
        if self.pri_class == "stagger":
            return self.reports[-1].pattern
        return sorted({round(r.pattern[0], 1) for r in self.reports})

    @property
    def mean_gap(self):
        g = self.gaps
        return sum(g) / len(g)


def read_pdws(path):
    pulses = []
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            pulses.append(Pulse(int(row["TOA_ns"]) / 1000, float(row["RF_MHz"]), int(row["PW_ns"]) / 1000, float(row["Amplitude_dBFS"]), int(row["Index"])))
    pulses.sort(key=lambda p: p.toa)
    return pulses


def read_tracks(path, day_start):
    by_number = {}
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            by_number.setdefault(row["TrackNumber"], []).append(row)
    tracks = []
    for number, rows in by_number.items():
        reports = []
        for row in rows:
            kind = row["Parameters_PRIClass"].lower()
            if kind == "stagger":
                n = int(row["Parameters_Parameters_Stagger_Count"])
                pattern = [int(row[f"Parameters_Parameters_Stagger_Position{i}"]) / 1000 for i in range(n)]
            else:
                pattern = [int(row["Parameters_BasePRI"]) / 1000]
            t = (datetime.strptime(row["MissionTime"], "%Y%m%d-%H%M%S.%f") - day_start).total_seconds() * 1e6
            reports.append(Report(t, kind, pattern, int(row["Parameters_Parameters_Simple_Jitter"] or 0) / 1000, float(row["Parameters_RF"]),
                                  int(row["Parameters_PulseWidth"]) / 1000, float(row["ReceivedPower"])))
        tracks.append(Track(number, rows[0]["ModeIdAmbiguities_0_ModeName"], sorted(reports, key=lambda r: r.t)))
    return tracks


def candidates(pulses, toas, track):
    first, last = track.reports[0], track.reports[-1]
    lo = bisect.bisect_left(toas, first.t - LOOKBACK_US.get(track.pri_class, 1_000_000))
    hi = bisect.bisect_right(toas, last.t + 50_000)
    rfs = [r.rf for r in track.reports]
    pw = statistics.median(r.pw for r in track.reports)
    if track.pri_class == "fixed":
        rf_lo, rf_hi = min(rfs) - 15, max(rfs) + 15
        # Longer is kept too: maybe merged (pulse on pulse); flagged later.
        def pw_ok(p):
            return abs(p.pw - pw) <= max(0.3, pw * 0.4) or p.pw > pw
    else:  # agile and adaptive allowed
        rf_lo, rf_hi = min(rfs) - 500, max(rfs) + 500

        def pw_ok(p):
            return pw / 3 <= p.pw <= pw * 3
    return [p for p in pulses[lo:hi] if rf_lo <= p.rf <= rf_hi and pw_ok(p)]


def find_runs(cands, track):
    """Runs of pulses whose gaps fit the track's pattern, allowing up to
    MAX_MISSES missing pulses in a row; between pulses that fit the timing,
    the one continuing the run's amplitude (and PW, for a fixed PRI) wins."""
    gaps, stagger = track.gaps, track.pri_class == "stagger"
    jitter = max(r.jitter for r in track.reports)
    tol = max(jitter / 2 + 1.0, 1.0)
    toas = [p.toa for p in cands]
    used = set()
    runs = []

    def best_near(t, amp_ref, pw_ref):
        i = bisect.bisect_left(toas, t - tol)
        best, best_cost = None, None
        while i < len(toas) and toas[i] <= t + tol:
            if i not in used:
                p = cands[i]
                damp = abs(p.amp - amp_ref)
                if damp <= AMP_STEP_DB:
                    cost = abs(toas[i] - t) / tol + damp / 4 + (0 if stagger else abs(p.pw - pw_ref) / 0.2)
                    if best is None or cost < best_cost:
                        best, best_cost = i, cost
            i += 1
        return best

    def grow(start, phase):
        chain = [start]
        k, misses = phase, 0
        virtual = toas[start]
        while misses <= MAX_MISSES:
            recent = [cands[j] for j in chain[-5:]]
            amp_ref = statistics.median(p.amp for p in recent)
            pw_ref = statistics.median(p.pw for p in recent)
            if stagger:
                expected = virtual + gaps[k]
                j = best_near(expected, amp_ref, pw_ref)
                k = (k + 1) % len(gaps)
            else:
                # Any of the PRIs it reported (a dwell switch changes PRI).
                options = [(best_near(virtual + g, amp_ref, pw_ref), g) for g in gaps]
                options = [(j, g) for j, g in options if j is not None]
                j = min(options, key=lambda o: abs(toas[o[0]] - (virtual + o[1])))[0] if options else None
                if j is None:
                    last_gap = (toas[chain[-1]] - toas[chain[-2]]) if len(chain) > 1 else gaps[0]
                    expected = virtual + min(gaps, key=lambda g: abs(g - last_gap))
            if j is not None:
                chain.append(j)
                misses = 0
                virtual = toas[j]
            else:
                misses += 1
                virtual = expected
        return chain

    for start in range(len(cands)):
        if start in used:
            continue
        best = []
        for phase in range(len(gaps) if stagger else 1):
            chain = grow(start, phase)
            if len(chain) > len(best):
                best = chain
        if len(best) >= MIN_CYCLES * (len(gaps) if stagger else 2) + 1:
            runs.append([cands[i] for i in best])
            used.update(best)
    return runs, tol


def presence(run, mean_gap):
    span = run[-1].toa - run[0].toa
    return len(run) / (1 + span / mean_gap) if span else 1.0


def find_echoes(runs, merged):
    """This track's runs that repeat a track's pulses (all its runs together,
    `merged`: {track: (pulses, toas)}) at a constant delay, consistently
    weaker: multipath. Returns {run index: (track, delay µs, dB)}."""
    echoes = {}
    for i, r2 in enumerate(runs):
        mine = {id(p) for p in r2}
        for owner, (others, t1) in merged.items():
            offsets, damps = [], []
            for p in r2:
                k = bisect.bisect_right(t1, p.toa) - 1
                # Not the same pulse (two tracks' runs may share pulses), but the one before it.
                while k >= 0 and p.toa - t1[k] < 60 and (id(others[k]) in mine or t1[k] >= p.toa - 0.3):
                    k -= 1
                if k >= 0 and p.toa - t1[k] < 60:
                    offsets.append(p.toa - t1[k])
                    damps.append(p.amp - others[k].amp)
            # Most at the same delay (weak echoes' times are measured less precisely), and weaker.
            if len(offsets) < len(r2) * 0.7:
                continue
            typical = statistics.median(offsets)
            if sum(abs(o - typical) <= 0.5 for o in offsets) >= len(r2) * 0.7 and statistics.median(damps) < -3:
                echoes[i] = (owner, typical, statistics.median(damps))
                break
    return echoes


def pct(values, q):
    s = sorted(values)
    return s[min(len(s) - 1, max(0, round(q / 100 * (len(s) - 1))))] if s else None


def clusters(values, width, share=0.03):
    out = []
    for v in sorted(values):
        if out and v - out[-1][-1] <= width:
            out[-1].append(v)
        else:
            out.append([v])
    return [(statistics.median(c), len(c)) for c in out if len(c) >= max(3, len(values) * share)]


def scan_of(train):
    """The scan, from the amplitude envelope: the strongest pulse per 20 ms."""
    bins = {}
    for p in train:
        b = int(p.toa // 20_000)
        bins[b] = max(bins.get(b, -999), p.amp)
    amps = list(bins.values())
    if len(amps) < 5:
        return None
    top, floor = max(amps), pct(amps, 10)
    if top - floor < 12:
        return {"kind": "steady", "spread": pct(amps, 95) - pct(amps, 5)}
    peaks, current = [], []
    for b in sorted(bins):
        if bins[b] >= top - 6:
            current.append(b)
        elif current:
            peaks.append(current)
            current = []
    if current:
        peaks.append(current)
    centres = [sum(b for b in c) / len(c) * 20_000 + 10_000 for c in peaks]
    period = statistics.median(b - a for a, b in zip(centres, centres[1:])) if len(centres) > 1 else None
    widest = max(peaks, key=len)
    beam = sum(1 for b in widest if bins[b] >= max(bins[x] for x in widest) - 3) * 20
    return {"kind": "scanning", "period_s": period / 1e6 if period else None, "beam_ms": beam, "illuminations": len(centres), "depth": top - floor}


def power_check(track, train):
    """Does ReceivedPower (dBm) follow the pulses' amplitude (dBFS)? Their
    offset should hold steady if it does."""
    toas = [p.toa for p in train]
    offsets = []
    for r in track.reports:
        lo, hi = bisect.bisect_left(toas, r.t - 100_000), bisect.bisect_right(toas, r.t)
        if hi > lo:
            offsets.append(r.power - statistics.mean(p.amp for p in train[lo:hi]))
    if len(offsets) < 3:
        return None
    return {"offset": statistics.median(offsets), "spread": pct(offsets, 90) - pct(offsets, 10), "reports": len(offsets)}


def run(pdw_path, track_path, day_start=datetime(2025, 12, 1, 11, 10, 8)):
    pulses = read_pdws(pdw_path)
    toas = [p.toa for p in pulses]
    tracks = read_tracks(track_path, day_start)

    # 1. Each track's runs, on its own.
    found = {}
    for track in tracks:
        cands = candidates(pulses, toas, track)
        runs, tol = find_runs(cands, track)
        found[track.number] = {"runs": runs, "tol": tol, "cands": cands}

    # 2. Echoes: runs repeating a run of any track, later and weaker.
    merged = {}
    for t in tracks:
        ps = sorted({id(p): p for r in found[t.number]["runs"] for p in r}.values(), key=lambda p: p.toa)
        merged[t.number] = (ps, [p.toa for p in ps])
    for track in tracks:
        f = found[track.number]
        f["echoes"] = find_echoes(f["runs"], merged)
        for i in f["echoes"]:
            for p in f["runs"][i]:
                p.role = "echo"
    # A run made mostly of pulses another track's echo runs already are: an echo too.
    for track in tracks:
        f = found[track.number]
        for i, r in enumerate(f["runs"]):
            if i not in f["echoes"] and sum(p.role == "echo" for p in r) >= len(r) * 0.6:
                f["echoes"][i] = ("(known echoes)", None, None)
                for p in r:
                    p.role = "echo"
    owners = {}  # pulse → tracks whose (non-echo) runs have it
    for track in tracks:
        for i, r in enumerate(found[track.number]["runs"]):
            if i not in found[track.number]["echoes"]:
                for p in r:
                    owners.setdefault(id(p), set()).add(track.number)

    # 3. Borrowed runs: mostly another track's pulses, where that track explains them better.
    by_number = {t.number: t for t in tracks}
    for track in tracks:
        f = found[track.number]
        f["borrowed"] = {}
        for i, r in enumerate(f["runs"]):
            if i in f["echoes"]:
                continue
            others = {}
            for p in r:
                for n in owners.get(id(p), ()):
                    if n != track.number:
                        others[n] = others.get(n, 0) + 1
            for n, shared in sorted(others.items(), key=lambda kv: -kv[1]):
                if shared < len(r) * 0.6:
                    break
                other = by_number[n]
                mine = presence(r, track.mean_gap)
                # Against each of the other track's runs that shares these pulses, on its own: two of
                # its runs side by side (say, through every other pulse of a train) don't add up.
                ids = {id(p) for p in r}
                theirs = max((presence(rr, other.mean_gap) for k, rr in enumerate(found[n]["runs"])
                              if k not in found[n]["echoes"] and sum(id(p) in ids for p in rr) >= len(r) * 0.6), default=0)
                if theirs > mine + 0.1 or (abs(theirs - mine) <= 0.1 and other.mean_gap < track.mean_gap):
                    f["borrowed"][i] = (n, shared / len(r), mine, theirs)
                    break

    # 4. Each track's train: its runs that are neither echoes nor borrowed.
    results = []
    for track in tracks:
        f = found[track.number]
        keep = [r for i, r in enumerate(f["runs"]) if i not in f["echoes"] and i not in f["borrowed"]]
        train = sorted((p for r in keep for p in r), key=lambda p: p.toa)
        for p in train:
            p.trains.append(track.number)
        results.append({**f, "track": track, "train": train, "runs": keep, "all_runs": f["runs"]})

    analysed = [analyse(r) for r in results]
    link_split_tracks(analysed)
    return pulses, tracks, results, analysed, leftovers(pulses, tracks)


def analyse(res):
    track, train, tol = res["track"], res["train"], res["tol"]
    out = {"track": track.number, "name": track.name, "class": track.pri_class, "gaps": track.gaps, "tol": tol,
           "reports": len(track.reports), "first_report": track.reports[0].t, "last_report": track.reports[-1].t,
           "echoes": [(owner, off, db) for (owner, off, db) in res["echoes"].values() if off is not None],
           "echo_pulses": sum(len(res["all_runs"][i]) for i in res["echoes"]),
           "borrowed": list(res["borrowed"].values()),
           "borrowed_pulses": sum(len(res["all_runs"][i]) for i in res["borrowed"])}
    if not train:
        out["pulses"] = 0
        return out
    expected = sum(1 + (r[-1].toa - r[0].toa) / track.mean_gap for r in res["runs"])
    # Odd pulses: longer than the nearest of the train's own PWs by more than they normally vary,
    # at an RF none of its pulses has, or much stronger than the pulses around them (merged with a stronger one).
    pw_values = [c for c, _ in clusters([p.pw for p in train], 0.1)] or [statistics.median(p.pw for p in train)]
    rf_values = [c for c, _ in clusters([p.rf for p in train], 8)] or [statistics.median(p.rf for p in train)]
    over = [p.pw - min(pw_values, key=lambda v: abs(v - p.pw)) for p in train]
    # How much PW normally varies, by amplitude (3 dB steps): weak pulses are measured less precisely.
    by_level = {}
    for p, o in zip(train, over):
        by_level.setdefault(int(p.amp // 3), []).append(abs(o))
    spread = {lvl: statistics.median(v) * 1.4826 for lvl, v in by_level.items() if len(v) >= 20}
    overall = statistics.median(abs(o) for o in over) * 1.4826

    def pw_limit_at(amp):
        lvl = int(amp // 3)
        near = [spread[k] for k in (lvl - 1, lvl, lvl + 1) if k in spread]
        return max(0.06, 5 * (max(near) if near else overall))

    pw_limit = pw_limit_at(statistics.median(p.amp for p in train))
    # Amplitude compared with the pulses around it in its own run.
    jumps = {}
    for r in res["runs"]:
        for i, p in enumerate(r):
            around = [q.amp for q in r[max(0, i - 4):i] + r[i + 1:i + 5]]
            jumps[id(p)] = p.amp - statistics.median(around) if around else 0
    odd = []
    for p, o in zip(train, over):
        jump = jumps.get(id(p), 0)
        if o > pw_limit_at(p.amp) or min(abs(p.rf - v) for v in rf_values) > 15 or jump > 6:
            odd.append(p)
    odd_ids = {id(p) for p in odd}
    clean = [p for p in train if id(p) not in odd_ids]
    rfs, pws = [p.rf for p in clean], [p.pw for p in clean]
    deviations = []
    if track.pri_class == "fixed":
        for r in res["runs"]:
            for a, b in zip(r, r[1:]):
                gap = b.toa - a.toa
                pri = min(track.gaps, key=lambda g: abs(gap / max(1, round(gap / g)) - g))
                deviations.append(gap / max(1, round(gap / pri)) - pri)
    pri_seen = None
    if track.pri_class == "fixed" and len(track.gaps) > 1:
        used = {}
        for r in res["runs"]:
            for a, b in zip(r, r[1:]):
                g = min(track.gaps, key=lambda x: abs(b.toa - a.toa - x))
                if abs(b.toa - a.toa - g) <= tol:
                    used[g] = used.get(g, 0) + 1
        pri_seen = used
    density = len(res["cands"]) / max(1.0, res["cands"][-1].toa - res["cands"][0].toa)
    p_hit = min(1.0, 2 * tol * density)
    shared_with = {}
    for p in train:
        for n in p.trains:
            if n != track.number:
                shared_with[n] = shared_with.get(n, 0) + 1
    out.update({
        "pulses": len(train), "expected": round(expected), "present": len(train) / expected, "runs": len(res["runs"]),
        "start": train[0].toa, "end": train[-1].toa, "delay_ms": (track.reports[0].t - train[0].toa) / 1000,
        "rf_reported": statistics.median(r.rf for r in track.reports), "rf_minmax": (min(p.rf for p in train), max(p.rf for p in train)),
        "rf_p5_95": (pct(rfs, 5), pct(rfs, 95)), "rf_values": clusters(rfs, 8),
        "pw_reported": statistics.median(r.pw for r in track.reports), "pw_minmax": (min(p.pw for p in train), max(p.pw for p in train)),
        "pw_p5_95": (pct(pws, 5), pct(pws, 95)), "pw_values": clusters(pws, 0.1),
        "jitter_reported": max(r.jitter for r in track.reports),
        "jitter_measured": (pct(deviations, 99) - pct(deviations, 1)) if deviations else None,
        "pri_seen": pri_seen, "odd": odd, "pw_limit": pw_limit, "shared_with": shared_with,
        "amp_minmax": (min(p.amp for p in train), max(p.amp for p in train)),
        "scan": scan_of(train), "power": power_check(track, train),
        "chance_per_run": len(res["cands"]) * p_hit ** (MIN_CYCLES * (len(track.gaps) if track.pri_class == "stagger" else 2)),
    })
    return out


def link_split_tracks(analysed):
    """Tracks that look like one emitter heard at different times: the same
    pattern, RF and PW, not overlapping in time."""
    for a in analysed:
        a["same_as"] = []
    for i, a in enumerate(analysed):
        for b in analysed[i + 1:]:
            if not a.get("pulses") or not b.get("pulses") or a["class"] != b["class"] or a["gaps"] != b["gaps"]:
                continue
            if abs(a["rf_reported"] - b["rf_reported"]) > 5 or abs(a["pw_reported"] - b["pw_reported"]) > 0.1:
                continue
            if a["start"] <= b["end"] and b["start"] <= a["end"]:
                continue
            first, second = (a, b) if a["start"] < b["start"] else (b, a)
            gap = (second["start"] - first["end"]) / 1e6
            first["same_as"].append((second["track"], gap))
            second["same_as"].append((first["track"], gap))


def leftovers(pulses, tracks=()):
    """Pulses in no train (and not echoes), grouped by RF, with their
    commonest gaps: signals there that no track explains."""
    free = [p for p in pulses if not p.trains and p.role != "echo"]
    groups = {}
    for p in free:
        groups.setdefault(round(p.rf / 50), []).append(p)
    found = []
    for ps in groups.values():
        if len(ps) < 100:
            continue
        gaps = [round(b.toa - a.toa) for a, b in zip(ps, ps[1:])]
        common = {}
        for g in gaps:
            common[g // 5 * 5] = common.get(g // 5 * 5, 0) + 1
        top = sorted(common.items(), key=lambda kv: -kv[1])[:3]
        rf = statistics.median(p.rf for p in ps)
        like = [t.number for t in tracks if t.pri_class == "fixed" and any(abs(g - top[0][0]) <= 6 for g in t.gaps)
                and abs(statistics.median(r.rf for r in t.reports) - rf) <= 15] if top else []
        # At a track's RF but much longer: its pulses merged with others (pulse on pulse).
        merged_like = [t.number for t in tracks if abs(statistics.median(r.rf for r in t.reports) - rf) <= 15
                       and statistics.median(p.pw for p in ps) > 2 * statistics.median(r.pw for r in t.reports)]
        found.append({"rf": rf, "pw": statistics.median(p.pw for p in ps), "pw_values": [v for v, _ in clusters([p.pw for p in ps], 0.15, 0.1)],
                      "pulses": len(ps), "amp": statistics.median(p.amp for p in ps), "start": ps[0].toa, "end": ps[-1].toa,
                      "gaps": [(g, c) for g, c in top if c >= len(gaps) * 0.08], "like_track": like, "merged_like": merged_like, "members": ps})
    return sorted(found, key=lambda g: -g["pulses"])


if __name__ == "__main__":
    import time
    t0 = time.time()
    pulses, tracks, results, analysed, left = run(sys.argv[1], sys.argv[2])
    print(f"{len(pulses):,} PDWs, {len(tracks)} tracks in {time.time() - t0:.1f} s")
    for a in analysed:
        print({k: v for k, v in a.items() if k not in ("odd",)})
    for g in left:
        print({k: v for k, v in g.items() if k != "members"})
