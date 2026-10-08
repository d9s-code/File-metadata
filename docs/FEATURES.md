# Features

This document walks through every feature of the RF Emitter Profile Manager, organized in the order data flows through the system: **Emitters → Platforms → Mission Data Files (MDFs)**, plus the cross-cutting tools (versioning, ambiguity checks, test tracking, backups) that apply at each level.

If you just want to see it running, start with the [README](../README.md). This document explains *what each screen does and why it works the way it does*.

---

**Tables everywhere:** drag the right edge of a column heading to resize the column; double-click it to put it back. Widths are remembered per table in the browser.

## 1. Emitters

An **Emitter** is the top-level record for a single RF emitter profile. It has a **name** (unique) and an optional **designation** (e.g. a platform-independent reporting name), plus a free-text description.

An Emitter is always edited as a **live draft** — changes save immediately, and nothing is locked in until you explicitly [commit a version](#5-versioning--diffs). Two things live inside an Emitter:

- **EW Groups** — operational groupings of Modes (see below)
- **Sources** — data-provenance groupings of Modes, and the home of the element-based mode-building tools (see [DSL, Elements & Editorial Tools](#3-modes-the-dsl-elements--editorial-tools))

Every Mode belongs to exactly one EW Group *and* exactly one Source — two independent, orthogonal groupings of the same underlying Modes.

### EW Groups

An EW Group represents an operational grouping — think "the set of modes this emitter uses while in track mode." Each EW Group carries:

- **Scan min / max** — the group's scan parameter range, as raw/as-entered
- **Scan delta** (optional) — a symmetric ± tolerance margin; see [Raw vs. engineered values](#raw-vs-engineered-values) below
- **Threat priority** — a numeric priority value
- **Ageout** (optional, seconds) — a plain descriptive reference value. No automated behavior is tied to it (nothing expires or gets flagged when it elapses) — it's recorded and displayed only.

EW Groups are how the "EW Groups → Modes" tab on the Emitter page is organized: expand a group to see (and add) its Modes.

---

## 2. Modes and PRI Types

A **Mode** is one RF/PRI/PW parameter set. Every Mode has exactly one **Mode Line** — the actual RF, PW, and PRI values — and a **PRI Type** that determines which fields are required:

| PRI Type | Fields | Notes |
|---|---|---|
| **Fixed** | PRI min/max **and Jitter min/max** | Both PRI and Jitter ranges are required together. |
| **Stagger** | An ordered sequence of discrete PRI values (µs) | Order matters — it's a repeating stagger pattern. Frame time (see below) is the sum of one full cycle. |
| **CW** (continuous wave) | *(none)* | PRI is constant/not applicable — the field is deliberately left blank. |
| **Xlet** | *(none yet)* | A stub for a future PRI type; no fields are defined, and it's rejected by the DSL parser until they are. |

RF is always in **MHz**; PW, PRI, and Jitter are always in **µs** — fixed units for now to keep the input format simple.

Every Mode also carries `rf_min/max` and `pw_min/max`, always required regardless of PRI Type.

---

## 3. Modes: the DSL, Elements & Editorial Tools

There are two ways to build a Mode, and they're designed to be interchangeable:

### The Mode form

**+ Add Mode** and a Mode's **Edit** share one form. It suggests a name (the next free "<EW Group> n"; a copy suggests the one after the original's), then has one labelled row each for RF, PRI (its type chosen in the row) and PW, each with min, max, ± margin and a Range Matching box. Leaving max blank means the same as min, for a single datasheet value. Under every row the form shows what it will match with the margin applied ("Matches 2,999 – 3,001 MHz"), or a stagger's step count and frame time, and points out a mistake in plain words under its row (once you leave the row, or all at once on save) — the form doesn't submit until the line is valid. **Start from** copies an existing Mode in. **Add & next** saves and starts the next Mode with the same EW Group, Source, PRI type, margins and range flags, with the next name. Confirmation, notes and test-derived links sit under **More options**, summarised in one line while folded.

### Typed DSL entry

Type a mode line directly using a small custom syntax:

```
RF 2900-3100 PRI FIXED 800-1200 JITTER 5-15 PW 0.5-1.2
RF 2900-3100 PRI STAGGER [800, 850, 900, 780] PW 0.5-1.2
RF 2900-3100 PRI CW PW 0.5-1.2
```

Submitting a typed line does two things at once: it creates the Mode (with its parsed RF/PRI/PW values), **and** it derives matching RF/PW/PRI building blocks into the parent Source's **Elements** pool — so the same values immediately show up as reusable elements, ready for the cartesian-product tool below. Parse errors are reported inline with the offending text.

### Elements + Cartesian Product

Alternatively, build up a pool of reusable building blocks under a Source's **Elements** panel:

- **RF elements** — a min/max range
- **PW elements** — a min/max range
- **PRI elements** — either a Fixed-style range (+ optional Jitter) or a Stagger sequence

Then use the **Cartesian Product** tool: pick one or more RF elements, PW elements, and PRI elements, choose a target EW Group, and run it. The tool generates **one new Mode per combination** — N RF × M PW × K PRI elements produces N×M×K Modes in one action. This is the fast path for generating a large family of related modes (e.g. sweeping RF sub-bands against a couple of PRI options).

Mixing Fixed-style and Stagger PRI elements in a single cartesian-product run is rejected — pick one shape per run so the resulting batch is predictable.

### Raw vs. engineered values

An element's min/max is the **raw** value — pulled straight from the source, exactly as reported, with no adjustment. Separately, an RF, PW, or Fixed-style PRI element (not Stagger, for which delta means something different — see Frame Time below) can carry an optional **delta**: a symmetric ± tolerance margin representing sensor/collection measurement uncertainty. When a delta is set, the app computes the element's **engineered** range (`raw min − delta` to `raw max + delta`) and shows it alongside the raw value wherever the element appears — the raw value itself is never overwritten.

The engineered range, not the raw range, is what actually gets written into the generated Mode Line when the element is used in a cartesian-product run — so ambiguity checks, the Mode's DSL text, and XML export all see the engineered value, while the Elements pool keeps the raw value on record for provenance. An element created by typing a DSL line directly gets no delta (the typed numbers are already treated as final); go back to the Elements panel afterward to add one if the source data needs an engineering margin.

A manually-created or manually-edited Mode Line carries its **own** per-parameter deltas — `rf_delta`, `pw_delta`, and (for Fixed PRI) `pri_delta` — required fields, same status as `rf_min_mhz`/etc. Cartesian-generated and DSL-parsed lines don't set these: the engineered value is already baked into the line's raw min/max at generation time, so a separate delta would be redundant.

EW Group **scan delta** works the same way for computing an engineered scan window, but for v1 it's display-only: XML export still exports the group's raw `scan_min`/`scan_max` unchanged. Say so if you'd rather XML export emit the engineered scan window instead.

### Frame Time

Next to any Stagger element or Stagger Mode, a **Frametime badge** shows the sum of its sequence — the time for one full cycle through the stagger pattern.

A Stagger PRI **element** must carry a **delta** (repurposing the same `delta` field used for RF/PW/Fixed-PRI elsewhere, now meaning a frame-time tolerance rather than a range tolerance) — the app can't compute an engineered frame-time window without it, so it's required, not optional, specifically for Stagger. This is also how frame time flows through the cartesian-product tool: since a Stagger PRI element can't exist without its delta already set, every cartesian-generated Stagger Mode automatically inherits a valid frame-time delta with no separate input needed in the Cartesian Product form itself.

A manually-created or manually-edited Stagger Mode Line carries its own `frame_time_delta_us`, entered directly in the Mode form next to the stagger sequence. The form's **frame time** field follows the sum of the sequence as you type; write a different value into it and the Mode stores that as `explicit_frame_time_us` (cut to 3 decimals), used instead of the sum everywhere (engineered range, both PRS exports). **Use sum** clears it again. The engineered frame-time range (`frame time − delta` to `frame time + delta`) is shown wherever the sequence appears. A PRS import whose `FramePeriod` midpoint differs from the sequence sum restores it as a written-in frame time.

When logging intercepted parameters during a test, a Stagger set can also record the measured frame time.

### Confirmation quality & quantity

Every Mode carries a **Confirmation quality** (0–100, default 100) and a **Confirmation quantity** (1 or more, default 2). Both are set in the Mode form, editable per Mode or with Batch Edit, recorded in the audit trail and version history, and written to the PRS export's `ConfirmationQuality` / `ConfirmationQuantity` elements (which used to be fixed placeholders of 100 and 2).

### Range Matching

A per-parameter flag — `RF`, `PW`, and `PRI` are each independently on or off for a given Mode Line. Currently a stored flag only; no behavior elsewhere in the app reacts to it yet, but it's shown as its own sortable column on the Modes table (and its own field on the Mode cards view), rendering one small tag per active parameter (e.g. `RF` `PRI` side by side) or `—` if none are set.

Range matching is treated as **any other Mode Line parameter** — not a metadata field you can toggle freely. It's set when creating a Mode, and on an already-`approved` Mode it can only change through the same propose-edit/approve cycle as RF/PW/PRI values themselves (see [Editing an existing Mode](#editing-an-existing-mode-draft-edits--approval) below) — a direct attempt to flip it on an approved Mode is rejected the same way a direct line edit is.

---

### Editing an existing Mode: draft edits & approval

Editing a Mode's **metadata** (name, notes, which EW Group it's filed under) is an instant edit, same as creating one. But editing its **line** — the actual RF/PW/PRI/jitter/stagger values, deltas, and range matching flags — works differently once the Mode is `approved` (the normal state for anything already created):

- **Propose edit** creates a new `draft` Mode carrying your edited line, linked back to the Mode it would replace. The original is untouched and still fully live (still what ambiguity checks, XML export, and Emitter version commits see) while the draft sits pending.
- Only one pending draft per Mode at a time — you can't propose a second edit while one is already under review.
- **Approve** flips the draft to the live, canonical line and marks the Mode it replaced as `superseded`. Superseded Modes are kept permanently (full lineage, nothing is ever deleted) but are excluded from the active Modes list, ambiguity checks, and XML export — toggle **Show history** on the Modes table to see them.
- **Reject** discards the draft; the original Mode is never touched.

A `draft` Mode's line can still be freely edited directly (refining your own pending proposal) — the propose/approve gate only applies to the currently-`approved` line.

### Test-Derived Modes

A Mode's values don't always come from a Source — real-world testing can turn up an emission a datasheet never mentioned, or reveal that an existing Mode's parameters are wrong. Both the "+ Add Mode" form and a draft-edit proposal let you optionally link the Mode to one or more existing **Test Records** whose findings explain its values ("this Mode is test-derived"). A linked Mode shows a **Test-Derived** badge with a popover listing the justifying test(s) — explainability for a Mode that didn't come from a Source, without needing a Source to explain it.

---

## 4. Sources

A **Source** groups Modes by where the data came from (e.g. a specific collection event or report). Each Source has:

- Name and description
- **Date last updated** — a plain date *you* enter, independent of the record's actual edit timestamps. It's a fact about the data ("this is current as of..."), not a system-generated audit field.
- Its own pool of **Elements** (see above) — the working set Modes under this Source were built from

Sources are scoped per-Emitter — each Emitter curates its own list.

A Source can't be deleted while it still has Modes attached.

### A Mode from several Sources

A Mode can come from **more than one Source** — the same signal in two reports, say. The Mode form picks them as chips (*+ another Source…* adds one, × removes one; at least one stays); the Modes table's **Sources** column and the cards list them all, and the Source filter and search match any of them. **Batch Edit** can add a Source to every selected Mode, or make one Source their only one. Changes are audited ("Sources: A → A, B") and kept in versions: the diff shows a **Sources** change, and revert and fork bring them back.

- **Deleting a Source** is refused only while it's some Mode's *only* Source (the message names them); Modes that have another just lose it.
- **Rejected Sources**: a Mode is left out of exports and ambiguity checks only when *every* Source it comes from is rejected — one approved Source keeps it in.
- **Merging duplicates** from an ambiguity check keeps both Modes' Sources on the kept Mode.

### Intercepts as Sources

**Turn into Source** on an Intercept (Editors, with the Emitter checked out) adds a Source that stands for it — the Intercept's name, date and description, type "Intercept", starting `pending_review` — so a Mode can have the Intercept as its Source rather than an unrelated document. It's only a link: nothing is derived from the entries (no Elements), and Modes already made from the entries stay where they are. New Modes made from its entries (one at a time, or with Plan Modes) start on that Source. The Source shows "Stands for Intercept …" and the Intercept links to its Source; one Source per Intercept. The link is part of the Emitter's version (it survives save, discard and revert), and deleting the Intercept leaves the Source and its Modes in place, unlinked.

### Import

Beyond typing a DSL line or building Elements by hand, a Source's Elements and Parameter Sequences can be bulk-imported from a structured JSON payload — one `POST /emitters/{emitter_id}/imports` call creates a new Source (starting `pending_review`, same as any imported data) per "parametric set" in the payload, each carrying its own Elements/Sequences. A `/validate` dry-run endpoint checks the payload (cross-object checks like duplicate Source names within one import) without writing anything, returning field-path-addressable issues suitable for a pre-commit review UI.

**XML import — not yet built.** The Elements panel has an "Import from XML" entry point ("coming soon") that will eventually parse an uploaded XML datasheet into this same JSON shape rather than requiring it hand-typed. See **[docs/XML_IMPORT_BRIEF.md](XML_IMPORT_BRIEF.md)** for the full field-mapping reference and open design questions before that work starts.

---

## 5. Versioning & Diffs

Emitters, Platforms, and MDFs are all **versioned** the same way:

- The live record is always an editable **draft**.
- **Commit Version** takes a full, immutable snapshot of the current state (for an Emitter: every EW Group, Source, Mode, and Mode Line) and adds it to that entity's version history, numbered sequentially (v1, v2, v3, ...).
- The **Version History** page lists every committed version and lets you pick any two to **diff** — added / removed / changed fields, shown with old vs. new values. By default it diffs a version against the one immediately before it, but you can compare against any earlier version too.

Nothing is ever silently lost: the live draft can keep changing, but a committed version is a permanent, inspectable snapshot you can always come back to.

### Status

Emitters and MDFs additionally carry a **status** that moves through a fixed set of legal transitions — you can't jump straight from `draft` to `validated`, for example:

- **Emitter status**: `draft` → `in_review` → `validated` → `deprecated`
- **MDF status**: `draft` → `pending_review` → `approved` → `released` → `deprecated`

Every status transition automatically commits a new version with an auto-filled summary (e.g. "Status: In progress → Testing"), so your status history *is* your version history — nothing extra to look up.

An Emitter's status describes its saved content, so changing it doesn't need **Start editing**: any Editor can, even while someone else holds the Emitter. The new version is the **last saved version with only the status changed** — never the live draft, so unsaved edits aren't swept into a version titled as a status change; they stay unsaved, and take the new status with them when they're saved. An Emitter never saved can't change status ("Save a version first"). While editing, the Changes panel notes any status change saved since editing began. Each change is in the audit log, with its note where one is required.

---

## 6. Platforms

A **Platform** groups several Emitters — think "everything mounted on this aircraft/ship." Platforms are what actually gets pinned into an MDF, not Emitters directly.

Critically, a Platform doesn't reference an Emitter's live draft — it **pins to a specific committed Emitter version**. This means editing an Emitter later never silently changes a Platform that already pinned an earlier version. If you need the Platform to pick up new Emitter changes, you explicitly **repin** it to a newer version (the "Pin an Emitter Version" tool lets you pick from any of that Emitter's committed versions).

Platforms are versioned exactly like Emitters (commit, history, diff) — a Platform version snapshots the full set of emitter/version pins at that point, including each pinned emitter's complete nested data.

---

## 7. Mission Data Files (MDFs)

An **MDF** is the deployable artifact — the file structure actually loaded onto the RF Recognizer. MDFs link to **Platforms** (never directly to Emitters), and just like Platform→Emitter pinning, an MDF pins to a specific **committed Platform version**. This gives you a two-level pin (MDF → Platform version → Emitter version), so changes at either lower level never silently ripple upward into an MDF you've already built.

MDFs are versioned the same way as everything else, and carry their own status lifecycle (see [Versioning & Diffs](#5-versioning--diffs) above).

### Readiness signals

Before moving an MDF toward `approved` or `released`, the app checks two things and surfaces them as **soft warnings** (never a hard block — the decision stays with you):

- Are all the emitters referenced (transitively, through pinned platforms) marked `validated`?
- Is there at least one passing [test record](#8-test-tracking) on file for this MDF?

If either check turns up something, you'll see the warnings in a confirmation prompt before the transition goes through. You can always proceed anyway.

---

## 8. Test Tracking

A **Test Record** (a test run) logs validation against either an Emitter or an MDF. New runs are one of two types:

- **Simulation** — checked against the Emitter's **SIM Test Lines**, the simulated signals imported (with the date they were created in the simulator) on the Test History tab. Each line in the run gets an outcome (correct / partial / missed / inconclusive), any number of **intercepted Modes** (what the system reported for it), and optionally the **intercepted parameters** (RF, PW, PRI) that were measured.
- **Intercept** — a real-world intercept, checked against the Emitter's own Modes: each intercepted Mode gets a result, intercepted parameters and notes.

Searching the Modes (under Intercepted as, and the row filters) matches every typed word anywhere in the name, in any order, with `_ - . /` counting as spaces — "scan 6" finds `scan_fixed_6`. Intercepted parameters show as a small table inside the cell (one row per set, units in the headings), on the run page and in the finished report; notes grow as they're written and keep their line breaks.

A SIM line's intercepted Modes can include **Default Unknown** — the system reporting no Mode at all — on its own or alongside Modes; it's offered first in the list.

**Runs in progress.** A run is saved on the server as it's filled in (a moment after each change; the first change at once), so a reload, a closed tab or another computer picks it up where it was. Unlogged runs are listed under **In progress** on Test History — title, type, how far along, who saved it last and when — with **Continue** and **Discard** (Editors). A run in progress counts for nothing until it's logged; logging it deletes the draft. Each save carries the version it builds on, so if two people save the same run the second is refused and told to reload. A Mode being typed in on the run page isn't saved until it's staged.

Older lab bench, live range and field exercise records stay in the history but can't be logged any more. Every run also records a title, notes, test date, a **dwell** ("Manual", or a value written in such as "50 ms", set once for the whole run) and an overall result that is worked out from its lines or Modes (worst one wins). The tester can **override** it, with a required reason — when logging, or later on the run's page (Change the result, Editors); the worked-out result and the reason are kept beside it, the run's badge shows ✎, picking the worked-out result again removes the override, and every change is audited. Each run has its own page, and each SIM Test Line shows its status: its outcome and date in the most recent run that included it.

**Simulation trend** (Test History): one column per Simulation Test, oldest to newest, stacked by line outcome and topped by the SIM Test Lines the run didn't include (**Not in this run**), so every column is all of the Emitter's current lines; both that and numbers on the bars (**Counts**) can be switched, and the choice is remembered. Columns are labelled with the run's date and **time** — each run records the time it ran (filled with the current time on the run page); runs from before that show the time they were logged, in italics.

Each Mode shows **Last seen** (Modes table, cards, and a filter): the latest run it turned up in — reported under Intercepted as for a SIM line (with that line's outcome; if it was reported for several lines in one run, the worst counts) or rated in an Intercept Test — linking to the run, with how many runs it was seen in by outcome on hover. It replaces Last Tested, which only counted Intercept Test ratings and so never showed Modes reported in Simulation Tests. The Emitter summary's count of passing Modes uses the same.

A test record automatically pins to whichever version of the Emitter or MDF was the latest *committed* one at the moment you logged it — so your test history stays accurate to what was actually tested, even as the draft keeps changing afterward.

---

## 9. Dashboard

The **Dashboard** is the landing page after login. Each card loads on its own, so a slow one never holds up the rest.

- **My work**, across the top — your open tasks (overdue first, tick them off right there), the Emitters assigned to you with their status and open tasks, and the Emitters you're editing now with how long you've held each. See [Tasks & Assignment](#15-tasks--assignment).
- **Needs Attention** — one line per item, grouped by kind; each group folds away (the first two start open), with **Open all / Fold all**:
  - **Simulation** — SIM Test Lines missed or partial in their latest run; an Emitter in Testing never checked against a simulation; an Emitter whose content was committed after its last Simulation Test was logged (status changes alone don't count)
  - **Needs rework**, and **Sources awaiting review** (editors and admins only — viewers can't review)
  - **Intercepts not covered** — Intercepts with entries no Mode of their Emitter matches, not even nearly (a lead for Plan Modes)
  - **Ambiguity** — unreviewed high-severity or exact overlaps in an Emitter's, Platform's or MDF's latest ambiguity check
  - **Held for editing** — Emitters someone else has held over 8 hours (not shown to viewers; your own holds are on My work)
  - **Stalled** — Emitters in progress with no commit for over a week
  - **MDF readiness** — open readiness warnings on MDFs in progress
- **Emitters / MDFs** — counts per lifecycle stage, compact, with zeros faded.
- **Admin** (admins only) — failed sign-ins in the last 24 hours, and every Emitter held for editing over 8 hours, with a link to release one.
- **Simulation validation** — how every SIM Test Line did in its latest run as one bar, how many Emitters had every line correct, then one row per Emitter, worst first, searchable and filterable, scrolling inside a fixed height.
- **Test Runs** — the latest runs with their line outcomes, plus failed/partial runs with no retest on file.
- **Recent Activity** — the latest changes; sign-ins and starting or ending an edit are left out unless **Sign-ins & edit locks too** is ticked.
- **Backup** — time since the last backup and changes since; see [Backup & Restore](#12-backup--restore).

## 10. Ambiguity Checks

The core analytical feature: detecting when two Modes' parameter spaces overlap closely enough that the Recognizer might not be able to tell them apart.

### How it works

Each Mode Line is treated as an RF × PW × PRI box (plus jitter for Fixed PRI). RF and PW always compare as range overlaps; how PRI compares, and whether a pair can be ambiguous at all, is below.

Each parameter gets an overlap percentage (`intersection ÷ smaller of the two ranges`, so a narrow mode fully contained in a wide one still reads as highly ambiguous). A pair is a finding only if every compared parameter overlaps, and its severity comes from the parameter that overlaps least, bucketed by a configurable **tolerance** (low / high / exact thresholds, editable by Editors and Admins) into `low`, `medium`, `high` or `exact_overlap`.

Ranges are compared **with their ± margins** — each Mode's RF, PRI and PW range widened by its delta, the ranges the sensor actually matches with. Which pairs can be ambiguous at all:

- **Same PRI type only** — a different PRI type tells two Modes apart.
- **Fixed vs Fixed** — PRI and **jitter**, each as a range; jitter is a parameter like the others and can set the severity. Every Fixed Mode has jitter; 0–0 is a steady PRI.
- **Stagger vs Stagger** — with **range matching** on both, PRI is compared on the **frame time** (± frame margin); with it on only one, they're told apart; with it on neither, on the share of identical steps.
- **CW vs CW, X-let vs X-let** — RF and PW only.

Checks made under older rules say so on the page. Every finding records the ranges it compared and which parameter set its severity. The run bar at the top is one row: what was checked and when, **Run the check** / **Run again**, and a **Thresholds** chip (click to change, Editors and Admins). The rules in words, with the thresholds in the sentences, are behind **How it decides**.

### Three scopes

Run a check at three levels, each reusing the same engine:

- **Per-Emitter** — every Mode against every other Mode within one Emitter
- **Per-Platform** — every Mode across every Emitter version pinned into one Platform (catches ambiguity between emitters riding the same platform)
- **Per-MDF** — every Mode across every Emitter transitively referenced (through pinned Platforms) by the MDF

A check always runs against a specific **committed version** (the latest by default), never the live draft — so results are reproducible and tied to a known snapshot, not a moving target. Runs execute in the background; the page polls until it completes.

### The page

- **Findings list beside a detail panel** — open findings first, worst first, each with its per-parameter overlap and the deciding parameter in bold; filter chips for status (open / acknowledged / merged) and severity, plus Mode search, EW Group and Source filters; arrow keys move through the list. The selected finding shows both Modes' compared ranges drawn to scale with the overlap shaded (stagger steps as dots, shared steps ringed).
- **Modes involved** — the Modes in the most findings, worst first; click one to see its findings.
- **Matrix** — every Mode in a finding against every other, coloured by severity; a cell opens that finding.

### Handling findings

- **Open A / Open B** — straight to either Mode in its Emitter.
- **Merge** (Editors) — for two Modes of the same Emitter that are really the same: keep one, widened to the union of both ranges with the wider margin, and delete the other. A preview shows the before/after ranges, what moves (test records, test line results, SIM test lines and intercept links all move to the kept Mode; its notes record the merge and keep the other's notes) and any new or worse overlap the wider ranges would cause with the Emitter's other Modes. It changes the Emitter's live data, so it needs the Emitter checked out (the dialog can check it out); a version then has to be saved and the check run again. The finding records the merge, and others involving the deleted Mode are marked until the next run. Different PRI types, or staggers with different sequences, can't be merged.
- **Acknowledge** (Editors) — known and acceptable, with an optional reason; carried to later runs while the pair's overlap is unchanged. **Undo** reverses it. Acknowledging doesn't delete or hide the finding — it's a record that a human looked at it and made a call.

### AI explanations (optional)

When a language model is set up (`LLM_BASE_URL` — any OpenAI-compatible server, such as vLLM on the same network), the page offers two more things:

- **Explain with AI** on a selected finding — why the two Modes can't be told apart, what (if anything) in the data separates them, and one suggested action (keep both, tighten the ranges, merge, add a distinguishing parameter, or check the source data), with the model's confidence. An Editor can acknowledge the finding with the suggestion as its note.
- **Summarise with AI** for the run — an overview, what to look at first, and patterns across the findings.

The model never does the overlap arithmetic: the check computes it, and the model is given only one finding's two Modes and their computed overlap, or a run's counts and 40 most serious findings — a few thousand tokens however many Modes are in scope. Its answers are drafts, kept with the finding or run and labelled with the model and who asked; any number in an answer that wasn't in its input is listed so it can be checked. `scripts/llm_eval.py` tries the model on a run's findings and writes a report for analysts to judge before anyone relies on it.

#### The team's documentation as background

With Outline set up (`OUTLINE_URL`, `OUTLINE_API_TOKEN` and `OUTLINE_ROOT` for a page and everything under it, or `OUTLINE_COLLECTION` for a whole collection), the model is also given the documentation that bears on each question:

- **A copy, kept fresh.** The app copies the pages, split at their headings (long sections in parts of about 1,200 tokens), into its own database. The copy is refreshed on the next question once it's older than `OUTLINE_SYNC_MINUTES` (60), or at once with **Sync now** (Admins, at the top of the AI overview). If Outline can't be reached, questions go ahead with the last copy and the error is shown there.
- **Only what's relevant.** If the whole copy fits in `OUTLINE_CONTEXT_TOKENS` (6,000) it goes with every question. Otherwise the sections that best match the question's words do, in reading order: the PRI types involved and range matching count double; the parameters, ambiguity terms and the Modes' notes count once. The search is language-neutral (words match as prefixes, so "stagger" finds "staggered"; RF, PW, PRI and CW only as whole words).
- **Cited.** The sections are numbered and the model is told to cite the one a sentence relies on, as [S2], and not to let the documentation override the numbers. Citations link to the heading in Outline; under the draft, **Documentation cited** lists them, and **Also given, not cited** the rest. A citation of a section that wasn't given is flagged.

`scripts/outline_probe.py --sections` shows how the documentation splits, and which sections are too long, too short or without a heading.

#### The AI overview's format

**Summarise with AI** gives a one- or two-sentence verdict, then a table of up to six findings to look at first: the pair and severity come from the finding itself (the model picks findings by their label, F1–F40, and never retells them), with the model's reason and one suggested action. Clicking a row opens the finding. Patterns follow on one line.

### AI chat

The **✦ Ask AI** button in the bottom-right corner of every page opens a chat with the model (when one is set up). It isn't handed the database: it asks for what it needs, one read-only lookup at a time, at most five per question, then answers:

| Lookup | What it gets |
|---|---|
| overview | How many Platforms, Emitters (by status), Modes, MDFs and Intercepts there are |
| search | Platforms, Emitters, MDFs, Modes, Intercepts and Sources whose name contains the words |
| get_emitter | An Emitter's details, Platforms, and every Mode with its values (first 150) |
| get_platform | A Platform's Emitters and the MDFs it's in |
| find_modes | The Modes a signal with the given RF (and PRI, PW) would match, each range widened by its margin |
| get_ambiguity | An Emitter's latest ambiguity check: counts and the 20 most serious findings |
| get_intercept | An Intercept and its entries, with the Modes they're linked to |
| search_docs | More sections of the documentation |

The documentation sections matching the question go with it too, and the chat is told which page it was asked on. Under each answer: the lookups made, the documentation cited, and any number that wasn't in anything it was given. Users, passwords, sessions and the audit log are out of its reach; deleted items are left out. Nothing is stored on the server — the conversation (the last ten turns go with each question) lives in the browser tab. It works with any vLLM: each step is a structured JSON reply, so the server's tool-calling options aren't needed.

### Settings

Each person's own settings (their name, top right → **Settings…**), kept with their account: the AI chat, whether the chat is told which page they're on, and the AI drafts on the ambiguity page. Everything is on until switched off.

---

## 11. XML Export (PRS Format)

Any committed MDF version can be exported to XML — the file format meant to actually load onto hardware. The export walks the full pinned hierarchy: **Platforms → Emitters → EW Groups → Modes → Mode Lines**.

The current implementation supports the **PRS Format** specification.

Two things worth knowing:

- **Sources and Elements never appear in the export.** They're an authoring/organizational construct with no meaning outside this tool — the export excludes them by construction (the serializer never even reads that part of the snapshot).
- **The XML tag names are placeholders.** Since the target system's real XML Schema (XSD) wasn't available when this was built, all tag-name mapping lives in one file (`backend/app/xml_export/field_mapping.py`). Swapping in the real schema later is a data change to that file, not a rewrite of the export logic.
- **RF/PW/PRI values exported are already engineered** (raw ± any element delta, applied when the Mode was generated — see [Raw vs. engineered values](#raw-vs-engineered-values)); **EW Group scan range is exported raw**, ignoring `scan_delta`, since scan delta is display-only for v1.
- **Sanitization**: All exported string values (names, descriptions, etc.) are automatically sanitized to ensure valid XML content.
- **Confirmation quality/quantity** come from each Mode (see [Confirmation quality & quantity](#confirmation-quality--quantity)); snapshots taken before these fields existed export as 100 and 2.
- **Not yet exported at all:** per-parameter deltas (`rf_delta`/`pw_delta`/`pri_delta`), `frame_time_delta_us`, Range Matching flags, and EW Group `ageout`. None of these existed when the export mapping was built; whether they belong in the target XML format (and under what tag names) is undecided — see [docs/XML_IMPORT_BRIEF.md](XML_IMPORT_BRIEF.md), which flags this explicitly since it matters for any future import work too.

Export is available from the MDF page (latest committed version) and from the MDF's Version History page (any specific version) — click **Export XML** to download.

---

## 12. Backup & Restore

Since this app runs fully offline, its own database backups *are* the disaster-recovery plan — there's no cloud fallback. Whole-database `pg_dump` backups are:

- **Scheduled independently of the app** — weekly by default (`BACKUP_SCHEDULE_DAY`, or daily), from their own container, not an in-process job, so a backup still runs even if the web app is down. A server that was off catches up when it starts.
- **Due sooner the more changes** — between automatic backups, the dashboard's Backup card shows the time since the last backup and the changes since (Audit Log entries that edit data, plus which Emitters, Platforms and MDFs were added, changed or removed). A backup is due a week after the last at 50 changes (`BACKUP_CHANGES_PER_WEEK`), half a week at 100, and so on, between 12 hours and 4 weeks; nothing changed, nothing due. Due turns the card amber and warns admins on every page; twice past due is overdue, red.
- **Written to a separate disk/volume from the live database**, and optionally **copied to a second place** (`BACKUP_COPY_DIR` — another disk or a share), so one failure can't take out both the data and its backups
- **Pruned on a retention policy** (the newest 14, then one a week for 8 weeks and one a month for 6 months, by default) so the backup directory doesn't grow forever
- **Verified after every backup** — a real restore into a scratch database, with the row counts checked against what was backed up, then torn down again. Each file's checksum is checked first, so a file that changed on disk is caught too.
- **Accompanied by a PRS export of the whole repository** (`<backup>_prs.zip`) — every Emitter as XML, and every Platform and MDF as its own complete PRS package, from each one's latest saved version — so if the database can't be restored in time, the files are still there to use. It's checked on Verify, copied and pruned with its backup, and a failed export never costs the database backup.
- **Described by a manifest** next to each file: when and why it was taken (automatically, by hand, or just before a restore), by whom, its size, checksum, row counts, and an overview of every Emitter, Platform and MDF in it

**Admin → Backups** shows whether all of this is working: the latest backup and its verification, when the next one runs, and a plain list of anything wrong (a backup due for the changes made, a failed verification, the scheduler not reporting). Admins see a warning across the top of every page when there is. From there an Admin can also take a backup now, verify any backup again, **download** one to keep a copy off the server — the database file, or its PRS export (both recorded in the Audit Log, since the database file holds everything), and **compare** two backups — or a backup against the current data. The comparison is an overview, not a field-by-field diff: which Emitters, Platforms and MDFs were added, removed or moved to Recently Deleted, and for each changed one a line per change — renamed, status, number of Modes, saved version, pins.

Restoring is a deliberate, operator-run CLI action (not a UI button) — it overwrites live data, so it requires explicitly confirming the target database name, and it takes a backup of the current data first so a restore of the wrong file can be undone. See the [README](../README.md#backups) for the exact commands.

---

## 13. Accounts & Roles

Three roles, enforced by the backend on every request (not just hidden in the UI):

| Role | Can do |
|---|---|
| **Viewer** | Read everything, including version diffs and ambiguity dashboards. Can trigger ambiguity runs (non-destructive) but not edit tolerance thresholds or acknowledge findings. |
| **Editor** | Full CRUD on Platforms/Emitters/EW Groups/Sources/Modes/Elements, commit versions, build/pin Platforms and MDFs, run ambiguity checks, acknowledge findings, log test records. |
| **Admin** | Everything Editor can, plus the [Admin panel](#14-admin-panel) (user management, Recently Deleted) and hard/permanent delete. |

Authentication is local username/password (no external identity provider, matching the offline requirement), with the session stored in an httpOnly cookie and CSRF protection on every state-changing request.

**Passwords** are never stored — only a salted bcrypt hash of each (work factor 12). A hash can't be turned back into the password, so a database backup (or a downloaded copy of one) doesn't give anyone the passwords; it's the standard, stronger alternative to encrypting them, which would need a key kept somewhere. Passwords must be at least 12 characters.

**Changing your password**: click your name in the top bar → **Change password…**, give the current one and the new one twice. Wrong guesses at the current password count toward the same limit as signing in. Afterwards every other place you're signed in is signed out (this one carries on); an Admin resetting someone's password signs them out everywhere too. Both are recorded in the Audit Log.

---

## 14. Admin Panel

Admin-only (both the nav link and the routes themselves redirect a non-admin away, not just hide the link) — Users, Edit locks, Recently Deleted and Backups:

### Users

Create a user (username, password, role) directly from the UI — previously only possible via a one-off CLI script. Existing users can have their role changed or be **deactivated/reactivated** inline. Deactivation, not deletion, is how a user's access is revoked: there's no "delete a user" action, so a user row is never actually removed (and every audit-log entry that names them as the actor stays attributable).

### Recently Deleted

Emitters, Platforms, and MDFs are already soft-deleted by default when you delete one from its list page (see the [Roles](#13-accounts--roles) table above — hard/permanent delete is a separate, Admin-only action). This section is where that soft-deleted data actually lives:

- Every soft-deleted item, across all three entity types, in one list with a live "days left" countdown (30 days by default, `TRASH_RETENTION_DAYS`).
- **Restore** — reverses the soft delete; the item reappears wherever it normally lives.
- **Delete forever** — Admin-only, immediate, irreversible hard delete from the trash view itself.
- **Automatic purge** — the `backup` container (see the [README](../README.md#backups)) hard-deletes anything past the retention window every day, so nothing relies on a human remembering to empty the trash.

Restoring can fail with a 409 if another item now holds the same name — rename the conflicting one first.

### Backups

The backups' health, Back up now, Verify, and the compare overview — see [Backup & Restore](#12-backup--restore).

---

## 15. Tasks & Assignment

**Assigning an Emitter.** Each Emitter can be assigned to one person — whoever's responsible for it. It's set from the "Assigned to" control on the Emitter's page by any editor, without editing the Emitter: who works on it isn't part of what it is, so it isn't saved in its versions and leaves nothing unsaved. Only editors and admins can be given an Emitter (a viewer couldn't edit it). The Emitters list has an **Assigned to** column and filter (Me, Nobody, or a person). Every change is in the Audit Log and the Emitter's Audit tab.

**Tasks** are to-dos, three ways:

- **For yourself** — a personal reminder.
- **For someone else** — giving out work; it shows on their dashboard and in the count by **Tasks** in the top bar.
- **For anyone** — up for grabs; whoever takes it becomes its owner.

A task has a title, optional details and due date, and can be about one Emitter, Platform or MDF. Each task also keeps a running **notes** log — progress, questions, what's left — each note stamped with who wrote it and when, newest first. **💬 Notes** on any task row (on the Tasks page, the dashboard, or an item's Tasks list) opens it. Editors and whoever the task is for can add notes; a note can be deleted by whoever wrote it or an admin; deleting a task deletes its notes. The **Tasks** page has views for Mine, Up for grabs, I gave out, Everyone (narrowed to one person if you like) and Done (the latest 200). On an Emitter, Platform or MDF page, **☑ Tasks** lists the tasks about it and adds one already linked. Overdue tasks are marked red, ones due today amber.

Editors can create, edit, reassign and tick off any task; whoever a task is for can always tick it off, even a viewer. A task can be deleted by whoever made it, whoever it's for, or an admin. Tasks are visible to everyone — they're how the team splits the work. Every change is recorded in the Audit Log.

