"""Scores the matcher against truth.csv, which it never reads."""
import csv
from match import run

pulses, tracks, results, analysed, left = run("pdw.csv", "tracks.csv")
truth = {}
with open("truth.csv", newline="") as f:
    for row in csv.DictReader(f):
        truth[int(row["Index"])] = (row["Emitter"].split("+"), row["Note"])


def of(p):
    return truth[p.index][0]


def score():
    rows = []
    for res, a in zip(results, analysed):
        track = res["track"]
        who = track.name.split()[-1]
        train = res["train"]
        right = sum(1 for p in train if who in of(p))
        # Its emitter's pulses within the track's own window (an emitter heard in two sweeps is two tracks).
        lo, hi = track.reports[0].t - 600_000, track.reports[-1].t + 50_000
        total = sum(1 for p in pulses if lo <= p.toa <= hi and who in of(p))
        wrong = {}
        for p in train:
            if who not in of(p):
                k = "+".join(of(p))
                wrong[k] = wrong.get(k, 0) + 1
        odd = a.get("odd", [])
        odd_kinds = {"merged": 0, "another emitter's": 0, "its own, clean": 0}
        for p in odd:
            odd_kinds["merged" if truth[p.index][1] == "merged" else "another emitter's" if who not in of(p) else "its own, clean"] += 1
        echo_pulses = [p for i in res["echoes"] for p in res["all_runs"][i]]
        echo_right = sum(1 for p in echo_pulses if any(e.endswith("-echo") for e in of(p)))
        rows.append({"track": track.number, "who": who, "found": len(train), "correct": right / len(train) if train else None,
                     "recall": right / total if total else None, "wrong": dict(sorted(wrong.items(), key=lambda kv: -kv[1])[:4]),
                     "odd": odd_kinds, "echoes": (len(echo_pulses), echo_right), "borrowed": a["borrowed_pulses"]})
    return rows


if __name__ == "__main__":
    for r in score():
        c = "—" if r["correct"] is None else f"{r['correct']:.1%}"
        rc = "—" if r["recall"] is None else f"{r['recall']:.1%}"
        print(f"track {r['track']:>2} ({r['who']:5}) found {r['found']:>6}  correct {c:>6}  of its pulses {rc:>6}  "
              f"echo pulses set aside {r['echoes'][0]} ({r['echoes'][1]} really echoes)  borrowed set aside {r['borrowed']}")
        if r["wrong"]:
            print(f"      wrong pulses in the train, by true emitter: {r['wrong']}")
        print(f"      odd pulses flagged: {r['odd']}")
    for g in left:
        who = {}
        for p in g["members"]:
            for e in of(p):
                who[e] = who.get(e, 0) + 1
        print(f"untracked group at {g['rf']:.0f} MHz, {g['pulses']} pulses: truly {dict(sorted(who.items(), key=lambda kv: -kv[1]))}")
