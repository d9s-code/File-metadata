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
          { id: "emitter-sources", title: "EW Groups & Sources tab" },
          { id: "emitter-intercepts-tab", title: "Intercepts tab" },
          { id: "emitter-testing-tab", title: "Test History tab" },
          { id: "emitter-audit-tab", title: "Audit tab" },
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
  { id: "source-groups", title: "Source Groups" },
  { id: "customers", title: "Customers" },
  {
    id: "intercepts",
    title: "Intercepts",
    children: [
      { id: "intercept-import", title: "Importing from CSV" },
      { id: "intercept-detail", title: "Intercept detail" },
    ],
  },
  { id: "tasks", title: "Tasks & assignment" },
  { id: "audit-log", title: "Audit Log" },
  {
    id: "admin",
    title: "Admin",
    children: [{ id: "admin-backups", title: "Backups" }],
  },
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
          This app tracks RF emitter profiles for EW (electronic warfare) use — the RF/PRI/PW parameters
          that let a receiver recognize a given radar. The core object is a <strong>Mode</strong>: one
          named signal (e.g. "Search Wide", "Track Lock") with a frequency range, pulse width, and PRI
          behavior. Modes are grouped into <strong>EW Groups</strong> under an <strong>Emitter</strong>{" "}
          (a physical radar/system). Emitters are referenced by <strong>Platforms</strong> (the vehicle or
          site carrying them), and Platforms are bundled into an <strong>MDF</strong> (Mission Data File)
          for a specific mission or exercise.
        </p>
        <p>
          Every Mode's parameters trace back to a <strong>Source</strong> — a datasheet, test report, or
          other document — and optionally to individual <strong>Elements</strong>: the raw RF/PRI/PW value
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
            editing Emitters/Platforms/MDFs, Modes, EW Groups, Sources, Elements, logging tests, checking
            out and editing an Emitter, approving or rejecting imported Sources, and committing versions.
          </li>
          <li>
            <span className="role-badge">admin</span> — everything an editor can do; the highest rank.
          </li>
        </ul>
        <p>
          <strong>Your password:</strong> click your name in the top bar → <strong>Change password…</strong>. You
          need the current one; the new one must be at least 12 characters. Changing it signs you out everywhere
          else. Passwords are only ever stored as a one-way hash, so not even a backup holds them.
        </p>
        <p className="hint-text">
          Ranks are cumulative (viewer &lt; editor &lt; admin). A control that requires a role simply
          doesn't render for accounts below that rank, rather than showing a locked/disabled version of it.
        </p>
      </div>

      <div className="card" id="dashboard">
        <h2>Dashboard</h2>
        <p>
          The landing page after login, and the best place to start when you&rsquo;re not sure where
          something stands. Each card loads on its own.
        </p>
        <ul>
          <li>
            <strong>My work</strong>, across the top — your open tasks (tick them off right there), the Emitters
            assigned to you, and the Emitters you&apos;re editing now. See <a href="#tasks">Tasks &amp; assignment</a>.
          </li>
          <li>
            <strong>Needs Attention</strong> — one line per item, grouped: Simulation (SIM Test Lines missed or
            misclassified, an Emitter in Testing never simulated, one changed since its last simulation), Needs rework,
            Sources awaiting review, Intercepts with entries no Mode covers, unreviewed serious overlaps from the latest
            ambiguity check, Emitters held for editing over 8 hours, stalled Emitters and MDF readiness. Click a group
            to fold it; click an item to go to it.
          </li>
          <li>
            <strong>Emitters</strong> and <strong>MDFs</strong> — how many are at each lifecycle stage.
          </li>
          <li>
            <strong>Admin</strong> (admins only) — failed sign-ins in the last day, and long-held edit locks.
          </li>
          <li>
            <strong>Simulation validation</strong> — every SIM Test Line&rsquo;s latest outcome as one bar, then
            one row per Emitter, worst first, with a search box and a filter.
          </li>
          <li>
            <strong>Test Runs</strong> — the latest runs with their line outcomes, and failed or partial runs
            that still need a redo.
          </li>
          <li>
            <strong>Recent Activity</strong> — the latest changes from the Audit Log; tick{" "}
            <em>Sign-ins &amp; edit locks too</em> to include those.
          </li>
          <li>
            <strong>Backup</strong> — how long since the last backup, how many changes have been made since, and
            which Emitters, Platforms and MDFs were added, changed or removed. The more that changes, the sooner a
            backup is due. See <a href="#admin-backups">Backups</a>.
          </li>
        </ul>
      </div>

      <div className="card" id="emitters">
        <h2>Emitters</h2>
        <p>
          The Emitters list (top nav) shows every Emitter with its current status, and RF/PRI/PW/Scan
          min/max plus a Modes-passing count computed across its Modes — every column is
          sortable, and the toolbar above the table filters by name, designation, or any of those
          RF/PRI/PW/Scan ranges. <strong>+ Add Emitter</strong> opens a small form as an overlay rather
          than a full page; click a row to open that Emitter.
        </p>

        <div className="help-subsection" id="emitter-detail">
          <h3>Emitter detail</h3>
          <p>
            An Emitter's page has five tabs — <strong>Modes</strong>, <strong>EW Groups &amp; Sources</strong>,{" "}
            <strong>Intercepts</strong>, <strong>Test History</strong>, and <strong>Audit</strong> — plus
            links to its <strong>Version history</strong> and <strong>Ambiguity check</strong> above them.
            Below the title, a summary line repeats the same RF/PRI/PW/Scan ranges and Modes-passing count
            shown on the list page, for this one Emitter. On first load, a brand-new Emitter with no EW
            Groups or Sources yet opens straight to the EW Groups & Sources tab instead of Modes.
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
              See the Emitter's Modes as a sortable <strong>Table</strong>, as <strong>Cards</strong>, or as{" "}
              <strong>Charts</strong>. Filter by EW Group, Source, or Batch, and search by name. Each Mode row shows:
            </p>
            <ul>
              <li>RF min/max, PRI type (FIXED / STAGGER / CW / XLET) and its min/max where applicable, PW min/max</li>
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
              <strong>Right-click</strong> the Modes table&rsquo;s header row to choose which columns show —
              tick or untick each one, or <strong>Show all columns</strong> to bring them all back. Your choice
              is remembered in this browser. Confirmation Quality and Confirmation Quantity have their own
              columns, right after Range Matching.
            </p>
            <p>
              Hover a Mode's name to see its notes, when it (and its Source) were last updated, and a
              staleness callout if the Source has changed more recently than the Mode.
            </p>
            <p>
              A Mode whose parameters came from a test finding rather than its Source carries a{" "}
              <span className="test-derived-badge">Test-Derived</span> badge; one derived from a logged{" "}
              <strong>Intercept</strong> entry instead carries an{" "}
              <span className="test-derived-badge">Intercept-Derived</span> badge. Either one is a link —
              click it to jump to the record that produced it.
            </p>
            <p>
              <strong>+ Add Mode</strong> opens the Mode form (the same fields as <strong>Edit</strong>): a
              suggested name (the next free &ldquo;EW Group n&rdquo;), the EW Group and Source, then one row each for
              RF, PRI (with its type) and PW. For a single value, fill in <em>min</em> and leave <em>max</em> blank.
              Under each row you see what it will match once its ± margin is added (&ldquo;Matches 2,999 – 3,001
              MHz&rdquo;), or, for a stagger, its steps and frame time. A mistake is pointed out under its row once
              you move on, in plain words, and the form won&apos;t save until it&apos;s fixed.{" "}
              <strong>Start from</strong> fills everything in from an existing Mode. <strong>Add &amp; next</strong>{" "}
              saves this one and starts the next with the same EW Group, Source, PRI type and margins, and the next
              name. Function Group, confirmation, notes and &ldquo;test-derived&rdquo; are folded under{" "}
              <strong>More options</strong>, which says what they&apos;re set to.
            </p>
            <p>
              Every field — metadata (name, notes, EW Group) and the actual line values (RF/PRI/PW/deltas)
              alike — edits in place immediately, the same way everything else in the app works. The only
              gate is holding the Emitter's <strong>checkout</strong> (see below): with it, click{" "}
              <strong>Edit</strong> on a Mode's row to change its line right there.
            </p>
            <p>
              The Mode form lists RF, then PRI, then PW. Each delta starts at <strong>0</strong> — type a
              tolerance only where the Source gives one. A Stagger Mode&rsquo;s <strong>frame time</strong>{" "}
              follows the sum of its sequence until you type your own value; <strong>Use sum</strong> goes
              back to the sum. Every Mode also carries a <strong>Confirmation quality</strong> (0–100, default
              100) and <strong>Confirmation quantity</strong> (default 2); both go into the PRS export and
              can be changed per Mode or with Batch Edit.
            </p>
            <p>
              Tick a Mode's checkbox (or several) to reveal a <strong>Batch Edit</strong> button for
              applying the same field, delta, or range-shift change to all of them at once — muted until at
              least one Mode is selected. A <strong>Collapse generation batches</strong> toggle folds every
              Mode a single Cartesian Product run created into one expandable summary row, so a run that
              produced 20+ Modes doesn't clutter the table.
            </p>
          </div>

          <div className="help-subsection" id="emitter-modes-charts">
            <h4>Modes charts</h4>
            <p>
              <strong>Charts</strong> draws the Modes the filters leave as <strong>range ladders</strong>, using the
              engineered ranges the system recognises: each Mode gets a row with its RF, PRI (a stagger&apos;s frame
              time) and PW in three separate panels — the solid bar is what it was set to, the faint extension the
              engineered ± delta — so overlaps line up in a column and gaps are values no Mode covers. Click a Mode&apos;s
              name to open it in the table. This Emitter&apos;s intercept entries are ticks along the top of each panel
              (orange when outside every Mode); the axes fit the Modes unless you choose to fit the entries too.
            </p>
            <p>
              <strong>Colour</strong> switches between each Mode&apos;s last test result (named in the legend and on
              hover) and <strong>By Mode</strong>, which gives Modes a colour each so you can tell them apart. Eight
              colours at most are in use at once — more can&apos;t be told apart reliably — and the rest are grey; the
              first eight by name get one to start with. Only the coloured Modes are listed above the chart, so the list
              stays short however many Modes there are. Give another Mode a colour with <strong>+ Colour a Mode</strong>{" "}
              or by clicking its square in the chart; click a listed Mode (or its square again) to make it grey, and
              point at one to pick it out. <strong>Only the coloured Modes</strong> hides the rest. The choice is kept
              for each Emitter.
            </p>
            <p>
              <strong>Axis ranges</strong> set where the RF, PRI and PW axes start and end, in place of fitting them to
              this Emitter&apos;s Modes. Fill in either end, or both; a blank end still fits the Modes. The ranges stay
              in this browser for every Emitter, so Emitters can be compared on the same scale. A Mode reaching past
              them is cut at the edge, and in the ladders a Mode wholly outside gets an arrow (◂ ▸) with its nearest
              value. <strong>Fit to the Modes</strong> clears them.
            </p>
          </div>
          <div className="help-subsection" id="emitter-testing-tab">
            <h4>Test History tab</h4>
            <p>
              Two parts: the <strong>SIM Test Lines</strong> this Emitter is checked against, and the list of
              logged <strong>test runs</strong>. Between them, <strong>Simulation trend</strong> shows each simulation
              run as a column of its line outcomes (correct, misclassified, missed, inconclusive), oldest to newest,
              with the Emitter version it was run against on hover — click a column to open the run.
            </p>
            <ul>
              <li>
                <strong>SIM Test Lines</strong> are imported by pasting rows from a spreadsheet, together with
                the (required) date the lines were created in the simulator. Each line shows a{" "}
                <strong>Status</strong> — its outcome in the most recent run that included it, linking to that
                run — and the date it was <strong>last tested</strong>. Click the heading to collapse the
                table; the choice is remembered.
              </li>
              <li>
                <strong>+ New Test Run</strong> opens a separate page. Pick the type:{" "}
                <strong>simulation</strong> (checked against the SIM Test Lines) or{" "}
                <strong>intercept</strong> (a real-world intercept, checked against the Emitter&rsquo;s own
                Modes). Older lab-bench, live-range and field-exercise records stay in the history, but new
                runs are one of these two. Set the run&rsquo;s <strong>Dwell</strong> next to its dates: leave it on
                Manual, or pick Value and write one in (e.g. 50 ms); it applies to the whole run.
              </li>
              <li>
                A simulation run is a table with one row per SIM Test Line. Every line starts included and{" "}
                <span className="test-result-badge test-result-pass">correct</span>; change the outcome to{" "}
                <span className="test-result-badge test-result-partial">misclassified</span>,{" "}
                <span className="test-result-badge test-result-fail">missed</span> or{" "}
                <span className="test-result-badge test-result-inconclusive">inconclusive</span> where needed,
                flag every Mode the system reported under <strong>Intercepted as</strong> — type to search
                the Emitter&rsquo;s Modes and click (or press Enter) to add as many as apply; the list stays
                open between picks, and <strong>+ Add all N matches</strong> adds everything the search
                found — and use <strong>+ Log</strong> to record the intercepted parameters as means — RF mean, PRI mean and jitter mean (Fixed), PW
                mean; a Stagger set takes its sequence and the measured <strong>frame time</strong> instead.
                Add more than one set if it was measured more than once; each shows on its own line.
              </li>
              <li>
                An intercept run is a table with one row per Mode: tick the Modes that were intercepted, then
                give each a result, intercepted parameters and notes. Function Group ratings are computed
                from these and can be overridden.
              </li>
              <li>
                The run&rsquo;s overall result is always <strong>derived</strong> from the included rows
                (worst one wins); it can only be set by hand when nothing is included.
              </li>
              <li>
                <strong>+ Stage a new Mode</strong> creates a Mode found during the run, linked as{" "}
                <span className="test-result-badge test-result-derived">derived</span> from it once the run
                is saved — its line can be pre-filled from any intercepted parameters you logged. The same
                pre-fill is on <strong>+ Add Mode from this test</strong> once the run is saved: pick which
                logged set to use (each is listed by line, set number and values), and a mean fills both min
                and max.
              </li>
              <li>
                Each run has its own page with the full per-line and per-Mode detail, plus{" "}
                <strong>+ Add Mode from this test</strong>. A failed or partial run gets a{" "}
                <strong>Redo test</strong> button that starts a new run pre-filled as a retest of it.
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
            <h4>EW Groups & Sources tab</h4>
            <p>
              <strong>EW Groups</strong> are the operational buckets (scan range + threat priority) Modes
              are organized under; <strong>Function Groups</strong> are a second, independent way to group
              Modes (e.g. by radar function) alongside their EW Group. <strong>Sources</strong> record
              where a parameter set came from — a datasheet, a lab measurement — and hold the RF/PRI/PW/Scan{" "}
              <strong>Elements</strong> you build Modes from (min/max, optional jitter and a tolerance{" "}
              <strong>delta</strong>, or a stagger sequence for PRI).
            </p>
            <p>
              An Element can carry a <strong>measurement variant</strong> — <em>typical</em>,{" "}
              <em>discrete</em>, <em>most probable</em>, <em>extreme</em>, <em>intercept</em>, or{" "}
              <em>analysis</em> — shown as a <span className="hint-text">[variant]</span> tag before its
              label. The <em>analysis</em> variant means the value came from further analysis rather than a
              direct reading, and requires a note explaining how it was derived.
            </p>
            <p>
              A <strong>Parameter Sequence</strong> is a further step beyond a single Element: an ordered,
              multi-parameter "dwell & switcher" pattern where each step can set any combination of
              RF/PRI/PW/Scan (and how long to dwell there), shown as a small table per sequence with a
              blank cell wherever that step didn't set that parameter.
            </p>
            <p>
              Tick one or more Sources' checkboxes to reveal a <strong>Batch Add</strong> button — muted
              until at least one is selected — for adding the same new Element or Sequence to every
              selected Source at once, instead of repeating the same entry by hand on each one.
            </p>
            <p>
              A Source that came from an <strong>import</strong> (see below) starts out{" "}
              <span className="status-badge status-pending_review">pending review</span> rather than{" "}
              <span className="status-badge status-approved">approved</span> — an editor reviews its
              Elements and Sequences, then <strong>Approve</strong>s or <strong>Reject</strong>s it via the
              buttons next to the Source. Rejecting asks for a reason, which is shown under the Source&rsquo;s
              name. A <span className="status-badge status-rejected">rejected</span> Source stays in the list,
              but its Modes are left out of exports and ambiguity checks until someone approves it — the{" "}
              <strong>Approve</strong> button stays available on rejected Sources for exactly that. A
              manually-created Source is approved immediately; there&rsquo;s nothing to review.
            </p>
            <p>
              <strong>Import from XML</strong> (in Editorial Tools, currently disabled — "coming soon") is
              built for an automated pipeline rather than manual use: a source XML document can contain
              many <em>parametric sets</em>, each becoming its own Source, all linked back to the same{" "}
              <strong>import batch</strong> (the document they came from) — so several pending-review
              Sources appearing at once with the same document behind them is expected, not a duplicate.
            </p>
            <p className="hint-text">
              Also here: <strong>Cartesian Product</strong>, which combines chosen RF/PRI/PW Elements (and
              individually-selected Parameter Sequence steps) into every possible Mode in one step, instead of
              typing each Mode's line by hand. Each selected item gets a <strong>Delta</strong> field that
              starts at 0 — that&rsquo;s exactly the delta the generated Modes get unless you type another
              value. Each of its RF/PRI/PW columns sorts independently.
            </p>
          </div>

          <div className="help-subsection" id="emitter-intercepts-tab">
            <h4>Intercepts tab</h4>
            <p>
              This Emitter's logged real-world signal intercepts — see <strong>Intercepts</strong> below for
              what an Intercept is and how it's built. Each row shows when it was recorded, who collected it,
              and how its entries compare with this Emitter's Modes; the line above the table totals the
              entries that don't match a Mode. <strong>+ Add Intercept</strong> here pre-fills the new
              Intercept's Emitter; click one to open its detail page.
            </p>
          </div>
        </div>

        <div className="help-subsection" id="emitter-versions">
          <h3>Editing, Save version, Discard, Revert & Fork</h3>
          <p>
            Editing an Emitter (or any of its EW Groups/Sources/Modes/Elements) requires holding its{" "}
            <strong>checkout</strong> first — press <strong>Start editing</strong> in the Emitter's header.
            Until then every editing control is faded out. This stops two people from editing the same
            Emitter at once; the header shows who holds it, and an Admin can force-release a stale lock. A
            brand-new Emitter is auto-checked-out to whoever created it. While you hold any, a panel in the
            bottom-left corner of every page lists them and how long you&apos;ve held each (marked after 8 hours);
            fold it to a small tab if it&apos;s in the way. Admins see every hold under{" "}
            <strong>Admin → Edit locks</strong>, with <strong>Force release</strong> for one that&apos;s blocking
            others.
          </p>
          <p>
            <strong>Save version</strong> takes an immutable snapshot of the Emitter's current state, with a
            short message describing what changed, and ends your editing session. <strong>Discard</strong>{" "}
            throws away everything since the last saved version. <strong>Version History</strong> lists the
            versions newest first — each with its summary, who saved it and when — and opens on the newest. The
            selected version shows what changed since the one before, item by item: each Mode, EW Group, Source
            or Test Line with its changed fields as before → after, and anything added or removed with a line
            saying what it was (an added Mode&apos;s type, RF, PRI and PW, say). Pick another version under{" "}
            <strong>Changes since</strong> to compare any two. Its actions — Revert, Fork — sit beside it.
          </p>
          <p>
            <strong>Revert to vN…</strong> resets live data to match an older saved version
            and immediately commits a new version documenting the revert — like <code>git revert</code>,
            history is never rewritten or deleted. <strong>Fork this version</strong> instead spins that
            version off into a brand-new, fully independent Emitter you can experiment on freely without
            touching the original.
          </p>
        </div>

        <div className="help-subsection" id="emitter-ambiguity">
          <h3>Ambiguity check</h3>
          <p>
            Compares Modes' RF/PRI/PW ranges against each other and flags pairs that overlap closely
            enough to be confused by a receiver, bucketed by severity. It only ever reads from the
            Emitter's most recently <strong>committed</strong> version — not live drafts — so results stay
            consistent with whatever was actually released.
          </p>
          <p>
            <strong>AI explanations</strong> (only if a language model is set up): select a finding and press{" "}
            <strong>Explain with AI</strong> for why the two Modes can&apos;t be told apart, what separates them, and a
            suggested action; <strong>Summarise with AI</strong> gives an overview of the whole run. The check still
            computes every overlap itself — the model only reads the result and explains it. What it writes is a{" "}
            <strong>draft</strong>: check it against the numbers, and if it mentions a number that wasn&apos;t in the
            data it was given, that number is listed in a warning. The draft stays with the finding for everyone, and{" "}
            <strong>Ask again</strong> replaces it. A finding with an AI suggestion is marked ✦ in the table.
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
          <p>
            Laid out like an Emitter: <strong>Save version</strong>, <strong>Export XML</strong> and{" "}
            <strong>More ▾</strong> (Version history, Ambiguity check, Edit details) along the top, with when it
            was last saved under the name. Pin and unpin Emitters below — each pin references one saved Emitter
            version. A Platform has no editing session: pins and details apply straight away, and{" "}
            <strong>Save version</strong> records them as a new version (the summary is optional).
          </p>
        </div>

        <div className="help-subsection" id="platform-versions">
          <h3>Version history</h3>
          <p>
            Laid out like an Emitter&apos;s — see &ldquo;Version history&rdquo; above. The changes list which
            Emitters were pinned or unpinned, which moved to another of their versions, and any change to the
            Platform&apos;s own name or description. Each version can be exported as a PRS package from beside it.
          </p>
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
          The MDFs list (top nav) shows every Mission Data File — its name, how many Platforms it has
          pinned, release date, status, and Customer — an MDF bundles the Platforms relevant to a mission
          or exercise. Every column is sortable, and the toolbar filters by name and Customer.
        </p>

        <div className="help-subsection" id="mdf-detail">
          <h3>MDF detail</h3>
          <p>
            Pin and unpin Platforms, and edit the MDF's own metadata — name, description, notes, release
            date (defaults to today when creating one, but overwritable), and <strong>Customer</strong>{" "}
            (picked from the <strong>Customers</strong> list below, so filtering stays consistent). Status
            moves draft → pending review → approved → released → deprecated.
          </p>
          <p>
            A <strong>Release notes</strong> panel below the title works the same way as an Emitter's
            Analyst notes — an append-only, timestamped log, separate from the single editable "Notes"
            field in the edit form.
          </p>
        </div>

        <div className="help-subsection" id="mdf-versions">
          <h3>Version history & XML export</h3>
          <p>
            <strong>Save version</strong> (along the top of the MDF and on this page) records the MDF as a new
            version, like an Emitter&apos;s, with an optional summary. <strong>Export ▾</strong> on the MDF
            exports its latest saved version as XML or as a PRS package; this page exports any version you pick —
            always from saved snapshots, never live data.
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

      <div className="card" id="source-groups">
        <h2>Source Groups</h2>
        <p>
          A Source Group is a named, cross-Emitter bucket of Sources — useful for keeping related datasheets
          or lab-measurement Sources together regardless of which Emitter they end up feeding. The list
          shows each group's Source count, its aggregate RF/PRI/PW range across every Source in it, and when
          it was last touched. A Source is put into a group from the Source's own edit form.
        </p>
        <p>
          Open a group (▸) to see the Emitters its Sources sit under, and open an Emitter to see each Source with
          its <strong>Date last updated</strong> and how long ago that was; every level shows the oldest and newest
          date beneath it. Sources with no group are listed under <strong>No group</strong>. The query bar
          narrows everything at once — search by Source, Emitter, designation, group or type, give a date range, or
          pick <strong>Not updated in</strong> 6 months to 5 years — and <strong>List</strong> shows the matching
          Sources as one table, oldest first. Click a Source to open it on its Emitter.
        </p>
      </div>

      <div className="card" id="customers">
        <h2>Customers</h2>
        <p>
          Customers are who an MDF is delivered to — a small, flat, globally-shared list (just a name) kept
          separate from free-typed text so the MDF overview can sort/filter by Customer without drifting on
          inconsistent spelling. Add one here, then pick it from an MDF's edit form.
        </p>
      </div>

      <div className="card" id="intercepts">
        <h2>Intercepts</h2>
        <p>
          A place to log real-world signal intercepts — searchable globally here, and scoped to one Emitter
          on that Emitter's own Intercepts tab. An Intercept is a <strong>container</strong> (name, the date
          the signal was recorded, who or what collected it, a description, and its own append-only Analyst
          notes feed) holding one or more logged{" "}
          <strong>entries</strong> — the actual observations, taken over time.
        </p>
        <p>
          Each entry records RF, PRI, and PW as a required mean, with an optional measured min and max.
          Pulse-train character depends on the entry's type: a <strong>Fixed</strong> entry gets a single
          flat jitter mean; a <strong>CW</strong> entry has RF only (no pulses, so no PRI or PW, and it's matched
          on RF alone); a <strong>Stagger</strong> entry gets an ordered list of stagger values instead
          (and its PRI mean field is read as the stagger frame-time mean — left blank, it's the sum of the
          stagger values). Each entry also has its own
          short note, separate from the container's Analyst notes.
        </p>

        <div className="help-subsection" id="intercept-import">
          <h3>Importing from CSV</h3>
          <p>
            <strong>Import CSV</strong> (on the Intercepts list, an Emitter&apos;s Intercepts tab, or an Intercept&apos;s
            More menu) reads an <strong>EmitterTrackParameters</strong> export. The file is read in your browser and
            nothing is saved until you press <strong>Import</strong>. Each line is one report: RF in MHz, and PRI,
            pulse width, jitter and stagger positions in ns, converted to µs. <code>Simple</code> becomes Fixed;{" "}
            <code>Stagger</code> keeps its first <code>Stagger_Count</code> positions and uses <code>BasePRI</code> as
            the frame time; <code>CW</code> keeps RF only. X-let lines are skipped for now, and every skipped line is
            listed with the reason.
          </p>
          <p>
            The Emitter is the one whose <strong>designation</strong> equals the designation the system identified
            the reports as, when exactly one does — the page says when it picked one that way. You can always choose
            another, and import into a new Intercept or add to an existing one.
          </p>
          <p>
            Each row in the grouping table becomes one entry: the mean of its reports, with their lowest and highest
            values as the measured range, and a note of which file lines it came from. Every report starts as its own
            row. Group them yourself: filter (by type, RF/PRI/PW, track or identification), select rows, and{" "}
            <strong>Merge into one</strong>; <strong>Split</strong> or <strong>Take out</strong> undoes it, and{" "}
            <strong>Exclude</strong> leaves rows out of the import. <strong>Split at a value…</strong> cuts the
            selected rows in two on RF, PRI or PW: while it&apos;s on, the charts show only those rows&apos; reports, so
            two signals that run into each other show as two humps — click the dip between them (or type the value),
            check the line on the chart, and press Split. Reports at or below the value go in one row, those above in
            the other.
          </p>
          <p>
            <strong>Auto group</strong> uses the gaps you set and only the rule written next to it. It keeps PRI types
            (and staggers with different numbers of positions) apart, and optionally tracks. Then it starts a new
            group wherever there&apos;s an <strong>empty stretch wider than the gap</strong> on RF, PRI or PW, and
            repeats until nothing splits further. So a signal stays in one group however much it spreads or drifts, as
            long as its reports run on into each other, and two signals separate as soon as there&apos;s a clear gap
            between them on any one parameter. Two signals whose spreads touch stay together — split them at the dip.
            The <strong>minimum reports per group</strong> keeps scattered reports out of the groups. A report with
            too few others near it (within the gaps on RF, PRI and PW together), or in a group smaller than the
            minimum, becomes a <strong>stray</strong>. This also stops a thin trickle of strays from joining two real
            signals. Strays are listed apart and held out of the import until you decide: show them, merge them into
            a group, keep each as its own entry, or exclude them. A minimum of 1 means no strays. Auto group never
            runs on its own. One import takes up to 5,000 entries.
          </p>
          <p>
            Each saved entry keeps what it was built from: how many reports, when it was first and last heard
            (mission times as written in the file), their track numbers and the file name. The reports themselves
            are kept with the Intercept too — every one, including those left out — so they can be viewed and
            regrouped later (up to 100,000 per file). Your work on an import
            is kept in this browser as you go — leave the page by any route and you&apos;re offered to resume it
            when you come back. If the file was imported before, the page says where and asks before adding its
            entries a second time.
          </p>
          <p>
            <strong>Charts</strong> show the reports (excluded ones left out): a scatter of any two of RF, PRI and PW
            (chosen with Across/Up, RF × PRI by default), and how often each
            RF, PRI, frame time, PW, jitter and stagger-position value occurs. With an Emitter chosen, each bar is
            split into reports <strong>within a Mode</strong> and <strong>outside every Mode</strong> for that
            parameter (using the Modes&apos; engineered ranges, Modes of the same PRI type only), a grey strip under
            the axis shows where the Modes reach, and each chart says what share falls outside — the quickest way to
            see what the current programming doesn&apos;t cover. Drag across a chart (or a box on RF × PRI) to filter
            to that range (a box on the scatter sets both of its parameters): the table follows and the other charts
            narrow to it, so you can isolate one cluster and
            check its spread before merging it. Click a chart to clear its range.
          </p>
          <p>
            The charts sit under two tabs, so only one set shows at a time: <strong>Scatter &amp;
            distributions</strong> (above) and <strong>Over time</strong>, which plots RF, PRI and PW against each
            report&apos;s mission time (as written in the file) on one shared time axis — when each signal was heard,
            whether it drifts, which were up together. On Over time you group by marking:{" "}
            <strong>drag a box around the dots you want</strong> on any of the three charts, and those reports light
            up on all three (the rest turn faint grey), so boxing a stretch of RF shows that signal&apos;s PRI and PW.
            Hold <strong>Shift</strong> to add another box, or <strong>Ctrl</strong> (⌘ or Alt) to keep only the
            marked reports inside a box — box a signal on RF, then Ctrl-box its PRI line to leave out reports that
            don&apos;t belong. The bar above the charts says how many are marked and their RF, PRI and PW spans;{" "}
            <strong>Make a group</strong> takes them out of whatever rows they were in and makes them one row (one
            per PRI type if they&apos;re mixed), selects the new rows and scrolls the table to them. Click a chart
            to clear the marks. The charts follow the table filters, and the page remembers which tab you left open.
          </p>
          <p>
            To <strong>zoom in on time</strong>, use the strip above the Over time charts — it shows how many
            reports were heard at each moment of the whole recording. Drag across it to show just that stretch;
            drag the highlighted window to slide along, or click elsewhere to move it there. <strong>+</strong> and{" "}
            <strong>−</strong> zoom around the middle and <strong>Show all</strong> goes back to the whole
            recording. Zoomed in, each value axis fits the reports in the window, so a thin band spreads out, and
            each chart counts how many of its reports are in view. To <strong>zoom vertically</strong>, drag up or
            down along a chart&apos;s value axis (the numbers on its left): that chart shows just that range, and{" "}
            <strong>Reset RF zoom</strong> (or PRI, PW) in its header goes back. Each chart zooms on its own.
            Marking works the same while zoomed.
          </p>
          <p>
            The two ways of grouping work together. While reports are marked, the table flags every row holding
            some of them (&ldquo;Marked&rdquo;, or &ldquo;12 marked&rdquo; when only part of the row is), and{" "}
            <strong>Show their rows in the table</strong> (or Show &rarr; Rows with marked reports) lists just those.
            The other way round, rows you select in the table — after Auto group, a merge or a split — light up on
            the time charts and the scatter while nothing is marked, and the bar above the charts gives their RF, PRI
            and PW spans. The scatter&apos;s <strong>Outline</strong> setting also draws each group on the time
            charts, as a box covering the time it was heard and its range of values. Boxes are shaded lightly behind
            the points, so overlapping groups blend into one area; with more than 40 in view they lose their
            outlines too, which would only tangle. Point at a box to outline it and see how many reports it holds.
          </p>
          <p>
            <strong>Not covered by the Modes…</strong> (beside the filters, once an Emitter with Modes is chosen)
            opens a window listing everything the Modes don&apos;t cover, using the Match column&apos;s test. Under{" "}
            <strong>Reports</strong>, every report that falls outside every Mode of its PRI type, with why: off on
            RF, PRI (or frame time) or PW alone — naming the nearest Mode and its range — off on two or more, or no
            Mode of that PRI type at all. Click a reason to list only those; a line above the table gives the RF,
            PRI and PW they reach. Under <strong>Rows</strong>, the rows that don&apos;t match a Mode, and those that
            match on their means but hold reports outside. The window only lists:{" "}
            <strong>Select … in the table</strong> (or a report&apos;s row) closes it and selects those rows in the
            table, listing just them, to merge, split or exclude as you see fit. Choose whether excluded rows count
            at the top.
          </p>
          <p>
            The <strong>sliders</strong> set Auto group&apos;s gaps. As you move them, the line under them says how
            many groups and strays Auto group would make, the charts mark where each group would sit, and the scatter
            outlines each one as a dashed box — a preview only; your grouping changes when you press the button. Set
            the scatter&apos;s <strong>Outline</strong> to &ldquo;Groups as they are&rdquo; to see the current
            grouping as solid boxes instead.
          </p>
        </div>

        <div className="help-subsection" id="intercept-detail">
          <h3>Intercept detail</h3>
          <p>
            <strong>+ Add entry</strong> adds a reading; each entry's <strong>⋯</strong> menu edits or
            deletes it, and <strong>More ▾</strong> edits the Intercept's name, date and description.
            Editing an entry keeps its link to any Mode created from it. <strong>Delete Intercept</strong>{" "}
            (under More, or from the list) removes it along with all
            its entries and notes — any Mode already created from one of its entries is unaffected, it just
            loses that provenance link.
          </p>
          <p>
            <strong>Reports.</strong> For an imported Intercept, click an entry&apos;s report count to list the
            reports it was built from, or switch the card to <strong>Reports</strong> to list every report — or
            just those in no entry (left out at import, or their entry was deleted). Both tables sort by clicking a
            heading and page through large files.
          </p>
          <p>
            <strong>Regroup reports</strong> reopens the grouping tools — Auto group, merge, split, split at a
            value, the charts and Over time marking — on the kept reports, starting from the entries as they are
            (reports in no entry start out excluded). Nothing changes until you save, and you&apos;re shown what
            will: each new group keeps the id — and so the Mode links — of the entry it shares the most reports
            with, other groups become new entries, and an entry no group took is removed, its Mode links moving to
            the entry that took most of its reports. Entries typed in by hand aren&apos;t touched. If someone else
            changes the grouping while you work (a regroup, merge or delete), saving is refused rather than undoing
            theirs. Unfinished regrouping is kept in this browser and offered when you come back. Intercepts
            imported before reports were kept can&apos;t be regrouped — import the file again to keep them.
          </p>
          <p>
            The entries table sorts by any of its columns (RF by default), shows one line per entry — the full
            note, stagger list and which parameter a partial match is off on are in the tooltips — and filters by match result. Tick
            entries (or box them on the charts) to <strong>Merge into one</strong> or <strong>Delete</strong>{" "}
            them together. Merging keeps the first-created entry, so its Mode links stay, and the others&apos;
            links move to it: means are weighted by each entry&apos;s report count, the measured range becomes
            the widest of them, and times, report counts and tracks combine. Entries must share a PRI type (and a
            stagger its number of positions) to merge.
          </p>
          <p>
            The <strong>charts</strong> above the table show the entries the same way as the CSV import: on{" "}
            <strong>Scatter &amp; distributions</strong>, each entry at its means (its measured range as a faint
            box), with histograms of RF, PRI, frame time and PW split by whether they fall within a Mode; on{" "}
            <strong>Over time</strong>, each entry as a box from first to last heard over its measured range.
            Drag a box around points to select those entries (Shift adds, Ctrl keeps only those inside); drag
            across a histogram to filter the table to that range. Selected entries light up on every chart. The
            Over time charts zoom like the import&apos;s: in time from the strip above them, and vertically by
            dragging along a chart&apos;s value axis. <strong>Box each entry&apos;s min–max</strong> (on Scatter) and{" "}
            <strong>Box each entry&apos;s time and min–max</strong> (on Over time) are one setting: on, each entry
            is drawn as a faint box over the lowest to highest values its reports measured (and, over time, from
            first to last heard); off, as just a point — selected entries keep their box. It starts off above 300
            entries, where the boxes would hide the points.
          </p>
          <p>
            Every entry is <strong>matched</strong> against the Emitter's Modes of the same PRI type: it
            matches a Mode when its RF, PRI (frame time for a stagger) and PW means all fall inside that
            Mode's engineered range — the range the system recognises. A <strong>partial match</strong> is
            inside a Mode on two of the three and outside it on the third, and says which and by how much;{" "}
            <strong>No matching Mode</strong> means neither, and is the cue to create one. Jitter isn't
            compared. Click a Mode's name to open the Modes tab filtered to it.
          </p>
          <p>
            <strong>Create Mode from this entry</strong> (in the entry's ⋯ menu, once you're editing the
            Emitter) opens the normal Mode form already filled in with that entry's RF/PRI/PW values (you
            still pick the EW Group and Source, since an Intercept isn't tied to either) — the resulting
            Mode is listed under the entry's <strong>Modes created</strong> and carries an{" "}
            <span className="test-derived-badge">Intercept-Derived</span> badge back to it, the same idea as
            a Test-Derived Mode.
          </p>
          <p>
            <strong>Plan Modes…</strong> (in the bar above the entries — for the ticked ones, or all of them when none
            are) opens a planning page: the step between an Intercept and its Modes. Every entry the Modes don&apos;t
            cover yet gets a row, and you choose what to do with it:
          </p>
          <ul>
            <li>
              <strong>Widen</strong> a Mode it partly matches — only the one parameter that&apos;s off grows, just enough
              to take in the entry&apos;s range (a stagger&apos;s frame time by its ±). The Mode keeps its name, margins
              and everything else; the Mode that needs the least change is suggested first. Several entries widening
              the same Mode widen it once, to take them all in.
            </li>
            <li>
              <strong>New Mode</strong> — the entry&apos;s range with the ± margins you set on top. A stagger&apos;s frame
              time is one value, so its measured spread goes into its ±; a Fixed Mode&apos;s jitter range comes from
              the reports. CW Modes need a PW range, since a CW entry has none. To give one entry different margins,
              click <strong>± for this entry</strong> under its choice: any field you fill overrides the page&apos;s
              margin for that entry alone (left empty, it shows and uses the page&apos;s); <strong>Use the
              page&apos;s</strong> clears them.
            </li>
            <li>
              <strong>Skip</strong> — leave it uncovered.
            </li>
          </ul>
          <p>
            Each row shows what the result will cover — for a widening, the range before and after — and how many of
            the entry&apos;s reports fall inside. <strong>Range from</strong> takes each range from every report, or
            from the middle 98% (leaving out the extreme 1% each side, so a handful of stray reports don&apos;t
            stretch a Mode); the reports-inside column shows what that costs. New Modes go into the EW Group and
            Source you pick, named in the order listed (numbers already used are skipped), with the confirmation
            quality and quantity you set, as one generation batch that can be deleted together from the Modes tab.
            You can plan without editing the Emitter, but <strong>Apply</strong> needs you to be editing it: it asks
            once, with a summary, then makes every change together or none — into your unsaved changes, so Discard
            still undoes it. Every Mode made or widened is linked to its entries; its{" "}
            <span className="test-derived-badge">Intercept-Derived</span> badge names the Intercept. Matching is
            worked out afresh from the Emitter&apos;s Modes wherever it&apos;s shown, so once applied the entries
            read as matching straight away — and go back if the Modes are discarded or changed.
          </p>
        </div>
      </div>

      <div className="card" id="tasks">
        <h2>Tasks &amp; assignment</h2>
        <p>
          <strong>Assigning an Emitter.</strong> On an Emitter&apos;s page, <strong>Assigned to</strong> says who&apos;s
          responsible for it. Any editor can change it without editing the Emitter — it isn&apos;t part of the
          Emitter&apos;s saved versions. Only editors and admins can be given one. The Emitters list has an Assigned to
          column and filter, so &ldquo;Me&rdquo; shows yours.
        </p>
        <p>
          <strong>Tasks</strong> are to-dos. Make one for yourself, give one to someone else, or leave it{" "}
          <em>up for grabs</em> for whoever takes it. A task can have details and a due date, and a running log of{" "}
          <strong>notes</strong> — click <strong>💬</strong> on any task to read them or add one (progress, a
          question, what&apos;s left), each stamped with who wrote it and when. A task can be about an
          Emitter, Platform or MDF — use <strong>☑ Tasks</strong> on that page to see its tasks and add one already
          linked. The <strong>Tasks</strong> page (top bar; the number is how many are open for you) has views for
          Mine, Up for grabs, I gave out, Everyone and Done. Overdue tasks show red, ones due today amber.
        </p>
        <p className="hint-text">
          Editors can create, change and tick off any task; whoever a task is for can always tick it off. Deleting is
          for whoever made it, whoever it&apos;s for, or an admin. Everyone can see every task, and every change is in
          the Audit Log.
        </p>
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

      <div className="card" id="admin">
        <h2>Admin</h2>
        <p>
          Admins only. <strong>Users</strong>: create accounts, change roles, deactivate or reactivate.{" "}
          <strong>Edit locks</strong>: every Emitter being edited, with Force release for a stale hold.{" "}
          <strong>Recently Deleted</strong>: restore deleted Emitters, Platforms and MDFs, or delete them for good;
          anything left 30 days is removed each day. <strong>Backups</strong>: below.
        </p>
        <div className="help-subsection" id="admin-backups">
          <h3>Backups</h3>
          <p>
            Once a week (Sunday night, unless set otherwise) a backup of the whole database is taken by its own
            container, so it runs even if the app itself is down. Each one is then <strong>verified</strong>: restored
            into a scratch database and checked against what was backed up, so a backup that wouldn&apos;t restore is
            caught straight away rather than on the day it&apos;s needed. Old backups are thinned out to the newest 14,
            then one a week for 8 weeks and one a month for 6 months. If the server was off, a backup is taken as soon
            as it&apos;s back.
          </p>
          <p>
            <strong>In between, a backup is due sooner the more that changes.</strong> Every change to the data (each
            Audit Log entry that edits something — not sign-ins or downloads) counts. At 50 changes a backup is due a
            week after the last one; at 100, half a week; at 200, under two days — never sooner than 12 hours, never
            later than 4 weeks, and never if nothing has changed. The dashboard&apos;s <strong>Backup</strong> card shows
            this; when a backup is due, it turns amber and admins see a warning on every page, and at twice that
            it&apos;s overdue and turns red. <strong>Back up now</strong> clears it.
          </p>
          <p>
            <strong>Admin → Backups</strong> shows whether this is all working — the latest backup, its verification,
            when the next one runs, and whether a second copy is kept. When something is wrong (a backup due for the
            changes made, a failed verification, the scheduler not running) it says what, and admins see a warning at the top of
            every page until it&apos;s fixed. <strong>Back up now</strong> takes one straight away — worth doing before
            a big change. <strong>Verify</strong> checks any backup again. <strong>Database</strong> downloads a backup to
            your own computer, as a copy off the server — it holds the whole database, user accounts&apos; password
            hashes included, so keep it somewhere safe; each download is recorded in the Audit Log. The server can
            also save a second copy of every backup to another machine by itself (the README explains how).
          </p>
          <p>
            <strong>No time to restore?</strong> Every backup also carries a <strong>PRS export</strong> of the whole
            repository, taken at the same moment: every Emitter as XML, and every Platform and MDF as its own complete
            PRS package — the same files exporting each from the app would give, from its latest saved version
            (anything never saved is from its current state). Download it with <strong>PRS (XML)</strong> and use the
            MDF folders as they are; the README.txt inside lists what&apos;s there and from which version. On the
            server it sits next to the backup, as <code>emitterdb_&lt;date&gt;_prs.zip</code>.
          </p>
          <p>
            <strong>Compare</strong> gives an overview of what changed between two backups, or between a backup and
            the current data: which Emitters, Platforms and MDFs were added, removed or changed, and for each changed
            one a line per change — renamed, status, number of Modes, moved to or restored from Recently Deleted,
            saved version, and the versions a Platform or MDF pins. It&apos;s the quick way to see what a restore
            would bring back or lose; for the detail, use an item&apos;s own version history.
          </p>
          <p className="hint-text">
            Restoring a backup is done on the server&apos;s command line, not from this page, because it replaces all
            the current data. A backup of the current data is taken first, so restoring the wrong one can be undone.
            The README has the exact commands.
          </p>
        </div>
      </div>
        </div>
      </div>
    </div>
  );
}
