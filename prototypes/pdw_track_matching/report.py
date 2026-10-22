"""Writes report.html: the sensor at a glance; per track, what it reported
against what its pulses show (RF, PW and amplitude over time); signals no
track explains; and how the matching scored against the mock's truth."""

import html
import score as scoring

pulses, tracks, results, analysed, left = scoring.pulses, scoring.tracks, scoring.results, scoring.analysed, scoring.left
names = {t.number: t.name for t in tracks}
MAX_POINTS = 2500  # per series, so the page stays light


def thin(data):
    step = max(1, len(data) // MAX_POINTS)
    return data[::step]


def chart(series, t0, t1, y_label, reports=(), report_values=None, height=170, width=900, digits=None):
    pts = [(t, y) for _, _, data in series for t, y in data if t0 <= t <= t1]
    if not pts:
        return ""
    ys = [y for _, y in pts] + [v for _, v in (report_values or []) if t0 <= _ <= t1]
    lo, hi = min(ys), max(ys)
    pad = (hi - lo) * 0.08 or 1
    lo, hi = lo - pad, hi + pad
    L, R, T, B = 64, 12, 24, 28
    def x(t):
        return L + (t - t0) / (t1 - t0) * (width - L - R)

    def y(v):
        return T + (hi - v) / (hi - lo) * (height - T - B)
    d = digits if digits is not None else (2 if hi - lo < 5 else 0)
    out = [f'<svg viewBox="0 0 {width} {height}" class="chart" role="img" aria-label="{html.escape(y_label)} over time">']
    for i in range(5):
        v = lo + (hi - lo) * i / 4
        out.append(f'<line x1="{L}" x2="{width - R}" y1="{y(v):.1f}" y2="{y(v):.1f}" class="grid"/>'
                   f'<text x="{L - 6}" y="{y(v) + 4:.1f}" class="tick" text-anchor="end">{v:,.{d}f}</text>')
    for i in range(6):
        t = t0 + (t1 - t0) * i / 5
        out.append(f'<text x="{x(t):.1f}" y="{height - 8}" class="tick" text-anchor="middle">{t / 1e6:.2f} s</text>')
    for t in reports:
        if t0 <= t <= t1:
            out.append(f'<line x1="{x(t):.1f}" x2="{x(t):.1f}" y1="{T}" y2="{height - B}" class="report"/>')
    if report_values:
        pts_r = [(t, v) for t, v in report_values if t0 <= t <= t1]
        out.append('<polyline class="reported" fill="none" points="' + " ".join(f"{x(t):.1f},{y(v):.1f}" for t, v in pts_r) + '"/>')
    for cls, r, data in series:
        out.append(f'<g class="{cls}">' + "".join(f'<circle cx="{x(t):.1f}" cy="{y(v):.1f}" r="{r}"/>' for t, v in thin(data) if t0 <= t <= t1) + "</g>")
    out.append(f'<text x="{L}" y="12" class="axis">{html.escape(y_label)}</text></svg>')
    return "".join(out)


def signal_of(a):
    if a["class"] == "stagger":
        kind = f"{len(a['gaps'])}-position stagger"
    elif a.get("pri_seen"):
        kind = "dwell-switch PRI"
    elif a.get("jitter_measured") and a["jitter_measured"] > 20:
        kind = "jittered PRI"
    else:
        kind = "fixed PRI"
    extra = []
    if len(a["rf_values"]) > 1:
        extra.append("RF agile")
    if len(a["pw_values"]) > 1:
        extra.append("PW adaptive")
    if a["scan"] and a["scan"]["kind"] == "scanning":
        extra.append("scanning")
    return ", ".join([kind] + extra)


summary, sections = [], []
by_track = {a["track"]: a for a in analysed}
for res, a in zip(results, analysed):
    track = res["track"]
    if not a.get("pulses"):
        reasons = []
        for n, share, mine, theirs in a["borrowed"][:1]:
            reasons.append(f"{share:.0%} of the pulses that fit it are track {n}'s ({html.escape(names[n])}), which has {theirs:.0%} of its expected pulses where this track would have {mine:.0%}.")
        verdict = "No pulse train of its own. " + " ".join(reasons)
        if a["borrowed"]:
            lender = next(t for t in tracks if t.number == a["borrowed"][0][0])
            ratio = lender.mean_gap / track.mean_gap
            if abs(ratio - round(ratio)) < 0.05 and round(ratio) > 1:
                verdict += f" Its PRI is 1/{round(ratio)} of track {lender.number}'s: most likely the sensor deinterleaved one emitter wrongly."
        summary.append(f"<tr class='flag'><td>{track.number}</td><td>{html.escape(track.name)}</td><td colspan='5'>{html.escape(verdict)}</td></tr>")
        sections.append(f"<section class='track'><h2>Track {track.number} <span class='muted'>· {html.escape(track.name)}</span></h2><p class='warn'>{html.escape(verdict)}</p></section>")
        continue
    train, odd_ids = res["train"], {id(p) for p in a["odd"]}
    in_train = {id(p) for p in train}
    other = [p for p in res["cands"] if id(p) not in in_train]
    echo = [p for i in res["echoes"] for p in res["all_runs"][i]]
    rf_vals = ", ".join(f"{v:,.0f}" for v, _ in a["rf_values"])
    really_rf = f"{len(a['rf_values'])} values, {a['rf_values'][0][0]:,.0f}–{a['rf_values'][-1][0]:,.0f}" if len(a["rf_values"]) > 1 else f"{a['rf_values'][0][0]:,.1f}"
    really_pw = " / ".join(f"{v:.2f}" for v, _ in a["pw_values"])
    findings = []
    if len(a["rf_values"]) > 1:
        findings.append(f"RF is agile over {len(a['rf_values'])} values ({rf_vals} MHz); the sensor reports one, {a['rf_reported']:,.1f} MHz.")
    if len(a["pw_values"]) > 1:
        findings.append(f"PW takes {len(a['pw_values'])} values ({really_pw} µs); the sensor reports {a['pw_reported']:.2f} µs" + (", which no pulse has." if all(abs(v - a['pw_reported']) > 0.05 for v, _ in a['pw_values']) else "."))
    if a.get("pri_seen"):
        findings.append("PRI switches between " + ", ".join(f"{g:g} µs ({n:,} gaps)" for g, n in sorted(a["pri_seen"].items())) + "; each report gives only the PRI of the moment.")
    if a["jitter_measured"] is not None and a["jitter_reported"]:
        findings.append(f"Jitter measured {a['jitter_measured']:.1f} µs peak to peak; reported {a['jitter_reported']:.1f} µs.")
    findings.append(f"The sensor's first report came {a['delay_ms']:.0f} ms after the train's first pulse.")
    if a["scan"]:
        if a["scan"]["kind"] == "scanning":
            sc = a["scan"]
            findings.append(f"Scanning: amplitude swings {sc['depth']:.0f} dB; main beam about {sc['beam_ms']} ms wide" +
                            (f", every {sc['period_s']:.2f} s ({sc['illuminations']} sweeps)." if sc["period_s"] else " (one sweep heard)."))
        else:
            findings.append(f"Steady amplitude (within {a['scan']['spread']:.1f} dB): no scan seen.")
    if a["power"]:
        pw_ = a["power"]
        findings.append(f"ReceivedPower follows the pulses' amplitude: a steady {pw_['offset']:+.1f} dB offset (spread {pw_['spread']:.1f} dB over {pw_['reports']} reports)."
                        if pw_["spread"] < 4 else f"ReceivedPower doesn't follow the pulses' amplitude closely (offset {pw_['offset']:+.1f} dB, spread {pw_['spread']:.1f} dB).")
    own_echoes = [(o, off, db) for o, off, db in a["echoes"] if o == track.number]
    if own_echoes:
        off = sorted(e[1] for e in own_echoes)[len(own_echoes) // 2]
        db = sorted(e[2] for e in own_echoes)[len(own_echoes) // 2]
        findings.append(f"Multipath: an echo of its pulses {off:.1f} µs later and {abs(db):.0f} dB weaker ({a['echo_pulses']:,} pulses), left out.")
    elif a["echo_pulses"]:
        findings.append(f"{a['echo_pulses']:,} pulses that fit its pattern are another track's echoes, left out.")
    if a["borrowed_pulses"]:
        lenders = sorted({n for n, *_ in a["borrowed"]})
        findings.append(f"{a['borrowed_pulses']:,} pulses that fit its pattern belong to track {', '.join(lenders)}, which explains them better (a PRI harmonic), left out.")
    for n, gap in a["same_as"]:
        findings.append(f"Looks like the same emitter as track {n} ({gap:.1f} s apart: same PRI, RF and PW) — heard in separate sweeps.")
    if a["odd"]:
        findings.append(f"{len(a['odd'])} odd pulses (pulse on pulse, or another emitter's) left out of the RF and PW figures.")
    summary.append(f"<tr><td>{track.number}</td><td>{html.escape(track.name)}</td><td>{signal_of(a)}</td><td>{a['delay_ms']:.0f} ms</td>"
                   f"<td>{a['rf_reported']:,.1f} → {really_rf} MHz</td><td>{a['pw_reported']:.2f} → {really_pw} µs</td><td>{a['present']:.0%}</td></tr>")
    t_end = a["last_report"] + 50_000
    t0 = min(a["start"], a["first_report"]) - 30_000
    zoom_end = min(t_end, a["first_report"] + 200_000)
    def pts(f, src):
        return [(p.toa, f(p)) for p in src]
    rf_series = [("cand", 1.2, pts(lambda p: p.rf, other)), ("echo", 1.4, pts(lambda p: p.rf, echo)),
                 ("train", 1.5, pts(lambda p: p.rf, [p for p in train if id(p) not in odd_ids])), ("odd", 2.6, pts(lambda p: p.rf, [p for p in train if id(p) in odd_ids]))]
    pw_series = [("cand", 1.2, pts(lambda p: p.pw, other)), ("echo", 1.4, pts(lambda p: p.pw, echo)),
                 ("train", 1.5, pts(lambda p: p.pw, [p for p in train if id(p) not in odd_ids])), ("odd", 2.6, pts(lambda p: p.pw, [p for p in train if id(p) in odd_ids]))]
    amp_series = [("echo", 1.4, pts(lambda p: p.amp, echo)), ("train", 1.5, pts(lambda p: p.amp, [p for p in train if id(p) not in odd_ids])),
                  ("odd", 2.6, pts(lambda p: p.amp, [p for p in train if id(p) in odd_ids]))]
    rf_rep = [(r.t, r.rf) for r in track.reports]
    pw_rep = [(r.t, r.pw) for r in track.reports]
    power_rep = [(r.t, r.power - a["power"]["offset"]) for r in track.reports] if a["power"] else None
    rows = [
        ("Pulses in the train", f"{a['pulses']:,} of ~{a['expected']:,} expected ({a['present']:.0%}), in {a['runs']} run{'s' if a['runs'] != 1 else ''}"),
        ("Pattern searched", " / ".join(f"{v:g}" for v in a["gaps"]) + f" µs ({'positions in order' if a['class'] == 'stagger' else 'any of'}), ± {a['tol']:.1f} µs"),
        ("RF reported / measured", f"{a['rf_reported']:,.1f} MHz / min–max {a['rf_minmax'][0]:,.1f}–{a['rf_minmax'][1]:,.1f}, 5–95% {a['rf_p5_95'][0]:,.1f}–{a['rf_p5_95'][1]:,.1f}"),
        ("PW reported / measured", f"{a['pw_reported']:.2f} µs / min–max {a['pw_minmax'][0]:.2f}–{a['pw_minmax'][1]:.2f}, 5–95% {a['pw_p5_95'][0]:.2f}–{a['pw_p5_95'][1]:.2f}"),
        ("Amplitude", f"{a['amp_minmax'][0]:.1f} to {a['amp_minmax'][1]:.1f} dBFS"),
    ]
    sections.append(f"""
<section class="track">
  <h2>Track {track.number} <span class="muted">· {html.escape(track.name)} · {signal_of(a)}</span></h2>
  <ul class="findings">{''.join(f'<li>{html.escape(x)}</li>' for x in findings)}</ul>
  <table>{''.join(f'<tr><th>{k}</th><td>{html.escape(v)}</td></tr>' for k, v in rows)}</table>
  <h3>The start, close up</h3>
  {chart(rf_series, t0, zoom_end, "RF (MHz)", [r.t for r in track.reports], rf_rep)}
  <h3>The whole track</h3>
  {chart(rf_series, t0, t_end, "RF (MHz)", [r.t for r in track.reports], rf_rep)}
  {chart(pw_series, t0, t_end, "PW (µs)", [r.t for r in track.reports], pw_rep, height=140)}
  {chart(amp_series, t0, t_end, "Amplitude (dBFS) — the green line is ReceivedPower, shifted by its offset", [r.t for r in track.reports], power_rep, height=150, digits=0)}
</section>""")

untracked = []
for g in left:
    # A gap that's the sum of two others, or a multiple of one, is a missed pulse, not part of the pattern.
    listed = sorted(gap for gap, _ in g["gaps"])
    base = [x for x in listed if not any(abs(x - (a + b)) <= 5 for i, a in enumerate(listed) for b in listed[i:] if a + b <= x + 5 and a < x)
            and not any(abs(x - k * a) <= 5 for a in listed if a < x for k in (2, 3))]
    shown = ", ".join(f"{v:g}" for v in listed[:-1]) + (f" and {listed[-1]:g}" if len(listed) > 1 else f"{listed[-1]:g}") if listed else ""
    if not listed:
        pattern = "no regular gaps"
    elif len(base) > 1:
        pattern = f"gaps of {shown} µs — a stagger of " + " / ".join(f"{v:g}" for v in base) + " µs, by the look of it"
    else:
        pattern = f"gaps of {shown} µs — a PRI of {base[0]:g} µs (the longer gaps are missed pulses)" if len(listed) > 1 else f"gaps of {shown} µs"
    note = ""
    if g["merged_like"]:
        note = f" At track {', '.join(g['merged_like'])}'s RF but far longer: most likely its pulses merged with others (pulse on pulse)."
    elif g["like_track"]:
        note = f" Same PRI and RF as track {', '.join(g['like_track'])}, {g['amp']:.0f} dBFS: most likely its weakest pulses and echoes, too faint to follow."
    else:
        note = " No track explains it."
    untracked.append(f"<li><strong>{g['rf']:,.0f} MHz, PW {g['pw']:.2f} µs, {g['amp']:.0f} dBFS</strong>: {g['pulses']:,} pulses from "
                     f"{g['start'] / 1e6:.2f} to {g['end'] / 1e6:.2f} s, {pattern}.{note}</li>")

ANOTHERS = "another emitter's"
score_rows = []
for r in scoring.score():
    c = "—" if r["correct"] is None else f"{r['correct']:.1%}"
    rc = "—" if r["recall"] is None else f"{r['recall']:.1%}"
    o = r["odd"]
    score_rows.append(f"<tr><td>{r['track']}</td><td>{r['who']}</td><td>{r['found']:,}</td><td>{c}</td><td>{rc}</td>"
                      f"<td>{r['echoes'][0]:,} ({r['echoes'][1]:,} really)</td><td>{r['borrowed']:,}</td>"
                      f"<td>{o['merged']} merged, {o[ANOTHERS]} another's, {o['its own, clean']} false</td></tr>")

counts = {}
for e, _ in scoring.truth.values():
    k = e[0].split("-")[0] if e[0] != "clutter" else "clutter"
    counts[k] = counts.get(k, 0) + 1

page = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>PDW Track Matching</title>
<style>
:root {{ --bg:#f6f7f9; --card:#fff; --text:#1d2330; --muted:#667085; --border:#dde1e8; --grid:#eceef2;
  --cand:#c3c9d3; --echo:#a77bd6; --train:#2f6fd6; --odd:#d6402f; --report:#e2a400; --reported:#12996b; --warn-bg:#fff4e5; --warn:#8a4b00; }}
@media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{ --bg:#14171d; --card:#1c2029; --text:#e6e8ec; --muted:#9aa3b2;
  --border:#2d333f; --grid:#262b35; --cand:#424958; --echo:#b996f0; --train:#6aa0ff; --odd:#ff7262; --report:#f0c040; --reported:#3fcf98; --warn-bg:#3a2a12; --warn:#ffcf8a; }} }}
:root[data-theme="dark"] {{ --bg:#14171d; --card:#1c2029; --text:#e6e8ec; --muted:#9aa3b2; --border:#2d333f; --grid:#262b35; --cand:#424958;
  --echo:#b996f0; --train:#6aa0ff; --odd:#ff7262; --report:#f0c040; --reported:#3fcf98; --warn-bg:#3a2a12; --warn:#ffcf8a; }}
body {{ background:var(--bg); color:var(--text); font:15px/1.5 system-ui, sans-serif; margin:0; }}
main {{ max-width:980px; margin:0 auto; padding:24px 16px 48px; }}
h1 {{ font-size:1.5rem; margin:0 0 4px; }} h2 {{ font-size:1.15rem; margin:0 0 8px; }} h3 {{ font-size:.85rem; color:var(--muted); margin:14px 0 2px; font-weight:600; }}
.muted {{ color:var(--muted); font-weight:400; }}
section {{ background:var(--card); border:1px solid var(--border); border-radius:10px; padding:16px 18px; margin:16px 0; overflow-x:auto; }}
table {{ border-collapse:collapse; width:100%; font-size:.88rem; }} th, td {{ text-align:left; padding:4px 8px; border-bottom:1px solid var(--grid); vertical-align:top; }}
th {{ color:var(--muted); font-weight:500; }} .track table th {{ width:13rem; }}
tr.flag td {{ background:var(--warn-bg); color:var(--warn); }}
.warn {{ background:var(--warn-bg); color:var(--warn); padding:8px 12px; border-radius:6px; margin:0; }}
.findings {{ margin:0 0 10px; padding-left:1.2rem; }} .findings li {{ margin:2px 0; }}
.chart {{ width:100%; height:auto; display:block; }} .grid {{ stroke:var(--grid); }} .tick, .axis {{ fill:var(--muted); font-size:11px; }}
.report {{ stroke:var(--report); stroke-width:1; stroke-dasharray:3 3; opacity:.6; }} .reported {{ stroke:var(--reported); stroke-width:1.6; }}
.cand circle {{ fill:var(--cand); }} .echo circle {{ fill:var(--echo); }} .train circle {{ fill:var(--train); }} .odd circle {{ fill:var(--odd); }}
.legend {{ display:flex; flex-wrap:wrap; gap:14px; font-size:.82rem; color:var(--muted); margin:8px 0 0; }}
.legend i {{ display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:5px; vertical-align:-1px; }}
.legend b {{ display:inline-block; width:14px; border-top:2px dashed var(--report); margin-right:5px; vertical-align:3px; }}
.legend s {{ display:inline-block; width:14px; border-top:2px solid var(--reported); margin-right:5px; vertical-align:3px; text-decoration:none; }}
</style></head><body><main>
<h1>PDW ↔ track matching</h1>
<p class="muted">Prototype on harder mock data: a 10-second recording, {len(pulses):,} PDWs and {sum(len(t.reports) for t in tracks)} track reports
({len(tracks)} tracks). Scanning antennas, multipath, a twin on the same RF and PW, a PRI harmonic, heavy jitter, a dwell switch, an agile and
adaptive 5-position stagger, high PRF, a weak untracked emitter, clutter and {sum(1 for e, n in scoring.truth.values() if n == 'merged'):,} merged pulse-on-pulse PDWs —
and a ghost track from a sensor deinterleaving error.</p>
<div class="legend"><span><i style="background:var(--train)"></i>the track's pulses</span><span><i style="background:var(--odd)"></i>odd pulse (pulse on pulse, or another emitter's)</span>
<span><i style="background:var(--echo)"></i>echo (multipath)</span><span><i style="background:var(--cand)"></i>other pulses in the window</span>
<span><b></b>a track report</span><span><s></s>what the sensor reported</span></div>
<section><h2>The sensor at a glance</h2>
<table><tr><th>Track</th><th>Reported as</th><th>Really</th><th>Delay to first report</th><th>RF: reported → really</th><th>PW: reported → really</th><th>Pulses found</th></tr>
{''.join(summary)}</table></section>
{''.join(sections)}
<section><h2>Signals no track explains</h2><ul class="findings">{''.join(untracked) or '<li>None.</li>'}</ul></section>
<section><h2>How the matching did <span class="muted">· against the mock's truth, which the matcher never sees</span></h2>
<table><tr><th>Track</th><th>Really</th><th>Train</th><th>Of the train, its own</th><th>Of its pulses, found</th><th>Echoes set aside</th><th>Harmonic pulses set aside</th><th>Odd pulses flagged</th></tr>
{''.join(score_rows)}</table>
<p class="muted">"Of its pulses, found" counts its emitter's pulses within the track's own time window. The PDWs, by true emitter: {', '.join(f'{k} {v:,}' for k, v in sorted(counts.items()))}.</p></section>
</main></body></html>"""
open("report.html", "w").write(page)
print("report.html", len(page) // 1024, "KB")
