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
    children: [{ id: "intercept-detail", title: "Intercept detail" }],
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
            editing Emitters/Platforms/MDFs, Modes, EW Groups, Sources, Elements, logging tests, checking
            out and editing an Emitter, approving or rejecting imported Sources, and committing versions.
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
          min/max plus a Modes-passing count computed across its Modes — every column is
          sortable, and the toolbar above the table filters by name, designation, or any of those
          RF/PW/PRI/Scan ranges. <strong>+ Add Emitter</strong> opens a small form as an overlay rather
          than a full page; click a row to open that Emitter.
        </p>

        <div className="help-subsection" id="emitter-detail">
          <h3>Emitter detail</h3>
          <p>
            An Emitter's page has five tabs — <strong>Modes</strong>, <strong>EW Groups &amp; Sources</strong>,{" "}
            <strong>Intercepts</strong>, <strong>Test History</strong>, and <strong>Audit</strong> — plus
            links to its <strong>Version history</strong> and <strong>Ambiguity check</strong> above them.
            Below the title, a summary line repeats the same RF/PW/PRI/Scan ranges and Modes-passing count
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
              <span className="test-derived-badge">Test-Derived</span> badge; one derived from a logged{" "}
              <strong>Intercept</strong> entry instead carries an{" "}
              <span className="test-derived-badge">Intercept-Derived</span> badge. Either one is a link —
              click it to jump to the record that produced it.
            </p>
            <p>
              Every field — metadata (name, notes, EW Group) and the actual line values (RF/PW/PRI/deltas)
              alike — edits in place immediately, the same way everything else in the app works. The only
              gate is holding the Emitter's <strong>checkout</strong> (see below): with it, click{" "}
              <strong>Edit</strong> on a Mode's row to change its line right there.
            </p>
            <p>
              Tick a Mode's checkbox (or several) to reveal a <strong>Batch Edit</strong> button for
              applying the same field, delta, or range-shift change to all of them at once — muted until at
              least one Mode is selected. A <strong>Collapse generation batches</strong> toggle folds every
              Mode a single Cartesian Product run created into one expandable summary row, so a run that
              produced 20+ Modes doesn't clutter the table.
            </p>
          </div>

          <div className="help-subsection" id="emitter-testing-tab">
            <h4>Test History tab</h4>
            <p>
              Two parts: the <strong>SIM Test Lines</strong> this Emitter is checked against, and the list of
              logged <strong>test runs</strong>.
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
                runs are one of these two.
              </li>
              <li>
                A simulation run is a table with one row per SIM Test Line. Every line starts included and{" "}
                <span className="test-result-badge test-result-pass">correct</span>; change the outcome to{" "}
                <span className="test-result-badge test-result-partial">misclassified</span>,{" "}
                <span className="test-result-badge test-result-fail">missed</span> or{" "}
                <span className="test-result-badge test-result-inconclusive">inconclusive</span> where needed,
                flag every Mode the system reported under <strong>Intercepted as</strong> (as many as
                apply), and use <strong>+ Log</strong> to record the intercepted parameters (RF, PW, PRI —
                more than one set if it was measured more than once).
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
                is saved — its line can be pre-filled from any intercepted parameters you logged.
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
              where a parameter set came from — a datasheet, a lab measurement — and hold the RF/PW/PRI/Scan{" "}
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
              RF/PW/PRI/Scan (and how long to dwell there), shown as a small table per sequence with a
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
              Also here: <strong>Cartesian Product</strong>, which combines chosen RF/PW/PRI Elements (and
              individually-selected Parameter Sequence steps, each with its own optional delta override)
              into every possible Mode in one step, instead of typing each Mode's line by hand. Each of its
              RF/PW/PRI columns sorts independently.
            </p>
          </div>

          <div className="help-subsection" id="emitter-intercepts-tab">
            <h4>Intercepts tab</h4>
            <p>
              This Emitter's logged real-world signal intercepts — see <strong>Intercepts</strong> below for
              what an Intercept is and how it's built. <strong>+ Add Intercept</strong> here pre-fills the
              new Intercept's Emitter; click one to open its detail page.
            </p>
          </div>
        </div>

        <div className="help-subsection" id="emitter-versions">
          <h3>Editing lock, Commit, Discard, Revert & Fork</h3>
          <p>
            Editing an Emitter (or any of its EW Groups/Sources/Modes/Elements) requires holding its{" "}
            <strong>checkout</strong> first — a banner above the tabs shows whether it's free, held by you,
            or held by someone else, with a <strong>Start Editing</strong> button when it's free. This
            stops two people from editing the same Emitter at once; an Admin can force-release a stale
            lock. A brand-new Emitter is auto-checked-out to whoever created it.
          </p>
          <p>
            <strong>Commit Version</strong> takes an immutable snapshot of the Emitter's current state and
            requires a short message describing what changed. <strong>Discard changes</strong> (shown while
            you hold the checkout) throws away everything since the last commit, resetting live data back
            to it. The page also shows a diff between any two versions, called out field-by-field rather
            than as a raw JSON dump.
          </p>
          <p>
            <strong>Revert to this version</strong> resets live data to match an older committed version
            and immediately commits a new version documenting the revert — like <code>git revert</code>,
            history is never rewritten or deleted. <strong>Fork this version</strong> instead spins that
            version off into a brand-new, fully independent Emitter you can experiment on freely without
            touching the original.
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

      <div className="card" id="source-groups">
        <h2>Source Groups</h2>
        <p>
          A Source Group is a named, cross-Emitter bucket of Sources — useful for keeping related datasheets
          or lab-measurement Sources together regardless of which Emitter they end up feeding. The list
          shows each group's Source count, its aggregate RF/PW/PRI range across every Source in it, and when
          it was last touched. A Source is put into a group from the Source's own edit form.
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
          on that Emitter's own Intercepts tab. An Intercept is a <strong>container</strong> (name,
          description, and its own append-only Analyst notes feed) holding one or more logged{" "}
          <strong>entries</strong> — the actual observations, taken over time.
        </p>
        <p>
          Each entry records RF, PW, and PRI as an optional min, optional max, and a required mean.
          Pulse-train character depends on the entry's type: a <strong>Fixed</strong> entry gets a single
          flat jitter mean; a <strong>Stagger</strong> entry gets an ordered list of stagger values instead
          (and its PRI mean field is read as the stagger frame-time mean). Each entry also has its own
          short note, separate from the container's Analyst notes.
        </p>

        <div className="help-subsection" id="intercept-detail">
          <h3>Intercept detail</h3>
          <p>
            Edit the Intercept's name/description, add/delete entries, and add Analyst notes for the whole
            Intercept. <strong>Delete Intercept</strong> (here or from the list) removes it along with all
            its entries and notes — any Mode already created from one of its entries is unaffected, it just
            loses that provenance link.
          </p>
          <p>
            Each entry's <strong>Create Mode from this Entry</strong> button opens the normal Mode form
            pre-filled with that entry's RF/PW/PRI values (you still pick the EW Group and Source, since an
            Intercept isn't tied to either) — the resulting Mode carries an{" "}
            <span className="test-derived-badge">Intercept-Derived</span> badge back to it, the same idea as
            a Test-Derived Mode.
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
