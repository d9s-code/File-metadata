/** An Emitter's scans, on its Operational modes tab: each one's pattern,
 * values and beam, the illumination time and revisit worked out, and what
 * uses it. Opening one shows the pictures and the working (anyone can look;
 * the editor holding the Emitter changes them). */
import { useState, type ReactNode } from "react";
import type { EmitterScan } from "../../api/scans";
import { RequireRole } from "../../auth/RequireAuth";
import { useEmitter } from "../../state/hooks/useEmitters";
import { useEmitterCheckoutState } from "../../state/hooks/useEmitterCheckout";
import { useDeleteScan, useScans } from "../../state/hooks/useScans";
import { useEmitterModes } from "../../state/hooks/useModes";
import { useOperationalModes } from "../../state/hooks/useOperationalModes";
import { useEwGroups, useUpdateEwGroup } from "../../state/hooks/useEwGroups";
import { ApiRequestError } from "../../api/client";
import { buildTree } from "../operationalModes/opTree";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { MenuButton } from "../common/MenuButton";
import { ScanForm } from "./ScanForm";
import { needsPri, num, paramsText, patternName, scanTiming, spreadText } from "./scanPatterns";

export function ScansCard({ emitterId, children }: { emitterId: string; children?: ReactNode }) {
  const { data: scans } = useScans(emitterId);
  const { data: emitter } = useEmitter(emitterId);
  const { canEdit } = useEmitterCheckoutState(emitter);
  const del = useDeleteScan(emitterId);
  const { confirmDelete, dialog } = useConfirmDialog();
  const [open, setOpen] = useState<EmitterScan | "new" | null>(null);
  const editTitle = canEdit ? undefined : "Start editing this Emitter first";

  async function remove(scan: EmitterScan) {
    const used = scan.operational_modes_count + scan.modes_count;
    const message = used
      ? `Delete the scan '${scan.name}'? ${scan.operational_modes_count} operational mode(s) and ${scan.modes_count} Mode(s) use it: they'll have none of their own (Modes then take their operational mode's).`
      : `Delete the scan '${scan.name}'?`;
    if (await confirmDelete(message)) await del.mutateAsync(scan.id);
  }

  return (
    <div className="card scans-card">
      <div className="card-header-row">
        <h2 className="as-h4">
          Scans <span className="tab-count">{scans?.length ?? 0}</span>
        </h2>
        <RequireRole minimum="editor">
          <button type="button" className="button primary small" disabled={!canEdit} title={editTitle} onClick={() => setOpen("new")}>
            + Add scan
          </button>
        </RequireRole>
      </div>
      <p className="hint-text">
        How the radar's antenna moves, as many as it has. An operational mode uses one (the ones under it too); a Mode can
        use its own. The illumination time and revisit are worked out for the dwell planner — not exported: the XML keeps
        each EW Group's scan range.
      </p>
      {children}
      <GroupRangeCheck emitterId={emitterId} scans={scans ?? []} canEdit={canEdit} />
      {scans && scans.length > 0 ? (
        <div className="matrix-scroll">
          <table className="data-table scans-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Pattern</th>
                <th>Values</th>
                <th>Beam (°)</th>
                <th>Illumination</th>
                <th>Revisit</th>
                <th>Used by</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {scans.map((s) => {
                const t = scanTiming(s);
                const beam = [s.beam_az_deg, s.beam_el_deg].map((b) => (b == null ? null : num(b)));
                return (
                  <tr key={s.id}>
                    <td>
                      <button type="button" className="link-button" onClick={() => setOpen(s)} title={s.description ?? undefined}>
                        {s.name}
                      </button>
                    </td>
                    <td>{patternName(s.pattern)}</td>
                    <td className="scans-values">{paramsText(s) || "—"}</td>
                    <td className="num">{beam[0] || beam[1] ? `${beam[0] ?? "—"}${beam[1] ? ` × ${beam[1]}` : ""}` : "—"}</td>
                    <td className="num">
                      {t.continuous
                        ? "All the time"
                        : t.illuminationMs
                          ? `${spreadText(t.illuminationMs, "ms")}${t.looks > 1 ? ` × ${t.looks}` : ""}${t.typed ? " (typed)" : ""}`
                          : needsPri(s)
                            ? `${Math.round(s.params!.pulses)} × PRI`
                            : <span className="hint-text" title={t.missing.length ? `Still needs: ${t.missing.join(", ")}` : undefined}>Needs values</span>}
                    </td>
                    <td className="num">{t.continuous ? "—" : spreadText(t.revisitS, "s")}</td>
                    <td>
                      {s.operational_modes_count + s.modes_count === 0
                        ? <span className="hint-text">Nothing yet</span>
                        : [
                            s.operational_modes_count ? `${s.operational_modes_count} operational mode${s.operational_modes_count === 1 ? "" : "s"}` : null,
                            s.modes_count ? `${s.modes_count} Mode${s.modes_count === 1 ? "" : "s"}` : null,
                          ]
                            .filter(Boolean)
                            .join(", ")}
                    </td>
                    <td className="row-actions">
                      <MenuButton
                        label="⋯"
                        ariaLabel={`Actions for ${s.name}`}
                        items={[
                          { label: canEdit ? "Edit…" : "Open…", onSelect: () => setOpen(s) },
                          { label: "Delete…", onSelect: () => void remove(s), disabled: !canEdit, title: editTitle, danger: true },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="hint-text">No scans yet.</p>
      )}
      {open && <ScanForm emitterId={emitterId} initial={open === "new" ? undefined : open} readOnly={!canEdit} onClose={() => setOpen(null)} />}
      {dialog}
    </div>
  );
}

interface Outside {
  groupId: string;
  groupName: string;
  range: [number | null, number | null];
  /** The scans its Modes use, outside its range, with their revisits. */
  scans: { name: string; lo: number; hi: number }[];
  /** What would cover them all. */
  widened: [number, number];
}

/** The EW Groups whose scan range (with its delta) doesn't hold the revisits
 * of the scans their Modes use — the XML exports the range, so it should.
 * Widening sets the range to cover them (one click, audited like any edit). */
function GroupRangeCheck({ emitterId, scans, canEdit }: { emitterId: string; scans: EmitterScan[]; canEdit: boolean }) {
  const { data: modes } = useEmitterModes(emitterId);
  const { data: ops } = useOperationalModes(emitterId);
  const { data: groups } = useEwGroups(emitterId);
  const updateGroup = useUpdateEwGroup(emitterId);
  const [error, setError] = useState<string | null>(null);
  if (!modes || !ops || !groups || !scans.length) return null;
  const { byId } = buildTree(ops, modes, new Map(scans.map((x) => [x.id, x.name])));
  const scanById = new Map(scans.map((x) => [x.id, x]));
  const outside: Outside[] = [];
  for (const g of groups) {
    const used = new Map<string, { name: string; lo: number; hi: number }>();
    for (const m of modes.filter((x) => x.ew_group_id === g.id)) {
      const id = m.scan_id ?? (m.operational_mode_id ? byId.get(m.operational_mode_id)?.scanId : null);
      const scan = id ? scanById.get(id) : undefined;
      const rev = scan ? scanTiming(scan).revisitS : null;
      if (scan && rev) used.set(scan.id, { name: scan.name, lo: rev.lo, hi: rev.hi });
    }
    const lo = g.engineered_scan_min ?? g.scan_min;
    const hi = g.engineered_scan_max ?? g.scan_max;
    const out = [...used.values()].filter((u) => lo == null || hi == null || u.lo < lo - 1e-9 || u.hi > hi + 1e-9);
    if (!out.length) continue;
    const all = [...used.values()];
    outside.push({
      groupId: g.id,
      groupName: g.name,
      range: [g.scan_min, g.scan_max],
      scans: out,
      widened: [
        Math.min(...all.map((u) => u.lo), ...(g.scan_min != null ? [g.scan_min] : [])),
        Math.max(...all.map((u) => u.hi), ...(g.scan_max != null ? [g.scan_max] : [])),
      ],
    });
  }
  if (!outside.length) return null;
  const secs = (a: number, b: number) => (Math.abs(a - b) < 1e-9 ? `${num(a)} s` : `${num(a)}–${num(b)} s`);
  return (
    <div className="scan-group-check" role="status">
      {outside.map((o) => (
        <p key={o.groupId}>
          <span className="mode-form-warning">
            EW Group {o.groupName}&apos;s scan range (
            {o.range[0] != null && o.range[1] != null ? secs(o.range[0], o.range[1]) : "not set"}, exported to the XML) doesn&apos;t hold{" "}
            {o.scans.map((x) => `${x.name} (${secs(x.lo, x.hi)})`).join(", ")}.
          </span>{" "}
          <button
            type="button"
            className="link-button"
            disabled={!canEdit || updateGroup.isPending}
            title={canEdit ? undefined : "Start editing this Emitter first"}
            onClick={async () => {
              setError(null);
              try {
                await updateGroup.mutateAsync({
                  ewGroupId: o.groupId,
                  input: { scan_min: Number(o.widened[0].toFixed(4)), scan_max: Number(o.widened[1].toFixed(4)) },
                });
              } catch (err) {
                setError(err instanceof ApiRequestError ? err.message : "Couldn't change the EW Group");
              }
            }}
          >
            Widen it to {secs(o.widened[0], o.widened[1])}
          </button>
        </p>
      ))}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
