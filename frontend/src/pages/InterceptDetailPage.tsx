import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useEmitter } from "../state/hooks/useEmitters";
import { useEwGroups } from "../state/hooks/useEwGroups";
import { useFunctionGroups } from "../state/hooks/useFunctionGroups";
import { useSources } from "../state/hooks/useSources";
import { useEmitterModes } from "../state/hooks/useModes";
import { useEmitterCheckoutState } from "../state/hooks/useEmitterCheckout";
import {
  useDeleteIntercept,
  useDeleteInterceptEntries,
  useDeleteInterceptEntry,
  useInterceptEntries,
  useIntercept,
  useMergeInterceptEntries,
} from "../state/hooks/useIntercepts";
import {
  useCreateInterceptNote,
  useDeleteInterceptNote,
  useInterceptNotes,
} from "../state/hooks/useInterceptNotes";
import { RequireRole, useHasRole } from "../auth/RequireAuth";
import { ApiRequestError } from "../api/client";
import { LoadingState } from "../components/common/LoadingState";
import { EmptyState } from "../components/common/EmptyState";
import { MenuButton } from "../components/common/MenuButton";
import { NotesFeed } from "../components/common/NotesFeed";
import { useConfirmDialog } from "../components/common/ConfirmDialog";
import { ModeForm } from "../components/modes/ModeForm";
import { InterceptFormModal } from "../components/intercepts/InterceptFormModal";
import { EntryFormModal } from "../components/intercepts/EntryFormModal";
import { EntryMatchCell, MatchCounts } from "../components/intercepts/EntryMatchCell";
import { formatDay, modeLink } from "../components/intercepts/interceptFormat";
import { matchEntry, type EntryMatch, type EntryMatchStatus } from "../components/intercepts/interceptMatch";
import { SortableColumnHeader } from "../components/common/SortableColumnHeader";
import { useSortableTable } from "../components/common/useSortableTable";
import { compareNullable } from "../components/common/sortUtils";
import type { SortDirection } from "../components/common/sortUtils";
import {
  EntryCharts,
  entryValue,
  withinRange,
  type EntryChartTab,
  type SelectMode,
} from "../components/intercepts/charts/EntryCharts";
import type { Range, RangeParam } from "../components/intercepts/charts/ImportCharts";
import { ReportsTable } from "../components/intercepts/ReportsTable";
import { useInterceptReports } from "../state/hooks/useIntercepts";
import type { Emitter, InterceptEntry, Mode } from "../types/domain";

const PAGE_SIZE = 100;

const PRI_TYPE_LABEL: Record<string, string> = { fixed: "Fixed", stagger: "Stagger", cw: "CW", xlet: "X-let" };

/** A measured value: the mean, with the measured range under it when there
 * is one. A dash when the entry has none (a CW entry's PRI and PW). */
function MeasuredValue({ mean, min, max }: { mean: number | null; min?: number | null; max?: number | null }) {
  if (mean == null) return <span className="hint-text">—</span>;
  return (
    <>
      <strong>{mean}</strong>
      {(min != null || max != null) && (
        <div className="hint-text cell-subline">
          {min ?? "?"}–{max ?? "?"}
        </div>
      )}
    </>
  );
}

function CreateModeFromEntry({ entry, emitterId, onClose }: { entry: InterceptEntry; emitterId: string; onClose: () => void }) {
  const { data: ewGroups } = useEwGroups(emitterId);
  const { data: sources } = useSources(emitterId);
  const { data: functionGroups } = useFunctionGroups(emitterId);
  const priLabel = entry.pri_type === "stagger" ? "Frame time" : "PRI";
  const prefilled = entry.pri_type === "cw" ? "RF" : `RF/${priLabel}/PW`;
  // ModeForm picks its default EW Group and Source when it mounts, so wait for them.
  if (!ewGroups || !sources) return <LoadingState label="Loading EW Groups and Sources…" />;
  return (
    <>
      <p className="hint-text">
        {prefilled} pre-filled from this entry (min/max fall back to the mean when not measured).
        {entry.pri_type === "cw" && " A CW entry has no pulses, so fill in the Mode's PW range yourself."}
        {entry.pri_type === "fixed" && " Jitter min and max both take the entry's jitter mean."}
      </p>
      <ModeForm
        emitterId={emitterId}
        ewGroups={ewGroups}
        sources={sources}
        functionGroups={functionGroups}
        fixedDerivedFromInterceptEntryId={entry.id}
        prefillOnOpen
        observedValueOptions={[
          {
            key: entry.id,
            label: "This Intercept entry",
            values: {
              rf_min_mhz: entry.rf_min_mhz ?? entry.rf_mean_mhz,
              rf_max_mhz: entry.rf_max_mhz ?? entry.rf_mean_mhz,
              pw_min_us: entry.pw_min_us ?? entry.pw_mean_us ?? undefined,
              pw_max_us: entry.pw_max_us ?? entry.pw_mean_us ?? undefined,
              pri_type: entry.pri_type,
              pri_min_us: entry.pri_type === "fixed" ? (entry.pri_min_us ?? entry.pri_mean_us ?? undefined) : undefined,
              pri_max_us: entry.pri_type === "fixed" ? (entry.pri_max_us ?? entry.pri_mean_us ?? undefined) : undefined,
              jitter_mean_us: entry.pri_type === "fixed" ? (entry.jitter_mean_us ?? undefined) : undefined,
              pri_stagger_values_us: entry.pri_type === "stagger" ? (entry.stagger_values ?? undefined) : undefined,
            },
          },
        ]}
        onClose={onClose}
      />
    </>
  );
}

const pad2 = (n: number) => String(n).padStart(2, "0");
/** A mission time as written in the file (stored as UTC). */
function utcParts(iso: string) {
  const d = new Date(iso);
  return {
    date: `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`,
    time: `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`,
    full: `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`,
  };
}

/** When an entry was heard: "2026-09-14 08:15–09:09", the full times in the tooltip. */
function Heard({ entry }: { entry: InterceptEntry }) {
  if (!entry.first_seen_at) return <span className="hint-text">—</span>;
  const a = utcParts(entry.first_seen_at);
  const b = entry.last_seen_at ? utcParts(entry.last_seen_at) : a;
  const span = a.full === b.full ? a.time : a.date === b.date ? `${a.time}–${b.time}` : `${a.time} – ${b.date} ${b.time}`;
  return (
    <span title={`${a.full} – ${b.full}`}>
      <span className="cell-nowrap">{span}</span>
      <div className="hint-text cell-subline">{a.date}</div>
    </span>
  );
}

const STATUS_ORDER: Record<EntryMatchStatus, number> = { match: 0, near: 1, none: 2 };
type SortKey = "type" | "rf" | "pri" | "pw" | "reports" | "heard" | "match" | "created";
type Row = { entry: InterceptEntry; match: EntryMatch | null };

function EntryRow({
  entry,
  emitter,
  match,
  modeById,
  isMine,
  canWrite,
  selected,
  onToggle,
  onEdit,
  onDelete,
  columns,
  hasReports,
  multiFile,
}: {
  entry: InterceptEntry;
  emitter: Emitter | undefined;
  /** Null while the Modes load. */
  match: EntryMatch | null;
  modeById: Map<string, Mode>;
  isMine: boolean;
  canWrite: boolean;
  selected: boolean;
  onToggle: () => void;
  onEdit: (entry: InterceptEntry) => void;
  onDelete: (entry: InterceptEntry) => void;
  columns: number;
  /** The Intercept keeps its reports, so this entry's can be listed. */
  hasReports: boolean;
  multiFile: boolean;
}) {
  const [showCreateMode, setShowCreateMode] = useState(false);
  const [showReports, setShowReports] = useState(false);
  const emitterId = emitter?.id ?? "";
  const createdModes = entry.derived_mode_ids.map((id) => modeById.get(id)).filter((m): m is Mode => !!m);
  const tracks = entry.tracks ?? [];

  return (
    <>
      <tr
        className={[match?.status === "none" && "entry-unmatched", selected && "entry-selected"].filter(Boolean).join(" ") || undefined}
      >
        {canWrite && (
          <td>
            <input type="checkbox" aria-label="Select entry" checked={selected} onChange={onToggle} />
          </td>
        )}
        <td>
          {PRI_TYPE_LABEL[entry.pri_type] ?? entry.pri_type}
          {entry.pri_type === "stagger" && entry.stagger_values && (
            <div className="hint-text cell-subline">{entry.stagger_values.length} positions</div>
          )}
        </td>
        <td>
          <MeasuredValue mean={entry.rf_mean_mhz} min={entry.rf_min_mhz} max={entry.rf_max_mhz} />
        </td>
        <td>
          <MeasuredValue mean={entry.pri_mean_us} min={entry.pri_min_us} max={entry.pri_max_us} />
        </td>
        <td>
          <MeasuredValue mean={entry.pw_mean_us} min={entry.pw_min_us} max={entry.pw_max_us} />
        </td>
        <td className="entry-jitter">
          {entry.pri_type === "cw"
            ? <span className="hint-text">—</span>
            : entry.pri_type === "fixed"
            ? (entry.jitter_mean_us ?? "—")
            : entry.stagger_values && entry.stagger_values.length > 0
              ? <span title={entry.stagger_values.join(", ")}>{entry.stagger_values.join(", ")}</span>
              : "—"}
        </td>
        <td>
          {entry.report_count == null ? (
            <span className="hint-text">—</span>
          ) : hasReports ? (
            <button
              type="button"
              className="link-button cell-nowrap"
              aria-expanded={showReports}
              title="Show the reports this entry was built from"
              onClick={() => setShowReports((v) => !v)}
            >
              {showReports ? "▾" : "▸"} {entry.report_count.toLocaleString()}
            </button>
          ) : (
            entry.report_count.toLocaleString()
          )}
        </td>
        <td>
          <Heard entry={entry} />
        </td>
        <td>
          {tracks.length === 0 ? (
            <span className="hint-text">—</span>
          ) : (
            <span title={tracks.join(", ")}>
              {tracks.slice(0, 3).join(", ")}
              {tracks.length > 3 && <span className="hint-text"> +{tracks.length - 3}</span>}
            </span>
          )}
        </td>
        <td>{match ? <EntryMatchCell match={match} emitterId={emitterId} compact /> : <span className="hint-text">…</span>}</td>
        <td>
          {entry.derived_mode_ids.length === 0 ? (
            <span className="hint-text">—</span>
          ) : (
            <>
              {createdModes.map((m, i) => (
                <span key={m.id}>
                  {i > 0 && ", "}
                  <Link to={modeLink(emitterId, m)}>{m.name}</Link>
                </span>
              ))}
              {createdModes.length < entry.derived_mode_ids.length && (
                <span className="hint-text">
                  {createdModes.length > 0 && ", "}
                  {entry.derived_mode_ids.length - createdModes.length} deleted
                </span>
              )}
            </>
          )}
        </td>
        <td className="entry-notes" title={entry.notes ?? undefined}>
          {entry.notes ?? <span className="hint-text">—</span>}
        </td>
        <td className="sticky-end row-actions">
          {canWrite && (
            <MenuButton
              label="⋯"
              className="row-menu-button"
              ariaLabel="Actions for this entry"
              items={[
                { label: "Edit entry", onSelect: () => onEdit(entry) },
                {
                  label: showCreateMode ? "Hide Mode form" : "Create Mode from this entry",
                  onSelect: () => setShowCreateMode((v) => !v),
                  disabled: !isMine,
                  title: isMine ? undefined : `Start editing ${emitter?.name ?? "the Emitter"} first`,
                },
                { label: "Delete entry", danger: true, onSelect: () => onDelete(entry) },
              ]}
            />
          )}
        </td>
      </tr>
      {showReports && (
        <tr className="entry-reports-row">
          <td colSpan={columns}>
            <ReportsTable interceptId={entry.intercept_id} entryId={entry.id} showFile={multiFile} pageSize={25} />
          </td>
        </tr>
      )}
      {showCreateMode && isMine && (
        <tr>
          <td colSpan={columns}>
            <CreateModeFromEntry entry={entry} emitterId={emitterId} onClose={() => setShowCreateMode(false)} />
          </td>
        </tr>
      )}
    </>
  );
}

const CHARTS_OPEN_KEY = "intercept-charts-open";
const CHART_TAB_KEY = "intercept-chart-tab";

function readStored<T extends string>(key: string, allowed: T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return allowed.find((a) => a === v) ?? fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered — fine.
  }
}

/** Why the selected entries can't be merged, or null if they can. */
function cannotMerge(entries: InterceptEntry[]): string | null {
  if (entries.length < 2) return "Select at least two entries to merge.";
  if (new Set(entries.map((e) => e.pri_type)).size > 1) return "These have different PRI types — an entry has one.";
  if (
    entries[0].pri_type === "stagger" &&
    new Set(entries.map((e) => e.stagger_values?.length ?? 0)).size > 1
  )
    return "These staggers have different numbers of positions.";
  return null;
}

export function InterceptDetailPage() {
  const { interceptId } = useParams<{ interceptId: string }>();
  const navigate = useNavigate();
  const { data: intercept, isLoading } = useIntercept(interceptId ?? "");
  const { data: entries, isLoading: entriesLoading } = useInterceptEntries(interceptId ?? "");
  const { data: emitter } = useEmitter(intercept?.emitter_id);
  const { data: modes } = useEmitterModes(intercept?.emitter_id ?? "");
  const { isMine } = useEmitterCheckoutState(emitter);
  const { data: notes, isLoading: notesLoading } = useInterceptNotes(interceptId ?? "");
  const createNote = useCreateInterceptNote(interceptId ?? "");
  const deleteNote = useDeleteInterceptNote(interceptId ?? "");
  const deleteEntry = useDeleteInterceptEntry(interceptId ?? "");
  const deleteEntries = useDeleteInterceptEntries(interceptId ?? "");
  const mergeEntries = useMergeInterceptEntries(interceptId ?? "");
  const deleteIntercept = useDeleteIntercept();
  const { confirmDelete, dialog } = useConfirmDialog();

  const canWrite = useHasRole("editor");
  const [showEditDetails, setShowEditDetails] = useState(false);
  const [entryForm, setEntryForm] = useState<{ entry?: InterceptEntry } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [show, setShow] = useState<"all" | EntryMatchStatus>("all");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [ranges, setRanges] = useState<Record<RangeParam, Range>>({ rf: null, pri: null, pw: null });
  const [view, setView] = useState<"entries" | "reports">("entries");
  // Entries to create Modes from (the selection, or every entry from the More menu).
  const [reportFilter, setReportFilter] = useState<"all" | "none">("all");
  const hasReports = (intercept?.report_count ?? 0) > 0;
  // How many kept reports are in no entry — left out at import, or their entry deleted.
  const { data: leftOutPage } = useInterceptReports(interceptId ?? "", { entryId: "none", limit: 1 }, hasReports);
  const leftOut = leftOutPage?.total ?? 0;
  const [chartsOpen, setChartsOpenState] = useState(() => readStored(CHARTS_OPEN_KEY, ["true", "false"], "true") === "true");
  const [chartTab, setChartTabState] = useState<EntryChartTab>(() =>
    readStored<EntryChartTab>(CHART_TAB_KEY, ["distributions", "time"], "distributions"),
  );
  function setChartsOpen(open: boolean) {
    setChartsOpenState(open);
    store(CHARTS_OPEN_KEY, String(open));
  }
  function setChartTab(tab: EntryChartTab) {
    setChartTabState(tab);
    setChartsOpen(true);
    store(CHART_TAB_KEY, tab);
  }

  // Matched once per change rather than per render — an imported Intercept
  // can hold thousands of entries.
  const matched: Row[] = useMemo(
    () => (entries ?? []).map((entry) => ({ entry, match: modes ? matchEntry(entry, modes) : null })),
    [entries, modes],
  );
  const matchById = useMemo(
    () => (modes ? new Map(matched.map(({ entry, match }) => [entry.id, match!])) : null),
    [matched, modes],
  );
  const modeById = useMemo(() => new Map((modes ?? []).map((m) => [m.id, m])), [modes]);
  const byStatus = useMemo(
    () => (show === "all" ? matched : matched.filter(({ match }) => match?.status === show)),
    [matched, show],
  );
  const shown = useMemo(
    () =>
      byStatus.filter(({ entry }) =>
        (["rf", "pri", "pw"] as RangeParam[]).every((p) => withinRange(entryValue(entry, p), ranges[p])),
      ),
    [byStatus, ranges],
  );

  const compare = useCallback((a: Row, b: Row, key: SortKey, dir: SortDirection) => {
    const ea = a.entry;
    const eb = b.entry;
    switch (key) {
      case "type":
        return compareNullable(ea.pri_type, eb.pri_type, dir) || compareNullable(ea.rf_mean_mhz, eb.rf_mean_mhz, "asc");
      case "rf":
        return compareNullable(ea.rf_mean_mhz, eb.rf_mean_mhz, dir);
      case "pri":
        return compareNullable(ea.pri_mean_us, eb.pri_mean_us, dir);
      case "pw":
        return compareNullable(ea.pw_mean_us, eb.pw_mean_us, dir);
      case "reports":
        return compareNullable(ea.report_count, eb.report_count, dir);
      case "heard":
        return compareNullable(ea.first_seen_at, eb.first_seen_at, dir);
      case "match":
        return compareNullable(
          a.match ? STATUS_ORDER[a.match.status] : null,
          b.match ? STATUS_ORDER[b.match.status] : null,
          dir,
        );
      case "created":
        return compareNullable(ea.created_at, eb.created_at, dir);
    }
  }, []);
  // Imported entries share one creation time, so the default order is by RF.
  const { sorted, sortKey, sortDir, onSort, onClear } = useSortableTable<Row, SortKey>(shown, compare, {
    key: "rf",
    dir: "asc",
  });

  if (isLoading || !intercept) return <LoadingState label="Loading intercept…" />;

  const counts = modes
    ? matched.reduce((c, { match }) => ({ ...c, [match!.status]: c[match!.status] + 1 }), { match: 0, near: 0, none: 0 })
    : null;
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = sorted.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const selectedEntries = (entries ?? []).filter((e) => selected.has(e.id));
  const hiddenSelected = selectedEntries.length - shown.filter(({ entry }) => selected.has(entry.id)).length;
  const mergeBlocked = cannotMerge(selectedEntries);
  const allPageSelected = pageRows.length > 0 && pageRows.every(({ entry }) => selected.has(entry.id));
  const filteredByChart = Object.values(ranges).some(Boolean);
  const columns = canWrite ? 13 : 12;
  const legacyImport = !hasReports && (entries ?? []).some((e) => e.report_count != null);
  const multiFile = new Set((entries ?? []).map((e) => e.source_file).filter(Boolean)).size > 1;
  const entryById = new Map((entries ?? []).map((e) => [e.id, e]));
  function entryLabel(id: string | null) {
    if (!id) return "none";
    const e = entryById.get(id);
    if (!e) return "—";
    return `${PRI_TYPE_LABEL[e.pri_type] ?? e.pri_type} · RF ${e.rf_mean_mhz}${e.pri_mean_us != null ? ` · PRI ${e.pri_mean_us}` : ""}`;
  }

  const totalReports = (entries ?? []).reduce((n, e) => n + (e.report_count ?? 0), 0);
  const firsts = (entries ?? []).map((e) => e.first_seen_at).filter((t): t is string => !!t).sort();
  const lasts = (entries ?? []).map((e) => e.last_seen_at ?? e.first_seen_at).filter((t): t is string => !!t).sort();

  function selectBox(ids: string[], mode: SelectMode) {
    setSelected((current) => {
      if (mode === "replace") return new Set(ids);
      if (mode === "add") return new Set([...current, ...ids]);
      const inside = new Set(ids);
      return new Set([...current].filter((id) => inside.has(id)));
    });
  }
  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleDeleteEntry(entry: InterceptEntry) {
    setError(null);
    if (!(await confirmDelete("Delete this entry? Any Mode already created from it is unaffected."))) return;
    try {
      await deleteEntry.mutateAsync(entry.id);
      setSelected((current) => {
        const next = new Set(current);
        next.delete(entry.id);
        return next;
      });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to delete entry");
    }
  }

  async function handleDeleteSelected() {
    setError(null);
    const n = selectedEntries.length;
    if (
      !(await confirmDelete(
        `Delete ${n} entr${n === 1 ? "y" : "ies"}?${hiddenSelected > 0 ? ` (${hiddenSelected} of them aren't shown by the current filters.)` : ""} Any Mode already created from them is unaffected.`,
      ))
    )
      return;
    try {
      await deleteEntries.mutateAsync(selectedEntries.map((e) => e.id));
      setSelected(new Set());
      setMessage(`Deleted ${n} entr${n === 1 ? "y" : "ies"}.`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to delete the entries");
    }
  }

  async function handleMergeSelected() {
    setError(null);
    const n = selectedEntries.length;
    if (
      !(await confirmDelete(
        `Merge ${n} entries into one? Means are weighted by how many reports each was built from, the measured range becomes the widest of them, and their times, report counts, tracks and Mode links are combined.`,
        { confirmLabel: "Merge" },
      ))
    )
      return;
    try {
      const merged = await mergeEntries.mutateAsync(selectedEntries.map((e) => e.id));
      setSelected(new Set([merged.id]));
      setMessage(`Merged ${n} entries into one — it's selected.`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to merge the entries");
    }
  }

  async function handleDeleteIntercept() {
    if (!interceptId || !intercept) return;
    setError(null);
    if (
      !(await confirmDelete(
        `Delete Intercept "${intercept.name}"? This removes all its entries and notes. Any Mode already created from an entry is unaffected.`,
      ))
    )
      return;
    try {
      await deleteIntercept.mutateAsync(interceptId);
      navigate(emitter ? `/emitters/${emitter.id}?tab=intercepts` : "/intercepts");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to delete Intercept");
    }
  }

  const meta = [
    intercept.intercepted_on && `Recorded ${formatDay(intercept.intercepted_on)}`,
    intercept.collected_by && `collected by ${intercept.collected_by}`,
    `logged ${new Date(intercept.created_at).toLocaleDateString()}`,
  ].filter(Boolean);

  const header = (label: string, key: SortKey, columnType?: "string" | "number" | "date") => (
    <SortableColumnHeader
      label={label}
      columnKey={key}
      columnType={columnType}
      activeKey={sortKey}
      activeDir={sortDir}
      onSort={onSort}
      onClear={onClear}
    />
  );

  return (
    <div className="page">
      {emitter && <Link to={`/emitters/${emitter.id}?tab=intercepts`}>← {emitter.name} Intercepts</Link>}
      <div className="emitter-title-row">
        <h1>{intercept.name}</h1>
        <RequireRole minimum="editor">
          <div className="emitter-actions">
            <button type="button" className="button primary" onClick={() => setEntryForm({})}>
              + Add entry
            </button>
            <MenuButton
              label="More ▾"
              items={[
                { label: "Edit name, date & description", onSelect: () => setShowEditDetails(true) },
                { label: "Import entries from CSV", to: `/intercepts/import?intercept=${intercept.id}` },
                ...(hasReports ? [{ label: "Regroup reports", to: `/intercepts/${intercept.id}/regroup` }] : []),
                { label: "Delete Intercept", danger: true, onSelect: () => void handleDeleteIntercept() },
              ]}
            />
          </div>
        </RequireRole>
      </div>
      <p className="intercept-meta">
        {meta.join(" · ").replace(/^./, (c) => c.toUpperCase())}
        {totalReports > 0 && ` · ${totalReports.toLocaleString()} reports`}
        {firsts.length > 0 && (
          <>
            {" · heard "}
            {utcParts(firsts[0]).full.slice(0, 16)} – {utcParts(lasts[lasts.length - 1]).full.slice(0, 16)}
          </>
        )}
      </p>
      {intercept.description && <p className="muted">{intercept.description}</p>}
      {error && <div className="error-text">{error}</div>}

      <section className="card">
        <h4>Analyst notes</h4>
        <NotesFeed
          notes={notes}
          isLoading={notesLoading}
          placeholder="Your own thoughts/observations about this Intercept as a whole."
          onAdd={(body) => createNote.mutateAsync(body)}
          isAdding={createNote.isPending}
          onDelete={(noteId) => deleteNote.mutateAsync(noteId)}
        />
      </section>

      {entries && entries.length > 0 && (
        <section className="card">
          <div className="import-charts-bar">
            <button type="button" className="link-button" aria-expanded={chartsOpen} onClick={() => setChartsOpen(!chartsOpen)}>
              {chartsOpen ? "▾ Charts" : "▸ Charts"}
            </button>
            <div className="import-chart-tabs" role="tablist" aria-label="Charts">
              {(
                [
                  ["distributions", "Scatter & distributions"],
                  ["time", "Over time"],
                ] as [EntryChartTab, string][]
              ).map(([tab, label]) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={chartsOpen && chartTab === tab}
                  className={chartsOpen && chartTab === tab ? "sub-tab active" : "sub-tab"}
                  onClick={() => setChartTab(tab)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {chartsOpen && (
            <EntryCharts
              tab={chartTab}
              entries={byStatus.map((r) => r.entry)}
              matchById={matchById}
              modes={modes}
              ranges={ranges}
              onRange={(p, r) => {
                setRanges((current) => ({ ...current, [p]: r }));
                setPage(0);
              }}
              selected={selected}
              onSelectBox={selectBox}
            />
          )}
        </section>
      )}

      <section className="card">
        <div className="card-header">
          {hasReports ? (
            <div className="import-chart-tabs entry-view-tabs" role="tablist" aria-label="Entries or reports">
              <button
                type="button"
                role="tab"
                aria-selected={view === "entries"}
                className={view === "entries" ? "sub-tab active" : "sub-tab"}
                onClick={() => setView("entries")}
              >
                Entries <span className="section-count">{entries?.length ?? 0}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === "reports"}
                className={view === "reports" ? "sub-tab active" : "sub-tab"}
                onClick={() => setView("reports")}
              >
                Reports <span className="section-count">{intercept.report_count.toLocaleString()}</span>
              </button>
            </div>
          ) : (
            <h4>
              Entries <span className="section-count">{entries?.length ?? 0}</span>
            </h4>
          )}
          <span className="section-actions">
            {canWrite && hasReports && (
              <Link className="button secondary small" to={`/intercepts/${intercept.id}/regroup`}>
                Regroup reports
              </Link>
            )}
            {view === "entries" && counts && <MatchCounts counts={counts} />}
            {view === "entries" && counts && (entries?.length ?? 0) > 10 && (
              <select
                aria-label="Show entries"
                value={show}
                onChange={(e) => {
                  setShow(e.target.value as typeof show);
                  setPage(0);
                }}
              >
                <option value="all">All entries</option>
                <option value="none">No matching Mode</option>
                <option value="near">Partial matches</option>
                <option value="match">Matches</option>
              </select>
            )}
          </span>
        </div>
        {view === "reports" && (
          <>
            <p className="hint-text reports-view-bar">
              The single measurements this Intercept&apos;s entries were grouped from, as they were in the file.{" "}
              <label className="inline-label">
                Show
                <select value={reportFilter} onChange={(e) => setReportFilter(e.target.value as "all" | "none")}>
                  <option value="all">All reports</option>
                  <option value="none">In no entry ({leftOut.toLocaleString()})</option>
                </select>
              </label>
            </p>
            <ReportsTable
              key={reportFilter}
              interceptId={intercept.id}
              entryId={reportFilter === "none" ? "none" : undefined}
              entryLabel={(id) => entryLabel(id)}
              showFile={multiFile}
            />
          </>
        )}
        {view === "entries" && (
          <>
        {legacyImport && (
          <p className="import-duplicate">
            These entries were imported before the reports were kept, so their reports can&apos;t be shown or
            regrouped. Importing the file again (into a new Intercept) keeps them.
          </p>
        )}
        {hasReports && leftOut > 0 && (
          <p className="hint-text">
            {leftOut.toLocaleString()} report{leftOut === 1 ? " isn't" : "s aren't"} in any entry — left out at
            import, or their entry was deleted.{" "}
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setReportFilter("none");
                setView("reports");
              }}
            >
              Show {leftOut === 1 ? "it" : "them"}
            </button>
            {canWrite && (
              <>
                {" · "}
                <Link to={`/intercepts/${intercept.id}/regroup`}>Regroup</Link>
              </>
            )}
          </p>
        )}
        <p className="hint-text">
          Matched against {emitter?.name ?? "the Emitter"}&apos;s Modes on RF, PRI (frame time for a stagger) and PW, using
          each Mode&apos;s engineered range. A partial match is inside a Mode on two of the three and outside on the third — hover the badge for which.
          {canWrite && !isMine && counts && counts.none + counts.near > 0 && (
            <> To create a Mode from an entry, start editing {emitter?.name ?? "the Emitter"} first.</>
          )}
        </p>
        {filteredByChart && (
          <p className="entry-range-filters">
            Filtered by the charts:{" "}
            {(["rf", "pri", "pw"] as RangeParam[]).map((p) => {
              const r = ranges[p];
              if (!r) return null;
              return (
                <span key={p} className="filter-chip">
                  {p === "rf" ? "RF" : p === "pri" ? "PRI" : "PW"} {Number(r[0].toFixed(3))}–{Number(r[1].toFixed(3))}
                  <button
                    type="button"
                    className="link-button"
                    aria-label="Clear this filter"
                    onClick={() => setRanges((current) => ({ ...current, [p]: null }))}
                  >
                    ✕
                  </button>
                </span>
              );
            })}
            <button type="button" className="link-button" onClick={() => setRanges({ rf: null, pri: null, pw: null })}>
              Clear all
            </button>
            <span className="hint-text"> · {shown.length.toLocaleString()} of {byStatus.length.toLocaleString()} shown</span>
          </p>
        )}
        {canWrite && entries && entries.length > 0 && (
          <div className="import-selection entry-selection">
            <span>
              {selected.size.toLocaleString()} selected
              {hiddenSelected > 0 && <span className="hint-text"> ({hiddenSelected} not shown by the filters)</span>}
              {sorted.length > pageRows.length && !sorted.every(({ entry }) => selected.has(entry.id)) && (
                <>
                  {" · "}
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => setSelected(new Set(sorted.map(({ entry }) => entry.id)))}
                  >
                    Select all {sorted.length.toLocaleString()} shown
                  </button>
                </>
              )}
              {selected.size > 0 && (
                <>
                  {" · "}
                  <button type="button" className="link-button" onClick={() => setSelected(new Set())}>
                    Clear selection
                  </button>
                </>
              )}
            </span>
            <span className="import-selection-actions">
              <button
                type="button"
                className="button secondary small"
                disabled={!entries?.length}
                title="Choose, entry by entry, to make a new Mode or widen one it nearly fits — see what each covers before anything changes"
                onClick={() =>
                  navigate(`/intercepts/${intercept.id}/modes`, {
                    state: selected.size > 0 ? { entryIds: selectedEntries.map((e) => e.id) } : null,
                  })
                }
              >
                {selected.size > 0 ? `Plan Modes for ${selected.size}…` : "Plan Modes…"}
              </button>
              <button
                type="button"
                className="button secondary small"
                disabled={!!mergeBlocked || mergeEntries.isPending}
                title={mergeBlocked ?? undefined}
                onClick={() => void handleMergeSelected()}
              >
                Merge into one
              </button>
              <button
                type="button"
                className="button secondary small danger-outline"
                disabled={selected.size === 0 || deleteEntries.isPending}
                onClick={() => void handleDeleteSelected()}
              >
                Delete
              </button>
            </span>
          </div>
        )}
        {selected.size > 1 && mergeBlocked && <p className="hint-text">Can&apos;t merge: {mergeBlocked}</p>}
        {message && <p className="import-message">{message}</p>}
        {entriesLoading ? (
          <LoadingState label="Loading entries…" />
        ) : !entries || entries.length === 0 ? (
          <EmptyState
            compact
            title="No entries yet"
            message={canWrite ? "Add one per contact or measurement in this recording." : undefined}
          />
        ) : (
          <div className="matrix-scroll">
            <table className="data-table intercept-entries">
              <thead>
                <tr>
                  {canWrite && (
                    <th>
                      <input
                        type="checkbox"
                        aria-label="Select this page"
                        checked={allPageSelected}
                        onChange={() =>
                          setSelected((current) => {
                            const next = new Set(current);
                            for (const { entry } of pageRows) {
                              if (allPageSelected) next.delete(entry.id);
                              else next.add(entry.id);
                            }
                            return next;
                          })
                        }
                      />
                    </th>
                  )}
                  {header("PRI type", "type")}
                  {header("RF (MHz)", "rf", "number")}
                  {header("PRI (µs)", "pri", "number")}
                  {header("PW (µs)", "pw", "number")}
                  <th>Jitter / stagger (µs)</th>
                  {header("Reports", "reports", "number")}
                  {header("Heard", "heard", "date")}
                  <th>Tracks</th>
                  {header("Match", "match")}
                  <th>Modes created</th>
                  <th>Notes</th>
                  <th className="sticky-end" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {pageRows.map(({ entry, match }) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    emitter={emitter}
                    match={match}
                    modeById={modeById}
                    isMine={isMine}
                    canWrite={canWrite}
                    selected={selected.has(entry.id)}
                    onToggle={() => toggle(entry.id)}
                    onEdit={(e) => setEntryForm({ entry: e })}
                    onDelete={(e) => void handleDeleteEntry(e)}
                    columns={columns}
                    hasReports={hasReports}
                    multiFile={multiFile}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {entries && entries.length > 0 && shown.length === 0 && <p className="hint-text">No entries match the filters.</p>}
        {pageCount > 1 && (
          <div className="list-pager">
            <button type="button" className="button secondary small" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
              ← Previous
            </button>
            <span>
              Entries {(safePage * PAGE_SIZE + 1).toLocaleString()}–{Math.min((safePage + 1) * PAGE_SIZE, sorted.length).toLocaleString()} of{" "}
              {sorted.length.toLocaleString()}
            </span>
            <button
              type="button"
              className="button secondary small"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage(safePage + 1)}
            >
              Next →
            </button>
          </div>
        )}
          </>
        )}
      </section>

      {showEditDetails && <InterceptFormModal intercept={intercept} onClose={() => setShowEditDetails(false)} />}
      {entryForm && (
        <EntryFormModal interceptId={intercept.id} entry={entryForm.entry} onClose={() => setEntryForm(null)} />
      )}
      {dialog}
    </div>
  );
}
