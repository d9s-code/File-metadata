# Roadmap

Backlog notes for features under consideration but not yet built. Unlike [FEATURES.md](FEATURES.md), which documents what exists today, this document is a set of proposals — nothing here is scheduled or guaranteed.

---

## Shipped since this list was started

Kept here only so the history of the list reads; each is documented in [FEATURES.md](FEATURES.md).

- **Audit trail** — every change, who and when, with per-Mode revert.
- **Batch Mode editing** — fields, deltas, jitter, range shifts, Sources, and marking or unmarking Modes test-derived.
- **Platform and MDF tests** — the Emitters on the air together (all, some or one), detection with time to detect and the dwell that caught it, what each was reported as (mix-ups, down to the Modes), three verdicts; an MDF test across Platforms, with which Platform each was intercepted as and the confidence today's rules give for what was heard.
- **Platform confidence (experimental)** — what in an MDF tells its Platforms apart, and PCL 1–3 rules with checks and what-if.

---

## XML Import

**Status:** Partly open. Dwell files import from XML already (**Import XML** under Dwell files). Emitter data from XML isn't built: the Elements panel's "Import from XML" is still "coming soon". The brief is [docs/XML_IMPORT_BRIEF.md](XML_IMPORT_BRIEF.md).

**Open fork:** the brief leaves undecided whether this means a datasheet/parametric import at the Source/Element level or a full MDF round trip mirroring the XML export. Settle that before building either.

---

## Sensor analysis: PDWs against tracks

**Status:** Idea, with a prototype on mock data ([prototypes/pdw_track_matching](../prototypes/pdw_track_matching/README.md)). Parked.

**What it would be:** pair a recording's PDW files (what the receiver measured, pulse by pulse) with the sensor's track file for the same recording (what it concluded — the intercept format), and show per track what the pulses really were against what the sensor reported.

**What it would give:**
- **Why an intercept didn't match a Mode, with evidence.** E.g. an agile-PW stagger whose pulses are 0.5/1.2/2.0 µs, which the sensor reports as 1.1 µs — a Mode built from the real values would never match, since matching runs on what the sensor reports.
- **Modes programmed for how the sensor sees a signal:** the real values next to the reported ones (agile RF reported as one value, adaptive PW averaged, heavy jitter as its mean, a stagger from another position) — feeding "Add to the Modes…".
- **The sensor's behaviour over time:** its delay to form a track by signal type; how it reports agile, adaptive and jittered signals; ghost tracks, tracks split between sweeps, weak emitters it never tracks — per sensor software version, so an update's effect shows.
- **What the sensor missed:** pulse trains no track explains.
- **Facts for the AI chat and the Outline write-ups,** instead of reasoning from the track file alone.

**How the prototype works:** per track, it finds the pulse train whose arrival-time gaps repeat the track's PRI(s) or stagger — not the sensor's delay, which depends on the signal — within a generous window before and during the track; RF and PW only pre-filter loosely; amplitude and PW choose between pulses that fit the timing. Then, across tracks: echoes (a run at a constant delay, consistently weaker), borrowed runs (mostly another track's pulses, which that track explains better: a PRI harmonic, or a ghost track from a deinterleaving error); then what each train really was (RF and PW values, jitter, odd pulses — pulse on pulse, or another emitter's), the scan from the amplitude envelope, and whether ReceivedPower follows the pulses. On a 10 s mock recording (116,000 PDWs, 9 tracks, scanning, multipath, a twin, a harmonic, heavy jitter, a dwell switch, an agile/adaptive stagger, high PRF, clutter, pulse on pulse, a ghost track) every track's train was 99.9–100% its own emitter's pulses, with 97–99.8% of them found, in about 8 s. The mock was written alongside the matcher, so its thresholds (listed in `match.py`) are tuned to it, not to a real sensor.

**Real data, as far as known:**
- PDW files are split by time, named the same with an index at the end; the track file is one file.
- PDW columns: `MissionTime` (same format and clock as the track file's, to the ns), `UnixTime`, `CollectId`, `Tune`, `CollectTime`, `FullTOA`, `PW`, `Amp`, `TA` (ns since the collect began: `CollectTime + TA = FullTOA`), `FC` (RF, MHz), flags (`DV`, `OL`, `CW`, …) and per-channel `A0`–`A3`, `P0`–`P3` and others. Only time, RF, PW and amplitude are needed; angle of arrival isn't used.
- A gap in the recording is in both files at once.
- **Collects:** each PDW belongs to a collect tuned somewhere (`Tune`). If the receiver steps through bands, an emitter is only heard while a collect covers it — so matching, "pulses found" and the delay must count only time when the receiver was listening on that band. Not handled by the prototype yet.

**Open questions:** the unit of `PW` (56 — ns?) and of `Amp` (dBFS?); the file format (CSV, space-separated or fixed-width) and extension; what `Tune` is (a collect's centre frequency in MHz?) and how wide a band a collect covers; whether the receiver switches bands within a recording; whether to skip `DV` = 0, distrust the amplitude where `OL` = 1 and leave out `CW` = 1; the receiver's specified accuracy for TOA, RF, PW and amplitude (most thresholds should follow from it).

**Steps, when picked up:**
1. A command-line script for the offline server — several PDW files and a track file in, the HTML report out; the PDW columns and thresholds in a settings file; gaps between files found (and checked against the track file's); collects handled. Run on one easy and one hard real recording, and tune.
2. In the app: a PDW upload on an Intercept, analysed in the background, with a **Sensor analysis** tab (the summary kept with the Intercept).
3. Actions from it: "Add to the Modes…", ask the AI about a track, write it up as a case note.
4. A sensor-behaviour overview across captures and sensor versions.

---

## Considered and rejected

**Per-kind pattern flexibility (Stagger/Switcher/Dwell/Jitter for RF and PW, not just PRI).** A sibling project supports this for all three parameter kinds via a legality-matrix `CheckConstraint`. Not added here by default — it's a real schema expansion, not a bolt-on, and should only be scoped if there's an actual case where RF or PW needs to be more than a fixed range, rather than added because another project has it.

**Dual-row draft/approved versioning, per-entity approval guards, per-value source provenance chains.** All present in the sibling project. Deliberately not adopted: this app's snapshot-based versioning (draft row + immutable JSONB snapshots on commit) already gives reproducible history without a second shadow-row per entity, and the sibling project's stacked guard-mixin approach is a strong candidate for *why* that codebase became hard to govern. Recreating it here would reintroduce the same problem this project was started to avoid.
