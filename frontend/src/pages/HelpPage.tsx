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
      { id: "dwells", title: "Dwells" },
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
        <p>
          <strong>Search:</strong> <strong>⌕ Search</strong> in the menu bar, or <kbd>Ctrl K</kbd> (<kbd>⌘K</kbd> on a
          Mac) from any page, finds Emitters (by name or designation), Modes, Platforms, MDFs, Sources,
          Intercepts, Dwell Strategies and dwell files — every word you type has to match, in any order. ↑↓ moves, Enter opens, Esc closes. A Mode
          opens on its Emitter&apos;s Modes tab, a Source on the Groups &amp; Sources tab.
        </p>
        <p>
          <strong>Tables:</strong> drag the right edge of a column&apos;s heading to make it wider or narrower;
          double-click the edge to put it back. Widths are remembered in this browser for that table. A row&apos;s
          less common actions — Edit, Delete and the like — are under its <strong>⋯</strong> menu at the end
          of the row. Filters sit on one line above a list, with how many rows are shown; <strong>Reset</strong>{" "}
          appears while a filter is set.
        </p>
        <p>
          <strong>Menu:</strong> Dashboard, Emitters, Platforms, MDFs, Dwells and Intercepts (and Admin for admins).{" "}
          <strong>Source Groups</strong> is a tab on the Emitters page and <strong>Customers</strong> one on the MDFs
          page; <strong>Help</strong> is the <strong>?</strong> beside Search. <strong>Tasks</strong> and the{" "}
          <strong>Audit Log</strong> are in your name&apos;s menu (the number by your name is your open tasks), and
          your tasks are at the top of the Dashboard. A small <strong>?</strong> beside a title says what that page or panel is for.
        </p>
        <p>
          <strong>Analyst notes:</strong> on an Emitter, Platform, MDF or Intercept — and on their test pages (a new
          run, a run&apos;s report, a Platform test) — the <strong>Notes</strong> tab on the right edge of the window
          opens its notes in a panel that stays put while you scroll and work on the page.
          It stays open (or closed) as you move between pages. A note you&apos;ve written but not added yet is kept in
          this browser — closing the panel, leaving the page or a stray click doesn&apos;t lose it, and the tab shows
          ✎ until you add it. The same goes for notes on Sources and Tasks.
        </p>
        <p>
          <strong>Dates</strong> are written day.month.year (07.10.2026) with a 24-hour clock. Date fields take the
          same — 7.10.2026, 07.10.26, 7/10/2026 or 07102026 all work — or pick from the calendar button; times are
          hh:mm.
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
            out and editing an Emitter, and committing versions.
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
            partial, an Emitter in Testing never simulated, one changed since its last simulation), Needs rework,
            Intercepts with entries no Mode covers, unreviewed serious overlaps from the latest
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
          The Emitters list (top nav) shows every Emitter with its current status, and its RF, PRI and PW
          ranges across its Modes, the <strong>Platforms</strong> it&apos;s pinned on (each a link) — a <strong>min</strong> and a <strong>max</strong> column for each, each sortable, <strong>SIM correct</strong> — how many of its SIM Test Lines
          were correct in the latest run that included them, out of all of them (e.g. 4 / 5) — and{" "}
          <strong>Tasks</strong>: its open tasks (☑ 2; with none, the chip shows when you point at the row), which open
          its task list to read, tick off or add one. <strong>Columns ▾</strong> (or right-clicking the header) picks
          which columns show — Scan is off until you turn it on. Every column but Tasks is sortable. Above the table:
          a search on name or designation, a <strong>Platform</strong> search (part of a Platform&apos;s name, picked
          from a list as you type, or &ldquo;none&rdquo; for Emitters on no Platform), who it&apos;s assigned to, and <strong>RF / PRI / PW / Scan ▾</strong> for
          range filters. A row&apos;s <strong>⋯</strong> menu compares it with another Emitter or deletes it. <strong>+ Add Emitter</strong> opens a small form as an overlay rather
          than a full page; click a row to open that Emitter.
        </p>
        <p>
          <strong>Report</strong> (a tab beside Source Groups) downloads a spreadsheet with a line per Mode. Tick the
          Platforms and Emitters to include — an Emitter on a ticked Platform is already in, through it — then{" "}
          <strong>Download report (.xlsx)</strong>. It lists Platforms A–Z, each one&apos;s Emitters A–Z, each
          Emitter&apos;s Modes A–Z, then the Emitters picked on their own. A Platform&apos;s Emitters are the versions it
          pins; an Emitter picked on its own is its latest saved version. Values are as the PRS export writes them
          (deltas applied; scan period in ms).
        </p>
        <p>
          <strong>Analysis sheet (.xlsx)</strong>, beside it, is for working from rather than loading: the same Emitters,
          a line per Mode with its EW Group, Sources, confirmation and notes, and every value twice — as typed, with
          its delta beside it, and with the delta applied in <strong>shaded columns</strong> (RF, PW, PRI, frame time and
          scan). Further sheets list each Source (its details, the Modes citing it and its notes), each Source&apos;s
          Elements (as typed and with their delta) and the Emitters&apos; and Sources&apos; notes; a Key sheet explains
          the shading.
        </p>
        <p>
          On an Emitter&apos;s Modes, sorting by a column lists Modes with the same value by name (A–Z, &ldquo;Search
          2&rdquo; before &ldquo;Search 10&rdquo;), then by EW Group.
        </p>
        <p>
          <strong>Bulk actions</strong> (Editors and Admins): tick Emitters in the first column (the box in the heading
          ticks every one shown) and a bar appears above the table — <strong>Assign to</strong> someone (or nobody),{" "}
          <strong>Move status to</strong> (Operational and Needs rework ask for the usual note),{" "}
          <strong>Pin latest saved version into</strong> a Platform, or <strong>Release edit locks</strong> (your own;
          an Admin can release anyone&apos;s). Each Emitter goes through the same rules as doing it on its own page;
          any that can&apos;t are listed with the reason, and the rest are done. With exactly two ticked,{" "}
          <strong>Compare these two</strong> opens them side by side.
        </p>
        <p>
          <strong>Compare two Emitters</strong> (<strong>More ▾ → Compare with another Emitter</strong> on an Emitter):
          pick A and B and a saved version of each (the latest by default). It shows how many pairs of their Modes the
          ambiguity check would flag, both on the coverage charts with the overlaps hatched, the overlapping pairs worst
          first, and each Emitter&apos;s Modes side by side (if one has no Modes in the version picked, it says there&apos;s
          nothing to compare yet). The page&apos;s address keeps the choice, so you can share
          it.
        </p>

        <div className="help-subsection" id="emitter-detail">
          <h3>Emitter detail</h3>
          <p>
            An Emitter's page has five tabs — <strong>Modes</strong>, <strong>EW Groups &amp; Sources</strong>,{" "}
            <strong>Intercepts</strong>, <strong>Test History</strong>, and <strong>Audit</strong> — plus
            links to its <strong>Version history</strong> and <strong>Ambiguity check</strong> above them.
            Below the title, a summary line repeats the same RF/PRI/PW/Scan ranges shown on the list page,
            for this one Emitter, with its Modes and SIM results. On first load, a brand-new Emitter with no EW
            Groups or Sources yet opens straight to the EW Groups & Sources tab instead of Modes.
          </p>
          <p>
            Changing the status doesn&apos;t need <strong>Start editing</strong> — any Editor can, even while someone
            else is editing. The status is where the Emitter stands, not part of its content, so changing it
            doesn&apos;t save a version (the Audit Log keeps every move, and the next version you save records the
            status it had); anything being edited stays as it is, and discarding or reverting leaves the status
            alone. Versions saved only for a status change, before this, are folded away in the version history
            (<strong>Show them</strong> brings them back).{" "}
            Status moves <strong>In progress</strong> → <strong>Testing</strong> →{" "}
            <strong>Operational</strong> → <strong>Needs rework</strong> (and back to In progress from
            there to start fixing it). <strong>Partially operational</strong> (yellow) sits between Testing
            (orange) and Operational: part of the Emitter can be relied on, the rest is still being worked on —
            moving there asks which part. Moving from Operational or Partially operational to Needs rework
            requires a note explaining what's wrong — it's shown afterward via a bright{" "}
            <span
              className="rework-note-button"
              style={{ display: "inline-block", padding: "0.1rem 0.4rem", fontSize: "0.75rem", borderRadius: 6 }}
            >
              ⚠ View rework note
            </span>{" "}
            button next to the status badge, so the reason a previously-Operational Emitter needs rework
            is never buried in a commit message.
          </p>
          <p>
            <strong>Statuses and milestones are set up by Admins</strong> (Admin → Statuses &amp; milestones) — the
            names, colours and allowed moves above are the defaults, for Emitters and Platforms alike.{" "}
            <strong>◎ Milestones</strong> beside ☑ Tasks lists what to get done before each status (e.g. a manual
            dwell test before Partially operational): tick one off by hand, with a note if you like, or add one just
            for this Emitter. The count shows how many for the next status are met, and each Move to … button shows
            its own. Moving to a status with milestones not met asks you to confirm, and the version records which
            weren&apos;t.
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
                <strong>Last seen</strong> — the latest test run the Mode turned up in: reported under{" "}
                <em>Intercepted as</em> for a SIM line in a Simulation Test (with that line&apos;s outcome — reported
                for the wrong signal shows as partial), or rated in an Intercept Test. Click it to open the run;
                hover for how every run it was seen in went. &ldquo;never&rdquo; means no test has exercised it yet
              </li>
            </ul>
            <p>
              Every column header opens a small sort menu on click — ascending/descending, worded for
              that column's data (e.g. "smallest → largest" for a number, "oldest → newest" for a date) —
              plus a <strong>Clear sort</strong> option once a column is active. This same header works the
              same way on every table in the app, not just here.
            </p>
            <p>
              Sorts and filters are <strong>remembered for the session</strong>: sort a table or filter a list, and
              they&apos;re still set after a reload or after going to another page and back. They&apos;re kept per
              browser tab and forgotten when it closes; an Emitter&apos;s Modes and All Sources filters are kept for
              each Emitter.
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
              A Mode can come from <strong>more than one Source</strong> — e.g. the same signal in two reports.
              Pick them under <strong>Sources</strong> in the Mode form (<em>+ another Source…</em> adds one, ×
              takes one off); the Sources column lists them all, and the Source filter finds a Mode by any of
              them. <strong>Batch edit</strong> can add a Source to many Modes at once, or make one their only
              Source. A Source can be deleted unless it&rsquo;s some Mode&rsquo;s only Source; its other Modes just
              lose it. Merging duplicates from the ambiguity check keeps both Modes&rsquo; Sources.
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
              Under each row you see what it will match once its ± delta is added (&ldquo;Matches 2,999 – 3,001
              MHz&rdquo;), or, for a stagger, its steps and frame time. A mistake is pointed out under its row once
              you move on, in plain words, and the form won&apos;t save until it&apos;s fixed.{" "}
              <strong>Start from</strong> fills everything in from an existing Mode. <strong>Add &amp; next</strong>{" "}
              saves this one and starts the next with the same EW Group, Source, PRI type and deltas, and the next
              name. Confirmation, notes and &ldquo;test-derived&rdquo; are folded under{" "}
              <strong>More options</strong>, which says what they&apos;re set to.
            </p>
            <p>
              Every field — metadata (name, notes, EW Group) and the actual line values (RF/PRI/PW/deltas)
              alike — edits in place immediately, the same way everything else in the app works. The only
              gate is holding the Emitter's <strong>checkout</strong> (see below): with it,{" "}
              <strong>double-click a value in the Modes table</strong> to change just that one in its cell — the name,
              RF, PRI and PW min/max and ± deltas, a fixed PRI&apos;s jitter (&ldquo;0–1&rdquo;), a stagger&apos;s steps
              (in the PRI cell, &ldquo;800, 850, 900&rdquo;) and its frame-time delta (PRI Δ), and the confirmation
              quality and quantity. <strong>Enter</strong> or clicking away saves, <strong>Tab</strong> saves and
              moves to the row&apos;s next value, <strong>Esc</strong> puts it back; a value the Mode form wouldn&apos;t
              take (a max below its min, say) stays open with what&apos;s wrong under it. The box holds the programmed
              value even while the table shows values with their delta. For everything at once — Sources, PRI type,
              notes — <strong>Edit</strong> (in a Mode&apos;s <strong>⋯</strong> menu) opens the full form in a dialog
              centred in the window (Save always in view); the cursor starts in the name. <strong>Duplicate</strong>{" "}
              opens the same way. A name can't be blank or one another Mode in the same EW Group already has. <strong>Rename…</strong> in the same menu just renames it — and EW Groups and Sources have <strong>Rename…</strong> in their ⋯ menus too (a name another EW Group or Source of the Emitter has is refused). Every rename is in the Audit Log as &ldquo;Renamed … &lsquo;old&rsquo; to &lsquo;new&rsquo;&rdquo;.
            </p>
            <p>
              The Mode form lists RF, then PRI, then PW. Each delta starts at <strong>0</strong> — type a
              tolerance only where the Source gives one. A Stagger Mode&rsquo;s <strong>frame time</strong>{" "}
              follows the sum of its sequence until you type your own value; <strong>Use sum</strong> goes
              back to the sum. Every Mode also carries a <strong>Confirmation quality</strong> (0–100, default
              100) and <strong>Confirmation quantity</strong> (default 2); both go into the PRS export and
              can be changed per Mode or with Batch edit.
            </p>
            <p>
              Tick a Mode's checkbox (or several) to reveal a <strong>Batch edit</strong> button for
              applying the same field, delta, jitter (Fixed Modes only) or range-shift change to all of them at
              once — muted until at least one Mode is selected. <strong>+ Add a value…</strong> adds one RF, PRI or PW value — a
              stray PRI from a test, say — to every combination of the other two among your Modes: tick the
              combinations it applies to and it makes one new Mode for each, a copy with only that value changed, as
              one batch — named with a name of your own and a running number (&ldquo;Range day 1&rdquo;, the default
              from a test) or after the Mode each copies plus a suffix. It&apos;s also offered, already filled in, from a test run&apos;s logged intercepts that no Mode
              matches and from Element coverage&apos;s uncovered Elements. <strong>Delete (N)</strong> beside it deletes every ticked Mode at once,
              after asking (all or none; each is kept in the Audit Log, logged test results keep their names, and
              Discard brings them back until you save). A <strong>Collapse generation batches</strong> toggle folds every
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
              <strong>Layout → Grouped by value</strong> keeps many Modes compact when they are combinations of a few
              ranges (say 4 RF × 4 PRI × 4 PW = 64 Modes). <strong>Distinct ranges</strong> draws each RF, PRI and PW
              range once, labelled with its values and how many Modes have it, the bar split by their last test results;
              point at one to see its Modes. <strong>Combinations</strong> crosses two parameters (pick RF × PRI, RF × PW
              or PRI × PW): each cell holds a square per Mode with that pair — coloured by its last result, the third
              parameter on hover, click to open it — and a hatched cell is a combination no Mode has. With more than 24
              Modes the charts start grouped; <strong>One row per Mode</strong> brings back the ladders, and the choice
              is remembered.
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
              run as a column of its line outcomes (correct, partial, missed, inconclusive), oldest to newest,
              topped by the SIM Test Lines it <em>didn&apos;t</em> include (<strong>Not in this run</strong>, dashed) so
              every column is all of the Emitter&apos;s lines — switch that off with <strong>Lines not in the run</strong>,
              and <strong>Counts</strong> writes the numbers on the bars. Each column is labelled with the run&apos;s date
              and time (runs logged before times were kept show the time they were logged, in italics); hover for the
              Emitter version it was run against — click a column to open the run. A new run takes its time from the{" "}
              <strong>Time</strong> field next to its date (filled with the current time).
            </p>
            <ul>
              <li>
                <strong>SIM Test Lines</strong> are imported by pasting rows from a spreadsheet, together with
                the (required) date the lines were created in the simulator. Each line shows a{" "}
                <strong>Status</strong> — its outcome in the most recent run that included it, linking to that
                run — and the date it was <strong>last tested</strong>, with its expected Mode and reference
                detail. Click the heading to collapse the table; the choice is remembered.{" "}
                <strong>Edit</strong> changes one line: its label, expected Mode, detail (one{" "}
                <em>name: value</em> per row) and created date. When the simulator&apos;s table is revised,{" "}
                <strong>⟳ Update from a revised table</strong> takes the new table: each row is matched to a line
                already here by its label (ignoring case and extra spaces), so a matched line keeps its test history
                and takes the row&apos;s detail (unless the row has only a label), the new created date and batch
                label; rows with no match are added, and the lines follow the table&apos;s order. Lines not in the
                table are kept unless you tick to delete them. <strong>Preview changes</strong> shows what it will
                do before anything is changed. Deleting a line also deletes its results in logged runs.
              </li>
              <li>
                <strong>Out of date</strong>: once a Mode a line&apos;s latest result involved is deleted (a Mode it
                was intercepted as, or the Mode it was expected to be) — say every Mode replaced by a PRS import —
                that result no longer counts as correct or missed until the SIM test is run again; the summary, the
                Emitters list and the Dashboard say so. Bringing the Modes back (discard or revert) makes it count
                again. <strong>Re-link expected Modes by name…</strong> points lines that lost their expected Mode at
                the Mode of the same name now, ready for the next run.
              </li>
              <li>
                <strong>+ Add test run</strong> opens a separate page. Pick the type:{" "}
                <strong>simulation</strong> (checked against the SIM Test Lines) or{" "}
                <strong>intercept</strong> (a real-world intercept, checked against the Emitter&rsquo;s own
                Modes). Older lab-bench, live-range and field-exercise records stay in the history, but new
                runs are one of these two. Set the run&rsquo;s <strong>Dwell</strong> next to its dates: leave it on
                Manual, or pick Value and write one in (e.g. 50 ms); it applies to the whole run. Beside it,{" "}
                <strong>Received Power (dBFS)</strong> — how strong the signals were received over the run — is
                required (marked *): a run isn&apos;t logged without it. It shows on the run&apos;s page and as a column in
                Test History.
              </li>
              <li>
                A run is <strong>saved as you fill it in</strong> — the line under the title says when it last was —
                so a reload or a closed tab loses nothing. It&apos;s first saved once something is typed or picked — opening
                the page and leaving again leaves nothing behind. Leave it half done and it waits under{" "}
                <strong>In progress</strong> on Test History, where anyone who can log tests can{" "}
                <strong>Continue</strong> it or <strong>Discard</strong> it. Nothing counts — results, SIM line status,
                the dashboard — until it&apos;s logged with <strong>Log test run</strong>. If two people save the same run,
                the second is told to reload rather than overwrite the first.
              </li>
              <li>
                A Simulation Test is a table with one row per SIM Test Line. Every line starts included and{" "}
                <span className="test-result-badge test-result-pass">Correct</span>; change the outcome to{" "}
                <span className="test-result-badge test-result-partial">Partial</span>,{" "}
                <span className="test-result-badge test-result-fail">Missed</span> or{" "}
                <span className="test-result-badge test-result-inconclusive">Inconclusive</span> where needed,
                flag what the system reported under <strong>Intercepted as</strong> —{" "}
                <strong>Default Unknown</strong> (listed first) when it reported no Mode, or the Modes it did; type to search
                the Emitter&rsquo;s Modes — every word you type is matched anywhere in the name, so &ldquo;scan 6&rdquo; finds
                scan_fixed_6 — and click (or press Enter) to add as many as apply; the list stays
                open between picks, and <strong>+ Add all N matches</strong> adds everything the search
                found — and use <strong>+ Log</strong> to record the intercepted parameters as means — RF mean, PRI mean and jitter mean (Fixed), PW
                mean; a Stagger set takes its steps and the measured <strong>frame time</strong> instead. Jitter and the
                stagger steps are typed in <strong>ns</strong>, as the test format logs them, and turned into µs at
                once — they&apos;re kept, matched against the Modes and shown in µs, so a Mode or an Element made from
                them gets µs (1250 ns → 1.25 µs). They&apos;re typed into one table, a numbered line per intercept and a column per parameter; ✕ removes a line.{" "}
                <strong>+ Log</strong> opens the fields with the cursor already in RF mean, so you can type a value and
                Tab to the next. <strong>+ Add another intercept</strong> adds a line for each further intercept; once you
                click Done they show as a small table in the cell. Notes grow as you write.
              </li>
              <li>
                An Intercept Test is a table with one row per Mode: tick the Modes that were intercepted, then
                give each a result, intercepted parameters and notes. Below it, <strong>Signals not tied to a
                Mode</strong> logs anything else intercepted (<em>+ Add signal</em>): its parameters, whether it was
                reported as Default Unknown or not at all, and notes. Each says whether a Mode already covers it or
                it&apos;s <em>New</em>; signals don&apos;t count towards the result. On the logged run&apos;s page,{" "}
                <strong>Add to Source…</strong> puts a signal into one of the Emitter&apos;s intercept Sources (or a
                new one, type Intercept) as one Sequence or as an Element per parameter, all with the variant
                Intercept.
              </li>
              <li>
                The run&rsquo;s overall result is <strong>worked out</strong> from the included rows (worst one wins),
                or set by hand when nothing is included. To make a different call, pick it under{" "}
                <strong>Override</strong> and say why (required). A logged run&rsquo;s result can also be changed on its
                page under <strong>More ▾ → Change the result…</strong> (Editors) — picking the worked-out one again removes the
                override. An overridden result shows ✎, with the worked-out result and the reason beside it, and each
                change is in the audit log.
              </li>
              <li>
                <strong>+ Stage a new Mode</strong> creates a Mode found during the run, linked as{" "}
                <span className="test-result-badge test-result-derived">Derived</span> from it once the run
                is saved — its line can be pre-filled from any intercepted parameters you logged. The same
                pre-fill is on <strong>+ From this test → New Mode…</strong> once the run is saved: pick which
                logged set to use (each is listed by line, set number and values), and a mean fills both min
                and max.
              </li>
              <li>
                Each run has its own page with the full per-line and per-Mode detail. Its actions sit top right:{" "}
                <strong>+ From this test ▾</strong>, <strong>Redo test</strong> on a failed or partial run (a new run
                pre-filled as a retest of it), and <strong>More ▾</strong> to change the result or delete the run.
              </li>
              <li>
                <strong>Against the Modes now</strong>, a tab beside <strong>Results</strong> on the run&apos;s page
                (shown once something was logged), takes every set of parameters logged in the run — on SIM lines,
                Mode results and signals — and matches it against the Emitter&apos;s Modes as they are now, the way an
                Intercept&apos;s entries are matched, and more strictly: a fixed PRI&apos;s logged jitter must be inside
                the Mode&apos;s jitter range, and a stagger is matched by the Mode&apos;s PRI range matching: on — by its
                frame time alone (± the frame-time delta); off — by its steps, as many as the Mode&apos;s and in the
                same order (starting at any step, each within the frame-time delta, at least 0.1%). Each row is{" "}
                <strong>✓ would match</strong> (which Modes),{" "}
                <strong>≈ near</strong> (one value off, and which — with <strong>Edit ‹Mode›…</strong> while you&apos;re
                editing the Emitter: the Mode opens widened to cover what was logged, and saving records it as derived
                from this run), <strong>✕ no Mode</strong>, or can&apos;t compare
                (no RF or PRI logged). Beside it is what the system reported in the test; rows where it differs (the Modes it
                would match now aren&apos;t the ones reported) are marked <strong>Changed since test</strong> (tick to see
                only those), and a SIM line says whether its expected Mode
                matches now. The bar on top shows the split at a glance. <strong>Chart</strong> puts every logged set on
                two parameters you pick (RF × PRI to start) over the Modes&apos; ranges: ● would match, ▲ near (dashed to
                the Mode it&apos;s close to), ✕ no Mode, a dashed ring where it&apos;s changed since test. Hover a
                point for why; click it to pick out its row in the table. Its view options: <strong>Each parameter</strong>{" "}
                (RF, PRI and PW each on a strip, to see which one a set misses on), a <strong>logarithmic</strong> scale,
                the Modes&apos; ranges with their delta or as typed, fitting to the logged values only, and Mode names on
                or off — remembered in this browser.
              </li>
              <li>
                <strong>+ From this test → Elements to a Source…</strong> turns the run&apos;s logged values into
                Elements: each logged RF, PRI (a range with its jitter, or a stagger&apos;s steps) and PW is listed once —
                the same value logged on several lines is one — ticked to start with. Pick the variant (intercept to
                start with), an optional ± delta per parameter, and where they go: one of the Emitter&apos;s Sources, or a
                <strong> new Source</strong> named after the run and dated when it was intercepted or simulated. They&apos;re
                named with a name of your own and a running number (the run&apos;s title to start with) or after the
                lines they were logged on, and noted as coming from the run. A line logged with several intercepts can
                also be kept as a <strong>sequence</strong>, a step per intercept in order. <strong>Make Elements…</strong>{" "}
                on a row of <strong>Against the Modes now</strong> opens the same with only that intercept ticked.
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
            <p>
              <strong>What changed</strong> narrows it to one kind — its Modes, say, with how many entries each kind has.
              Narrowed, the Emitter&apos;s version saves stay in as dividers (&ldquo;Saved v2 — range day 3
              findings&rdquo;), and reverts and discards as amber ones, so each change sits under the version it went
              into. Under each change, one line says what changed (&ldquo;RF 9400–9500 → 9380–9520 MHz, jitter max 1 →
              3 µs&rdquo;); <strong>Details</strong> has every field. A revert or a discard logs each Mode, EW Group,
              Source and SIM Test Line it brought back, removed or changed back (&ldquo;Brought back Mode
              &lsquo;Search 2&rsquo; — reverting to version 2&rdquo;), and per Source how many Elements and sequences.
              A Mode made by adding a value says which Mode it copies and what it adds.
            </p>
          </div>

          <div className="help-subsection" id="emitter-sources">
            <h4>EW Groups & Sources tab</h4>
            <p>
              <strong>EW Groups</strong> are the operational buckets (scan range + threat priority) Modes
              are organized under. While an Emitter has none and its Sources have scan Elements, a{" "}
              <strong>Suggested</strong> scan range shows under the empty EW Groups card — the shortest to the longest
              scan time among them — and <strong>Use it for a new EW Group</strong> opens the form with it filled in.{" "}
              <strong>Sources</strong> record
              where a parameter set came from — a datasheet, a lab measurement — and hold the RF/PRI/PW/Scan{" "}
              <strong>Elements</strong> you build Modes from (min/max, optional jitter and a tolerance{" "}
              <strong>delta</strong>, or a stagger sequence for PRI).
            </p>
            <p>
              A Source&apos;s <strong>Generation log</strong> tab lists every run of <em>Generate Modes</em> on it,
              newest first: when and by whom, into which EW Group and with which name prefix and note, the Elements or
              Sequence steps combined (values, variant, the delta used — &ldquo;this run&rdquo; when it was changed
              just for the run), range matching, and the Modes it made (and how many are still there; the entry stays
              after they&apos;re deleted).
            </p>
            <p>
              Below the Sources, <strong>All Sources</strong> is every Element of the Emitter&apos;s Sources in one list:
              the same values in several Sources are one Element. Each shows its delta, variants and Sources — two by
              name and <strong>+N</strong> for the rest (hover for all, click to list them). Search it (values, Source
              names, labels), give a <strong>from – to</strong> value range, or filter by type, Source, variant, or to
              Elements in more than one Source. While editing, tick Elements and <strong>Generate Modes</strong> from
              them, as on a Source: each Mode gets the Sources its own RF, PRI and PW were found in, the one holding most
              of them as its main Source. A blank delta uses the widest any of an Element&apos;s Sources gives. Sequence
              steps are picked on their own Source. <strong>Clean up…</strong> deletes what an import shouldn&apos;t have
              brought in: search Element names (labels, e.g. &ldquo;scan rate&rdquo;) and/or an exact value (a PRI of 0),
              tick the names it lists, and every Element under them goes from every Source at once.
            </p>
            <p>
              <strong>Element coverage</strong>, under All Sources, shows which of those Elements the Modes cover:
              <strong> ✓ covered</strong>, <strong>½ partly</strong> (a range running past the Modes, or some of a
              stagger&apos;s steps) or <strong>✕ not covered</strong> — an RF, PRI or PW inside a Mode&apos;s range with
              its delta, a PRI used as a Stagger Mode&apos;s step, a scan inside an EW Group&apos;s scan range. A
              stagger — a stagger Element, or a Source&apos;s sequence with PRI steps (in step order, a range at its
              middle) — is checked against the Stagger Modes <em>in order</em>: covered by one with the same steps in the
              same order (from any step), a sequence&apos;s RF and PW fitting that Mode too; the same steps in another
              order, or only some, is partly covered, and the note says which. A sequence without PRI has each
              step&apos;s RF and PW checked. Tick under <strong>Include</strong> which parameters count. Each has a
              chart — the Modes&apos; ranges above, the Elements below; hover either to see what covers what — and the
              Elements not wholly covered are listed under it, with their Sources.
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
              <strong>Batch add</strong> adds Elements (or a Sequence) to several Sources at once. Tick the Sources
              in the dialog — the ones selected in the table start ticked; <strong>All</strong> ticks every one. Pick
              the type and variant, then type the <strong>values</strong>: each becomes its own Element, a single value
              (9000) or a range (9100-9200), separated by commas, spaces or new lines — so
              &ldquo;9000, 9100-9200, 9300&rdquo; to three Sources adds nine Elements. Below the box it says what
              will be added; an entry that isn&apos;t a number is pointed out first. A delta, label, jitter (PRI) and
              notes apply to each. It&apos;s all or nothing: if anything is refused, nothing is added.
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
            <p className="hint-text">
              <strong>PRI type</strong> (Fixed by default) beside the PRI column: <strong>Stagger</strong> makes one
              stagger train from the ticked PRIs, crossed with every RF × PW. Their Delta column becomes{" "}
              <strong>Firing order</strong> — each PRI&rsquo;s place in the train (<em>1, 3</em> fires it twice); a
              range fires at its mean. Or tick Sequence steps instead: they fire in their step order, so there&rsquo;s
              nothing to type twice.
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
            others, or several at once (<strong>Select the untouched ones</strong>, <strong>Release selected</strong>). A
            lock whose holder hasn&apos;t changed anything for 3 days is marked <strong>untouched</strong>, and after 14
            days without a change it&apos;s released on its own — nothing unsaved is lost, it just stops being yours
            to save (an Admin can change both numbers).
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
            <strong>Revert to vN…</strong> first shows what it would do — each Mode, Source, EW Group and SIM
            line it removes, brings back or changes, any unsaved changes it would throw away, and how many logged test
            results name what it removes — then, if you go ahead, resets live data to match that saved version
            and immediately commits a new version documenting the revert — like <code>git revert</code>,
            history is never rewritten or deleted. Logged test results are kept whatever a revert removes: a Mode or
            SIM Test Line that&apos;s gone shows as <em>(deleted)</em> on the run, and reverting back to a version
            that has it links its results again. Nothing else is lost either: a Source&apos;s notes, sequences and
            generation log, and an Intercept&apos;s link to the Mode made from it, all come back with it. <strong>Fork this version</strong> instead spins that
            version off into a brand-new, fully independent Emitter you can experiment on freely without
            touching the original.
          </p>
        </div>

        <div className="help-subsection" id="emitter-ambiguity">
          <h3>Ambiguity check</h3>
          <p>
            Compares every pair of Modes and flags the ones a receiver could confuse. It reads the latest{" "}
            <strong>saved</strong> version — never unsaved edits — so results match what was released. The same check runs
            for a Platform or an MDF, where it asks which <em>Emitters</em> could be taken for each other — see
            Platforms below.
          </p>
          <p>
            <strong>How it decides.</strong> Only Modes of the <strong>same PRI type</strong> are compared — a different
            type tells them apart. Each Mode&apos;s RF, PRI and PW ranges are widened by their ± deltas — the ranges the
            sensor matches with. Two <strong>Fixed</strong> Modes are compared on PRI and on <strong>jitter</strong>, each
            as a range (a jitter of 0–0 is a steady PRI, so it only overlaps jitter ranges that include 0). A{" "}
            <strong>Stagger</strong> with <strong>range matching</strong> on is compared on its <strong>frame time</strong>{" "}
            (± frame delta); if only one of two Staggers has range matching on, they&apos;re told apart; without range
            matching, Staggers overlap on the share of their steps that are identical. CW and X-let have no PRI, so
            they&apos;re compared on RF and PW only. For each parameter, the overlap is how much of the <em>narrower</em>{" "}
            of the two ranges the other covers, so a narrow Mode inside a wide one is 100%. A pair is a finding only if it
            overlaps on <em>every</em> parameter compared — one clear gap tells them apart. Its severity comes
            from the parameter that overlaps <em>least</em>: <strong>Exact</strong> when every parameter overlaps at least
            99%, <strong>High</strong> when the least is 70% or more, <strong>Medium</strong> between 30% and 70%,{" "}
            <strong>Low</strong> under 30%. <strong>Run the check</strong> (or <strong>Run again</strong>) is at the
            top right, with those numbers in the <strong>Thresholds</strong> chip next to it — Editors click it to change
            them before running. This explanation is behind <strong>How it decides</strong>. Checks made under older rules say so — run them again.
          </p>
          <p>
            <strong>The page.</strong> The findings are listed on the left — open ones first, worst first — with each
            parameter&apos;s overlap and the one that set the severity in bold; the views are tabs, and below them one
            row filters by status and severity (only those with findings), Mode, EW Group and Source. Arrow keys move
            through the list. The selected finding is on the right: both Modes&apos; ranges
            drawn to scale with the overlap shaded. <strong>Modes involved</strong> lists the Modes in the most findings —
            changing one of those often clears many. <strong>Matrix</strong> shows every pair at once; click a cell to open
            it.
          </p>
          <p>
            <strong>Handling a finding.</strong> <strong>Open A / Open B</strong> takes you to either Mode in its Emitter
            to change it. <strong>Merge</strong> is for two Modes that are really the same: pick the one to keep, see what
            changes — its values become the union of both (jitter too), keeping its own ± deltas, never the
            other&apos;s; the other is deleted, and its test
            history and intercept links move to the kept Mode — including any new overlap the wider ranges would cause
            with other Modes. It changes the Emitter&apos;s unsaved edits, so the Emitter must be checked out by you (the
            dialog can do that); save a version and run the check again to see the result. Findings that involved the
            deleted Mode are marked until then. <strong>Acknowledge</strong> marks a finding as known and acceptable, with
            an optional reason; it carries over to later checks while the pair&apos;s overlap doesn&apos;t change.
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
          <p>
            <strong>Documentation as background</strong> (only if Outline is set up): the sections of the team&apos;s
            Outline documentation that match the question — the PRI types involved, range matching, the parameters, the
            Modes&apos; notes — go to the model with it, numbered. Where the answer relies on one it cites it, like{" "}
            <span className="ai-cite">S2</span>; click it to open that heading in Outline. Under the draft,{" "}
            <strong>Documentation cited</strong> lists what it cited, and <strong>Also given, not cited</strong> the
            rest of what it was given. A citation of a section it wasn&apos;t given is flagged. The app keeps a copy of
            the documentation, refreshed when it&apos;s more than an hour old; the line at the top of the AI overview
            says how fresh it is, and an Admin can press <strong>Sync now</strong> under Admin → Settings → AI
            documentation after changing pages in Outline. There, <strong>What lives where</strong> says what each
            page holds — documentation, a test result, analysis, or left out (sub-pages follow their page). The AI is
            told which each section is: it reports a test result as that one test&apos;s finding, not as how the sensor
            always behaves, and cited sections show <em>test result</em> or <em>analysis</em> beside them.
          </p>
          <p>
            The <strong>AI overview</strong> of a check is a one- or two-sentence verdict, then a table of the
            findings to look at first — the pair and severity as the check found them, the model&apos;s reason and a
            suggested action. Click a row to open that finding.
          </p>
          <p>
            <strong>AI chat</strong>: the <strong>✦ Ask AI</strong> button in the bottom-right corner of every page
            opens a chat with the model. Before answering it can look things up — read-only — in the library: search
            by name or designation (and in descriptions and notes), lists of Emitters by status or Platform, an
            Emitter&apos;s Modes and Sources, its SIM Test Lines and test runs, a Platform&apos;s Emitters, an MDF and
            its readiness, the Modes a signal (or an RF band) would match, an Emitter&apos;s latest ambiguity check, an
            Intercept — and in the documentation. Under each answer, the lookups it made and the documentation it cited;
            numbers that weren&apos;t in anything it looked up are flagged. It knows which page you&apos;re on, so
            &ldquo;this Emitter&rdquo; works. It remembers what it looked up for its last few answers, so follow-ups like
            &ldquo;and its PW?&rdquo; or &ldquo;what about the other one?&rdquo; work — &ldquo;used N earlier
            lookups&rdquo; under an answer says so. Names of things it looked up — Emitters, Modes, Sources, Platforms,
            MDFs, Intercepts — are links in the answer that open their page (a name that could mean two things isn&apos;t
            linked). It can&apos;t change anything, and it never sees accounts or the
            audit log.
          </p>
          <p>
            Your chats are kept (only you see them) in the list beside the conversation — <strong>☰</strong> shows or
            hides it. Click one to read it again and carry on; <strong>+ New chat</strong> starts another; hover one for{" "}
            <strong>✎</strong> to rename it or <strong>🗑</strong> to delete it. Drag the window&apos;s top-left corner
            to resize it, <strong>⤢</strong> maximises it, and <strong>A− / A+</strong> change its text size — all
            remembered in this browser.
          </p>
          <p>
            Ask it to <strong>write Modes</strong> and it proposes them under its answer as a preview — where each would
            go, its values and deltas, and why any can&apos;t be added. It never adds anything itself: tick the ones you
            want and press <strong>Add N Modes</strong> (editors, into an Emitter you&apos;re editing). Ask it to{" "}
            <strong>change Modes</strong> and it proposes the edits the same way — each value before → after and why —
            and changes nothing until you tick them and press <strong>Apply N edits</strong>; an edit is refused if the
            Mode was changed since it was proposed. Proposing and applying Modes or edits is for editors and admins
            only. <strong>📎</strong>,
            pasting or dropping attaches images to a question. The bar in the header shows how much of the model&apos;s
            context the chat takes of its maximum (an admin sets it under <strong>⚙</strong> or Admin → Settings);
            <strong> Compact</strong> summarises the chat so far to free it, and it compacts on its own when nearly full.
          </p>
          <p>
            <strong>Settings</strong> (your name, top right → Settings…) lets you switch off the AI chat, telling it
            which page you&apos;re on, or the AI drafts on the ambiguity page — for you only, wherever you sign in.
          </p>
        </div>
      </div>

      <div className="card" id="platforms">
        <h2>Platforms</h2>
        <p>
          The Platforms list (top nav) shows every Platform — a Platform bundles the Emitters carried by a
          given vehicle or site. A Platform has no status of its own; it's purely a container, ready to be
          pinned into an MDF whenever the Emitters inside it are. The list shows how many Emitters each pins, the
          worst status among them (hover for the count of each), outdated pins, the Modes pinned, how many MDFs
          it&apos;s in, what its latest ambiguity check found, when it was last saved, and its open Tasks.
        </p>

        <div className="help-subsection" id="platform-detail">
          <h3>Platform detail</h3>
          <p>
            Laid out like an Emitter: <strong>Save version</strong>, <strong>Ambiguity check</strong>,{" "}
            <strong>Export XML</strong> and <strong>More ▾</strong> (Version history, Edit details) along the top,
            with when it was last saved under the name. <strong>+ Pin Emitters</strong> opens a list of every Emitter
            (designation first, with a search box): tick any number and they&apos;re pinned at their latest saved
            version in one go — ones already pinned, or never saved, are shown but can&apos;t be ticked. Each pin
            references one saved Emitter version; change it with the version picker in its row (<strong>view</strong>{" "}
            opens it), and <strong>Unpin</strong> asks first. A pin whose Emitter
            has been saved again since is flagged <strong>Outdated — vN saved</strong>, with <strong>Repin to vN</strong>{" "}
            beside it; the header counts outdated pins, and <strong>Repin all to their latest version</strong> moves
            them all at once. A Platform has no
            editing session: pins and details apply straight away, and <strong>Save version</strong> records them
            as a new version (the summary is optional).
          </p>
          <p>
            <strong>Charts</strong> shows what the pinned Emitter versions cover on RF, PRI (frame time for a
            stagger) and PW, one chart each. <strong>Per Emitter</strong> draws one line per Emitter: its
            Modes&apos; ranges joined only where they overlap, so a PRI of 1–2 µs in one Mode and 200–205 µs in
            another stays two pieces with a gap between. <strong>Per Mode</strong> draws a line for each Mode under
            its Emitter. Engineered values (with deltas) are shown unless unticked, and a log scale helps when
            values span orders of magnitude. <strong>Horizontal / Vertical bars</strong> turns the charts on their
            side and <strong>Stacked / Side by side</strong> places RF, PRI and PW under or next to each other. Drag a
            chart to pan it, hold Ctrl (⌘ on a Mac) and scroll to zoom, and double-click or <strong>Show all</strong>{" "}
            to see everything again. <strong>Ambiguities</strong> hatches in red where Modes of different Emitters
            overlap, from the latest ambiguity check — hover a mark to see which. <strong>Ambiguity check</strong>{" "}
            runs on the latest saved Platform version.{" "}
            <strong>Tests</strong> holds <strong>Platform tests</strong> — every pinned Emitter tested in one run.{" "}
            <strong>+ Add Platform test</strong> opens a page with the run&apos;s details and a row per pinned Emitter: a{" "}
            <strong>result</strong> and <strong>notes</strong> (untick <strong>In this run</strong> to leave one out). In a
            Simulation Test each Emitter also has its own <strong>Simulation created</strong> date, filled in from the
            newest of its SIM Test Lines&apos; created dates (change it if that&apos;s wrong; one with no lines needs it
            typed).
            Results start blank — every Emitter in the run needs one picked before it can be logged. It&apos;s saved as you fill it in and can be continued from the Tests tab. Logging it writes a test record
            for each Emitter in the run, against the version the Platform pins, so each also shows in that
            Emitter&apos;s Test History, linked back to the Platform test. Each Platform test has its own page — an Emitter&apos;s name there opens its own record — <strong>Redo test</strong> starts a retest
            of the same Emitters, and the <strong>Trend</strong> grid shows each Emitter&apos;s result across the latest
            runs.{" "}
            <strong>Analyst notes</strong> is the same append-only log as on an Emitter, in the Notes panel.
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
            Answers <em>which Emitters on this Platform could be taken for each other</em>: each pinned
            Emitter&apos;s Modes are compared with the other Emitters&apos; Modes, never with its own (run the
            Emitter&apos;s own check for that). It opens on <strong>Emitters</strong> — each ambiguous Emitter with
            the ones it could be taken for, then every pair of Emitters with its findings by severity; click one to
            see the Mode pairs behind it. The rules are the Emitter check&apos;s — see &ldquo;Ambiguity check&rdquo;
            above.
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
            <strong>Analyst notes</strong> (the Notes tab on the right edge) work the same way as an Emitter&apos;s —
            an append-only, timestamped log, separate from the single editable "Notes" field in the edit form.
          </p>
          <p>
            The <strong>Readiness</strong> checklist at the top of Pinned Platforms says what&apos;s left before the
            MDF goes out, problems first: Platforms pinned, the pins saved as a version, Platform pins and the Emitter
            pins inside them up to date, every Emitter Operational and passing its latest Simulation Test, no open
            High or Exact finding in the latest ambiguity check, and a passing MDF test on file. Pinned Platforms with a
            newer saved version are flagged <strong>Outdated</strong>, with <strong>Repin to vN</strong> beside each and{" "}
            <strong>Repin all to their latest version</strong> above the table.
          </p>
          <p>
            <strong>Charts</strong> works like a Platform&apos;s, one level up: <strong>Per Platform</strong> draws
            a line per pinned Platform — everything its Emitters cover, gaps kept as gaps; <strong>Per
            Emitter</strong> a line per Emitter under its Platform; <strong>Per Mode</strong> a line per Mode
            under its Emitter. It reads each pinned Platform version and the Emitter versions it pins.
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
            Works like a Platform&apos;s — which Emitters could be taken for each other — across every Emitter
            reached through the Platforms pinned to this MDF (an Emitter on several of them counts once).
          </p>
        </div>
        <div className="help-subsection" id="dwells">
          <h3>Dwells</h3>
          <p>
            <strong>Dwells</strong> (a tab beside MDFs and Customers) has two lists. A <strong>Strategy</strong> is a
            named set of dwells (e.g. &quot;Summer&quot;) for one or more Platforms — a Platform can have several, and
            one Strategy can cover several Platforms. With no Platform ticked it&apos;s a <strong>default dwell</strong>:
            not tied to any Platform, typically a larger sweep, listed first. A <strong>dwell file</strong> pins saved
            versions of any Strategies — a Platform can have several in one file; linked to an MDF, it goes into
            that MDF&apos;s export as dwells/&lt;name&gt;.xml. <strong>Saving an MDF version</strong> records its dwell
            files at a saved version (saving any changed since, first), so exporting that MDF version always gives the
            same dwells; the MDF&apos;s readiness checklist flags a dwell file that&apos;s changed, empty, or behind.
            The same Strategy can be in several files.
          </p>
          <p>
            <strong>Testing a Strategy</strong> happens through Emitter testing: a simulation run that records the
            Strategy as its dwell. A Strategy&apos;s <strong>Testing</strong> tab lists, for each Platform it covers,
            every pinned Emitter: <strong>tested</strong> (a run with this Strategy still holds — the dwells covering it
            have the same frequencies, dwell and collect times as in the latest saved version, and the Emitter
            hasn&apos;t moved outside the RF it was tested at or grown a longer PRI / frame time), <strong>stale</strong>{" "}
            (tested, but that no longer holds — it says why), <strong>untested</strong>, or <strong>not covered</strong>{" "}
            (no dwell reaches its RF — a gap testing can&apos;t fix). Editing dwells for other bands leaves a test
            standing. A Platform test counts only for its own Platform; an Emitter&apos;s own run counts on every
            Platform the Strategy covers. Only simulation runs count, and default dwells aren&apos;t tracked. The Dwells
            lists and a Platform&apos;s Dwells tab say what&apos;s open (&ldquo;2 untested · 1 stale&rdquo;), and the
            dashboard lists it under <strong>Dwell testing</strong>. A new run starts on the Strategy covering the
            Emitter&apos;s Platform when exactly one does; a run logged without one can be given its Strategy (and
            version) afterwards with <strong>Set Strategy…</strong> on the run&apos;s page.
          </p>
          <p>
            On a Strategy&apos;s page you edit its <strong>dwells</strong> in order: each a frequency in MHz (as in the
            file), a dwell time and a collect time in ms (50 by default). <strong>Enter</strong> in a row adds the next
            one and <strong>Add several…</strong> takes a list of frequencies at once. <strong>Save as vN</strong> saves
            them as a new version straight away; until then they&apos;re kept in your browser, so leaving the page
            doesn&apos;t lose them. Name, Platforms, description and manual collect time are under More ▾ → Details…, and
            the Notes panel keeps running notes.
          </p>
          <p>
            The <strong>Cycle</strong> badge at the top of the chart says how long one pass through all the dwells
            takes. The chart beside the table draws one cycle as a waterfall — frequency across, time running down — with
            each dwell a band of the <strong>bandwidth</strong> (set in the chart&apos;s header; the default is an
            admin&apos;s, under Admin → Settings). Hover a band or a row to see the stretch it covers, e.g. 3020–3040
            MHz. Behind the dwells are the frequencies the Platform&apos;s pinned Emitters occupy, each in a lane under
            the chart; the legend says how much of each the dwells sit on (<strong>not dwelt on</strong> is flagged) and
            hides or shows it. The axis <strong>cuts gaps</strong> where nothing is dwelt on or transmitted (or pick
            Linear or Log). A Platform&apos;s page has a <strong>Dwells</strong> tab with its Strategies and this chart —
            before any Strategy exists it shows the Emitters alone.
          </p>
          <p>
            A dwell file pins a saved version of each Strategy, flags newer versions (<strong>Repin all</strong>) and the
            MDF&apos;s Platforms with no Strategy yet; its row opens to the pinned version&apos;s chart. Timeout, setup
            time and the MDF are under More ▾ → Details…. Version history shows what each version changed. When logging a
            test run, <strong>Dwell → Strategy…</strong> records the Strategy (its latest version) the run used; a
            Strategy&apos;s <strong>Used in</strong> tab lists its files and test runs.
          </p>
          <p>
            <strong>Import XML</strong> (under Dwell files) makes a file from an existing one: each Strategy in it
            becomes a Strategy of its own — pick each one&apos;s Platform on its page. <strong>Download XML</strong>{" "}
            writes the file in the same layout.
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
            <strong>Turn into Source.</strong> Under the description, an Intercept that isn&apos;t a Source yet has a{" "}
            <strong>Turn into Source</strong> button (Editors, with the Emitter checked out — the page offers to check
            it out). It adds a Source to the Emitter that stands for this Intercept — same name, date and description,
            type &quot;Intercept&quot; — so a Mode can have the Intercept as
            its Source. It&apos;s only a link: nothing is copied from the entries into it, and Modes already made from
            the entries stay in the Source they&apos;re in. From then on, new Modes made from its entries (one at a time
            or with Plan Modes) start on that Source. The Source shows &quot;Stands for Intercept …&quot; with a link
            back; deleting the Intercept keeps the Source and its Modes, unlinked. Like any Source it&apos;s part of the
            Emitter&apos;s unsaved changes until a version is saved.
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
              to take in the entry&apos;s range (a stagger&apos;s frame time by its ±). The Mode keeps its name, deltas
              and everything else; the Mode that needs the least change is suggested first. Several entries widening
              the same Mode widen it once, to take them all in.
            </li>
            <li>
              <strong>New Mode</strong> — the entry&apos;s range with the ± deltas you set on top. A stagger&apos;s frame
              time is one value, so its measured spread goes into its ±; a Fixed Mode&apos;s jitter range comes from
              the reports. CW Modes need a PW range, since a CW entry has none. To give one entry different deltas,
              click <strong>± for this entry</strong> under its choice: any field you fill overrides the page&apos;s
              delta for that entry alone (left empty, it shows and uses the page&apos;s); <strong>Use the
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
          linked. The <strong>Tasks</strong> page (your name&apos;s menu, or <strong>All tasks</strong> on the Dashboard) has views for
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
        <p>
          For an Emitter, <strong>Started editing</strong> and <strong>Stopped editing</strong> only mean the edit
          lock was taken and released — nothing is saved by them. A <strong>Saved version</strong> entry is a saved
          version (Save version also stops editing, so the two come together). Stopped editing on its own means the
          editor stopped without saving (the changes stay live, unsaved), an Admin force-released the lock, or it was
          released automatically after going untouched; <strong>Discarded changes</strong> means the edits were thrown
          away.
        </p>
          </div>

      <div className="card" id="admin">
        <h2>Admin</h2>
        <p>
          Admins only. <strong>Users</strong>: create accounts, change roles, deactivate or reactivate.{" "}
          <strong>Edit locks</strong>: every Emitter being edited, with Force release for a stale hold.{" "}
          <strong>Recently Deleted</strong>: restore deleted Emitters, Platforms and MDFs, or delete them for good;
          anything left 30 days is removed each day. <strong>Backups</strong>: below.{" "}
          <strong>Statuses &amp; milestones</strong>: for Emitters, Platforms and MDFs, rename, recolour, add and
          reorder statuses, choose which moves are allowed and which ask for a note, and set the default milestones
          every item has before each status. Built-in statuses can be renamed but not deleted; an added one can be
          deleted once nothing is in it. <strong>Defaults</strong>: what a new Mode starts with — confirmation
          quality and quantity, and the RF, PRI, PW and frame-time deltas (frame time ±3 µs to start; it widens a
          stagger&apos;s frame time, the sum of its steps, not each step). The Add Mode form and the Intercept planning
          page fill them in; Modes made from Elements, a typed line or the AI chat get the confirmation and the
          frame-time delta. Existing Modes keep theirs.
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
            repository, taken at the same moment: every Emitter as XML, every Platform and MDF as its own complete
            PRS package, every dwell file, and every Dwell Strategy (default dwells too) — the same files exporting each from the app would give, from its latest saved version
            (anything never saved is from its current state). Download it with <strong>PRS (XML)</strong> and use the
            MDF folders as they are; the README.txt inside lists what&apos;s there and from which version. On the
            server it sits next to the backup, as <code>emitterdb_&lt;date&gt;_prs.zip</code>.
          </p>
          <p>
            <strong>Compare</strong> gives an overview of what changed between two backups, or between a backup and
            the current data: which Emitters, Platforms, MDFs, Dwell Strategies and dwell files were added, removed or
            changed, and for each changed one a line per change — renamed, status, number of Modes, a Strategy&apos;s
            Platforms and dwells, moved to or restored from Recently Deleted, saved version, and the versions a
            Platform, MDF or dwell file pins. It&apos;s the quick way to see what a restore
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
