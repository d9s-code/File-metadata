import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "../components/common/PageHeader";
import { MenuButton } from "../components/common/MenuButton";
import { RenameDialog } from "../components/common/RenameDialog";
import { LoadingState } from "../components/common/LoadingState";
import { useConfirmDialog } from "../components/common/ConfirmDialog";
import { StrategyEditor } from "../components/dwells/StrategyEditor";
import { num } from "../components/dwells/DwellChart";
import { useHasRole } from "../auth/RequireAuth";
import { ApiRequestError } from "../api/client";
import { dwellsApi, type DwellFile, type DwellFileUpdate } from "../api/dwells";
import {
  dwellsKey,
  useAddDwellStrategy,
  useAppSettings,
  useDeleteDwellStrategy,
  useDwellFile,
  useDwellFiles,
  useUpdateDwellFile,
  useUpdateDwellStrategy,
} from "../state/hooks/useDwells";
import { useMdfLinks, useMdfs } from "../state/hooks/useMdfs";
import { usePlatforms } from "../state/hooks/usePlatforms";

/** A number field that saves when it's left (or on Enter), if it changed. */
function SavedNumber({
  label,
  value,
  placeholder,
  disabled,
  onSave,
}: {
  label: string;
  value: number | null;
  placeholder?: string;
  disabled?: boolean;
  onSave: (value: number | null) => void;
}) {
  const [text, setText] = useState(value == null ? "" : num(value));
  const [was, setWas] = useState(value);
  if (was !== value) {
    setWas(value);
    setText(value == null ? "" : num(value));
  }
  function commit() {
    const next = text.trim() === "" ? null : Number(text);
    if (next != null && !(next >= 0)) {
      setText(value == null ? "" : num(value));
      return;
    }
    if (next !== value) onSave(next);
  }
  return (
    <label>
      {label}
      <input
        type="number"
        step="any"
        min="0"
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
      />
    </label>
  );
}

/** One dwell file: its settings, the chart bandwidth, and one Dwell Strategy
 * per Platform with its Merged Mode dwells. */
export function DwellFilePage() {
  const { dwellId = "" } = useParams<{ dwellId: string }>();
  const { data: file, isLoading, error } = useDwellFile(dwellId);
  if (isLoading) return <LoadingState label="Loading dwell file…" />;
  if (!file || error)
    return (
      <div className="page">
        <Link to="/dwells">← Dwells</Link>
        <p className="hint-text">This dwell file doesn&apos;t exist (it may have been deleted).</p>
      </div>
    );
  return <DwellFileView file={file} />;
}

function DwellFileView({ file }: { file: DwellFile }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canEdit = useHasRole("editor");
  const { data: settings } = useAppSettings();
  const { data: mdfs } = useMdfs();
  const { data: links } = useMdfLinks(file.mdf_id ?? "");
  const { data: platforms } = usePlatforms();
  const { data: files } = useDwellFiles();
  const update = useUpdateDwellFile(file.id);
  const addStrategy = useAddDwellStrategy(file.id);
  const updateStrategy = useUpdateDwellStrategy(file.id);
  const deleteStrategy = useDeleteDwellStrategy(file.id);
  const { confirmDelete, dialog } = useConfirmDialog();
  const [renaming, setRenaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaultBandwidth = settings?.dwell_bandwidth_mhz ?? 10;
  const bandwidth = file.bandwidth_mhz ?? defaultBandwidth;
  const mdfPlatformIds = file.mdf_id ? new Set((links ?? []).map((l) => l.platform_id)) : null;
  const platformList = (platforms ?? [])
    .map((p) => ({ id: p.id, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const missing = mdfPlatformIds
    ? [...mdfPlatformIds].filter((id) => !file.strategies.some((s) => s.platform_id === id))
    : [];

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "That didn't work.");
    }
  }
  const save = (input: DwellFileUpdate) => run(() => update.mutateAsync(input));

  async function download() {
    await run(async () => {
      const blob = await dwellsApi.xml(file.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${file.name.replace(/[^\w.-]+/g, "_")}.xml`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
  }

  async function handleDelete() {
    if (!(await confirmDelete(`Delete the dwell file "${file.name}" and its ${file.strategies.length} Strategies?`))) return;
    await run(async () => {
      await dwellsApi.delete(file.id);
      qc.invalidateQueries({ queryKey: dwellsKey });
      navigate("/dwells");
    });
  }

  async function move(index: number, direction: -1 | 1) {
    const a = file.strategies[index];
    const b = file.strategies[index + direction];
    if (!a || !b) return;
    // Swap their places, numbering every Strategy by its new place.
    const order = [...file.strategies];
    [order[index], order[index + direction]] = [b, a];
    await run(async () => {
      for (const [place, strategy] of order.entries()) {
        if (strategy.sort_order !== place) await updateStrategy.mutateAsync({ strategyId: strategy.id, input: { sort_order: place } });
      }
    });
  }

  return (
    <div className="page">
      <Link to="/dwells">← Dwells</Link>
      <PageHeader title={file.name}>
        <button type="button" className="button secondary" onClick={() => void download()}>
          Download XML
        </button>
        {canEdit && (
          <MenuButton
            label="More ▾"
            items={[
              { label: "Rename…", onSelect: () => setRenaming(true) },
              { label: "Delete this dwell file…", danger: true, onSelect: () => void handleDelete() },
            ]}
          />
        )}
      </PageHeader>

      <div className="card dwell-settings">
        <div className="form-row">
          <label>
            For the MDF
            <select
              value={file.mdf_id ?? ""}
              disabled={!canEdit}
              onChange={(e) => void save({ mdf_id: e.target.value || null })}
            >
              <option value="">None</option>
              {(mdfs ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <SavedNumber label="Timeout" value={file.timeout} disabled={!canEdit} onSave={(v) => v != null && void save({ timeout: v })} />
          <SavedNumber
            label="Setup time"
            value={file.setup_time}
            disabled={!canEdit}
            onSave={(v) => v != null && void save({ setup_time: v })}
          />
          <SavedNumber
            label="Chart bandwidth (MHz)"
            value={file.bandwidth_mhz}
            placeholder={`${num(defaultBandwidth)} (default)`}
            disabled={!canEdit}
            onSave={(v) => void save({ bandwidth_mhz: v && v > 0 ? v : null })}
          />
        </div>
        <p className="hint-text">
          {file.mdf_id ? (
            <>
              Goes into <Link to={`/mdfs/${file.mdf_id}`}>{file.mdf_name}</Link>&apos;s export as dwells/{file.name}.xml.{" "}
            </>
          ) : (
            "Not in any MDF's export yet. "
          )}
          The charts draw each dwell ± half the bandwidth —{" "}
          {file.bandwidth_mhz == null
            ? `the default, ${num(defaultBandwidth)} MHz (set by an admin under Admin → Settings).`
            : `${num(file.bandwidth_mhz)} MHz for this file; leave it blank for the default (${num(defaultBandwidth)} MHz).`}
        </p>
        {missing.length > 0 && (
          <p className="mode-form-warning">
            {missing.length} Platform{missing.length === 1 ? "" : "s"} in the MDF {missing.length === 1 ? "has" : "have"} no
            Strategy yet: {missing.map((id) => platformList.find((p) => p.id === id)?.name ?? "?").join(", ")}.
          </p>
        )}
      </div>

      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}

      {file.strategies.map((s, i) => (
        <StrategyEditor
          key={s.id}
          index={i}
          count={file.strategies.length}
          strategy={s}
          platforms={platformList}
          mdfPlatformIds={mdfPlatformIds}
          takenPlatformIds={new Set(file.strategies.filter((o) => o.id !== s.id && o.platform_id).map((o) => o.platform_id as string))}
          bandwidthMhz={bandwidth}
          canEdit={canEdit}
          onSave={(input) => updateStrategy.mutateAsync({ strategyId: s.id, input })}
          onMove={(direction) => void move(i, direction)}
          onRemove={async () => {
            if (!(await confirmDelete(`Remove Strategy ${i + 1}${s.platform_name ? ` (${s.platform_name})` : ""}?`))) return;
            await run(() => deleteStrategy.mutateAsync(s.id));
          }}
        />
      ))}
      {file.strategies.length === 0 && <p className="hint-text">No Dwell Strategies yet.</p>}
      {canEdit && (
        <button
          type="button"
          className="button secondary"
          disabled={addStrategy.isPending}
          onClick={() => void run(() => addStrategy.mutateAsync(missing[0] ?? null))}
        >
          + Add a Dwell Strategy{missing[0] ? ` for ${platformList.find((p) => p.id === missing[0])?.name ?? "the next Platform"}` : ""}
        </button>
      )}

      {renaming && (
        <RenameDialog
          what="dwell file"
          currentName={file.name}
          takenNames={(files ?? []).filter((f) => f.id !== file.id).map((f) => f.name)}
          takenWhere="here"
          onRename={(name) => update.mutateAsync({ name })}
          onClose={() => setRenaming(false)}
        />
      )}
      {dialog}
    </div>
  );
}
