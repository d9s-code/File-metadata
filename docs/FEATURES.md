# Features

This document walks through every feature of the RF Emitter Profile Manager, organized in the order data flows through the system: **Emitters → Platforms → Mission Data Files (MDFs)**, plus the cross-cutting tools (versioning, ambiguity checks, test tracking, backups) that apply at each level.

If you just want to see it running, start with the [README](../README.md). This document explains *what each screen does and why it works the way it does*.

---

**Tables everywhere:** drag the right edge of a column heading to resize the column; double-click it to put it back. Widths are remembered per table in the browser. A row's less common actions (Edit, Delete, Approve, Reject …) are under its **⋯** menu; Delete always asks first. List filters sit on one line above the table with the shown count ("12 of 31 Emitters"); **Reset** appears only while a filter is set.

**Menu.** The top bar holds Dashboard, Emitters, Platforms, MDFs, Dwells, Intercepts (and Admin). **Source Groups** and **Report** are tabs on the Emitters page and **Customers** a tab on the MDFs page (the menu item stays lit on them); **Help** is the **?** beside Search. **Tasks** are on the Dashboard (My work) and in the account menu, which also holds the **Audit Log**; the number by your name is how many tasks are open for you. Explanations that used to sit under page titles are behind a small **?** beside the title, shown on hover or focus.

**Every page is laid out the same way.** The title row first (the title, its **?**, and the page's main buttons on the right), at the same height on every page; then the section's tabs (Emitters · Source Groups · Report, MDFs · Customers, Strategies · Dwell files, the Admin pages), all one size; then the filters, with the count of what's shown at the right; then the content.

**Analyst notes** on Emitters, Platforms, MDFs and Intercepts open from a **Notes** tab fixed to the right edge of the window, in a panel that stays put while the page scrolls and doesn't block it; open or closed is remembered across pages. A note written but not yet added is kept in the browser per Emitter/Platform/MDF/Intercept (and per Source and Task) until it's added — closing the panel, leaving the page or the browser, or a stray click doesn't lose it, and the closed tab shows ✎ while one is waiting. Nothing is added to the log until **Add note** is pressed, since notes are append-only.

**Dates** are shown day.month.year (07.10.2026) with a 24-hour clock (14:05), everywhere. Date fields take dd.mm.yyyy (also 7.10.26, 7/10/2026, 07102026 or 2026-10-07) with a calendar button; time fields take hh:mm. The server still stores and exchanges ISO dates.

**Backup warnings** for admins show on the Dashboard and the Admin pages only.

**Editing entries in the Audit Log.** For an Emitter, **Started editing** and **Stopped editing** are the edit lock being taken and released — neither saves anything. **Saved version** is a saved version; Save version also stops editing, so the two appear together. A **Stopped editing** on its own means the editor stopped without saving (the changes stay live, unsaved), an Admin force-released the lock, or it was released automatically after going untouched. **Discarded changes** means the edits were thrown away. (Older entries recorded as "Checked in" show with today's wording.)

**An Emitter's Audit tab, narrowed.** **What changed** narrows the tab to one kind of thing under the Emitter (Modes, Sources, EW Groups, … with their counts; `/audit-log?emitter_id=…&entity_type=mode`, counts at `/audit-log/entity-types?emitter_id=…`). Narrowed, the Emitter's version saves, reverts and discards stay in as dividers (`with_versions=true`; "Saved v2 — …", reverts and discards in amber, each entry recording its `version_number`), so each change sits under the version it went into. Every update shows its changes in one line under its summary ("RF 9400–9500 → 9380–9520 MHz, jitter max 1 → 3 µs"; a min and max that both changed read as a range); Details has every field. A **revert** or **discard** logs each Mode, EW Group, Source and SIM Test Line it brought back, removed or changed back, with old → new values ("Changed Mode 'Search 1' back — reverting to version 2"), and per Source one entry counting the Elements and sequences it brought back, removed or changed. A Mode made by **adding a value** says which Mode it copies and what it adds ("Created Mode 'Search PRI 1500 1' — Search 1 with PRI 1500 µs, jitter 0–3 added").

**What else the Audit Log records.** Besides every edit: reordering milestones ("Reordered default Emitter milestones: …"), starting and discarding a test run in progress (its saves as it's filled in aren't logged), running an ambiguity check (scope, version and thresholds), syncing the AI's documentation from Outline, someone changing their own settings, Modes added from what the AI chat proposed (beside each Mode's own "Created Mode" entry), and the admin's settings and Mode defaults. An AI chat's own questions, answers, renames and deletions are each person's own and aren't logged; nothing in them changes data. Filter by **Test runs in progress**, **Ambiguity checks** or **AI documentation** like any other kind.

**Search (quick-jump).** **⌕ Search** in the menu bar, or Ctrl+K (⌘K on a Mac) from any page, opens a box that finds Emitters (name or designation), Modes, Platforms, MDFs, Sources, Intercepts, Dwell Strategies (name or description) and dwell files as you type — every word has to match, in any order; exact and starts-with matches first; up to 8 of each kind; deleted things left out. ↑↓ and Enter open one: a Mode on its Emitter's Modes tab, a Source on the Groups & Sources tab (`GET /search?q=`).

**Sorts and filters are remembered for the session.** Every table's sort (the column and direction) and the filters on the lists and tables — Emitters (name, ranges, assigned), Platforms, MDFs (name, status, customer), Intercepts, Dwells, the Audit Log, the Dashboard's Emitter table, Ambiguity, Source Groups, an Emitter's Modes (every filter, sort and the deltas switch) and All Sources (per Emitter), Mode ladders, an Intercept's reports — are kept in the browser tab's session storage: a reload, or going to another page and back, finds them as they were. They're forgotten when the tab closes, and a new tab starts with none. Ticked rows and open dialogs aren't kept.

**Modes sort with ties broken by name.** On an Emitter's Modes, sorting by any column (RF, EW Group, PRI type…) lists Modes with the same value by name, A–Z with numbers by value ("Search 2" before "Search 10"), then by EW Group — so equal values never come out in an arbitrary order; sorting by name breaks ties between same-named Modes by EW Group.

An address that doesn't exist (mistyped or out of date) shows **Page not found**, with a link to the Dashboard.

## 1. Emitters

An **Emitter** is the top-level record for a single RF emitter profile. It has a **name** (unique) and an optional **designation** (e.g. a platform-independent reporting name), plus a free-text description.

An Emitter is always edited as a **live draft** — changes save immediately, and nothing is locked in until you explicitly [commit a version](#5-versioning--diffs). Two things live inside an Emitter:

- **EW Groups** — operational groupings of Modes (see below)
- **Sources** — data-provenance groupings of Modes, and the home of the element-based mode-building tools (see [DSL, Elements & Editorial Tools](#3-modes-the-dsl-elements--editorial-tools))

Every Mode belongs to exactly one EW Group *and* one or more Sources — two independent, orthogonal groupings of the same underlying Modes.

The **Emitters list** (Z–A by name until sorted otherwise) shows each Emitter's designation, name, status, assignee, the **Platforms** it's pinned on (each a link to it, sortable; deleted Platforms aren't listed) and RF, PRI and PW ranges — each as a **min** and a **max** column under one heading with its unit, each sortable on its own (Scan is a pair you can turn on under **Columns ▾**, which also hides any other); the table spans the page with the name a set width (long names wrap) and the spare width shared among the other columns, numbers right-aligned, plus **SIM correct** — how many of its SIM Test Lines were correct in the latest run that included them, out of all its lines (e.g. "4 / 5"; sortable by the share) — and **Tasks**: its open tasks as "☑ n", opening the Emitter's task list to read, tick off or add one (the counts come from one query for the whole list; a row with none shows the chip only when pointed at). Filters: a search on name or designation, a **Platform** search (matches part of the name of any Platform the Emitter is on, suggesting the Platforms as you type; "none" finds Emitters on no Platform), the assignee, and **RF / PRI / PW / Scan ▾** for min/max range filters, laid out across the page's width. Each row's **⋯** menu has Compare with another Emitter and Delete.

**Bulk actions** (Editors and Admins): tick Emitters in the list (the heading's box ticks every one shown) and a bar above the table applies one action to all of them — **Assign to** someone or nobody, **Move status to** (Operational, Partially operational and Needs rework take the required note), **Pin latest saved version into** a Platform, or **Release edit locks** (your own; an Admin anyone's). Each Emitter goes through the same rules as on its own page, one at a time; any that can't are skipped and listed with the reason ("Already Testing", "No saved version to pin", "Only the holder or an Admin can release this checkout"…), the rest are done (`POST /emitters/bulk`).

**Compare two Emitters** (**More ▾ → Compare with another Emitter** on an Emitter, or **Compare these two** with two ticked in the list): pick Emitter A and B and, for each, a saved version (the latest by default); **⇄ Swap** flips them. The page says how many pairs of Modes — one from each — the ambiguity check would flag, by severity; draws both on the RF/PRI/PW coverage charts (per Emitter or per Mode, with the overlaps hatched); lists the overlapping pairs, worst first, with each parameter's overlap — RF, PRI (marked *frame time* or *steps* for Staggers), PW and, for two Fixed Modes, jitter — the deciding one in bold; and shows each Emitter's Modes side by side, the overlapping ones marked. If either has no Modes in the version picked, it says there's nothing to compare yet. The address keeps the choice, so it can be shared (`GET /emitters/compare?a=&b=&a_version=&b_version=`).

### EW Groups

An EW Group represents an operational grouping — think "the set of modes this emitter uses while in track mode." Each EW Group carries:

- **Scan min / max** — the group's scan parameter range, as raw/as-entered
- **Scan delta** (optional) — a symmetric ± tolerance delta; see [Raw vs. engineered values](#raw-vs-engineered-values) below
- **Threat priority** — a numeric priority value
- **Ageout** (optional, seconds) — a plain descriptive reference value. No automated behavior is tied to it (nothing expires or gets flagged when it elapses) — it's recorded and displayed only.

EW Groups are how the "EW Groups → Modes" tab on the Emitter page is organized: expand a group to see (and add) its Modes.

**A suggested first EW Group.** While an Emitter has no EW Group, the empty EW Groups card suggests a scan range from its Sources: the **shortest to the longest scan time** (s) among the scan Elements of all its Sources (a single value counts as both ends; scan times are used as entered, never converted to a rate), with how many Elements and Sources it came from. **Use it for a new EW Group** opens the form with Scan min / max filled in, to name and save. Nothing shows when no Source has a scan Element (`GET /emitters/{id}/ew-groups/suggestion`).

---


### Report

**Report** (a tab on the Emitters page) downloads a spreadsheet (.xlsx) with a line per Mode for the Platforms and Emitters picked. Two lists, each with a search and All / None: **Platforms** (each with how many Emitters it pins) and **Emitters** — an Emitter on a picked Platform is ticked and greyed, "on <Platform>", as it's in the report through it; tick others to add them on their own. The line above says how many Platforms, extra Emitters and Emitters in all; the picks are kept for the session.

The sheet has the export header's columns, with **Platform** in front: Emitter, its designation, Mode, Polarization, Ageout [s], Threat Priority, Quality, Quantity, Scan Type, Period Min/Max [ms] (the EW Group's scan, in ms), Frequency and Pulse Width Min/Max, PRI Type, PRI and Jitter Min/Max, Frame Min/Max, then Stagger 1–32 [µs] (more columns if a stagger has more steps). Frequency, pulse width, PRI and frame time have their deltas applied, as the PRS export writes them. Polarization and Scan Type aren't kept in the app, so they're empty. The header row stays in view while scrolling.

**Order:** Platforms A–Z, each one's Emitters A–Z under it, each Emitter's Modes A–Z (numbers by value: "Search 2" before "Search 10"); then the Emitters picked on their own, A–Z, with Platform empty. An Emitter on two picked Platforms is listed under each. A Platform's Emitters are the versions it pins; an Emitter picked on its own is its latest saved version (as it is now, if never saved). An Emitter without Modes still gets a line, its Mode columns empty (`POST /reports/emitters`).

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

**+ Add Mode** and a Mode's **Edit** share one form. It suggests a name (the next free "<EW Group> n"; a copy suggests the one after the original's), then has one labelled row each for RF, PRI (its type chosen in the row) and PW, each with min, max, ± delta and a Range Matching box. Leaving max blank means the same as min, for a single datasheet value. Under every row the form shows what it will match with the delta applied ("Matches 2,999 – 3,001 MHz"), or a stagger's step count and frame time, and points out a mistake in plain words under its row (once you leave the row, or all at once on save) — the form doesn't submit until the line is valid. **Start from** copies an existing Mode in. **Add & next** saves and starts the next Mode with the same EW Group, Source, PRI type, deltas and range flags, with the next name. Confirmation, notes and test-derived links sit under **More options**, summarised in one line while folded.

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

Then use the **Cartesian Product** tool: pick one or more RF elements, PW elements, and PRI elements, choose a target EW Group, and run it. The tool generates **one new Mode per combination** — N RF × M PW × K PRI elements produces N×M×K Modes in one action. This is the fast path for generating a large family of related modes (e.g. sweeping RF sub-bands against a couple of PRI options). The Modes are named from the **name prefix**, numbered (*Search 1*, *Search 2*, …); a run that makes just one Mode names it the prefix alone (*Search*), unless a Mode of that name is already in the EW Group, when it's numbered too.

Mixing Fixed-style and Stagger PRI elements in a single cartesian-product run is rejected — pick one shape per run so the resulting batch is predictable.

**PRI type** (beside the PRI column; **Fixed** by default) sets the PRI of the Modes made. **Fixed** works as above: one Mode per PRI Element or Sequence step. **Stagger** makes **one stagger train**, crossed with every RF × PW combination, from either:
- the ticked **PRI Elements**, whose **Delta** column becomes **Firing order** — each Element's place in the train, from 1 (filled in as you tick them; `1, 3` fires an Element first and third). The positions must run 1 to N with no gaps or repeats. A PRI range fires at its **mean** (900–1000 µs → 950); a stored stagger Element puts in all its values. No PRI delta is asked for; or
- the ticked **Sequence steps** — each Sequence's PRI steps fire in its **step order**, so the order isn't typed twice (one train per Sequence; a step's PRI range fires at its mean). With no RF or PW Element ticked, the Mode takes the RF and PW its steps span.

Not both at once. The Modes' frame-time delta starts at 0; edit a Mode to give it one. All Sources' **Generate** has the same **PRI type** choice, with a firing-order box per ticked PRI. The Generation log notes the PRI type and each PRI's firing position.

Each run is kept in the Source's **Generation log** tab, newest first: when and by whom, the EW Group, name prefix and note, the Elements or Sequence steps combined (values, variant, and the delta used — marked when it was overridden for that run), range matching, and the Modes it made, with how many are still there. An entry outlives its Modes: deleting the generation batch leaves it in the log.

**All Sources** (Setup tab, under the Sources) is every Element of the Emitter's Sources as one pool: the same type and values (and a PRI's jitter) in several Sources — or twice in one — is one Element, merged the way the per-Source generator merges them. Each row shows the values, the delta (a range when its Sources differ), its variants, and its Sources: two by name, the rest folded into **+N** (every name on hover; click to list them). **Search** matches values, Source names, labels and variants (every word); **from – to** keeps Elements whose values reach into that range (in the unit of the type picked); filter by type, Source, variant, or to Elements in more than one Source; **Reset** clears them.

**Clean up…** (All Sources, while editing the Emitter) clears out what an import brought in that shouldn't be there. Narrow by type, **Name** (the Element's label — every word, e.g. *scan rate*) and/or **Value is exactly** (every value of the Element is that one — a PRI of 0, say); it lists each matching name per type with its values, how many Elements and how many Sources. Tick names and **Delete N Elements…** → **Delete them** removes every Element under them, from every Source at once — all or none, one Audit Log entry per Source listing what went (`POST /emitters/{id}/elements/delete`).

While the Emitter is being edited, tick Elements (RF, PRI, PW — Scan isn't used in Modes) and **Generate N Modes**: every RF × PRI × PW combination (no RF or PW ticked: that axis is left at 0, as on a Source; PRI is required, and Fixed-style ranges and stagger sequences can't be mixed), into an EW Group, with a name prefix, an optional note, range matching per parameter and an optional delta per parameter — blank uses, for each Element, the widest delta any of its Sources gives. **Each Mode gets the Sources its own Elements were found in**: every Source holding any of its RF, PRI or PW, the one holding most of them as its main Source (by name on a tie); rejected Sources only when there's nothing else. The run is logged in the Generation log of the Source holding most of the ticked Elements, its note starting "From All Sources" (`POST /emitters/{id}/sources/all-sources/cartesian-product`, the same body as a Source's cartesian product, any Element of a merged group picking the group; sequence steps aren't taken).

A Mode with many Sources shows two by name and **+N** for the rest, in the Modes table and cards alike.

**Element coverage** (Setup tab, under All Sources) shows which of those Elements the Emitter's Modes cover. Each distinct Element is **covered** (✓, green), **partly covered** (½, amber) or **not covered** (✕, red): an RF, PW or fixed PRI against the Modes' ranges with their deltas (several Modes together can cover a range); a PRI used as a step of a Stagger Mode (a range by its mean) is covered by it; a scan against the EW Groups' scan ranges. A **stagger** is checked against the Stagger Modes **in order**: a stagger Element, and each of the Sources' **sequences** with PRI steps — its PRI steps in step order, a range at its mean, the same train generating Modes from it makes — is covered by a Stagger Mode with the same steps in the same order (starting at any step, since a train repeats); for a sequence, its steps' RF and PW must also sit in that Mode's. It's partly covered when a Stagger Mode has all its steps in another order or among others, has only some of them, or matches but not on RF/PW. A sequence without PRI steps has each step's RF (and PW) checked against the Modes'. Partly means only some of it is, and a note says how ("Hop has all its steps, in another order", "2 of its 3 steps are covered"). Sequences are drawn as squares at their steps, Elements as dots and bars. **Include** ticks which parameters (RF, PRI, PW, Scan) count — unticked ones leave the charts, the counts and the list, and the choice is remembered in the browser. Each ticked parameter has a chart: the Modes' (for scan, the EW Groups') ranges in grey above — a Stagger Mode as ticks at its steps — and the Elements below, coloured by coverage, on one axis with empty stretches cut out (⧵⧵). Hovering an Element names what covers it and its Sources, and dims the Modes that don't; hovering a Mode says how many Elements it covers and dims the rest. Under the charts each parameter's counts, then a table of the Elements not, or not wholly, covered — values, Sources (linked) and the Modes covering part of them (`GET /emitters/{id}/element-coverage`).

**Batch add** (Sources panel) adds Elements to several Sources at once: tick the Sources in the dialog (the table's selection starts ticked, **All** ticks every one), pick the type and variant, and type the values — each entry its own Element, a value (`9000`) or a range (`9100-9200`, `9100–9200`, `9100 to 9200`), separated by commas, semicolons, spaces or new lines. A delta, label, notes and (PRI) jitter apply to each; a stagger PRI sequence goes in as one Element per Source. The preview counts what will be made ("4 Elements × 3 Sources = 12 Elements"), entries that aren't numbers are flagged before sending, and the whole batch is one request that adds everything or nothing, placed after each Source's existing Elements of that type, with one audit entry per Source (`POST /emitters/{id}/sources/batch-elements` with `source_ids` and `elements`). Sequences are still added Source by Source.

### Raw vs. engineered values

An element's min/max is the **raw** value — pulled straight from the source, exactly as reported, with no adjustment. Separately, an RF, PW, or Fixed-style PRI element (not Stagger, for which delta means something different — see Frame Time below) can carry an optional **delta**: a symmetric ± tolerance delta representing sensor/collection measurement uncertainty. When a delta is set, the app computes the element's **engineered** range (`raw min − delta` to `raw max + delta`) and shows it alongside the raw value wherever the element appears — the raw value itself is never overwritten.

The engineered range, not the raw range, is what actually gets written into the generated Mode Line when the element is used in a cartesian-product run — so ambiguity checks, the Mode's DSL text, and XML export all see the engineered value, while the Elements pool keeps the raw value on record for provenance. An element created by typing a DSL line directly gets no delta (the typed numbers are already treated as final); go back to the Elements panel afterward to add one if the source data needs an engineering delta.

A manually-created or manually-edited Mode Line carries its **own** per-parameter deltas — `rf_delta`, `pw_delta`, and (for Fixed PRI) `pri_delta` — required fields, same status as `rf_min_mhz`/etc. Cartesian-generated and DSL-parsed lines don't set these: the engineered value is already baked into the line's raw min/max at generation time, so a separate delta would be redundant.

EW Group **scan delta** works the same way for computing an engineered scan window, but for v1 it's display-only: XML export still exports the group's raw `scan_min`/`scan_max` unchanged. Say so if you'd rather XML export emit the engineered scan window instead.

### Frame Time

Next to any Stagger element or Stagger Mode, a **Frametime badge** shows the sum of its sequence — the time for one full cycle through the stagger pattern.

A Stagger PRI **element** must carry a **delta** (repurposing the same `delta` field used for RF/PW/Fixed-PRI elsewhere, now meaning a frame-time tolerance rather than a range tolerance) — the app can't compute an engineered frame-time window without it, so it's required, not optional, specifically for Stagger. This is also how frame time flows through the cartesian-product tool: since a Stagger PRI element can't exist without its delta already set, every cartesian-generated Stagger Mode automatically inherits a valid frame-time delta with no separate input needed in the Cartesian Product form itself.

A manually-created or manually-edited Stagger Mode Line carries its own `frame_time_delta_us`, entered directly in the Mode form next to the stagger sequence. The form's **frame time** field follows the sum of the sequence as you type; write a different value into it and the Mode stores that as `explicit_frame_time_us` (cut to 3 decimals), used instead of the sum everywhere (engineered range, both PRS exports). **Use sum** clears it again. The engineered frame-time range (`frame time − delta` to `frame time + delta`) is shown wherever the sequence appears. A PRS import whose `FramePeriod` midpoint differs from the sequence sum restores it as a written-in frame time.

When logging intercepted parameters during a test, a Stagger set can also record the measured frame time.

### Confirmation quality & quantity

Every Mode carries a **Confirmation quality** (0–100, default 100) and a **Confirmation quantity** (1 or more, default 2). Both are set in the Mode form, editable per Mode or with Batch edit, recorded in the audit trail and version history, and written to the PRS export's `ConfirmationQuality` / `ConfirmationQuantity` elements (which used to be fixed placeholders of 100 and 2).

### Range Matching

A per-parameter flag — `RF`, `PW`, and `PRI` are each independently on or off for a given Mode Line. Currently a stored flag only; no behavior elsewhere in the app reacts to it yet, but it's shown as its own sortable column on the Modes table (and its own field on the Mode cards view), rendering one small tag per active parameter (e.g. `RF` `PRI` side by side) or `—` if none are set.

Range matching is treated as **any other Mode Line parameter** — not a metadata field you can toggle freely. It's set when creating a Mode, and on an already-`approved` Mode it can only change through the same propose-edit/approve cycle as RF/PW/PRI values themselves (see [Editing an existing Mode](#editing-an-existing-mode-draft-edits--approval) below) — a direct attempt to flip it on an approved Mode is rejected the same way a direct line edit is.

---

### Editing an existing Mode: draft edits & approval

Editing a Mode's **metadata** (name, notes, which EW Group it's filed under) is an instant edit, same as creating one. **Renaming**: the Mode's **Edit** form (⋯ menu, while editing the Emitter) starts with its **Name**, cursor there; it warns as you type if another Mode in the same EW Group already has the name, and the server refuses a blank name (422) or a clash in the group (409). The Audit Log records "Renamed Mode 'old' to 'new'". **Rename…** in the ⋯ menu of an EW Group or a Source (while editing the Emitter) opens a small dialog with the name selected, ready to type over — Enter saves; it warns and won't save when a neighbour already has the name (another EW Group or Source of the Emitter), and the server refuses a blank name (422) or a clash (409) the same way for both, logging "Renamed EW Group/Source 'old' to 'new'". The EW Group and Source edit forms label each field and say which one is being edited. A Mode's **Edit** and **Duplicate** (⋯ menu) open the form in a dialog centred in the window, never taller than it, with Save pinned at its bottom. Single values change **in place**: double-click a cell of the Modes table (while editing the Emitter, editor or admin) — name, RF/PRI/PW min and max, their ± deltas, a fixed PRI's jitter ("0–1"), a stagger's steps (in the PRI cell) and its frame-time delta (PRI Δ), confirmation quality and quantity. Enter or clicking away saves, Tab saves and moves to the row's next editable value (Shift+Tab back), Esc puts it back. It's checked like the form (a max below its min, a name another Mode of the EW Group has, quality outside 0–100) and stays open with the problem under it; the box holds the programmed value even when the table shows engineered values. The Modes table's box is sized to the window: with the page at the top, its last row, horizontal scrollbar and card edge are in view, and it resizes with the window (never under 240 px). But editing its **line** — the actual RF/PW/PRI/jitter/stagger values, deltas, and range matching flags — works differently once the Mode is `approved` (the normal state for anything already created):

- **Propose edit** creates a new `draft` Mode carrying your edited line, linked back to the Mode it would replace. The original is untouched and still fully live (still what ambiguity checks, XML export, and Emitter version commits see) while the draft sits pending.
- Only one pending draft per Mode at a time — you can't propose a second edit while one is already under review.
- **Approve** flips the draft to the live, canonical line and marks the Mode it replaced as `superseded`. Superseded Modes are kept permanently (full lineage, nothing is ever deleted) but are excluded from the active Modes list, ambiguity checks, and XML export — toggle **Show history** on the Modes table to see them.
- **Reject** discards the draft; the original Mode is never touched.

A `draft` Mode's line can still be freely edited directly (refining your own pending proposal) — the propose/approve gate only applies to the currently-`approved` line.

### Test-Derived Modes

A Mode's values don't always come from a Source — real-world testing can turn up an emission a datasheet never mentioned, or reveal that an existing Mode's parameters are wrong. Both the "+ Add Mode" form and a draft-edit proposal let you optionally link the Mode to one or more existing **Test Records** whose findings explain its values ("this Mode is test-derived"). A linked Mode shows a **Test-Derived** badge with a popover listing the justifying test(s) — explainability for a Mode that didn't come from a Source, without needing a Source to explain it.

### Modes charts

The Modes tab's **Charts** view draws the Modes the filters leave on RF, PRI (a stagger's frame time) and PW, engineered ranges with the raw ones solid inside them, and this Emitter's intercept entries as ticks. **Layout** picks how:

- **One row per Mode** — range ladders: a row per Mode, its three ranges side by side, coloured by last test result or by Mode (eight colours at most).
- **Grouped by value** — for Emitters whose Modes combine a few ranges (4 RF × 4 PRI × 4 PW is 64 Modes but 12 ranges). **Distinct ranges** draws each parameter's distinct ranges once, labelled with the values and how many Modes have it, the bar split by those Modes' last test results (worst first); pointing at one fades the others and marks its Modes. **Combinations** is a grid crossing two parameters (the pair with the most ranges to start with; RF × PRI, RF × PW or PRI × PW) — a cell per pair of ranges, one square per Mode in it coloured by its last result (the third parameter on hover; a click opens the Mode), a hatched cell where no Mode has that pair, and "N of M combinations used" above it.

With more than 24 Modes the charts start grouped; the layout picked is kept in the browser.

---

## 4. Sources

A **Source** groups Modes by where the data came from (e.g. a specific collection event or report). Each Source has:

- Name and description
- **Date last updated** — a plain date *you* enter, independent of the record's actual edit timestamps. It's a fact about the data ("this is current as of..."), not a system-generated audit field.
- Its own pool of **Elements** (see above) — the working set Modes under this Source were built from

Sources are scoped per-Emitter — each Emitter curates its own list.

A Source can't be deleted while it still has Modes attached.

### A Mode from several Sources

A Mode can come from **more than one Source** — the same signal in two reports, say. The Mode form picks them as chips (*+ another Source…* adds one, × removes one; at least one stays); the Modes table's **Sources** column and the cards list them all, and the Source filter and search match any of them. **Batch edit** can add a Source to every selected Mode, or make one Source their only one, and set a Fixed PRI's **jitter** (min and/or max, µs) on the selected Fixed Modes — Stagger, CW and X-let Modes have none and are left as they are; one bound alone keeps the other. **+ Add a value…** (Modes toolbar) adds one RF, PRI or PW value — a stray PRI seen in a test, say — to every applicable combination of the other two: it lists each distinct combination of the other parameters among the Emitter's Modes (with their deltas and range matching, per EW Group; for an RF or PW the PRI type is part of it), all ticked to start, with which Modes have it; untick the ones it doesn't apply to and **Add N Modes** makes one new Mode per ticked combination — a copy of one of its Modes with only that parameter changed (a PRI as fixed with its jitter, or as a stagger's steps with its frame-time delta), named either with a name of your own and a running number ("Range day 1", "Range day 2" — carrying on from the highest number the Emitter already has under that name; the default when it comes from a test) or after the Mode it copies plus a suffix ("A1 PRI 1500"), in one generation batch per EW Group so they can be deleted together. A combination whose Mode has the value already is shown greyed and skipped. All or none: one that wouldn't make a valid Mode refuses the lot. It's offered pre-filled from a test run's **Logged intercepts against the Modes now** (a row with no Mode or a near miss: the parameter it was one off on, else its PRI — the new Modes are marked derived from the run) and from **Element coverage**'s list (an uncovered RF, PRI or PW Element, or a sequence's stagger — the new Modes also get its Sources). Needs the Emitter checked out (`POST /emitters/{id}/modes/add-parameter/plan` and `/add-parameter`).

**Delete (N)**, beside Batch edit while Modes are ticked, deletes them all at once after asking — all or none, each kept whole in the Audit Log, logged test results keeping their names, and Discard bringing them back until the Emitter is saved (`POST /emitters/{id}/modes/batch-delete`). Changes are audited ("Sources: A → A, B") and kept in versions: the diff shows a **Sources** change, and revert and fork bring them back.

- **Deleting a Source** is refused only while it's some Mode's *only* Source (the message names them); Modes that have another just lose it.
- **Rejected Sources**: a Mode is left out of exports and ambiguity checks only when *every* Source it comes from is rejected — one approved Source keeps it in.
- **Merging duplicates** from an ambiguity check keeps both Modes' Sources on the kept Mode.

### Intercepts as Sources

**Turn into Source** on an Intercept (Editors, with the Emitter checked out) adds a Source that stands for it — the Intercept's name, date and description, type "Intercept" — so a Mode can have the Intercept as its Source rather than an unrelated document. It's only a link: nothing is derived from the entries (no Elements), and Modes already made from the entries stay where they are. New Modes made from its entries (one at a time, or with Plan Modes) start on that Source. The Source shows "Stands for Intercept …" and the Intercept links to its Source; one Source per Intercept. The link is part of the Emitter's version (it survives save, discard and revert), and deleting the Intercept leaves the Source and its Modes in place, unlinked.

### Import

Beyond typing a DSL line or building Elements by hand, a Source's Elements and Parameter Sequences can be bulk-imported from a structured JSON payload — one `POST /emitters/{emitter_id}/imports` call creates a new Source per "parametric set" in the payload, each carrying its own Elements/Sequences. A `/validate` dry-run endpoint checks the payload (cross-object checks like duplicate Source names within one import) without writing anything, returning field-path-addressable issues suitable for a pre-commit review UI.

**XML import — not yet built.** The Elements panel has an "Import from XML" entry point ("coming soon") that will eventually parse an uploaded XML datasheet into this same JSON shape rather than requiring it hand-typed. See **[docs/XML_IMPORT_BRIEF.md](XML_IMPORT_BRIEF.md)** for the full field-mapping reference and open design questions before that work starts.

---

## 5. Versioning & Diffs

Emitters, Platforms, and MDFs are all **versioned** the same way:

- The live record is always an editable **draft**.
- **Commit Version** takes a full, immutable snapshot of the current state (for an Emitter: every EW Group, Source, Mode, and Mode Line) and adds it to that entity's version history, numbered sequentially (v1, v2, v3, ...).
- The **Version History** page lists every committed version and lets you pick any two to **diff** — added / removed / changed fields, shown with old vs. new values. By default it diffs a version against the one immediately before it, but you can compare against any earlier version too.

Nothing is ever silently lost: the live draft can keep changing, but a committed version is a permanent, inspectable snapshot you can always come back to.

### Status

Emitters, Platforms and MDFs carry a **status** that moves only along the allowed moves — you can't jump straight from In progress to Operational, for example. Admins set the statuses up under **Admin → Statuses & milestones** (see below); out of the box:

- **Emitters and Platforms**: **In progress** (grey) → **Testing** (orange) → **Partially operational** (yellow) / **Operational** (green) → **Needs rework** (red), and back to In progress from there
- **MDFs**: **Draft** → **Pending review** → **Approved** → **Released** → **Deprecated**

*Partially operational* is for something usable in part — some of its Modes have been checked and can be relied on, the rest are still being worked on; the note asked for when moving there says which part. From Testing an Emitter can go to Partially operational or Operational; from Partially operational to Operational, back to Testing, or to Needs rework; from Operational back to Partially operational. Moving to Operational, Partially operational or Needs rework asks for a note. Partially operational counts as not yet Operational wherever that matters (MDF readiness, Platform pin checks), and sits between Testing and Operational when a Platform shows its Emitters' worst status.

**Statuses Admins set up.** Under **Admin → Statuses & milestones**, for Emitters, Platforms and MDFs separately: rename any status, pick its colour (grey, blue, green, yellow, amber, orange, red, purple), add new ones, reorder them (the order lists and the dashboard show), choose which statuses each can **move to** (and which can reach it), and whether moving there **asks for a note** and with what question. The built-in statuses can be renamed and recoloured but not deleted — the app relies on them: new items start In progress / Draft, Operational is what MDF readiness and pin checks look for, Needs rework keeps the rework note. An added status can be deleted once nothing is in it; its default milestones go with it. Renames show everywhere at once — items store a status's fixed key, not its name (`GET/POST /statuses`, `PATCH/DELETE /statuses/{id}`, `POST /statuses/reorder`).

**Milestones.** What to get done before an item reaches a status — e.g. *Partially operational* needs *Manual dwell test passed*. **Default milestones** are set by Admins on the same page, per type and status, and are on every item of that type (edit or delete one there and it changes everywhere); an item can also have **its own**, added on its page. On the Emitter, Platform and MDF page, **◎ Milestones · 1/3** in the header shows how many of the milestones for the statuses it can move to next are met; it opens the list by status — tick one off by hand (who and when are recorded, with an optional note such as *Passed on the range, 14.10*), untick it, or add and remove the item's own. Each **Move to …** button shows the same count for its status. Moving to a status with milestones not met **warns and asks to confirm**, listing the open ones; confirming goes ahead and the version summary and audit entry record which weren't met (… *(milestones not met: …)*). Bulk status moves on the Emitters list skip those with milestones not met unless **even if milestones aren't met** is ticked (`GET/POST /milestones/{type}/{id}`, `PUT/DELETE /milestones/{milestone}/check/{id}`, defaults at `/milestones/defaults`).

**Status isn't versioned.** A status is where an Emitter, Platform or MDF stands, not part of its content: moving it doesn't save a version (that used to make a version for every move, often holding nothing else, and set Platform and MDF pins "Outdated"). Every move is in the Audit Log, with its note; the next version you save records the status it had then. Discard and revert leave the status as it is, and the unsaved-changes view doesn't count it. Readiness checks (an MDF's "Emitters Operational") use each Emitter's status now. Versions saved only for a status change, from before, are **folded away** in every version history — one line says how many, and **Show them** brings them back (remembered for the session).

Changing an Emitter's status doesn't need **Start editing**: any Editor can, even while someone else holds the Emitter, and their unsaved edits stay as they are. Each change is in the audit log, with its note where one is required.

---

## 6. Platforms

A **Platform** groups several Emitters — think "everything mounted on this aircraft/ship." Platforms are what actually gets pinned into an MDF, not Emitters directly.

Critically, a Platform doesn't reference an Emitter's live draft — it **pins to a specific committed Emitter version**. This means editing an Emitter later never silently changes a Platform that already pinned an earlier version. If you need the Platform to pick up new Emitter changes, you explicitly **repin** it to a newer version (the version picker in each pinned row lists all of that Emitter's committed versions).

Platforms are versioned exactly like Emitters (commit, history, diff) — a Platform version snapshots the full set of emitter/version pins at that point, including each pinned emitter's complete nested data.

**+ Pin Emitters** opens a list of every Emitter, designation first, with a search box (designation or name) and its status and latest saved version: tick any number (or **Tick all shown**) and **Pin N Emitters** pins each at its latest saved version in one go. Emitters already pinned show the version they're at, and ones never saved say so; neither can be ticked (`GET /platforms/{id}/pin-candidates`; `POST /platforms/{id}/links` without `emitter_version_id` pins the latest). In the pinned table, an Editor changes a pin's version with the picker in its row (newest first, the latest marked; **view** opens that version), and **Unpin** asks first. The designation is its own column. A pin whose Emitter has a newer saved version is flagged **Outdated — vN saved**, with **Repin to vN** beside it for Editors; the header counts the outdated pins, and **Repin all to their latest version** moves every outdated pin at once (one Audit Log entry; `POST /platforms/{id}/links/repin-latest`). `GET /platforms/{id}/links` returns each pin's version number and the Emitter's latest. Its tabs:

- **Charts** — what the pinned Emitter versions cover on **RF**, **PRI** (a stagger's frame time) and **PW**, one chart each. **Per Emitter**: one line per Emitter, its Modes' ranges joined only where they overlap or touch — a PRI of 1–2 µs and 200–205 µs in two Modes stays two pieces, never 1–205. **Per Mode**: a line per Mode under its Emitter. Engineered values (± deltas) by default, raw on request; a log scale for values spanning orders of magnitude. **Horizontal / Vertical bars** turns the charts on their side (a column per line), and **Stacked / Side by side** puts RF, PRI and PW under or next to each other (both remembered). Each chart **pans** by dragging, **zooms** with Ctrl/⌘ + scroll (or + and −), and **Show all** or a double-click resets it. **Ambiguities** marks, hatched in red, where Modes of different Emitters overlap according to the latest ambiguity check — hover a mark for the Modes and severity. Modes whose Sources are all rejected are left out, as in the export.
- **Tests** — **Platform tests**: every pinned Emitter tested in one run. **+ Add Platform test** opens a run page with the run's own details (title, Simulation or Intercept Test, date and time, the intercept date for an Intercept Test, dwell, session notes) and one row per pinned Emitter: **In this run**, the pinned version, for a Simulation Test its own **Simulation created** date (filled in from the newest of that Emitter's SIM Test Lines' created dates, editable; required — one with no lines needs it typed), a **result** (Pass / Fail / Partial / Inconclusive — blank until picked, and every Emitter in the run needs one before it can be logged) and **notes**. The run is saved as it's filled in and listed under **In progress** to continue or discard. **Log** writes, in one go, an ordinary test record per Emitter in the run against the version the Platform pins (so it also shows in that Emitter's Test History, marked *Part of the Platform test …* with a link back to it, as on the record's own page), grouped as one Platform test whose result is the worst of the Emitters'. Each Platform test has its own page — the run's details, then each Emitter's version tested, simulation date, result and notes, its name linking to its record — and **Redo test** (also **Redo** in the list) starts a new run titled "Retest: …" with the same Emitters, each linked to its record in the earlier run and showing its result then. Above the list, a **Trend** grid shows each Emitter's result in the latest 12 Platform tests, oldest first (`POST /platforms/{id}/tests`, `GET /platforms/{id}/tests`, `GET /platform-tests/{id}`, drafts at `/platforms/{id}/test-drafts`).
- **Analyst notes** — the same append-only, timestamped log as an Emitter's (also on MDFs), in the Notes panel.
- **Ambiguity check** (under **More** at the top, as on an Emitter) — runs on the latest saved Platform version and answers *which Emitters could be taken for each other*: each Emitter's Modes are compared with the other Emitters' Modes, never with its own (that's the Emitter's own check).

The **Platforms list** shows, for each Platform: its own **Status**, how many Emitters it pins, the **worst status** among them (Needs rework, then In progress, Testing, Partially operational, Operational — hover for the count of each), how many pins are **outdated**, the Modes in the pinned versions, how many MDFs it's in, what its latest ambiguity check found (how many Emitters could be taken for another, and how many findings are still open), when it was last saved, and its open Tasks. Every column sorts.

---

## 7. Mission Data Files (MDFs)

An **MDF** is the deployable artifact — the file structure actually loaded onto the RF Recognizer. MDFs link to **Platforms** (never directly to Emitters), and just like Platform→Emitter pinning, an MDF pins to a specific **committed Platform version**. This gives you a two-level pin (MDF → Platform version → Emitter version), so changes at either lower level never silently ripple upward into an MDF you've already built.

MDFs are versioned the same way as everything else, and carry their own status lifecycle (see [Versioning & Diffs](#5-versioning--diffs) above).

Pinned Platforms with a newer saved version are flagged the same way as a Platform's Emitter pins — **Outdated — vN saved**, **Repin to vN**, a count in the header and **Repin all to their latest version** (`POST /mdfs/{id}/links/repin-latest`).

A **Readiness** checklist heads the Pinned Platforms tab (`GET /mdfs/{id}/readiness`), problems first, each line ✓ ready, ! a warning or ✕ a problem: Platforms pinned · the pins saved as a version (or changed since) · Platform pins up to date · Emitter pins inside those Platform versions up to date · every Emitter Operational in the version pinned · every Emitter's latest Simulation Test passed (never-tested ones are a warning) · the latest ambiguity check has no open High or Exact finding (never checked, or the MDF saved since, is a warning) · a passing MDF test on file. Long lists show the first five with **Show all**.

The MDF page's **Charts** tab works like a Platform's (layout, zoom and the ambiguity marks included), one level up: **Per Platform** — a line per pinned Platform version covering everything its Emitters do (joined only where ranges overlap); **Per Emitter** — a line per Emitter under a heading for its Platform; **Per Mode** — a line per Mode under its Emitter. Bars are coloured by Platform, or by Emitter once Emitters are shown. It reads each pinned Platform version and the Emitter versions recorded in it (`GET /mdfs/{id}/coverage`).

### Readiness signals

Before moving an MDF toward `approved` or `released`, the app checks two things and surfaces them as **soft warnings** (never a hard block — the decision stays with you):

- Are all the emitters referenced (transitively, through pinned platforms) marked `validated`?
- Is there at least one passing [test record](#8-test-tracking) on file for this MDF?

If either check turns up something, you'll see the warnings in a confirmation prompt before the transition goes through. You can always proceed anyway.

### Dwells

**Dwells** (a tab beside MDFs and Customers) has two lists, **Strategies** and **Dwell files**.

A **Strategy** is a named set of dwells for **one or more Platforms** — a Platform can have several (say, Summer and Winter), and one Strategy can cover several Platforms (ticked in a list; its chart then shows all of their Emitters, each once). A name can't repeat on a Platform the two Strategies share. A Strategy with **no Platform ticked** is a **default dwell**: not tied to any Platform, typically a larger sweep, and not a dwell file; default dwells' names are unique among themselves. It has a short **description**, shown under its name in the lists (and searched by the filter). Strategies are listed with the **Default dwells** first, then grouped by the Platforms they cover, with their dwell count, frequency range, cycle length, latest saved version and the files they're in. **+ Add Strategy** asks for the name, Platforms (none for a default dwell — the button then reads *Create default dwell*) and description, and can start from another Strategy's dwells. A Platform's **Dwells** tab lists the Strategies covering it, noting the other Platforms a shared one covers (*· also North*).

On a Strategy's page the **Dwells** tab edits, in order, each dwell's **frequency in MHz** (as the file has it), **dwell time** and **collect time** in ms (collect defaults to 50 ms). Enter in a row adds the next dwell below it; each row's ⋯ menu inserts, duplicates, moves or removes; **Add several…** appends a list of frequencies (commas, spaces or lines) with one dwell and collect time; a Starts at column shows where each dwell falls in the cycle. **Save as vN** (with an optional "what changed") saves the dwells as a new version straight away, so dwell files can pin them; Discard drops the edits. Until then the edits are **kept in this browser** — leaving the page, a refresh or a closed tab doesn't lose them: coming back restores them (and says when, and whether the Strategy was saved since). The name, Platforms, description and **manual collect time** (ms, default 50) are under More ▾ → **Details…** (read-only for viewers); saving them saves a new version too. RapidDF and Split Mode aren't shown or edited: they're written to the file as the imported file had them (a new Strategy gets RapidDF 50/50/500 and Split Mode 500, 750, dwell and collect 50). The page's **Notes** panel keeps running analyst notes about the Strategy, like a Platform's.

The **cycle** — how long one pass through all the dwells takes — leads the chart's summary as a highlighted **Cycle 1250 ms** badge (with seconds beside it from 1 s up: *(1.25 s)*).

Beside the table, the chart draws one cycle as a **waterfall**: frequency (MHz) across, time (ms) running down. Each dwell is a band of the chart **bandwidth** around its frequency (± half of it) from when it starts to when the next one does, numbered, with dashed lines for the hop to the next. Hovering a band or a table row picks out both and shows a box beside the band with the stretch it covers — e.g. **3020–3040 MHz** for a dwell at 3030 MHz with a 20 MHz band — its place in the cycle, dwell and collect time. The bandwidth (in the chart's header) is an app-wide default an admin sets under **Admin → Settings** (10 MHz to start with); a Strategy can keep its own (blank goes back to the default). The frequency axis is **Cut gaps** by default: stretches with no dwell and no Emitter in them (say, the C band between S- and X-band work) are left out and marked ⧵⧵, and the line above the chart names them; **Linear** shows every MHz alike and **Log** a logarithmic axis (the choice is remembered in the browser). With no dwells yet the chart still shows the Platform's Emitters, to plan against. Beside the table the chart fills the window's height; **Wide chart** puts it full width above the table, taller still (remembered in the browser; **Beside table** goes back).

**The Platform's Emitters on the chart.** A Strategy's chart also shows the frequencies its Platform's pinned Emitters occupy — each Emitter's Modes' RF ranges as measured (without matching deltas), from the Emitter version the Platform pins. Each Emitter is shaded behind the dwells across its ranges and drawn in a lane of its own colour under the chart, so a gap between the dwells and an Emitter stands out. The legend names each Emitter (linked), says how much of its RF the dwell bands sit on (e.g. "35% dwelt on", or **not dwelt on** in red), and its swatch hides or shows it; hovering an Emitter picks it out. The chart widens to take in every Emitter shown.

**On the Platform.** A Platform's page has a **Dwells** tab: its Strategies (with descriptions, dwells, range, cycle, version, the files they're in), **+ Add Strategy** for that Platform, and the chart of the picked Strategy (click a row) with the Platform's Emitters behind it — or, before it has any Strategy, the Emitters alone.

A **dwell file** (`dwells/<name>.xml` in an export) holds its Settings (timeout, setup time) and pins **saved versions of any Strategies** — a Platform can have several in one file (a Strategy covering two Platforms beside one for just one of them, say), default dwells too, and the same Strategy can be in several files. **+ Add a Strategy** picks the Platform or **Default dwells** (the file's MDF's Platforms first, each saying how many of the file's Strategies already cover it), then which of its Strategies (one already in the file can't be added twice); its latest saved version is pinned. The table lists each pinned Strategy's Platform, version, dwell count, range and cycle, and a row opens to its chart; the ⋯ menu repins to the latest version, pins another version, moves or removes it. A row opens to the pinned version's chart with that Platform's Emitters behind it; a pinned version with no dwells says so, and points to the newer version to repin. Pins with a newer saved version are flagged (**Repin all to their latest version**), as are Strategies for a Platform the MDF doesn't pin, and the page names the MDF's Platforms with no Strategy in the file yet. Name, MDF, timeout, setup time and notes are under More ▾ → **Details…** (read-only for viewers).

**Testing a Strategy.** Dwell testing is a by-product of Emitter testing: a simulation run that records a saved Strategy version as its dwell. A Strategy's **Testing** tab (`GET /dwell-strategies/{id}/testing`) lists, per Platform it covers, every pinned Emitter at its pinned version as **tested** — a run of it with this Strategy still holds: the dwells covering it (each dwell's band, its frequency ± half the bandwidth, reaching the Emitter's RF as typed) have the same frequencies, dwell times and collect times as in the latest saved version, and it hasn't moved outside the RF it was tested at or grown a longer PRI / frame time since — **stale** (tested, but no run still holds; it says why: "the dwells covering it changed since", "its RF moved outside what was tested", "its longest PRI / frame time grew since"), **untested**, or **not covered** (no dwell reaches its RF — the chart's "0% dwelt on"; a gap testing can't fix). Editing dwells for other bands leaves a test standing. A Platform test's run counts only for its own Platform; an Emitter's own run counts on every Platform the Strategy covers. Only simulation runs count; default dwells (no Platform) aren't tracked. The Dwells list and a Platform's Dwells tab have a **Testing** column ("2 untested · 1 stale", or "All tested"; `testing` counts in `/dwell-strategies`), and the dashboard's Needs attention has a **Dwell testing** group. Logging a new run (not a draft or a redo) starts its dwell on the Strategy covering the Emitter's Platform when exactly one saved one does. A run logged without a Strategy gets one afterwards — **Set Strategy…** on the run's page picks the Strategy and version (`PATCH /emitters/{id}/test-records/{run}/dwell-strategy`, audited; not for a Platform test's records, whose dwell is the Platform test's).

**Versions.** Strategies and dwell files are versioned: a Strategy saves a version each time its dwells or details are saved; a dwell file has **Save version** (pins and settings are changed first, then saved), **Version history** shows what each version changed (a Strategy's dwells added, removed or changed; a file's settings and pins) and a Strategy version's chart, or a file version's XML. The header says when there are changes since the latest version. Version history is the record of what changed; the pages have no Audit tab, but every change is still in the app's audit log. An MDF's **PRS export** (and the backup's PRS copy) includes every dwell file linked to it at its **latest saved version**. A Strategy that's in a file or recorded by a test run can't be deleted.

**Tests.** When logging a run, **Dwell** offers Manual, a value, or **Strategy…** — a Strategy's latest saved version, recorded with the run (on a Platform test, that Platform's Strategies only). The run's page links the Strategy and version, and the Strategy's **Used in** tab lists its files and the test runs that recorded it.

**Import XML** (under Dwell files) makes a dwell file from one: each Strategy in it becomes a Strategy of its own (named after the file and its place in it, with no Platform until one is picked on its page), pinned into the new file at v1. **Download XML** writes the file in the same layout — an imported file comes out as it went in. (`/dwell-strategies`, `/dwell-strategies/{id}/versions`, `/dwell-files`, `/dwell-files/import`, `/dwell-files/{id}/xml?version=`, `/dwell-files/{id}/strategies`, `/dwell-files/{id}/strategies/repin-latest`, `/dwell-file-strategies/{id}`; settings at `GET/PATCH /settings`, admins only to change.)

---

## 8. Test Tracking

A **Test Record** (a test run) logs validation against either an Emitter or an MDF. New runs are one of two types:

- **Simulation** — checked against the Emitter's **SIM Test Lines**, the simulated signals imported (with the date they were created in the simulator) on the Test History tab — listed below the test runs, being set up once and seldom changed. Each line in the run gets an outcome (correct / partial / missed / inconclusive), any number of **intercepted Modes** (what the system reported for it), and optionally the **intercepted parameters** (RF, PW, PRI) that were measured.
- **Intercept** — a real-world intercept, checked against the Emitter's own Modes: each intercepted Mode gets a result, intercepted parameters and notes.

Searching the Modes (under Intercepted as, and the row filters) matches every typed word anywhere in the name, in any order, with `_ - . /` counting as spaces — "scan 6" finds `scan_fixed_6`. Intercepted parameters show as a small table inside the cell (one row per set, units in the headings), on the run page and in the finished report; notes grow as they're written and keep their line breaks.

A SIM line's intercepted Modes can include **Default Unknown** — the system reporting no Mode at all — on its own or alongside Modes; it's offered first in the list.

**Runs in progress.** A run is saved on the server as it's filled in (a moment after each change; the first change at once), so a reload, a closed tab or another computer picks it up where it was. Nothing is saved until something is typed or picked (a title, notes, a result, a line's outcome, values or notes, a Mode ticked), so opening the page and leaving doesn't leave an empty run behind; a Platform test likewise waits for a title, notes, or an Emitter's result or notes. Unlogged runs are listed under **In progress** on Test History — title, type, how far along, who saved it last and when — with **Continue** and **Discard** (Editors). A run in progress counts for nothing until it's logged; logging it deletes the draft. Each save carries the version it builds on, so if two people save the same run the second is refused and told to reload. A Mode being typed in on the run page isn't saved until it's staged.

Older lab bench, live range and field exercise records stay in the history but can't be logged any more. Every run also records a title, notes, test date, a **dwell** ("Manual", or a value written in such as "50 ms", set once for the whole run) and an overall result that is worked out from its lines or Modes (worst one wins) — with none included, the tester picks it (there's no default). The tester can **override** it, with a required reason — when logging, or later on the run's page (More ▾ → Change the result…, Editors; its other actions — + Add Mode from this test, Redo test — sit beside it in the title row); the worked-out result and the reason are kept beside it, the run's badge shows ✎, picking the worked-out result again removes the override, and every change is audited. Each run has its own page, and each SIM Test Line shows its status: its outcome and date in the most recent run that included it. Every run keeps the **Emitter version it tested**: **Version tested** on the new-run form lists the Emitter's saved versions, the latest picked (it says so when the Emitter is being edited, since unsaved changes aren't in any version); the version shows as a column in Test History and among the run's details on its page (`emitter_version_id` on create, `emitter_version_number` on read). A Platform test's records keep the version the Platform pins. SIM Test Lines are listed alphabetically everywhere — the panel, a new run and a run's report — with numbers in order (Line 2 before Line 10). **+ Log** on a line or Mode opens its parameter fields with the cursor in the first one (RF mean), so values can be typed and tabbed through. The run's page shows its session notes as their own block, and the Emitter's Notes tab is there too.

**Updating SIM Test Lines.** **Edit** on a line changes its label, expected Mode, reference detail (one `name: value` per row) and created date. When the simulator's table is revised, **⟳ Update from a revised table** takes the new table (pasted like an import, with its created date and an optional batch label): each row is matched to an existing line by label, ignoring case and extra spaces, so a matched line keeps its id and test history and takes the row's detail (left as it is when the row has only a label), the new created date and batch; rows with no match are added; the lines end up in the table's order. Lines not in the table are kept, or deleted when asked — with their results in logged runs, which the preview counts. **Preview changes** lists what would be added, updated (and what about each changes), left unchanged and not in the table before anything is written (`POST /emitters/{id}/test-lines/sync`, `apply: false` to preview). Like importing, it needs the Emitter checked out and becomes part of its next saved version.

**Signals not tied to a Mode** (Intercept Tests): besides rating Modes, a run logs anything else intercepted — its parameters (one or more sets), whether the system reported it as **Default Unknown** or not at all, and notes. Each signal says whether the Emitter's Modes already cover it (matched like an Intercept entry, deltas included) or it's **New**; signals don't count towards the run's result (override it if they should). On the logged run's page, **Add to Source…** puts a signal into one of the Emitter's intercept Sources — one standing for an Intercept or of type Intercept — or a new Source (type Intercept, named and dated after the run): either **as one Parameter Sequence** (a step per set; a stagger takes a step per position) or **each parameter as an Element** (RF, PRI with any jitter or the stagger, PW), all with the variant **Intercept**. A signal's values are also offered when adding a Mode from the run.

Intercepted parameters are typed in the order RF (MHz), PRI type, then for a Fixed PRI its mean (µs), PW (µs) and the **jitter in ns**; for a Stagger, the frame time (µs), PW and then the **stagger steps in ns** — jitter and steps as the test format logs them. Both are turned into µs as they're typed: they're stored, matched against the Modes and shown in µs like every other time (the run's tables have "Jitter µs" and "Stagger µs" columns), so a Mode pre-filled from a logged set, or Elements made from it, get µs (1250 ns → 1.25 µs). Nothing is ever compared in ns. While they're being logged they're one table: a numbered line per intercept, a column per parameter (one the PRI type doesn't have reads —), ✕ to remove a line and **+ Add another intercept** for the next.

**Received Power.** Every run has one **Received Power (dBFS)** — how strong the signals were received over the whole run — and it's required: it sits beside Dwell at the top of a new run, a Platform test and an MDF's test form (marked *), and a run isn't logged without it (the API refuses it too). It shows on the run's page, on a Platform test's page (and each Emitter's record of it), and as a sortable **Power (dBFS)** column in Test History; runs logged before it was asked show —.

**Elements from a test.** On a run's page, **+ From this test ▾** holds **New Mode…** (the pre-filled Mode form) and **Elements to a Source…**, and each row of **Against the Modes now** with no Mode or a near miss has **Make Elements…** beside **Add to the Modes…** (the same dialog with only that intercept's values ticked): each logged RF, PRI (a range with its jitter, or a stagger's steps) and PW becomes an Element, the same value logged on several lines listed once, all ticked to start with. The variant starts as *intercept*; a ± delta can be given per parameter (a stagger's is required, 0 if left blank); they're labelled with a name of your own and a running number (the run's title to start with — "Range day 1", "Range day 2" …) or with the lines or Modes they were logged on, and noted "From test run …". A line logged with several intercepts can also be kept as a **sequence** on the same Source — a step per intercept in the order logged (RF, a Fixed PRI's mean, PW), numbered on after the Elements. They go to one of the Emitter's Sources or to a **new Source** made in the same request, named after the run and dated when it was intercepted or simulated — all or nothing (`new_source` on `POST /emitters/{id}/sources/batch-elements`, which returns `new_source_id`).

**Simulation trend** (Test History): one column per Simulation Test, oldest to newest, stacked by line outcome and topped by the SIM Test Lines the run didn't include (**Not in this run**), so every column is all of the Emitter's current lines; both that and numbers on the bars (**Counts**) can be switched, and the choice is remembered. Columns are labelled with the run's date and **time** — each run records the time it ran (filled with the current time on the run page); runs from before that show the time they were logged, in italics.

**Modes derived from this run** (on its page) is a table: each Mode linked to it on the Modes tab, with its EW Group, PRI type, RF, PRI (or stagger steps), jitter or frame time and PW as they are now; one deleted since is still listed.

**Logged intercepts against the Modes now** (the run page's **Against the Modes now** tab, beside **Results**, with the number of sets logged; shown once anything was logged, and kept in the URL as `?view=recheck`): every set of parameters logged in the run — on SIM lines, Mode results and signals — matched against the Emitter's Modes **as they are now**, by the same rule as an Intercept's entries (mean RF, PRI — a stagger's frame time and number of steps — and PW inside a Mode's range with its delta, Modes of the same PRI type only; a set without a logged PRI type is taken as stagger when it has steps, fixed when it has a PRI) plus two checks Intercepts don't make: a fixed PRI's logged **jitter** must be inside the Mode's jitter range (in µs), and a stagger's **steps** must be the Mode's in the same order — starting at any of them, as a train repeats — each within the frame-time delta (at least 0.1% of the step). A jitter or step-order miss is a PRI miss, so it shows as **≈ near** ("Steps 140, 120, 100 µs — Mode has 100, 120, 140 (± 1), not in this order"; without "not in this order" when the steps themselves differ). Each row says where it was logged, its parameters, what the system **reported in the test** (the Modes intercepted as, Default Unknown, or not reported), and now: **✓ would match** (the Modes, linked), **≈ near** (one value off — which Mode and which value), **✕ no Mode**, or **can't compare** (no RF or PRI). Rows where today's match differs from what was reported are marked **Changed**, and can be shown alone; a SIM line also says whether its **expected Mode** matches now, with a count over the run. A bar above splits the run's intercepts by outcome (status colours, each with its icon and count). It's worked out in the browser from the Emitter's current Modes — nothing is stored.

Each Mode shows **Last seen** (Modes table, cards, and a filter): the latest run it turned up in — reported under Intercepted as for a SIM line (with that line's outcome; if it was reported for several lines in one run, the worst counts) or rated in an Intercept Test — linking to the run, with how many runs it was seen in by outcome on hover. It replaces Last Tested, which only counted Intercept Test ratings and so never showed Modes reported in Simulation Tests. The Emitter summary's count of passing Modes uses the same.

**Test history outlives Modes and lines.** A run's results don't depend on the Mode or SIM Test Line still existing: each result keeps the Mode's name and the line's label as they were when it was logged. Deleting a Mode or line, or **reverting** to a version without it, leaves every logged result in place — the run's page shows the name with *(deleted)* — and reverting back to a version that has it links the results to it again, so they show as before.

**Revert shows what it will do first.** **Revert to vN…** opens a preview before anything changes: the live Emitter against that version, item by item (each Mode, Source, EW Group and SIM line removed, brought back or changed, as the version diff shows them), a count of removed / brought back / changed, a warning when unsaved changes would be thrown away, and how many logged test results name a Mode or SIM line it removes (kept, shown as deleted). **Revert to vN** in it does the revert (`GET /emitters/{id}/versions/{n}/revert-preview`).

**Reverting never loses data.** What a revert (or discard) removes comes back as it was when a later revert brings it back: a Source with its Elements (variant, delta and details too), sequences, legacy terms and Source group; an EW Group with its scan delta; a Mode with its generation batch; a SIM line with its import batch. What isn't part of a version is kept throughout — test results, a Source's notes and cartesian-run log, generation batches, and an Intercept entry's link to the Mode made from it (hidden while the Mode is gone). Versions saved before sequences were kept still get them back. A fork copies the same. The Changes view lists changes to a Source's **Elements** and **Sequences** and an EW Group's **Scan Delta**. Purging an Emitter from Recently Deleted removes all of it, with its logged test runs.

A test record automatically pins to whichever version of the Emitter or MDF was the latest *committed* one at the moment you logged it — so your test history stays accurate to what was actually tested, even as the draft keeps changing afterward.

---

## 9. Dashboard

The **Dashboard** is the landing page after login. Each card loads on its own, so a slow one never holds up the rest.

- **My work**, across the top — your open tasks (overdue first, tick them off right there), the Emitters assigned to you with their status and open tasks, and the Emitters you're editing now with how long you've held each. See [Tasks & Assignment](#15-tasks--assignment).
- **Needs Attention** — one line per item, grouped by kind; each group folds away (the first two start open), with **Open all / Fold all**:
  - **Simulation** — SIM Test Lines missed or partial in their latest run; an Emitter in Testing never checked against a simulation; an Emitter whose content was committed after its last Simulation Test was logged (status changes alone don't count)
  - **Needs rework**
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

Ranges are compared **with their ± deltas** — each Mode's RF, PRI and PW range widened by its delta, the ranges the sensor actually matches with. Which pairs can be ambiguous at all:

- **Same PRI type only** — a different PRI type tells two Modes apart.
- **Fixed vs Fixed** — PRI and **jitter**, each as a range; jitter is a parameter like the others and can set the severity. Every Fixed Mode has jitter; 0–0 is a steady PRI.
- **Stagger vs Stagger** — with **range matching** on both, PRI is compared on the **frame time** (± frame delta); with it on only one, they're told apart; with it on neither, on the share of identical steps.
- **CW vs CW, X-let vs X-let** — RF and PW only.

Checks made under older rules say so on the page. Every finding records the ranges it compared and which parameter set its severity. The run bar at the top is one row: what was checked and when, **Run the check** / **Run again**, and a **Thresholds** chip (click to change, Editors and Admins). The rules in words, with the thresholds in the sentences, are behind **How it decides**.

### Three scopes

Run a check at three levels, each reusing the same engine:

- **Per-Emitter** — every Mode against every other Mode within one Emitter
- **Per-Platform** — which Emitters pinned into one Platform could be taken for each other: each Emitter's Modes against the *other* Emitters' Modes. Overlaps inside one Emitter aren't part of it (its own check covers them).
- **Per-MDF** — the same across every Emitter reached through the MDF's pinned Platforms; an Emitter on several of its Platforms counts once.

A Platform or MDF check opens on **Emitters**: each ambiguous Emitter with the Emitters it could be taken for (worst first), then every pair of Emitters with its findings by severity — click one for the Mode pairs behind it. Findings, Modes involved and the Matrix follow as for an Emitter.

A check always runs against a specific **committed version** (the latest by default), never the live draft — so results are reproducible and tied to a known snapshot, not a moving target. Runs execute in the background; the page polls until it completes.

### The page

- **Layout** — the views as tabs under the run bar (Emitters for a Platform or MDF, Findings, Modes involved, Matrix; each tab's hover says what it shows), then one row of filters: status and severity chips (only those with findings), Mode search, EW Group and Source.
- **Findings list beside a detail panel** — open findings first, worst first, each with its per-parameter overlap (jitter for two Fixed Modes; PRI marked frame time or steps for Staggers) and the deciding parameter in bold; arrow keys move through the list. The selected finding shows each parameter on one line — both Modes' values and the overlap — over the ranges drawn to scale with the overlap shaded (stagger steps as dots, shared steps ringed), then one row of actions: **Open A**, **Open B**, **Merge…**, **Acknowledge…** (which asks for the optional reason); what each does is on its hover.
- **Modes involved** — the Modes in the most findings, worst first; click one to see its findings.
- **Matrix** — every Mode in a finding against every other, coloured by severity; a cell opens that finding.

### Handling findings

- **Open A / Open B** — straight to either Mode in its Emitter.
- **Merge** (Editors) — for two Modes of the same Emitter that are really the same: keep one, widened to the union of both ranges (jitter too) — keeping its own ± deltas, never the other's — and delete the other. A preview shows the before/after values as typed, each with its delta, and a Fixed pair's jitter or a Stagger's frame time, what moves (test records, test line results, SIM test lines and intercept links all move to the kept Mode; its notes record the merge and keep the other's notes) and any new or worse overlap the wider ranges would cause with the Emitter's other Modes. It changes the Emitter's live data, so it needs the Emitter checked out (the dialog can check it out); a version then has to be saved and the check run again. The finding records the merge, and others involving the deleted Mode are marked until the next run. Different PRI types, or staggers with different sequences, can't be merged.
- **Acknowledge** (Editors) — known and acceptable, with an optional reason; carried to later runs while the pair's overlap is unchanged. **Undo** reverses it. Acknowledging doesn't delete or hide the finding — it's a record that a human looked at it and made a call.

### AI explanations (optional)

When a language model is set up (`LLM_BASE_URL` — any OpenAI-compatible server, such as vLLM on the same network), the page offers two more things:

- **Explain with AI** on a selected finding — why the two Modes can't be told apart, what (if anything) in the data separates them, and one suggested action (keep both, tighten the ranges, merge, add a distinguishing parameter, or check the source data), with the model's confidence. An Editor can acknowledge the finding with the suggestion as its note.
- **Summarise with AI** for the run — an overview, what to look at first, and patterns across the findings.

The model never does the overlap arithmetic: the check computes it, and the model is given only one finding's two Modes and their computed overlap, or a run's counts and 40 most serious findings — a few thousand tokens however many Modes are in scope. Its answers are drafts, kept with the finding or run and labelled with the model and who asked; any number in an answer that wasn't in its input is listed so it can be checked. `scripts/llm_eval.py` tries the model on a run's findings and writes a report for analysts to judge before anyone relies on it.

#### The team's documentation as background

With Outline set up (`OUTLINE_URL`, `OUTLINE_API_TOKEN` and `OUTLINE_ROOT` for a page and everything under it, or `OUTLINE_COLLECTION` for a whole collection), the model is also given the documentation that bears on each question:

- **A copy, kept fresh.** The app copies the pages, split at their headings (long sections in parts of about 1,200 tokens), into its own database. The copy is refreshed on the next question once it's older than `OUTLINE_SYNC_MINUTES` (60), or at once with **Sync now** (Admins, under Admin → Settings → AI documentation, which also shows what's copied, when, and the last refresh's error). The AI overview of a check says which documentation was given and how fresh it is. If Outline can't be reached, questions go ahead with the last copy and the error is shown in both places.
- **Only what's relevant.** If the whole copy fits in `OUTLINE_CONTEXT_TOKENS` (6,000) it goes with every question. Otherwise the sections that best match the question's words do, in reading order: the PRI types involved and range matching count double; the parameters, ambiguity terms and the Modes' notes count once. The search is language-neutral (words match as prefixes, so "stagger" finds "staggered"; RF, PW, PRI and CW only as whole words).
- **Cited.** The sections are numbered and the model is told to cite the one a sentence relies on, as [S2], and not to let the documentation override the numbers. Citations link to the heading in Outline; under the draft, **Documentation cited** lists them, and **Also given, not cited** the rest. A citation of a section that wasn't given is flagged.

- **What lives where.** Not everything in Outline is the same kind of thing. Under Admin → Settings → AI documentation, **What lives where** lists the copied pages as a tree; for each, an admin says what it holds — **Documentation** (reference material on how the sensor and the library work; the default), **Test result** (a record of one test or trial: what was observed that time, under those conditions), **Analysis** (analysts' notes and working conclusions — opinion) or **Leave out** (never given to the AI). A page's sub-pages follow it unless set themselves (`outline_page_kinds` in `/settings`, the pages at `GET /ai/documentation/pages`). Each section reaches the model marked with its kind — "[S3] (test result) Trials › Range day 4" — together with how to weigh them: a test result is reported as that test's finding, never as proof of how the sensor always behaves (and it says when one test is all there is); analysis is opinion; documentation outweighs a single test, several consistent tests outweigh one. Cited sections show their kind beside them (*test result*, *analysis*).

`scripts/outline_probe.py --sections` shows how the documentation splits, and which sections are too long, too short or without a heading.

#### The AI overview's format

**Summarise with AI** gives a one- or two-sentence verdict, then a table of up to six findings to look at first: the pair and severity come from the finding itself (the model picks findings by their label, F1–F40, and never retells them), with the model's reason and one suggested action. Clicking a row opens the finding. Patterns follow on one line.

### AI chat

The **✦ Ask AI** button in the bottom-right corner of every page opens a chat with the model (when one is set up). It isn't handed the database: it asks for what it needs, one read-only lookup at a time, at most six per question, then answers:

| Lookup | What it gets |
|---|---|
| overview | How many Platforms, Emitters (by status), Modes, MDFs and Intercepts there are |
| search | As the app's search box: Emitters (name or designation), Modes, Sources, Platforms, MDFs and Intercepts with every word in the name. Failing that, what mentions the words in a description or notes, then matches for the longer words one at a time |
| list_emitters | Emitters — all, or with a status and/or on a Platform — with status, Modes and assignee |
| get_emitter | An Emitter's details, Platforms, assignee, Sources (date, type), SIM/test summary, and every Mode with its values (first 150) |
| get_tests | An Emitter's SIM Test Lines with each one's latest outcome and date, and its 10 latest test runs (type, result, version tested, line outcomes, notes) |
| get_platform | A Platform's Emitters and the MDFs it's in |
| get_mdf | An MDF's status, customer, release date, pinned Platform versions and its readiness checklist |
| find_modes | The Modes a signal with the given RF (and PRI, PW) would match — or every Mode overlapping an RF band — each range widened by its delta |
| get_ambiguity | An Emitter's latest ambiguity check: counts and the 20 most serious findings |
| get_intercept | An Intercept and its entries, with the Modes they're linked to |
| search_docs | More sections of the documentation |
| propose_modes | Not a lookup: Modes the user asked it to write, for the user to add (below) |

Names are matched by id, exact name (an Emitter also by designation), or every word of the name. Statuses are given as the app shows them (In progress, Testing, Partially operational, Operational, Needs rework).

**Memory.** The last ten turns go with each question, and so do the **lookups behind the latest three answers**: each answer comes back with the lookups it made, the browser sends them with the next question, and the server runs them again (so the data is current, and nothing from the browser is used as data — only lookups the model could have asked for are run) and gives the results to the model as what it looked up before. A follow-up such as "and its PW?" or "what about the other one?" has the Emitter, Modes or test results it refers to in front of the model. The documentation for a follow-up is found from it and the question before. Under an answer, "used N earlier lookups" says when this happened.

**Links.** Names in an answer are links to their pages when they belong to something the lookups turned up (by the ids in their results, the page's and the remembered ones included): an Emitter (by name or designation), Platform, MDF, Intercept or Source, a Mode found by id, and every Mode of an Emitter that was looked up. A name that could mean two different things (two Emitters' "Search Mode 01") isn't linked, and ids the model copies into its text are left out (`links` in the reply, longest name first).

The documentation sections matching the question go with it too, and the chat is told which page it was asked on. Under each answer: the lookups made, the documentation cited, and any number that wasn't in anything it was given. Users' accounts, passwords, sessions and the audit log are out of its reach (it sees who an Emitter is assigned to, as everyone can); deleted items are left out. It works with any vLLM: each step is a structured JSON reply, so the server's tool-calling options aren't needed.

**Chat history.** Chats are kept on the server for the person who had them — nobody else sees them — and listed beside the conversation (☰ shows or hides the list), the latest first: each named after its first question, with when it was last used. Click one to read it again and carry on where it left off (the model gets its last turns and earlier lookups, as above); **+ New chat** starts another. Hovering a chat shows ✎ to rename it (Enter saves, Esc cancels; renaming doesn't move it up the list) and 🗑 to delete it (after a confirmation; it can't be brought back). A question whose answer failed is kept with why, and **Ask again** replaces the pair. A question still being answered finishes and is saved even if you switch chats. A user's chats are deleted with their account (`GET/POST /ai/chats`, `GET/PATCH/DELETE /ai/chats/{id}`, `POST /ai/chats/{id}/messages`).

**Writing Modes — only with the user's say-so.** Asked to write or create Modes, the chat proposes them (`propose_modes`): for each, the Emitter, one of its existing EW Groups and Sources, a name, the PRI type and its values with their deltas. The app checks every one as the Mode form would — the Emitter, EW Group and Source must exist (a Source can be left out when the Emitter has one), the name mustn't be taken in the EW Group, the values must make a valid line — and shows them under the answer as a **preview**: each Mode's place, RF, PRI (a Fixed range with its jitter, a stagger's steps, or CW) and PW with their deltas, and why any can't be added. **Nothing is written by the chat**: the model is told only the user can add them, and the only way they're written is the user ticking them and pressing **Add N Modes** (`POST /ai/chats/{id}/proposals/apply`) — an editor or admin, into Emitters they're editing, all or none, each checked again and logged like a Mode made in the form. Added ones show ✓ and link to the Mode; they can't be added twice.

**Images.** **📎** (or pasting, or dropping onto the input) attaches up to four images to a question — shrunk in the browser to at most 1600 px and 2 MB each — sent to the model with it (it needs a vision model). They're kept with the question, shown small (click for full size); later questions mention them rather than sending them again.

**Context.** The chat's header shows how much of the model's context the conversation takes, of the most it may (**Max context**, 32,768 tokens to start — an admin's setting under ⚙ in the chat or **Admin → Settings**; set it to the model's context window or less): the model's own count after an answer, an estimate otherwise, the bar turning amber at 60% and red at 80%. Older turns are left out of a question to stay inside it. **Compact** has the model summarise the chat so far; the summary stands in for those turns from then on (shown as a divider that opens to it), and a question that would take the chat past 80% is compacted first on its own.

**The chat window.** Drag its top-left corner to resize it (it's pinned bottom right, so it grows up and left), **⤢** maximises it to nearly the whole window (**⤡** restores), and **A− / A+** make all its text smaller or larger (seven steps). The size, text size and whether the history shows are remembered in the browser; whether it's open and which chat is shown, for the tab. On a phone-width screen the history covers the conversation while it's open and closes when a chat is picked.

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

Export is available from the MDF page (**Export PRS**, the latest saved version) and from the MDF's Version History page (any version) — one PRS package: its Platforms, Emitters and dwell files. (The older single-file MDF XML, with placeholder tags, is no longer offered in the app; `GET /mdfs/{id}/versions/{n}/export.xml` still answers.)

**An MDF version keeps its dwell files.** Saving an MDF version records each of its dwell files at a saved version, whole, and the version's export writes those — so exporting an older MDF version gives the dwells it had then. A dwell file changed since it was last saved (or never saved) is **saved with the MDF** first ("Saved with MDF '…'"), so what you see is what goes in. The version's changes list dwell files added, removed or at another saved version, and the MDF's readiness checklist has a **Dwell files** item: one changed since saved, saved since the latest MDF version (not in it yet), with no Strategy, pinning a Strategy version with no dwells, or behind its Strategy's latest. MDF versions saved before this have no dwell files recorded; their export uses each file's latest saved version, as before.

---

## 12. Backup & Restore

Since this app runs fully offline, its own database backups *are* the disaster-recovery plan — there's no cloud fallback. Whole-database `pg_dump` backups are:

- **Scheduled independently of the app** — weekly by default (`BACKUP_SCHEDULE_DAY`, or daily), from their own container, not an in-process job, so a backup still runs even if the web app is down. A server that was off catches up when it starts.
- **Due sooner the more changes** — between automatic backups, the dashboard's Backup card shows the time since the last backup and the changes since (Audit Log entries that edit data, plus which Emitters, Platforms, MDFs, Dwell Strategies and dwell files were added, changed or removed). A backup is due a week after the last at 50 changes (`BACKUP_CHANGES_PER_WEEK`), half a week at 100, and so on, between 12 hours and 4 weeks; nothing changed, nothing due. Due turns the card amber and warns admins on the Dashboard and Admin pages; twice past due is overdue, red.
- **Written to a separate disk/volume from the live database**, and optionally **copied to a second place** (`BACKUP_COPY_DIR` — another disk or a share), so one failure can't take out both the data and its backups
- **Pruned on a retention policy** (the newest 14, then one a week for 8 weeks and one a month for 6 months, by default) so the backup directory doesn't grow forever
- **Verified after every backup** — a real restore into a scratch database, with the row counts checked against what was backed up, then torn down again. Each file's checksum is checked first, so a file that changed on disk is caught too.
- **Accompanied by a PRS export of the whole repository** (`<backup>_prs.zip`) — every Emitter as XML, every Platform and MDF as its own complete PRS package, every dwell file, and every Dwell Strategy as a dwell file of its own (so default dwells, in no file, are there too), from each one's latest saved version — so if the database can't be restored in time, the files are still there to use. It's checked on Verify, copied and pruned with its backup, and a failed export never costs the database backup.
- **Described by a manifest** next to each file: when and why it was taken (automatically, by hand, or just before a restore), by whom, its size, checksum, row counts, and an overview of every Emitter, Platform, MDF, Dwell Strategy and dwell file in it

**Admin → Backups** shows whether all of this is working: the latest backup and its verification, when the next one runs, and a plain list of anything wrong (a backup due for the changes made, a failed verification, the scheduler not reporting). Admins see a warning across the top of the Dashboard and Admin pages when there is. From there an Admin can also take a backup now, verify any backup again, **download** one to keep a copy off the server — the database file, or its PRS export (both recorded in the Audit Log, since the database file holds everything), and **compare** two backups — or a backup against the current data. The comparison is an overview, not a field-by-field diff: which Emitters, Platforms, MDFs, Dwell Strategies and dwell files were added, removed or moved to Recently Deleted, and for each changed one a line per change — renamed, status, number of Modes, a Strategy's Platforms and number of dwells, a dwell file's MDF, saved version, pins (a Platform's Emitters, an MDF's Platforms, a dwell file's Strategies). Backups taken before dwells were listed leave them out of a comparison (it says so).

Restoring is a deliberate, operator-run CLI action (not a UI button) — it overwrites live data, so it requires explicitly confirming the target database name, and it takes a backup of the current data first so a restore of the wrong file can be undone. It empties the database before restoring, then brings the restored data up to the current schema, so a backup taken by an older version of the app restores cleanly. See the [README](../README.md#backups) for the exact commands.

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

Admin-only (both the nav link and the routes themselves redirect a non-admin away, not just hide the link) — Users, Edit locks, Recently Deleted, Backups, Statuses & milestones, Defaults and Settings:

### Users

Create a user (username, password, role) directly from the UI — previously only possible via a one-off CLI script. Existing users can have their role changed or be **deactivated/reactivated** inline. Deactivation, not deletion, is how a user's access is revoked: there's no "delete a user" action, so a user row is never actually removed (and every audit-log entry that names them as the actor stays attributable).

### Edit locks

Every Emitter someone is holding for editing: who, since when, how long, their **last change** to it, and when it will be **released automatically**. A lock whose holder hasn't changed anything under it for `CHECKOUT_WARN_DAYS` (3) is marked **untouched** — here and in the holder's editing panel — and after `CHECKOUT_RELEASE_DAYS` (14; 0 turns it off) without a change it's released on its own with an Audit Log entry. Nothing is discarded: unsaved changes stay live, just no longer held. **Force release** frees one; tick several (or **Select the untouched ones**) and **Release selected** frees them at once.

### Defaults

What a new Mode starts with (`mode_defaults` in `/settings`): **confirmation quality** (100%) and **quantity** (2), and the **RF**, **PRI** (Fixed) and **PW deltas** (0) and the **frame-time delta** (Stagger, **3 µs**). The frame-time delta widens a stagger's frame time — the sum of its steps, or its explicit frame time — never each step. The Add Mode form and the Intercept planning page start with these (they can be changed there for one Mode; a Fixed Mode switched to Stagger in its Edit form gets the default frame-time delta). Modes made without a form get the confirmation and, for a stagger, the frame-time delta: from Elements (a stagger Element with no delta of its own) or a sequence's steps, a typed DSL line, the AI chat (unless it gave one), and the bulk Intercept route. Imports keep what the file says. Existing Modes don't change. A request that gives a value keeps it. Each change is in the Audit Log ("Changed the Mode defaults: frame-time delta 3 µs → 5 µs"); **Back to the built-in defaults** puts the original values back in the form.

### Recently Deleted

Emitters, Platforms, and MDFs are already soft-deleted by default when you delete one from its list page (see the [Roles](#13-accounts--roles) table above — hard/permanent delete is a separate, Admin-only action). This section is where that soft-deleted data actually lives:

- Every soft-deleted item, across all three entity types, in one list with a live "days left" countdown (30 days by default, `TRASH_RETENTION_DAYS`).
- **Restore** — reverses the soft delete; the item reappears wherever it normally lives.
- **Delete forever** — Admin-only, immediate, irreversible hard delete from the trash view itself.
- **Automatic purge** — the `backup` container (see the [README](../README.md#backups)) hard-deletes anything past the retention window every day, so nothing relies on a human remembering to empty the trash.

Restoring can fail with a 409 if another item now holds the same name — rename the conflicting one first.

### Backups

The backups' health, Back up now, Verify, and the compare overview — see [Backup & Restore](#12-backup--restore).

### Statuses & milestones

Per kind of item (Emitters · Platforms · MDFs): its statuses in order — name and colour, what each can move to, whether moving there asks for a note, how many items are in it — with ↑ ↓ to reorder, **+ Add status**, and **Edit…** / **Delete** in each row's ⋯ menu; and the **default milestones** before each status, added with the form at the bottom, reordered with ↑ ↓, edited or deleted from their ⋯ menu. See [Status](#status).

---

## 15. Tasks & Assignment

**Assigning an Emitter.** Each Emitter can be assigned to one person — whoever's responsible for it. It's set from the "Assigned to" control on the Emitter's page by any editor, without editing the Emitter: who works on it isn't part of what it is, so it isn't saved in its versions and leaves nothing unsaved. Only editors and admins can be given an Emitter (a viewer couldn't edit it). The Emitters list has an **Assigned to** column and filter (Me, Nobody, or a person). Every change is in the Audit Log and the Emitter's Audit tab.

**Tasks** are to-dos, three ways:

- **For yourself** — a personal reminder.
- **For someone else** — giving out work; it shows on their dashboard and in the count by their name in the top bar.
- **For anyone** — up for grabs; whoever takes it becomes its owner.

A task has a title, optional details and due date, and can be about one Emitter, Platform or MDF. Each task also keeps a running **notes** log — progress, questions, what's left — each note stamped with who wrote it and when, newest first. **💬 Notes** on any task row (on the Tasks page, the dashboard, or an item's Tasks list) opens it. Editors and whoever the task is for can add notes; a note can be deleted by whoever wrote it or an admin; deleting a task deletes its notes. The **Tasks** page has views for Mine, Up for grabs, I gave out, Everyone (narrowed to one person if you like) and Done (the latest 200). On an Emitter, Platform or MDF page, **☑ Tasks** lists the tasks about it and adds one already linked. Overdue tasks are marked red, ones due today amber.

Editors can create, edit, reassign and tick off any task; whoever a task is for can always tick it off, even a viewer. A task can be deleted by whoever made it, whoever it's for, or an admin. Tasks are visible to everyone — they're how the team splits the work. Every change is recorded in the Audit Log.

