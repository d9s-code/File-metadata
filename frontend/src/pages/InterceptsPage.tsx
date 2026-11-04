import { Fragment, useState } from "react";
import { formatDate } from "../components/common/dates";
import { MenuButton } from "../components/common/MenuButton";
import { FilterBar, shownCount } from "../components/common/FilterBar";
import { PageHeader } from "../components/common/PageHeader";
import { Link, useNavigate } from "react-router-dom";
import { useEmitters } from "../state/hooks/useEmitters";
import { useDeleteIntercept, useIntercepts } from "../state/hooks/useIntercepts";
import { RequireRole } from "../auth/RequireAuth";
import { ApiRequestError } from "../api/client";
import { LoadingState } from "../components/common/LoadingState";
import { EmptyState } from "../components/common/EmptyState";
import { InterceptFormModal } from "../components/intercepts/InterceptFormModal";
import { formatDay } from "../components/intercepts/interceptFormat";
import { useConfirmDialog } from "../components/common/ConfirmDialog";
import { SortableColumnHeader } from "../components/common/SortableColumnHeader";
import { useSortableTable } from "../components/common/useSortableTable";
import { compareNullable, compareStrings } from "../components/common/sortUtils";
import type { Intercept } from "../types/domain";
import { useRecordings } from "../state/hooks/useRecordings";
import { RecordingUploadButton, formatBytes } from "../components/recordings/RecordingUpload";
import { formatUtc } from "../components/recordings/recordingFilters";
import type { Recording } from "../api/recordings";
import { useSessionState } from "../components/common/useSessionState";

type InterceptSortKey = "name" | "emitter" | "intercepted_on" | "collected_by" | "entry_count" | "created_at";

export function InterceptsPage() {
  const { data: emitters } = useEmitters();
  const { data: intercepts, isLoading, error } = useIntercepts();
  const deleteIntercept = useDeleteIntercept();
  const navigate = useNavigate();
  const { confirmDelete, dialog } = useConfirmDialog();

  const [showAddModal, setShowAddModal] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [nameFilter, setNameFilter] = useSessionState("intercepts.nameFilter", "");
  const [emitterFilter, setEmitterFilter] = useSessionState("intercepts.emitterFilter", "");
  const [byRecording, setByRecording] = useSessionState("intercepts.byRecording", true);
  const { data: recordings } = useRecordings();

  const emitterNameById = Object.fromEntries((emitters ?? []).map((e) => [e.id, e.name]));

  function compareIntercepts(a: Intercept, b: Intercept, key: InterceptSortKey, dir: "asc" | "desc"): number {
    switch (key) {
      case "name":
        return compareStrings(a.name, b.name, dir);
      case "emitter":
        return compareStrings(emitterNameById[a.emitter_id] ?? "", emitterNameById[b.emitter_id] ?? "", dir);
      case "intercepted_on":
        return compareNullable(a.intercepted_on, b.intercepted_on, dir);
      case "collected_by":
        return compareNullable(a.collected_by, b.collected_by, dir);
      case "entry_count":
        return compareNullable(a.entry_count, b.entry_count, dir);
      case "created_at":
        return compareStrings(a.created_at, b.created_at, dir);
    }
  }

  const filtered = (intercepts ?? []).filter((i) => {
    const nameQ = nameFilter.trim().toLowerCase();
    if (nameQ && ![i.name, i.collected_by ?? "", i.description ?? ""].some((t) => t.toLowerCase().includes(nameQ)))
      return false;
    if (emitterFilter && i.emitter_id !== emitterFilter) return false;
    return true;
  });

  const { sorted, sortKey, sortDir, onSort, onClear } = useSortableTable(filtered, compareIntercepts, "intercepts");

  const header = (label: string, key: InterceptSortKey, columnType?: "string" | "number" | "date") => (
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

  function resetFilters() {
    setNameFilter("");
    setEmitterFilter("");
  }

  async function handleDelete(intercept: Intercept) {
    setDeleteError(null);
    if (
      !(await confirmDelete(
        `Delete Intercept "${intercept.name}"? This removes all its entries and notes. Any Mode already created from an entry is unaffected.`,
      ))
    )
      return;
    try {
      await deleteIntercept.mutateAsync(intercept.id);
    } catch (err) {
      setDeleteError(err instanceof ApiRequestError ? err.message : "Failed to delete Intercept");
    }
  }

  function row(i: Intercept) {
    return (
      <tr key={i.id}>
        <td>
          <Link to={`/intercepts/${i.id}`}>{i.name}</Link>
        </td>
        <td>
          {emitterNameById[i.emitter_id] ? (
            <Link to={`/emitters/${i.emitter_id}`}>{emitterNameById[i.emitter_id]}</Link>
          ) : (
            "—"
          )}
        </td>
        <td>{formatDay(i.intercepted_on) ?? <span className="hint-text">—</span>}</td>
        <td>{i.collected_by ?? <span className="hint-text">—</span>}</td>
        <td>{i.entry_count}</td>
        <td>{formatDate(i.created_at)}</td>
        <td className="row-actions">
          <RequireRole minimum="editor">
            <MenuButton
              label="⋯"
              className="row-menu-button"
              ariaLabel={`Actions for ${i.name}`}
              items={[{ label: "Delete…", danger: true, onSelect: () => void handleDelete(i) }]}
            />
          </RequireRole>
        </td>
      </tr>
    );
  }

  /** The rows, or — By recording — each recording with the Intercepts snipped from it, then the rest. */
  function groupedRows() {
    if (!byRecording) return sorted.map(row);
    const under = new Map<string, Intercept[]>();
    const rest: Intercept[] = [];
    for (const i of sorted) {
      if (i.recording_id) under.set(i.recording_id, [...(under.get(i.recording_id) ?? []), i]);
      else rest.push(i);
    }
    const filtering = !!(nameFilter.trim() || emitterFilter);
    // Recordings without a matching Intercept still show while nothing is filtered — they're where snipping starts.
    const shownRecordings = (recordings ?? []).filter((r) => under.has(r.id) || !filtering);
    return (
      <>
        {shownRecordings.map((r) => (
          <Fragment key={r.id}>
            <RecordingRow recording={r} shown={under.get(r.id)?.length ?? 0} />
            {(under.get(r.id) ?? []).map(row)}
          </Fragment>
        ))}
        {shownRecordings.length > 0 && rest.length > 0 && (
          <tr className="recording-group-row">
            <td colSpan={7}>
              <strong>Not from a recording</strong>
              <span className="hint-text">imported from a file or added by hand</span>
            </td>
          </tr>
        )}
        {rest.map(row)}
      </>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="Intercepts"
        info="Logged real-world signal intercepts, searchable across every Emitter. Each Intercept holds one or more logged entries, and an entry can be used to create a Mode."
      >
        <RequireRole minimum="editor">
          <span className="section-actions">
            <RecordingUploadButton />
            <Link className="button secondary" to="/intercepts/import">
              Import CSV
            </Link>
            <button className="button primary" onClick={() => setShowAddModal(true)}>
              + Add Intercept
            </button>
          </span>
        </RequireRole>
      </PageHeader>

      {showAddModal && (
        <InterceptFormModal
          emitters={emitters}
          onClose={() => setShowAddModal(false)}
          onSaved={(saved) => navigate(`/intercepts/${saved.id}`)}
        />
      )}

      {error && <div className="error-text">{(error as Error).message}</div>}

      <FilterBar
        active={!!(nameFilter || emitterFilter)}
        onReset={resetFilters}
        count={intercepts ? shownCount(sorted.length, intercepts.length, "Intercept") : null}
      >
        <input
          type="search"
          placeholder="Name, collector or description…"
          aria-label="Filter by name, collector or description"
          value={nameFilter}
          onChange={(e) => setNameFilter(e.target.value)}
        />
        <label className="checkbox-label" title="Intercepts snipped from a whole recording listed under it">
          <input type="checkbox" checked={byRecording} onChange={(e) => setByRecording(e.target.checked)} />
          By recording
        </label>
        <select value={emitterFilter} onChange={(e) => setEmitterFilter(e.target.value)} aria-label="Emitter">
          <option value="">All Emitters</option>
          {(emitters ?? []).map((em) => (
            <option key={em.id} value={em.id}>
              {em.name}
            </option>
          ))}
        </select>
      </FilterBar>

      {isLoading ? (
        <LoadingState label="Loading intercepts…" />
      ) : (intercepts ?? []).length === 0 && !(byRecording && (recordings ?? []).length > 0) ? (
        <EmptyState
          icon="◇"
          title="No Intercepts yet"
          message="Add one with + Add Intercept, bring one in with Import CSV, or upload a whole recording to snip from."
        />
      ) : sorted.length === 0 && !(byRecording && (recordings ?? []).length > 0) ? (
        <EmptyState icon="◇" title="No matches" message="No Intercepts match the current search/filters." />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              {header("Name", "name")}
              {header("Emitter", "emitter")}
              {header("Recorded", "intercepted_on", "date")}
              {header("Collected by", "collected_by")}
              {header("Entries", "entry_count", "number")}
              {header("Logged", "created_at", "date")}
              <th className="row-actions" aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody>
            {groupedRows()}
          </tbody>
        </table>
      )}
      {deleteError && <div className="error-text">{deleteError}</div>}
      {dialog}
    </div>
  );
}

const STATUS_TEXT: Record<Recording["status"], string> = {
  uploading: "upload not finished",
  processing: "being read…",
  ready: "",
  failed: "couldn't be read",
};

/** A recording's heading row in the Intercepts list. */
function RecordingRow({ recording: r, shown }: { recording: Recording; shown: number }) {
  return (
    <tr className="recording-group-row">
      <td colSpan={7}>
        <Link to={`/recordings/${r.id}`}>
          <strong>{r.name}</strong>
        </Link>
        <span className="hint-text">
          {[
            formatBytes(r.size_bytes),
            r.status === "ready" ? `${r.report_count.toLocaleString()} reports` : STATUS_TEXT[r.status],
            r.first_time && r.last_time ? `${formatUtc(r.first_time)} – ${formatUtc(r.last_time, false)}` : null,
            shown ? `${shown} Intercept${shown === 1 ? "" : "s"}` : "no Intercepts yet — open it to snip",
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </td>
    </tr>
  );
}
