import { useEffect, useMemo, useState } from "react";

interface TocNode {
  id: string;
  title: string;
  children?: TocNode[];
}

const TOC: TocNode[] = [
  { id: "overview", title: "Overview" },
  { id: "roles", title: "Roles & permissions" },
  { id: "dashboard", title: "Dashboard" },
  {
    id: "emitters",
    title: "Emitters",
    children: [
      {
        id: "emitter-detail",
        title: "Emitter detail",
        children: [
          { id: "emitter-modes-tab", title: "Modes tab" },
          { id: "emitter-testing-tab", title: "Test History tab (the workbench)" },
          { id: "emitter-audit-tab", title: "Audit tab" },
          { id: "emitter-sources", title: "EW Groups & Sources setup" },
        ],
      },
      { id: "emitter-versions", title: "Version history" },
      { id: "emitter-ambiguity", title: "Ambiguity check" },
    ],
  },
  {
    id: "platforms",
    title: "Platforms",
    children: [
      { id: "platform-detail", title: "Platform detail" },
      { id: "platform-versions", title: "Version history" },
      { id: "platform-ambiguity", title: "Ambiguity check" },
    ],
  },
  {
    id: "mdfs",
    title: "MDFs",
    children: [
      { id: "mdf-detail", title: "MDF detail" },
      { id: "mdf-versions", title: "Version history & XML export" },
      { id: "mdf-ambiguity", title: "Ambiguity check" },
    ],
  },
  { id: "audit-log", title: "Audit Log" },
];

function flattenIds(nodes: TocNode[]): string[] {
  return nodes.flatMap((n) => [n.id, ...(n.children ? flattenIds(n.children) : [])]);
}

function TocList({ nodes, activeId }: { nodes: TocNode[]; activeId: string }) {
  return (
    <ul>
      {nodes.map((n) => (
        <li key={n.id}>
          <a href={`#${n.id}`} className={n.id === activeId ? "help-nav-active" : undefined}>
            {n.title}
          </a>
          {n.children && <TocList nodes={n.children} activeId={activeId} />}
        </li>
      ))}
    </ul>
  );
}

/** Tracks which section heading is currently nearest the top of the viewport,
 * so the sidebar can highlight where you are on a page long enough that the
 * nav itself scrolls out of view otherwise. */
function useScrollSpy(ids: string[]): string {
  const [activeId, setActiveId] = useState(ids[0] ?? "");

  useEffect(() => {
    const elements = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => el != null);
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        const topmost = visible.reduce((a, b) => (a.boundingClientRect.top < b.boundingClientRect.top ? a : b));
        setActiveId(topmost.target.id);
      },
      { rootMargin: "-96px 0px -70% 0px", threshold: 0 },
    );
    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
  }, [ids]);

  return activeId;
}

export function HelpPage() {
  const allIds = useMemo(() => flattenIds(TOC), []);
  const activeId = useScrollSpy(allIds);

  return (
    <div className="page help-page">
      <h1>Help</h1>
      <p className="hint-text">
        Organized the way the app itself is — by page. Pick a page on the left, or scroll — the list
        tracks where you are.
      </p>

      <div className="help-layout">
        <nav className="help-nav" aria-label="On this page">
          <TocList nodes={TOC} activeId={activeId} />
        </nav>

        <div className="help-content">
          <div className="card" id="overview">
        <h2>Overview</h2>
        <p>
          This app tracks RF emitter profiles for EW (electronic warfare) use — the RF/PW/PRI parameters
          that let a receiver recognize a given radar. The core object is a <strong>Mode</strong>: one
          named signal (e.g. "Search Wide", "Track Lock") with a frequency range, pulse width, and PRI
          behavior. Modes are grouped into <strong>EW Groups</strong> under an <strong>Emitter</strong>{" "}
          (a physical radar/system). Emitters are referenced by <strong>Platforms</strong> (the vehicle or
          site carrying them), and Platforms are bundled into an <strong>MDF</strong> (Mission Data File)
          for a specific mission or exercise.
        </p>
        <p>
          Every Mode's parameters trace back to a <strong>Source</strong> — a datasheet, test report, or
          other document — and optionally to individual <strong>Elements</strong>: the raw RF/PW/PRI value
          entries extracted from that Source, kept as supporting evidence.
        </p>
      </div>

      <div className="card" id="roles">
        <h2>Roles & permissions</h2>
        <p>Every account has one role, shown next to your name in the top right:</p>
        <ul>
          <li>
            <span className="role-badge">viewer</span> — read-only. Can browse Emitters, Platforms, MDFs,
            run the Ambiguity check, and read the Audit Log.
          </li>
          <li>
            <span className="role-badge">editor</span> — everything a viewer can do, plus creating and
            editing Emitters/Platforms/MDFs, Modes, EW Groups, Sources, Elements, logging tests, proposing
            and approving Mode drafts, approving or rejecting imported Sources, and committing versions.
          </li>
          <li>
            <span className="role-badge">admin</span> — everything an editor can do; the highest rank.
          </li>
        </ul>
        <p className="hint-text">
          Ranks are cumulative (viewer &lt; editor &lt; admin). A control that requires a role simply
          doesn't render for accounts below that rank, rather than showing a locked/disabled version of it.
        </p>
      </div>

      <div className="card" id="dashboard">
        <h2>Dashboard</h2>
        <p>
          The landing page after login. Shows status tiles for Emitters and MDFs (counts by lifecycle
          stage) plus a <strong>Needs Attention</strong> list — things like an MDF with no platforms
          pinned yet, or no passing test on file. Click any item to jump straight to it. This is the best
          place to start when you're not sure where something stands.
        </p>
      </div>

      <div className="card" id="emitters">
        <h2>Emitters</h2>
        <p>
          The Emitters list (top nav) shows every Emitter with its current status, and RF/PW/PRI/Scan
          min/max plus a Modes-passing count computed across its approved Modes — every column is
          sortable, and the toolbar above the table filters by name, designation, or any of those
          RF/PW/PRI/Scan ranges. <strong>+ Add Emitter</strong> opens a small form as an overlay rather
          than a full page; click a row to open that Emitter.
        </p>

        <div className="help-subsection" id="emitter-detail">
          <h3>Emitter detail</h3>
          <p>
            An Emitter's page has three tabs — <strong>Modes</strong>, <strong>Test History</strong>, and{" "}
            <strong>Audit</strong> — plus links to its <strong>Version history</strong> and{" "}
            <strong>Ambiguity check</strong> above them. Below the title, a summary line repeats the same
            RF/PW/PRI/Scan ranges and Modes-passing count shown on the list page, for this one Emitter.
          </p>
          <p>
            Status moves <strong>In progress</strong> → <strong>Testing</strong> →{" "}
            <strong>Operational</strong> → <strong>Needs rework</strong> (and back to In progress from
            there to start fixing it). Moving from Operational to Needs rework requires a note explaining
            what's wrong — it's shown afterward via a bright{" "}
            <span
              className="rework-note-button"
              style={{ display: "inline-block", padding: "0.1rem 0.4rem", fontSize: "0.75rem", borderRadius: 6 }}
            >
              ⚠ View rework note
            </span>{" "}
            button next to the status badge, so the reason a previously-Operational Emitter needs rework
            is never buried in a commit message.
          </p>

          <div className="help-subsection" id="emitter-modes-tab">
            <h4>Modes tab</h4>
            <p>
              See the Emitter's Modes as a sortable <strong>Table</strong> or as <strong>Cards</strong>.
              Filter by EW Group, Source, or Batch, and search by name. Each Mode row shows:
            </p>
            <ul>
              <li>RF min/max, PW min/max, PRI type (FIXED / STAGGER / CW / XLET) and its min/max where applicable</li>
              <li>
                <strong>Last Tested</strong> — the date and result of the most recent test that exercised
                this Mode; click it to jump to that test record
              </li>
            </ul>
            <p>
              Every column header opens a small sort menu on click — ascending/descending, worded for
              that column's data (e.g. "smallest → largest" for a number, "oldest → newest" for a date) —
              plus a <strong>Clear sort</strong> option once a column is active. This same header works the
              same way on every table in the app, not just here.
            </p>
            <p>
              Hover a Mode's name to see its notes, when it (and its Source) were last updated, and a
              staleness callout if the Source has changed more recently than the Mode.
            </p>
            <p>
              A Mode whose parameters came from a test finding rather than its Source carries a{" "}
              <span className="test-derived-badge">Test-Derived</span> badge — click it to jump to the
              test record that produced it.
            </p>
            <p>
              Metadata edits (name, notes, EW Group) apply immediately. Editing a Mode's actual line values
              (RF/PW/PRI/deltas) works differently: clicking <strong>Propose edit</strong> creates a{" "}
              <span className="mode-status-badge mode-status-draft">Pending Review</span> draft alongside
              the existing approved Mode, rather than changing it in place. The draft can then be{" "}
              <strong>approved</strong> — which supersedes the original — or <strong>rejected</strong>, by
              any editor. This keeps a live Mode's values stable (and safe to reference from a committed
              version) while a proposed change is still being reviewed.
            </p>
          </div>

          <div className="help-subsection" id="emitter-testing-tab">
            <h4>Test History tab (the workbench)</h4>
            <p>
              Logs lab-bench validation runs. Click <strong>+ New Test</strong> to open the workbench:
            </p>
            <ul>
              <li>
                Every current Mode defaults to{" "}
                <span className="test-result-badge test-result-pass">pass</span>, included in the test —
                with 70+ Modes on some Emitters, you only need to touch the few that actually need a
                different result. Click one or more Mode chips, then apply a{" "}
                <span className="test-result-badge test-result-fail">fail</span>/
                <span className="test-result-badge test-result-partial">partial</span>/
                <span className="test-result-badge test-result-inconclusive">inconclusive</span> result
                and notes to the selection, or exclude them from the test entirely.
              </li>
              <li>
                The chip grid defaults to approved Modes only, and can be narrowed further by Result,
                Status, or a "not tested since" date — useful once an Emitter has 70+ Modes. Narrowing
                only changes which chips are <em>visible</em>; a chip you already flagged stays included in
                the test even while filtered out of view.
              </li>
              <li>
                Selecting exactly one Mode also reveals an <strong>observed values</strong> panel — what
                was actually measured, for recording an anomaly or seeding a new Mode from it. It's
                PRI-type aware (jitter min/max for FIXED, a stagger sequence for STAGGER, nothing extra for
                CW/XLET), and <strong>+ Add another observed value</strong> lets you record more than one
                distinct measurement set against the same Mode in one test.
              </li>
              <li>
                A failed or partial test's row in the history table gets a <strong>Redo test</strong>{" "}
                button — one click opens a new test already set up as a retest of it (title, "This is a
                retest of…" link, and Mode selection all pre-filled), instead of setting those up by hand.
              </li>
              <li>
                The test's overall result is always <strong>derived</strong> from the per-Mode results,
                never picked independently — a test can't be marked pass while a Mode inside it failed.
              </li>
              <li>
                <strong>+ Stage a new Mode</strong> lets you create a new Mode while still filling out the
                test, using the same form as normal Mode creation. It's automatically linked as{" "}
                <span className="test-result-badge test-result-derived">derived</span> from this test once
                the test saves — this is what puts the Test-Derived badge on a Mode. If you flagged
                observed values on another Mode in this same test, a "Pre-fill from observed values"
                control can copy its RF/PW (and PRI, for FIXED-type Modes) straight into the new Mode's
                line — deltas and jitter still need to be entered manually, same as any other Mode.
              </li>
              <li>
                <strong>This is a retest of…</strong> links a new test record back to an earlier one (e.g.
                after a fix) and shows the before/after outcome inline — for example: "Retest of:
                Mixed-result run <span className="test-result-badge test-result-fail">fail</span> →{" "}
                <span className="test-result-badge test-result-pass">pass</span>".
              </li>
              <li>
                <strong>Start from a previous test's Mode selection</strong> pre-populates the chip grid
                from an earlier test's results — handy for routine repeat testing of the same Mode set.
                Notes and observed values are never carried forward, only which Modes were flagged and what
                they scored.
              </li>
              <li>
                For a Simulation-type test, a <strong>Sim created</strong> date (when the simulation
                artifact itself was generated, as opposed to when the test was logged) is its own column in
                the history table — sortable separately from the test date.
              </li>
            </ul>
          </div>

          <div className="help-subsection" id="emitter-audit-tab">
            <h4>Audit tab</h4>
            <p>
              A scoped view of the global Audit Log — but rolled up, not limited to the Emitter's own
              entries: everything under it too (its EW Groups, Sources, Modes, Elements, generation
              batches, imports, and test records), including entries for Modes since deleted. An Entity
              column identifies which kind of thing each row is about.
            </p>
          </div>

          <div className="help-subsection" id="emitter-sources">
            <h4>EW Groups & Sources setup</h4>
            <p>
              A collapsible panel below the Modes table. <strong>EW Groups</strong> are the operational
              buckets (scan range + threat priority) Modes are organized under. <strong>Sources</strong>{" "}
              record where a parameter set came from — a datasheet, a lab measurement — and hold the
              RF/PW/PRI/Scan <strong>Elements</strong> you build Modes from (min/max, optional jitter and a
              tolerance <strong>delta</strong>, or a stagger sequence for PRI).
            </p>
            <p>
              An Element can carry a <strong>measurement variant</strong> — <em>typical</em>,{" "}
              <em>discrete</em>, <em>most probable</em>, or <em>extreme</em> — shown as a{" "}
              <span className="hint-text">[variant]</span> tag before its label, when a parametric set
              distinguishes between them rather than giving one plain value.
            </p>
            <p>
              A <strong>Parameter Sequence</strong> is a further step beyond a single Element: an ordered,
              multi-parameter "dwell & switcher" pattern where each step can set any combination of
              RF/PW/PRI/Scan (and how long to dwell there) — read-only for now, shown as a small table per
              sequence with a blank cell wherever that step didn't set that parameter.
            </p>
            <p>
              A Source that came from an <strong>import</strong> (see below) starts out{" "}
              <span className="status-badge status-pending_review">pending review</span> rather than{" "}
              <span className="status-badge status-approved">approved</span> — an editor reviews its
              Elements and Sequences, then <strong>Approve</strong>s or <strong>Reject</strong>s it via the
              buttons next to the Source (only shown while it's pending). A manually-created Source is
              approved immediately; there's nothing to review.
            </p>
            <p>
              <strong>Import from XML</strong> (in Editorial Tools, currently disabled — "coming soon") is
              built for an automated pipeline rather than manual use: a source XML document can contain
              many <em>parametric sets</em>, each becoming its own Source, all linked back to the same{" "}
              <strong>import batch</strong> (the document they came from) — so several pending-review
              Sources appearing at once with the same document behind them is expected, not a duplicate.
            </p>
            <p className="hint-text">
              Also here: <strong>Cartesian Product</strong>, which combines chosen RF/PW/PRI Elements into
              every possible Mode in one step, instead of typing each Mode's line by hand.
            </p>
          </div>
        </div>

        <div className="help-subsection" id="emitter-versions">
          <h3>Version history</h3>
          <p>
            <strong>Commit Version</strong> takes an immutable snapshot of the Emitter's current state.
            Only <strong>approved</strong> Modes are included in a snapshot, so a pending draft never leaks
            into a released version. The page shows a diff between any two versions, called out
            field-by-field rather than as a raw JSON dump.
          </p>
        </div>

        <div className="help-subsection" id="emitter-ambiguity">
          <h3>Ambiguity check</h3>
          <p>
            Compares Modes' RF/PW/PRI ranges against each other and flags pairs that overlap closely
            enough to be confused by a receiver, bucketed by severity. It only ever reads from the
            Emitter's most recently <strong>committed</strong> version — not live drafts — so results stay
            consistent with whatever was actually released.
          </p>
        </div>
      </div>

      <div className="card" id="platforms">
        <h2>Platforms</h2>
        <p>
          The Platforms list (top nav) shows every Platform — a Platform bundles the Emitters carried by a
          given vehicle or site. A Platform has no status of its own; it's purely a container, ready to be
          pinned into an MDF whenever the Emitters inside it are.
        </p>

        <div className="help-subsection" id="platform-detail">
          <h3>Platform detail</h3>
          <p>Pin and unpin Emitters (each pin references one committed Emitter version), and edit the Platform's own metadata.</p>
        </div>

        <div className="help-subsection" id="platform-versions">
          <h3>Version history</h3>
          <p>Works the same way as an Emitter's — see "Version history" above.</p>
        </div>

        <div className="help-subsection" id="platform-ambiguity">
          <h3>Ambiguity check</h3>
          <p>
            Works the same way as an Emitter's, but across every Mode on every Emitter pinned to this
            Platform — see "Ambiguity check" above.
          </p>
        </div>
      </div>

      <div className="card" id="mdfs">
        <h2>MDFs</h2>
        <p>
          The MDFs list (top nav) shows every Mission Data File with its current status — an MDF bundles
          the Platforms relevant to a mission or exercise.
        </p>

        <div className="help-subsection" id="mdf-detail">
          <h3>MDF detail</h3>
          <p>
            Pin and unpin Platforms, and edit the MDF's own metadata. Status moves{" "}
            draft → pending review → approved → released → deprecated.
          </p>
        </div>

        <div className="help-subsection" id="mdf-versions">
          <h3>Version history & XML export</h3>
          <p>
            Commits work the same way as an Emitter's. For a committed MDF version, an{" "}
            <strong>Export XML</strong> button on this page produces the final XML output — built strictly
            from committed snapshots, never live/draft data.
          </p>
        </div>

        <div className="help-subsection" id="mdf-ambiguity">
          <h3>Ambiguity check</h3>
          <p>
            Works the same way as an Emitter's, but across every Mode reachable through every Platform
            pinned to this MDF — see "Ambiguity check" above.
          </p>
        </div>
      </div>

      <div className="card" id="audit-log">
        <h2>Audit Log</h2>
        <p>
          A chronological record of who changed what, across the whole app. Navigate by entity type down
          the left side, narrow further by action, or search for a specific object by name (an Emitter,
          Platform, MDF, EW Group, or Source) to see just its history. Each entry shows a human-readable
          summary and, where relevant, a field-by-field diff.
        </p>
          </div>
        </div>
      </div>
    </div>
  );
}
