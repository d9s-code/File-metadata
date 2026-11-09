import { useMemo } from "react";
import type { AmbiguityFinding, OverlapParam } from "../../api/ambiguity";
import { sideRange, sideSteps, type GroupMode } from "./ambiguityAnalysis";
import { PARAMS, SEVERITY_LABEL, num, rangeText } from "./ambiguityText";

/** Every Mode of a group on one parameter, a row each, so the overlaps are
 * seen at once: the selected pair in its two colours, the part they share
 * shaded across the rows. Click a Mode to list only its pairs. */
export function GroupChart({
  modes,
  param,
  params,
  onParam,
  selected,
  focusModeId,
  onFocusMode,
  showEmitter,
  changed,
}: {
  modes: GroupMode[];
  param: OverlapParam;
  /** The parameters these Modes were compared on. */
  params: OverlapParam[];
  onParam: (p: OverlapParam) => void;
  selected: AmbiguityFinding | null;
  focusModeId: string | null;
  onFocusMode: (id: string | null) => void;
  showEmitter: boolean;
  /** Modes edited or deleted since the check. */
  changed: Map<string, "changed" | "gone">;
}) {
  const rows = useMemo(() => {
    const out = modes.map((m) => ({ m, range: sideRange(m.compared, param), steps: sideSteps(m.compared, param) }));
    const start = (r: (typeof out)[number]) => r.range?.[0] ?? r.steps?.[0] ?? Infinity;
    return out.sort((x, y) => start(x) - start(y) || (x.range?.[1] ?? 0) - (y.range?.[1] ?? 0));
  }, [modes, param]);

  const values = rows.flatMap((r) => [...(r.range ?? []), ...(r.steps ?? [])]);
  if (values.length === 0) return <p className="hint-text">These Modes weren&apos;t compared on this parameter.</p>;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || Math.max(Math.abs(hi) * 0.01, 1);
  const pad = span * 0.03;
  const x = (v: number) => ((v - (lo - pad)) / (span + 2 * pad)) * 100;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => lo + t * span);

  const sideOf = (id: string) => (selected?.mode_id_a === id ? "a" : selected?.mode_id_b === id ? "b" : null);
  const selA = selected ? rows.find((r) => r.m.id === selected.mode_id_a)?.range : null;
  const selB = selected ? rows.find((r) => r.m.id === selected.mode_id_b)?.range : null;
  const shared = selA && selB && Math.max(selA[0], selB[0]) <= Math.min(selA[1], selB[1]) ? [Math.max(selA[0], selB[0]), Math.min(selA[1], selB[1])] : null;
  const unit = PARAMS.find((p) => p.key === param)?.unit ?? "";

  return (
    <div className={showEmitter ? "group-chart with-emitter" : "group-chart"}>
      <div className="group-chart-head">
        <span className="readout-label">The Modes on</span>
        <span className="seg-toggle" role="group" aria-label="Parameter">
          {params.map((p) => (
            <button type="button" key={p} className={p === param ? "on" : undefined} onClick={() => onParam(p)}>
              {PARAMS.find((x) => x.key === p)?.label}
            </button>
          ))}
        </span>
        <span className="hint-text">{unit} · ranges with ± delta · click a Mode for only its pairs</span>
      </div>
      <div className="group-chart-plot">
        {shared && (
          <div
            className="group-chart-shared"
            style={{ left: `calc(var(--gc-label) + (100% - var(--gc-label) - var(--gc-count)) * ${x(shared[0]) / 100})`, width: `calc((100% - var(--gc-label) - var(--gc-count)) * ${Math.max(0.3, x(shared[1]) - x(shared[0])) / 100})` }}
          />
        )}
        {rows.map(({ m, range, steps }) => {
          const side = sideOf(m.id);
          const c = changed.get(m.id);
          return (
            <button
              type="button"
              key={m.id}
              className={`group-chart-row${side ? ` side-${side}` : ""}${focusModeId === m.id ? " focused" : ""}${focusModeId && focusModeId !== m.id ? " dim" : ""}`}
              onClick={() => onFocusMode(focusModeId === m.id ? null : m.id)}
              title={`${m.name}${showEmitter ? ` · ${m.emitterName}` : ""}: ${range ? rangeText(range) : (steps ?? []).map(num).join(", ")} ${unit} · in ${m.pairs} pair${m.pairs === 1 ? "" : "s"}, worst ${SEVERITY_LABEL[m.worst]}${c ? ` · ${c === "gone" ? "deleted" : "edited"} since the check` : ""}`}
            >
              <span className="group-chart-name">
                {m.name}
                {showEmitter && <span className="hint-text"> · {m.emitterName}</span>}
                {c && <span className={`finding-changed-dot ${c}`} aria-label={c === "gone" ? "deleted since" : "edited since"} />}
              </span>
              <span className="group-chart-track">
                {range ? (
                  <i className="group-chart-bar" style={{ left: `${x(range[0])}%`, width: `${Math.max(0.6, x(range[1]) - x(range[0]))}%` }} />
                ) : (
                  (steps ?? []).map((v, i) => <i key={i} className="group-chart-step" style={{ left: `${x(v)}%` }} />)
                )}
              </span>
              <span className={`group-chart-count sev-text-${m.worst}`}>{m.pairs}</span>
            </button>
          );
        })}
        <div className="group-chart-axis" aria-hidden>
          {ticks.map((t, i) => (
            <span key={i} style={{ left: `${x(t)}%` }}>
              {num(Math.round(t * 1000) / 1000)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
