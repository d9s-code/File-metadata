import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { MDFS_SECTION, PageHeader } from "../components/common/PageHeader";
import { LoadingState } from "../components/common/LoadingState";
import { StatusBadge } from "../components/status/StatusBadge";
import { formatDate } from "../components/common/dates";
import { ApiRequestError } from "../api/client";
import type { Mdf } from "../api/mdfs";
import type { MdfVersionSummary } from "../api/mdfVersions";
import {
  mdfCompareApi,
  type MdfChange,
  type MdfCompareMode,
  type MdfCompareSide,
} from "../api/mdfCompare";
import type { StatusEntityType } from "../api/statuses";
import { useMdfs } from "../state/hooks/useMdfs";
import { useMdfVersions } from "../state/hooks/useMdfVersions";

const CHANGE_LABEL: Record<MdfChange, string> = {
  added: "Added",
  removed: "Removed",
  changed: "Changed",
  same: "Unchanged",
};

const MODE_CHANGE_LABEL: Record<MdfCompareMode["change"], string> = {
  added: "New",
  changed: "Changed",
  removed: "Removed",
};

function ChangeBadge({ change, label }: { change: MdfChange; label?: string }) {
  return <span className={`status-badge mdf-change-${change}`}>{label ?? CHANGE_LABEL[change]}</span>;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function sideName(s: MdfCompareSide) {
  return `${s.mdf_name} ${s.version != null ? `v${s.version}` : "(now)"}`;
}

/** "v1 → v2", or the one version when it didn't move. */
function versions(from: number[], to: number[]) {
  const f = from.map((v) => `v${v}`).join(", ");
  const t = to.map((v) => `v${v}`).join(", ");
  if (!f) return t;
  if (!t || f === t) return f;
  return `${f} → ${t}`;
}

function StatusMove({ type, from, to }: { type: StatusEntityType; from: string | null; to: string | null }) {
  if (from && to && from !== to) {
    return (
      <span className="mdf-status-move">
        <StatusBadge type={type} status={from} />
        <span className="change-arrow" aria-label="changed to">
          →
        </span>
        <StatusBadge type={type} status={to} />
      </span>
    );
  }
  return <StatusBadge type={type} status={to ?? from} />;
}

/** "now", a version number, or "" for the default. */
function Picker({
  side,
  mdfs,
  mdfId,
  version,
  versionsOf,
  resolved,
  onChange,
}: {
  side: "A" | "B";
  mdfs: Mdf[];
  mdfId: string;
  version: string;
  versionsOf: MdfVersionSummary[] | undefined;
  /** What "Default" stands for here: a version, or null for now. */
  resolved: number | null;
  onChange: (mdfId: string, version: string) => void;
}) {
  return (
    <div className="compare-picker">
      <span className="compare-side">{side}</span>
      <select value={mdfId} onChange={(e) => onChange(e.target.value, "")} aria-label={`MDF ${side}`}>
        <option value="">Choose an MDF…</option>
        {mdfs.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      <select
        value={version}
        onChange={(e) => onChange(mdfId, e.target.value)}
        disabled={!mdfId}
        aria-label={`Version of ${side}`}
      >
        <option value="">Default ({resolved != null ? `v${resolved}` : "now"})</option>
        <option value="now">Now — its current pins</option>
        {[...(versionsOf ?? [])]
          .sort((x, y) => y.version_number - x.version_number)
          .map((v) => (
            <option key={v.id} value={v.version_number}>
              v{v.version_number} · {formatDate(v.created_at)}
              {v.change_summary ? ` — ${v.change_summary}` : ""}
            </option>
          ))}
      </select>
    </div>
  );
}

/** The chosen version, or the default: one MDF on both sides compares its
 * latest version with the one before (or with now, if it has one version);
 * two MDFs compare each one's latest version (or now, if never saved). */
function resolve(chosen: string, latest: number, same: boolean, side: "a" | "b"): number | null {
  if (chosen === "now") return null;
  if (chosen) return Number(chosen);
  if (latest === 0) return null;
  if (!same) return latest;
  if (side === "b") return latest > 1 ? latest : null;
  return latest > 1 ? latest - 1 : latest;
}

export function MdfComparePage() {
  const [params, setParams] = useSearchParams();
  const a = params.get("a") ?? "";
  const b = params.get("b") ?? "";
  const av = params.get("av") ?? "";
  const bv = params.get("bv") ?? "";
  const same = !!a && a === b;
  const { data: mdfs } = useMdfs();
  const { data: versionsA } = useMdfVersions(a);
  const { data: versionsB } = useMdfVersions(b);
  const latestOf = (v: MdfVersionSummary[] | undefined) => Math.max(0, ...(v ?? []).map((x) => x.version_number));
  const ready = !!a && !!b && !!versionsA && !!versionsB;
  const ra = resolve(av, latestOf(versionsA), same, "a");
  const rb = resolve(bv, latestOf(versionsB), same, "b");
  const sameSide = same && ra === rb;
  const { data, error, isFetching } = useQuery({
    queryKey: ["mdf-compare", a, b, ra, rb],
    queryFn: () => mdfCompareApi.compare(a, b, ra, rb),
    enabled: ready && !sameSide,
    retry: false,
  });
  const [showUnchanged, setShowUnchanged] = useState(false);
  // The Mode-by-Mode list can be long: opened on request.
  const [showModes, setShowModes] = useState(false);
  const [modeKinds, setModeKinds] = useState<Set<MdfCompareMode["change"]>>(new Set(["added", "changed", "removed"]));

  function set(next: Record<string, string>) {
    const merged = { a, b, av, bv, ...next };
    setParams(Object.fromEntries(Object.entries(merged).filter(([, v]) => v)), { replace: true });
  }

  const platforms = useMemo(
    () => (data?.platforms ?? []).filter((p) => showUnchanged || p.change !== "same"),
    [data, showUnchanged],
  );
  const emitters = useMemo(
    () => (data?.emitters ?? []).filter((e) => showUnchanged || e.change !== "same"),
    [data, showUnchanged],
  );
  const modes = useMemo(() => (data?.modes ?? []).filter((m) => modeKinds.has(m.change)), [data, modeKinds]);

  if (!mdfs) return <LoadingState label="Loading MDFs…" />;
  const live = mdfs.filter((m) => !m.is_deleted).sort((x, y) => x.name.localeCompare(y.name));
  const c = data?.counts;

  return (
    <div className="page">
      <PageHeader
        title="Compare MDFs"
        section={MDFS_SECTION}
        info="Two MDFs, or one MDF at two points — each a saved version, or as it is now (its current pins). What changed from A to B: Platforms and Emitters in and out, their versions, their statuses as they stood when each version was saved, and the Modes that are new, changed or removed."
      />
      <div className="card compare-pickers">
        <Picker side="A" mdfs={live} mdfId={a} version={av} versionsOf={versionsA} resolved={ra} onChange={(id, v) => set({ a: id, av: v })} />
        <button
          type="button"
          className="button secondary small"
          onClick={() => set({ a: b, b: a, av: bv, bv: av })}
          disabled={!a && !b}
          title="Swap A and B"
        >
          ⇄ Swap
        </button>
        <Picker side="B" mdfs={live} mdfId={b} version={bv} versionsOf={versionsB} resolved={rb} onChange={(id, v) => set({ b: id, bv: v })} />
      </div>

      {!a || !b ? (
        <p className="hint-text">Pick two MDFs to compare, or the same MDF on both sides to see what changed between its versions.</p>
      ) : !ready ? (
        <LoadingState label="Loading versions…" />
      ) : sameSide ? (
        <p className="hint-text">
          {latestOf(versionsA) === 0
            ? "This MDF has no saved version yet — save one to compare it with how it is now."
            : "Both sides are the same — pick another version on one side."}
        </p>
      ) : error ? (
        <p className="error-text">{error instanceof ApiRequestError ? error.message : "Couldn't compare them"}</p>
      ) : !data || !c ? (
        <LoadingState label={isFetching ? "Comparing…" : "Loading…"} />
      ) : (
        <>
          <div className="card compare-verdict">
            <p>
              From <Link to={`/mdfs/${data.a.mdf_id}`}>{sideName(data.a)}</Link>
              {data.a.saved_at && <span className="hint-text"> · saved {formatDate(data.a.saved_at)}</span>} to{" "}
              <Link to={`/mdfs/${data.b.mdf_id}`}>{sideName(data.b)}</Link>
              {data.b.saved_at && <span className="hint-text"> · saved {formatDate(data.b.saved_at)}</span>}
              {data.a.status !== data.b.status && (
                <>
                  {" "}
                  · MDF status <StatusMove type="mdf" from={data.a.status} to={data.b.status} />
                </>
              )}
            </p>
            <ul className="mdf-compare-counts">
              <li>
                <strong>Modes:</strong> {c.modes.added} new · {c.modes.changed} changed · {c.modes.removed} removed
              </li>
              <li>
                <strong>Emitters:</strong> {c.emitters.status_changed} status {c.emitters.status_changed === 1 ? "change" : "changes"} ·{" "}
                {c.emitters.added} added · {c.emitters.removed} removed
              </li>
              <li>
                <strong>Platforms:</strong> {c.platforms.status_changed} status{" "}
                {c.platforms.status_changed === 1 ? "change" : "changes"} · {c.platforms.added} added · {c.platforms.removed} removed
              </li>
            </ul>
            <label className="inline-check">
              <input type="checkbox" checked={showUnchanged} onChange={(e) => setShowUnchanged(e.target.checked)} />
              Show unchanged Platforms and Emitters
            </label>
          </div>

          <div className="card">
            <h3>Platforms</h3>
            {platforms.length === 0 ? (
              <p className="hint-text">No Platform changed.</p>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Platform</th>
                      <th>Change</th>
                      <th>Status</th>
                      <th>Version</th>
                      <th>Emitters</th>
                    </tr>
                  </thead>
                  <tbody>
                    {platforms.map((p) => (
                      <tr key={p.platform_id}>
                        <td>
                          <Link to={`/platforms/${p.platform_id}`}>{p.name}</Link>
                        </td>
                        <td>
                          <ChangeBadge change={p.change} />
                        </td>
                        <td>
                          <StatusMove type="platform" from={p.from_status} to={p.to_status} />
                        </td>
                        <td>{versions(p.from_version != null ? [p.from_version] : [], p.to_version != null ? [p.to_version] : [])}</td>
                        <td>
                          {p.emitters_added.length === 0 && p.emitters_removed.length === 0 ? (
                            <span className="hint-text">{plural(p.emitter_count, "Emitter")}</span>
                          ) : (
                            <>
                              {p.emitters_added.length > 0 && (
                                <div className="mdf-compare-names">
                                  <span className="hint-text">Added</span>
                                  <ul>
                                    {p.emitters_added.map((n) => (
                                      <li key={n}>{n}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {p.emitters_removed.length > 0 && (
                                <div className="mdf-compare-names">
                                  <span className="hint-text">Removed</span>
                                  <ul>
                                    {p.emitters_removed.map((n) => (
                                      <li key={n}>{n}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <h3>Emitters</h3>
            {emitters.length === 0 ? (
              <p className="hint-text">No Emitter changed.</p>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Emitter</th>
                      <th>Change</th>
                      <th>Status</th>
                      <th>Version</th>
                      <th>Modes</th>
                      <th>In Platforms</th>
                    </tr>
                  </thead>
                  <tbody>
                    {emitters.map((e) => (
                      <tr key={e.emitter_id}>
                        <td>
                          <Link to={`/emitters/${e.emitter_id}`}>{e.name}</Link>
                        </td>
                        <td>
                          <ChangeBadge change={e.change} />
                        </td>
                        <td>
                          <StatusMove type="emitter" from={e.from_status} to={e.to_status} />
                        </td>
                        <td>{versions(e.from_versions, e.to_versions)}</td>
                        <td>
                          {e.modes_added + e.modes_changed + e.modes_removed === 0 ? (
                            <span className="hint-text">—</span>
                          ) : (
                            [
                              e.modes_added && `${e.modes_added} new`,
                              e.modes_changed && `${e.modes_changed} changed`,
                              e.modes_removed && `${e.modes_removed} removed`,
                            ]
                              .filter(Boolean)
                              .join(" · ")
                          )}
                        </td>
                        <td>{e.platforms.join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-header">
              <h3>
                <button
                  type="button"
                  className="link-button mdf-compare-toggle"
                  aria-expanded={showModes}
                  onClick={() => setShowModes((v) => !v)}
                >
                  {showModes ? "▾" : "▸"} Modes
                </button>{" "}
                <span className="hint-text">
                  {c.modes.added} new · {c.modes.changed} changed · {c.modes.removed} removed
                </span>
              </h3>
              {showModes && (
                <div className="mdf-compare-kinds" role="group" aria-label="Which Modes to show">
                  {(["added", "changed", "removed"] as const).map((k) => (
                    <label key={k} className="inline-check">
                      <input
                        type="checkbox"
                        checked={modeKinds.has(k)}
                        onChange={() =>
                          setModeKinds((prev) => {
                            const next = new Set(prev);
                            if (next.has(k)) next.delete(k);
                            else next.add(k);
                            return next;
                          })
                        }
                      />
                      {MODE_CHANGE_LABEL[k]} ({c.modes[k]})
                    </label>
                  ))}
                </div>
              )}
            </div>
            {!showModes ? null : modes.length === 0 ? (
              <p className="hint-text">{data.modes.length === 0 ? "No Mode changed." : "None of the kinds ticked."}</p>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Emitter</th>
                      <th>Mode</th>
                      <th>Group</th>
                      <th>Change</th>
                      <th>What changed</th>
                      <th>Ranges</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modes.map((m) => (
                      <tr key={`${m.emitter_id}:${m.mode_id}`}>
                        <td>
                          <Link to={`/emitters/${m.emitter_id}`}>{m.emitter_name}</Link>
                          {m.new_emitter && <span className="hint-text"> (new Emitter)</span>}
                        </td>
                        <td>
                          {m.name}
                          {m.old_name && <span className="hint-text"> (was {m.old_name})</span>}
                        </td>
                        <td>{m.group_name ?? "—"}</td>
                        <td>
                          <ChangeBadge change={m.change} label={MODE_CHANGE_LABEL[m.change]} />
                        </td>
                        <td>{m.fields.length ? m.fields.join(", ") : <span className="hint-text">—</span>}</td>
                        <td>
                          {m.old_summary && <div className="mdf-compare-was">{m.old_summary}</div>}
                          <div className={m.change === "removed" ? "mdf-compare-was" : undefined}>{m.summary || "—"}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
