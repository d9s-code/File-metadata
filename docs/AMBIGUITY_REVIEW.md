# The ambiguity check as a reprogramming tool: what's missing

A review of the ambiguity check (Emitter, Platform and MDF scopes) as part of a
reprogramming workflow: building and changing mission data, finding the
emitters the sensor would confuse, fixing them, and releasing the MDF with the
remaining ambiguities known and accepted. Written after the one-screen redesign
(groups, the pair's verdict, "To tell them apart", edits on the page).

Priority: **1** affects whether the result can be trusted or released; **2**
saves real time in every reprogramming cycle; **3** is useful later.

## The check's logic

| # | Pri | What's missing | Why it matters | Suggestion |
|---|-----|----------------|----------------|------------|
| 1 | Done | ~~**Stagger steps must be identical to overlap.**~~ Each step now has a ± buffer (1 µs to start, *Step tolerance (Stagger)* under Admin → Mode defaults), in the check and in Against the Modes now. Steps are compared as exact values (rounded to 6 decimals). The test-run matcher accepts each step within the frame-time delta. | Two Staggers with steps 100.0 / 100.2 µs are "told apart" by the check but matched as the same by the sensor rules the app uses elsewhere. That is a missed ambiguity. | Compare steps with the same tolerance the matcher uses (frame-time delta, at least 0.1% of the step), in the same order up to rotation. |
| 2 | 1 | **No consequence in the severity.** Severity is overlap only. Nothing says *which way* a confusion is dangerous. | Taking a high-priority emitter for a low-priority one is worse than the reverse. The EW Group's priority is stored but unused here. | Weigh or flag pairs by priority difference. Show "A could be reported as B (lower priority)" first. |
| 3 | 1 | **No receiver accuracy.** Only each Mode's own ± delta widens a range. The sensor's measurement accuracy (RF, PW, PRI) isn't a setting. | Two Modes that just miss each other on paper can overlap in the receiver. The check is optimistic by the receiver's error. | A per-MDF (or per-sensor) accuracy profile added to every range during the check, shown on the run. |
| 4 | 2 | **Scan isn't a discriminator.** The check ignores the EW Group's scan period, although it's in the data and the export. | Pairs that the sensor can separate by scan are reported as Exact. Analysts acknowledge them by hand, every cycle. | Optional "use scan" switch: a pair whose scan periods don't overlap is told apart (or downgraded). |
| 5 | 2 | **Different PRI types never overlap.** A Fixed Mode with large jitter vs a Stagger, or a Stagger the sensor deinterleaves as Fixed, are always "told apart". | The assumption holds for a clean receiver, not always in dense environments. | Make it a rule with a switch, or flag cross-type pairs whose ranges overlap as Low, "PRI type only". |
| 6 | 2 | **RF and PW range matching are ignored.** The check always compares ranges, though the Mode says whether the sensor matches RF/PW as a range. | The check and the sensor can disagree on the same Mode. | Compare the way the Mode is matched, as the test matcher already does for PRI. |
| 7 | 3 | **One RF range per Mode.** Agile or multi-band Modes are one wide range. | A hopping Mode reads as overlapping everything in its band. | Allow several RF (and PRI) intervals per Mode and compare interval sets. |

## Scope

| # | Pri | What's missing | Why it matters | Suggestion |
|---|-----|----------------|----------------|------------|
| 8 | 1 | **No friendly or neutral emitters.** Nothing marks an Emitter as own-ship, friendly or neutral. No check runs a new Mode against them. | Reporting own or friendly emitters as other emitters (and the reverse) is a common identification error. | An allegiance on the Emitter, and a check of an MDF against a library of friendly or neutral Emitters (both ways). |
| 9 | 2 | **No check against the whole library.** Scopes are one Emitter, Platform or MDF. | Before adding an Emitter to an MDF you want to know what it collides with anywhere. | A "Check against the library" scope (or against another MDF), across Emitters only. |

## The workflow

| # | Pri | What's missing | Why it matters | Suggestion |
|---|-----|----------------|----------------|------------|
| 10 | 1 | **No check of unsaved changes.** The check reads saved versions only. Fixing one pair means: edit, save a version, run again. On a Platform or MDF it also means repin, save the Platform, save the MDF, run again. | This loop is most of the time spent on ambiguity. The page now marks edited Modes but can't say whether the edit worked. | "Check my changes": a draft run on the live Modes (and the latest Emitter versions for a Platform or MDF). It is marked as a draft, never used for readiness, and compared with the last saved check. |
| 11 | 1 | **No run-to-run comparison.** Each run stands alone. | A reprogramming cycle needs: new since last check, resolved, worse, better. That is what goes in the change notes and the review. | A "Since the last check" strip and filter: new / resolved / worse / better / unchanged. |
| 12 | 1 | **No formal acceptance for release.** Acknowledge is one person, one free-text note, per pair. | Releasing an MDF needs the remaining ambiguities reviewed and signed off, with a reason category, by someone allowed to accept the risk. That record goes with the release. | Acceptance categories (told apart by scan / operationally acceptable / awaiting data / will fix), a reviewer role, and an ambiguity section in the MDF release notes and the readiness check. |
| 13 | 2 | **No export of findings.** Findings can't be downloaded. | Review boards, trials teams and other tools need the list (CSV/XLSX), and the accepted ones in the release package. | Export of the check (shown pairs, with the verdict, overlaps each way, status and acceptance) as CSV/XLSX. |
| 14 | 2 | **No test or intercept evidence.** A pair is theoretical. Whether the sensor *did* confuse them in a SIM run, or real intercepts fell in the shared region, isn't shown. | Evidence decides what to fix first and what to accept. | On the pair: SIM lines that expected one and were intercepted as the other, and intercept entries in the overlap. Sort groups by observed confusion. |
| 15 | 2 | **No group-level fix.** "To tell them apart" is per pair. A chain like F0–F7 (each overlapping the next by 80% on RF) needs a coordinated change. | Fixing pairs one at a time moves the overlap along the chain. | "Separate this group on RF": propose new edges for every Mode in the group (smallest total change), preview, apply as one batch. |
| 16 | 2 | **No bulk actions.** Acknowledge, assign or export work one pair at a time. | Platform checks often have dozens of pairs with the same reason. | Tick pairs (or a whole group) to acknowledge, assign or export together. |
| 17 | 2 | **No ownership.** A finding can't be assigned or discussed. | Ambiguity work is shared between analysts. | Assign a pair or group to someone (as Tasks), with a comment thread. |
| 18 | 3 | **Checks don't run by themselves.** Saving a version doesn't re-run the check. Lists don't show which Emitters' checks are out of date. | Stale results are easy to miss. | Re-run after a version is saved (in the background). Show "check out of date" on the Emitters, Platforms and MDFs lists. |
| 19 | 3 | **Thresholds are per run.** Nothing is set as the default for the team, and nothing applies per parameter. | Runs with different thresholds can't be compared, and some parameters matter more. | Admin defaults for the thresholds (and optional per-parameter weights), shown on each run. |

## The page

| # | Pri | What's missing | Why it matters | Suggestion |
|---|-----|----------------|----------------|------------|
| 20 | 2 | **The group chart shows one parameter at a time.** | A pair overlapping on RF may be well apart on PRI. Seeing two parameters together is how analysts reason. | A two-parameter view of the group (as on the test run's "Against the Modes now" chart): boxes per Mode, the selected pair highlighted. |
| 21 | 3 | **"Edit like this" covers RF, PW, PRI and jitter only.** A Stagger's frame time or steps aren't offered. | Stagger pairs get advice but no one-click edit. | Offer the frame time (± frame delta) and the shared steps as edits too. |
| 22 | 3 | **Large checks.** The chart draws up to 60 Modes. The pair list is one long list. | An MDF check can have thousands of pairs. | Paging or a virtual list, and the chart per group only above that size. |

## Done in this round

- One screen: totals, groups, chart and pairs, the pair (no tabs).
- The verdict in a sentence, the overlap each way, and the deciding parameter drawn large.
- "To tell them apart", with prefilled edits.
- Editing a Mode on the page. Start editing and Save version from the page.
- Modes changed since the check are marked.
- **Update from PRS**: Modes changed in place from a PRS file. Bringing edits back from another application no longer shows up as deletions and additions.
