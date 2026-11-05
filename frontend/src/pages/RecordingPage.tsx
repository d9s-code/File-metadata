import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { BackLink } from "../components/common/BackLink";
import { PageHeader } from "../components/common/PageHeader";
import { LoadingState } from "../components/common/LoadingState";
import { MenuButton } from "../components/common/MenuButton";
import { RenameDialog } from "../components/common/RenameDialog";
import { useConfirmDialog } from "../components/common/ConfirmDialog";
import { formatDateTime } from "../components/common/dates";
import { RequireRole, useHasRole } from "../auth/RequireAuth";
import { ApiRequestError } from "../api/client";
import { useEmitters } from "../state/hooks/useEmitters";
import {
  useDeleteRecording,
  useRecording,
  useRecordingOverview,
  useRecordings,
  useUpdateRecording,
} from "../state/hooks/useRecordings";
import { DensityChart, type DensityBox } from "../components/recordings/DensityChart";
import { formatBytes } from "../components/recordings/RecordingUpload";
import {
  cleanFilters,
  describeSnip,
  formatUtc,
  niceValue,
  PARAM_LABEL,
  PARAM_UNIT,
  readFilters,
  type FilterParam,
  type RecordingFilters,
} from "../components/recordings/recordingFilters";
import type { PriType } from "../types/domain";

const TYPES: [PriType, string][] = [
  ["fixed", "Fixed"],
  ["stagger", "Stagger"],
  ["cw", "CW"],
];
const PARAMS: FilterParam[] = ["rf", "pri", "pw"];

/** "2025-12-01T08:03:00Z" ↔ the value of a datetime-local input, read as UTC (as the file's times are). */
const toInput = (iso?: string) => (iso ? new Date(iso).toISOString().slice(0, 19) : "");
const fromInput = (v: string) => (v ? new Date(`${v}Z`).toISOString() : undefined);

type FormState = Record<string, string>;
function toForm(f: RecordingFilters): FormState {
  const form: FormState = {
    t0: toInput(f.t0),
    t1: toInput(f.t1),
    tracks: (f.tracks ?? []).join(", "),
    identified: f.identified ?? "",
  };
  for (const p of PARAMS) {
    form[`${p}_min`] = f[`${p}_min`]?.toString() ?? "";
    form[`${p}_max`] = f[`${p}_max`]?.toString() ?? "";
  }
  return form;
}
function fromForm(form: FormState, types: PriType[] | undefined): RecordingFilters {
  const num = (k: string) => (form[k].trim() === "" ? undefined : Number(form[k]));
  return cleanFilters({
    t0: fromInput(form.t0),
    t1: fromInput(form.t1),
    rf_min: num("rf_min"),
    rf_max: num("rf_max"),
    pri_min: num("pri_min"),
    pri_max: num("pri_max"),
    pw_min: num("pw_min"),
    pw_max: num("pw_max"),
    types,
    tracks: form.tracks
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    identified: form.identified,
  });
}

/** One whole recording: what it holds over time, cut down by time and
 * parameters (drag on a chart, or type the limits) to a snip that's grouped
 * into an Intercept like an imported file. */
export function RecordingPage() {
  const { recordingId = "" } = useParams<{ recordingId: string }>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const canWrite = useHasRole("editor");
  const { data: rec, isLoading, error } = useRecording(recordingId);
  const { data: allRecordings } = useRecordings();
  const { data: emitters } = useEmitters();
  const update = useUpdateRecording(recordingId);
  const del = useDeleteRecording();
  const { confirmDelete, dialog } = useConfirmDialog();
  const [renaming, setRenaming] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);

  // The snip lives in the address, so a link (or reload) brings it back.
  const filters = useMemo(() => {
    try {
      return readFilters(JSON.parse(params.get("snip") ?? "{}"));
    } catch {
      return {};
    }
  }, [params]);
  // Earlier snips, for "Undo".
  const [history, setHistory] = useState<RecordingFilters[]>([]);
  function setFilters(next: RecordingFilters, remember = true) {
    const clean = cleanFilters(next);
    if (remember) setHistory((h) => [...h.slice(-30), filters]);
    setParams(
      (p) => {
        const out = new URLSearchParams(p);
        if (Object.keys(clean).length) out.set("snip", JSON.stringify(clean));
        else out.delete("snip");
        out.delete("again");
        return out;
      },
      { replace: true },
    );
  }
  function undo() {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setFilters(prev, false);
  }

  const [form, setForm] = useState<FormState>(() => toForm(filters));
  useEffect(() => setForm(toForm(filters)), [filters]);

  const ready = rec?.status === "ready" && rec.reports_here;
  const { data: ov, isFetching, error: ovError } = useRecordingOverview(recordingId, filters, !!ready);

  if (isLoading) return <LoadingState label="Loading the recording…" />;
  if (error || !rec)
    return (
      <div className="page">
        <BackLink to="/intercepts">Intercepts</BackLink>
        <div className="error-text">{error ? (error as Error).message : "Recording not found"}</div>
      </div>
    );

  const emitterName = new Map((emitters ?? []).map((e) => [e.id, e.name]));
  const active = Object.keys(filters).length > 0;
  const tooBig = !!ov && ov.total > ov.max_snip;

  function snipTo(box: DensityBox, param?: FilterParam) {
    const next: RecordingFilters = {
      ...filters,
      t0: new Date(box.t[0]).toISOString(),
      t1: new Date(box.t[1]).toISOString(),
    };
    if (param && box.v) {
      const span = box.v[1] - box.v[0];
      next[`${param}_min`] = niceValue(box.v[0], span);
      next[`${param}_max`] = niceValue(box.v[1], span);
    }
    setFilters(next);
  }
  function toggleType(t: PriType) {
    const current = filters.types ?? TYPES.map(([k]) => k);
    const next = current.includes(t) ? current.filter((x) => x !== t) : [...current, t];
    setFilters({ ...filters, types: next.length === TYPES.length ? undefined : next });
  }
  function apply(e: FormEvent) {
    e.preventDefault();
    setFilters(fromForm(form, filters.types));
  }
  async function handleDelete() {
    if (!rec) return;
    setActionError(null);
    const n = rec.intercepts.length;
    if (
      !(await confirmDelete(
        `Delete the recording "${rec.name}" and its ${rec.report_count.toLocaleString()} reports?` +
          (n ? ` The ${n} Intercept${n === 1 ? "" : "s"} snipped from it stay, with their own reports.` : ""),
      ))
    )
      return;
    try {
      await del.mutateAsync(rec.id);
      navigate("/intercepts");
    } catch (err) {
      setActionError(err instanceof ApiRequestError ? err.message : "Couldn't delete the recording");
    }
  }
  function group() {
    navigate(`/intercepts/import?recording=${recordingId}&snip=${encodeURIComponent(JSON.stringify(filters))}`);
  }

  const timeDomain = ov?.time.min != null && ov.time.max != null ? { min: ov.time.min, max: ov.time.max, bins: ov.time.bins } : null;

  return (
    <div className="page recording-page">
      <BackLink to="/intercepts">Intercepts</BackLink>
      <PageHeader
        title={rec.name}
        info="A whole track export, kept on the server. Cut it down to a snip — drag a box on a chart, or type the limits — then group the snip into an Intercept as you would an imported file. One recording can give many Intercepts."
      >
        <RequireRole minimum="editor">
          <MenuButton
            label="⋯"
            className="button secondary more-button"
            ariaLabel="More actions"
            title="More actions"
            items={[
              { label: "Rename", onSelect: () => setRenaming(true) },
              {
                label: "Delete recording",
                danger: true,
                onSelect: () => void handleDelete(),
                disabled: rec.status === "processing",
              },
            ]}
          />
        </RequireRole>
      </PageHeader>
      <p className="intercept-meta">
        {formatBytes(rec.size_bytes)}
        {rec.status === "ready" && ` · ${rec.report_count.toLocaleString()} reports`}
        {rec.first_time && rec.last_time && ` · ${formatUtc(rec.first_time)} – ${formatUtc(rec.last_time)} (UTC)`}
        {` · uploaded ${formatDateTime(rec.created_at)}`}
        {rec.uploaded_by_username && ` by ${rec.uploaded_by_username}`}
        {rec.skipped_count > 0 && (
          <>
            {" · "}
            <button type="button" className="link-button" onClick={() => setShowSkipped((v) => !v)}>
              {rec.skipped_count.toLocaleString()} line{rec.skipped_count === 1 ? "" : "s"} couldn't be read
            </button>
          </>
        )}
      </p>
      {showSkipped && rec.skipped_sample && (
        <ul className="hint-text recording-skipped">
          {rec.skipped_sample.map((s) => (
            <li key={s}>{s}</li>
          ))}
          {rec.skipped_count > rec.skipped_sample.length && <li>…and {rec.skipped_count - rec.skipped_sample.length} more like these.</li>}
        </ul>
      )}
      {params.get("again") && (
        <p className="recording-note">This file had been uploaded before — this is that recording, with what's been snipped from it.</p>
      )}
      {actionError && <div className="error-text">{actionError}</div>}

      {rec.status === "uploading" && (
        <section className="card">
          <p>The upload didn't finish. Delete this and upload the file again.</p>
        </section>
      )}
      {rec.status === "processing" && (
        <section className="card" role="status">
          <p>
            <strong>Reading the file…</strong> {rec.report_count.toLocaleString()} reports so far.
          </p>
          <progress aria-label="Reading the file" />
          <p className="hint-text">This takes about half a minute per million reports. You can leave this page.</p>
        </section>
      )}
      {rec.status === "failed" && (
        <section className="card">
          <div className="error-text">{rec.error ?? "The file couldn't be read."}</div>
          {rec.skipped_sample && rec.skipped_sample.length > 0 && (
            <ul className="hint-text recording-skipped">
              {rec.skipped_sample.slice(0, 10).map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          )}
        </section>
      )}
      {rec.status === "ready" && !rec.reports_here && (
        <section className="card">
          <p className="hint-text">
            This copy has the recording's details but not its reports — snip it when you're back on the server.
          </p>
        </section>
      )}

      {ready && (
        <>
          <section className="card recording-filters">
            <form onSubmit={apply}>
              <div className="recording-filter-grid">
                <label>
                  From (UTC)
                  <input
                    type="datetime-local"
                    step={1}
                    value={form.t0}
                    onChange={(e) => setForm({ ...form, t0: e.target.value })}
                  />
                </label>
                <label>
                  To (UTC)
                  <input
                    type="datetime-local"
                    step={1}
                    value={form.t1}
                    onChange={(e) => setForm({ ...form, t1: e.target.value })}
                  />
                </label>
                {PARAMS.map((p) => (
                  <fieldset key={p} className="recording-range">
                    <legend>
                      {PARAM_LABEL[p]} ({PARAM_UNIT[p]})
                    </legend>
                    <input
                      type="number"
                      step="any"
                      placeholder="min"
                      aria-label={`${PARAM_LABEL[p]} from`}
                      value={form[`${p}_min`]}
                      onChange={(e) => setForm({ ...form, [`${p}_min`]: e.target.value })}
                    />
                    <span aria-hidden>–</span>
                    <input
                      type="number"
                      step="any"
                      placeholder="max"
                      aria-label={`${PARAM_LABEL[p]} to`}
                      value={form[`${p}_max`]}
                      onChange={(e) => setForm({ ...form, [`${p}_max`]: e.target.value })}
                    />
                  </fieldset>
                ))}
                <label>
                  Tracks
                  <input
                    type="text"
                    placeholder="e.g. 11, 12"
                    value={form.tracks}
                    onChange={(e) => setForm({ ...form, tracks: e.target.value })}
                  />
                </label>
                <label>
                  Identified as
                  <input
                    type="search"
                    placeholder="designation or Mode name"
                    value={form.identified}
                    onChange={(e) => setForm({ ...form, identified: e.target.value })}
                  />
                </label>
              </div>
              <div className="recording-filter-actions">
                <span className="recording-types" role="group" aria-label="PRI types">
                  {TYPES.map(([t, label]) => (
                    <label key={t} className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={!filters.types || filters.types.includes(t)}
                        onChange={() => toggleType(t)}
                      />
                      {label}
                      {ov && <span className="hint-text"> {(ov.by_type[t] ?? 0).toLocaleString()}</span>}
                    </label>
                  ))}
                </span>
                <span className="section-actions">
                  <button type="submit" className="button secondary small">
                    Apply
                  </button>
                  <button type="button" className="button secondary small" disabled={history.length === 0} onClick={undo}>
                    Undo
                  </button>
                  <button type="button" className="button secondary small" disabled={!active} onClick={() => setFilters({})}>
                    Whole recording
                  </button>
                </span>
              </div>
            </form>
          </section>

          <div className="recording-snip-bar">
            <div>
              <strong>{ov ? ov.total.toLocaleString() : "…"}</strong>
              {ov && ` of ${rec.report_count.toLocaleString()} reports`}
              {isFetching && <span className="hint-text"> · updating…</span>}
              <div className="hint-text">{describeSnip(filters)}</div>
            </div>
            {canWrite && (
              <span className="recording-snip-action">
                {tooBig && (
                  <span className="hint-text">
                    At most {ov!.max_snip.toLocaleString()} can be grouped at once — narrow it down.
                  </span>
                )}
                <button type="button" className="button primary" disabled={!ov || ov.total === 0 || tooBig} onClick={group}>
                  Group these reports →
                </button>
              </span>
            )}
          </div>
          {ovError && <div className="error-text">{(ovError as Error).message}</div>}

          {ov && ov.identified.length > 0 && (
            <div className="recording-identified" aria-label="Identified as">
              <span className="hint-text">Identified as:</span>
              {ov.identified.map((i) => (
                <button
                  key={i.label ?? "-"}
                  type="button"
                  className={`recording-chip${filters.identified === i.label ? " active" : ""}`}
                  disabled={!i.label}
                  title={i.label ? `Snip to reports identified as ${i.label}` : "Not identified"}
                  onClick={() => i.label && setFilters({ ...filters, identified: i.label })}
                >
                  {i.label ?? "not identified"} <span className="hint-text">{i.count.toLocaleString()}</span>
                </button>
              ))}
            </div>
          )}

          {ov && timeDomain && (
            <div className="recording-charts">
              <DensityChart title="Reports" unit="" time={timeDomain} counts={ov.counts} height={110} onSnip={(b) => snipTo(b)} />
              {PARAMS.map((p) => {
                const d = ov.params[p];
                return d ? (
                  <DensityChart
                    key={p}
                    title={PARAM_LABEL[p]}
                    unit={PARAM_UNIT[p]}
                    time={timeDomain}
                    values={{ min: d.min, max: d.max, bins: d.bins }}
                    cells={d.cells}
                    onSnip={(b) => snipTo(b, p)}
                  />
                ) : null;
              })}
            </div>
          )}
          {ov && ov.total > 0 && !timeDomain && <p className="hint-text">These reports have no times, so there's nothing to draw over time.</p>}
          {ov && ov.without_time > 0 && timeDomain && (
            <p className="hint-text">{ov.without_time.toLocaleString()} reports in the snip have no time and aren't drawn.</p>
          )}
        </>
      )}

      <section className="card">
        <h3>
          Intercepts from this recording <span className="section-count">{rec.intercepts.length}</span>
        </h3>
        {rec.intercepts.length === 0 ? (
          <p className="hint-text">None yet — snip it and group the snip to make one.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Emitter</th>
                <th>Entries</th>
                <th>Snip</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rec.intercepts.map((i) => (
                <tr key={i.id}>
                  <td>
                    <Link to={`/intercepts/${i.id}`}>{i.name}</Link>
                  </td>
                  <td>
                    <Link to={`/emitters/${i.emitter_id}?tab=intercepts`}>{emitterName.get(i.emitter_id) ?? "—"}</Link>
                  </td>
                  <td>{i.entry_count.toLocaleString()}</td>
                  <td className="hint-text">{i.snip ? describeSnip(i.snip) : "—"}</td>
                  <td>
                    {i.snip && ready && (
                      <button type="button" className="link-button" onClick={() => setFilters(readFilters(i.snip))}>
                        Show this snip
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {renaming && (
        <RenameDialog
          what="recording"
          currentName={rec.name}
          takenNames={(allRecordings ?? []).filter((r) => r.id !== rec.id).map((r) => r.name)}
          takenWhere="among the recordings"
          onRename={(name) => update.mutateAsync({ name })}
          onClose={() => setRenaming(false)}
        />
      )}
      {dialog}
    </div>
  );
}
