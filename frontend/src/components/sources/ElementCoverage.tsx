import { useState, type ReactNode } from "react";

const INCLUDED_KEY = "elementCoverageTypes";

/** The parameters ticked last time in this browser (all, the first time). */
function readIncluded(): Set<ElementType> {
  try {
    const saved = JSON.parse(localStorage.getItem(INCLUDED_KEY) ?? "null");
    if (Array.isArray(saved)) return new Set(saved.filter((t) => ["rf", "pri", "pw", "scan"].includes(t)));
  } catch {
    // Unreadable or blocked storage: start with everything.
  }
  return new Set(["rf", "pri", "pw", "scan"]);
}
import { Link } from "react-router-dom";
import { InfoTip } from "../common/PageHeader";
import { buildScale, num } from "../dwells/DwellChart";
import { useWidth } from "../intercepts/charts/Histogram";
import { elementValues } from "./elementDisplay";
import { useElementCoverage } from "../../state/hooks/useElements";
import { useEmitterModes } from "../../state/hooks/useModes";
import { useEwGroups } from "../../state/hooks/useEwGroups";
import type { Coverage, CoverageRange, ElementCoverageRow } from "../../api/elements";
import type { ElementType } from "../../types/domain";
import { AddValueToModesDialog, type ValueSeed } from "../modes/AddValueToModesDialog";
import { useHasRole } from "../../auth/RequireAuth";

const TYPES: { key: ElementType; label: string; unit: string; pad: number; ranges: string }[] = [
  { key: "rf", label: "RF", unit: "MHz", pad: 1, ranges: "Modes' RF" },
  { key: "pri", label: "PRI", unit: "µs", pad: 1, ranges: "Modes' PRI (Stagger: each step)" },
  { key: "pw", label: "PW", unit: "µs", pad: 0.01, ranges: "Modes' PW" },
  { key: "scan", label: "Scan", unit: "s", pad: 0.05, ranges: "EW Groups' scan" },
];

/** Each state's colour (status palette), mark and words — never colour alone. */
const STATE: Record<Coverage, { cls: string; icon: string; label: string }> = {
  covered: { cls: "status-good", icon: "✓", label: "Covered" },
  partial: { cls: "status-warning", icon: "½", label: "Partly covered" },
  not_covered: { cls: "status-critical", icon: "✕", label: "Not covered" },
};

// Chart geometry (px).
const M = { top: 8, right: 14, bottom: 26, left: 74 };
const RANGE_H = 6;
const ELEMENT_H = 9;
const ROW_GAP = 4;
const SECTION_GAP = 14;
const MIN_W = 8;

type Span = [number, number];

const elementSpan = (r: ElementCoverageRow): Span | null => {
  if (r.stagger_values?.length) return [Math.min(...r.stagger_values), Math.max(...r.stagger_values)];
  const lo = r.value_min ?? r.value_max;
  const hi = r.value_max ?? r.value_min;
  return lo == null || hi == null ? null : [Math.min(lo, hi), Math.max(lo, hi)];
};
const elementKey = (r: ElementCoverageRow) => r.occurrences[0].element_id;

/** An Element's values, or a sequence's steps, in words. */
function rowValues(r: ElementCoverageRow, unit: string): string {
  if (!r.sequence) return elementValues(r);
  const what = r.element_type === "pri" ? "stagger" : `${r.element_type.toUpperCase()} steps`;
  return `Sequence '${r.sequence.label}' — ${what} ${(r.stagger_values ?? []).map(num).join(", ")} ${unit}`;
}

/** Greedy rows: each item goes in the first row it fits without touching. */
function pack<T>(items: T[], extent: (t: T) => Span): { item: T; row: number }[] {
  const ends: number[] = [];
  return [...items]
    .sort((a, b) => extent(a)[0] - extent(b)[0])
    .map((item) => {
      const [x0, x1] = extent(item);
      let row = ends.findIndex((end) => x0 > end + 4);
      if (row === -1) row = ends.push(x1) - 1;
      else ends[row] = x1;
      return { item, row };
    });
}

/** A Mode's ranges together: one bar, or for a Stagger Mode its steps. */
interface RangeGroup {
  id: string;
  name: string;
  kind: CoverageRange["kind"];
  group: string;
  parts: CoverageRange[];
}

function groupRanges(ranges: CoverageRange[]): RangeGroup[] {
  const out = new Map<string, RangeGroup>();
  for (const r of ranges) {
    const g = out.get(r.id) ?? { id: r.id, name: r.name, kind: r.kind, group: r.group, parts: [] };
    g.parts.push(r);
    out.set(r.id, g);
  }
  return [...out.values()];
}

const spanText = ([lo, hi]: Span, unit: string) => (lo === hi ? `${num(lo)} ${unit}` : `${num(lo)}–${num(hi)} ${unit}`);

/** What's hovered, and where its mark sits (px), to put the details beside it. */
type Hover =
  | { kind: "element"; row: ElementCoverageRow; x: number; y: number }
  | { kind: "range"; group: RangeGroup; x: number; y: number }
  | null;

/** A cut stretch's ends, rounded to read. */
const roughly = (v: number) => num(Number(v.toPrecision(3)));

/** One parameter: the Modes' ranges above, the Elements below, on one axis. */
function CoverageChart({
  type,
  rows,
  ranges,
}: {
  type: (typeof TYPES)[number];
  rows: ElementCoverageRow[];
  ranges: CoverageRange[];
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<Hover>(null);
  const groups = groupRanges(ranges);
  const spans: Span[] = [
    ...rows.map(elementSpan).filter((s): s is Span => !!s),
    ...ranges.map((r): Span => [r.min, r.max]),
  ];
  const plotW = Math.max(160, width - M.left - M.right);
  const scale = spans.length ? buildScale("cut", spans, M.left, plotW, type.pad) : null;
  const x = scale?.x ?? (() => M.left);
  const pxSpan = ([lo, hi]: Span): Span => {
    const a = x(lo);
    const b = x(hi);
    const mid = (a + b) / 2;
    return b - a >= MIN_W ? [a, b] : [mid - MIN_W / 2, mid + MIN_W / 2];
  };

  const placedRanges = pack(groups, (g) => pxSpan([Math.min(...g.parts.map((p) => p.min)), Math.max(...g.parts.map((p) => p.max))]));
  const rangeRows = Math.max(1, ...placedRanges.map((p) => p.row + 1));
  const drawn = rows.filter((r) => elementSpan(r));
  const placedElements = pack(drawn, (r) => pxSpan(elementSpan(r)!));
  const elementRows = Math.max(1, ...placedElements.map((p) => p.row + 1));
  const rangesTop = M.top;
  const elementsTop = rangesTop + rangeRows * (RANGE_H + ROW_GAP) + SECTION_GAP;
  const axisY = elementsTop + elementRows * (ELEMENT_H + ROW_GAP) + 4;
  const H = axisY + M.bottom;

  // What the hovered mark is tied to: an Element's Modes, or a Mode's Elements.
  const lit = new Set<string>();
  if (hover?.kind === "element") hover.row.covered_by.forEach((c) => lit.add(c.id));
  if (hover?.kind === "range")
    for (const r of rows) if (r.covered_by.some((c) => c.id === hover.group.id)) lit.add(elementKey(r));
  const dimRange = (g: RangeGroup) => (hover?.kind === "element" && !lit.has(g.id)) || (hover?.kind === "range" && hover.group.id !== g.id);
  const dimElement = (r: ElementCoverageRow) =>
    (hover?.kind === "range" && !lit.has(elementKey(r))) || (hover?.kind === "element" && elementKey(hover.row) !== elementKey(r));

  let tip: ReactNode = null;
  if (hover?.kind === "element") {
    const r = hover.row;
    const st = STATE[r.coverage];
    const sources = [...new Set(r.occurrences.map((o) => o.source_name))];
    tip = (
      <>
        <div>
          <strong>{rowValues(r, type.unit)}</strong>
        </div>
        <div>
          <span className={`viz-swatch ${st.cls}`} /> {st.icon} {st.label}
          {r.coverage === "covered" && r.covered_by.length > 0 && ` by ${r.covered_by.map((c) => c.name).join(", ")}`}
        </div>
        {r.coverage !== "covered" && (r.note || r.covered_by.length > 0) && (
          <div>{r.note ?? `Partly by ${r.covered_by.map((c) => c.name).join(", ")}`}</div>
        )}
        <div className="hint-text">
          {sources.length === 1 ? "Source" : "Sources"}: {sources.join(", ")}
        </div>
      </>
    );
  } else if (hover?.kind === "range") {
    const g = hover.group;
    const covers = rows.filter((r) => r.covered_by.some((c) => c.id === g.id)).length;
    tip = (
      <>
        <div>
          <strong>{g.name}</strong> {g.kind === "mode" && <span className="hint-text">· {g.group}</span>}
        </div>
        <div>
          {g.parts.length > 1
            ? `Steps ${g.parts.map((p) => num((p.min + p.max) / 2)).join(", ")} ${type.unit}`
            : spanText([g.parts[0].min, g.parts[0].max], type.unit)}{" "}
          <span className="hint-text">(with its delta)</span>
        </div>
        <div className="hint-text">
          Covers {covers} of the {rows.length} {type.label} Element{rows.length === 1 ? "" : "s"}
        </div>
      </>
    );
  }

  return (
    <div className="viz-card coverage-chart">
      <div className="viz-card-header">
        <strong>{type.label}</strong>
        <span className="hint-text">
          {scale && scale.breaks.length > 0 &&
            `${scale.breaks.length} empty stretch${scale.breaks.length === 1 ? "" : "es"} cut (${scale.breaks
              .map((b) => `${roughly(b.from)}–${roughly(b.to)}`)
              .join(", ")} ${type.unit})`}
        </span>
      </div>
      <div ref={ref} className="viz-plot" onPointerLeave={() => setHover(null)}>
        {width > 0 && scale && (
          <svg width={width} height={H} role="img" aria-label={`${type.label} Elements against the ${type.ranges} ranges`}>
            {scale.breaks.map((b) => (
              <g key={b.x0} className="coverage-break">
                <rect x={b.x0} y={rangesTop} width={b.x1 - b.x0} height={axisY - rangesTop} />
                <text x={(b.x0 + b.x1) / 2} y={axisY + 4} textAnchor="middle">
                  ⧵⧵
                </text>
              </g>
            ))}
            {scale.ticks.map((t) => (
              <g key={t}>
                <line className="coverage-grid" x1={x(t)} x2={x(t)} y1={rangesTop} y2={axisY} />
                <text className="coverage-tick" x={x(t)} y={axisY + 14} textAnchor="middle">
                  {num(t)}
                </text>
              </g>
            ))}
            <line className="coverage-axis" x1={M.left} x2={M.left + plotW} y1={axisY} y2={axisY} />
            <text className="coverage-tick" x={M.left + plotW} y={axisY + 24} textAnchor="end">
              {type.unit}
            </text>
            <text className="coverage-lane-label" x={M.left - 8} y={rangesTop + RANGE_H} textAnchor="end">
              {type.key === "scan" ? "EW Groups" : "Modes"}
            </text>
            <text className="coverage-lane-label" x={M.left - 8} y={elementsTop + ELEMENT_H - 1} textAnchor="end">
              Elements
            </text>

            {groups.length === 0 && (
              <text className="coverage-tick" x={M.left + 4} y={rangesTop + RANGE_H}>
                {type.key === "scan" ? "No EW Group has a scan range" : "No Mode has one"}
              </text>
            )}
            {placedRanges.map(({ item: g, row }) => {
              const y = rangesTop + row * (RANGE_H + ROW_GAP);
              const [x0, x1] = pxSpan([Math.min(...g.parts.map((p) => p.min)), Math.max(...g.parts.map((p) => p.max))]);
              const steps = g.parts.length > 1 || g.parts[0].step;
              return (
                <g
                  key={g.id}
                  className={dimRange(g) ? "coverage-range dimmed" : "coverage-range"}
                  onPointerEnter={() => setHover({ kind: "range", group: g, x: x0, y: y + RANGE_H })}
                >
                  <rect className="coverage-hit" x={x0 - 3} y={y - 3} width={x1 - x0 + 6} height={RANGE_H + 6} />
                  {steps ? (
                    <>
                      <line className="coverage-steps-line" x1={x0} x2={x1} y1={y + RANGE_H / 2} y2={y + RANGE_H / 2} />
                      {g.parts.map((p, i) => {
                        const [a, b] = pxSpan([p.min, p.max]);
                        return <rect key={i} x={(a + b) / 2 - 1.5} y={y - 1} width={3} height={RANGE_H + 2} rx={1} />;
                      })}
                    </>
                  ) : (
                    <rect x={x0} y={y} width={x1 - x0} height={RANGE_H} rx={3} />
                  )}
                </g>
              );
            })}

            {placedElements.map(({ item: r, row }) => {
              const y = elementsTop + row * (ELEMENT_H + ROW_GAP);
              const span = elementSpan(r)!;
              const [x0, x1] = pxSpan(span);
              const st = STATE[r.coverage];
              const point = span[0] === span[1] && !r.stagger_values?.length;
              return (
                <g
                  key={elementKey(r)}
                  className={`coverage-element ${st.cls}${dimElement(r) ? " dimmed" : ""}`}
                  onPointerEnter={() => setHover({ kind: "element", row: r, x: x0, y: y + ELEMENT_H })}
                >
                  <rect className="coverage-hit" x={x0 - 4} y={y - 4} width={x1 - x0 + 8} height={ELEMENT_H + 8} />
                  {r.stagger_values?.length ? (
                    <>
                      <line className="coverage-steps-line" x1={x0} x2={x1} y1={y + ELEMENT_H / 2} y2={y + ELEMENT_H / 2} />
                      {r.stagger_values.map((v, i) =>
                        r.sequence ? (
                          <rect key={i} x={x(v) - 4} y={y + ELEMENT_H / 2 - 4} width={8} height={8} rx={1.5} />
                        ) : (
                          <circle key={i} cx={x(v)} cy={y + ELEMENT_H / 2} r={4} />
                        ),
                      )}
                    </>
                  ) : point ? (
                    <circle cx={(x0 + x1) / 2} cy={y + ELEMENT_H / 2} r={4.5} />
                  ) : (
                    <rect x={x0} y={y} width={x1 - x0} height={ELEMENT_H} rx={4} />
                  )}
                </g>
              );
            })}
          </svg>
        )}
        {tip && (
          <div
            className="viz-tooltip coverage-tip"
            style={{ top: (hover?.y ?? 0) + 8, left: Math.max(0, Math.min(hover?.x ?? 0, width - 260)) }}
          >
            {tip}
          </div>
        )}
      </div>
    </div>
  );
}

/** An uncovered Element (or a sequence's stagger) as the value to add to the
 * Modes; null for what can't be added that way (scan, a sequence of RF hops). */
function seedOf(r: ElementCoverageRow): ValueSeed | null {
  if (r.element_type === "scan" || (r.sequence && r.element_type !== "pri")) return null;
  const margin = r.occurrences.find((o) => o.delta != null)?.delta ?? 0;
  if (r.stagger_values?.length) return { parameter: "pri", priType: "stagger", steps: r.stagger_values, margin };
  return {
    parameter: r.element_type as "rf" | "pri" | "pw",
    priType: "fixed",
    from: r.value_min,
    to: r.value_max,
    jitterFrom: r.jitter_min ?? 0,
    jitterTo: r.jitter_max ?? 0,
    margin,
  };
}

/** Which Elements in the Emitter's Sources its Modes cover — each parameter
 * as a chart (Modes' ranges above, Elements below, coloured by coverage),
 * then the ones not, or not wholly, covered as a list. */
export function ElementCoverage({ emitterId }: { emitterId: string }) {
  const modes = useEmitterModes(emitterId);
  const groups = useEwGroups(emitterId);
  const { data, isLoading } = useElementCoverage(emitterId, modes.dataUpdatedAt, groups.dataUpdatedAt);
  const [open, setOpen] = useState(true);
  const [included, setIncluded] = useState<Set<ElementType>>(readIncluded);
  const [adding, setAdding] = useState<ElementCoverageRow | null>(null);
  const canWrite = useHasRole("editor");

  function toggleType(t: ElementType) {
    const next = new Set(included);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    setIncluded(next);
    try {
      localStorage.setItem(INCLUDED_KEY, JSON.stringify([...next]));
    } catch {
      // Not remembered, but still applied.
    }
  }

  const all = data?.elements ?? [];
  const present = TYPES.filter((t) => all.some((r) => r.element_type === t.key));
  const rows = all.filter((r) => included.has(r.element_type));
  const count = (c: Coverage) => rows.filter((r) => r.coverage === c).length;
  const gaps = rows.filter((r) => r.coverage !== "covered");
  const types = present.filter((t) => included.has(t.key));

  return (
    <div className="card element-coverage">
      <div className="card-header-row">
        <h4>
          Element coverage{" "}
          {rows.length > 0 && (
            <span className="hint-text">
              {count("covered")} of {rows.length} Elements covered
              {count("partial") > 0 && ` · ${count("partial")} partly`}
              {count("not_covered") > 0 && ` · ${count("not_covered")} not`}
            </span>
          )}{" "}
          <InfoTip label="About Element coverage">
            Whether each Element in this Emitter&apos;s Sources is covered by a Mode: its RF, PRI or PW inside a
            Mode&apos;s range (with the Mode&apos;s delta), a PRI used as a step of a Stagger Mode, a scan inside an
            EW Group&apos;s scan range. A stagger — a stagger Element, or a Source&apos;s sequence with PRI steps (in
            step order, a range at its middle) — is checked against the Stagger Modes in order: covered by one with the
            same steps in the same order (from any step), and a sequence&apos;s RF and PW must fit that Mode too. A
            sequence without PRI has each step&apos;s RF and PW checked. <strong>Partly</strong> means only some of it
            is; the note says how. Hover a mark to see what covers it; hover a Mode to see what it covers.
          </InfoTip>
        </h4>
        <button type="button" className="link-button" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "Hide" : "Show"}
        </button>
      </div>
      {open &&
        (isLoading ? (
          <p className="hint-text">Loading…</p>
        ) : all.length === 0 ? (
          <p className="hint-text">No Elements in this Emitter&apos;s Sources yet.</p>
        ) : (
          <>
            <div className="coverage-include" role="group" aria-label="Parameters included">
              <span className="hint-text">Include</span>
              {present.map((t) => {
                const n = all.filter((r) => r.element_type === t.key).length;
                return (
                  <label key={t.key} className="checkbox-label">
                    <input type="checkbox" checked={included.has(t.key)} onChange={() => toggleType(t.key)} />
                    {t.label} <span className="hint-text">({n})</span>
                  </label>
                );
              })}
            </div>
            {rows.length === 0 && <p className="hint-text">No parameter ticked — tick one to see its coverage.</p>}
            <div className="viz-legend coverage-legend">
              {(Object.keys(STATE) as Coverage[]).map((c) => (
                <span key={c}>
                  <span className={`viz-swatch ${STATE[c].cls}`} /> {STATE[c].icon} {STATE[c].label}
                </span>
              ))}
              <span>
                <span className="viz-swatch coverage-range-swatch" /> A Mode&apos;s range (with its delta)
              </span>
              <span>
                <span className="viz-swatch viz-marks-swatch" /> A Stagger Mode&apos;s steps
              </span>
              <span>● Element · ■ A Source&apos;s sequence (each step)</span>
            </div>
            <div className="coverage-charts">
              {types.map((t) => {
                const own = rows.filter((r) => r.element_type === t.key);
                const s = data!.summary[t.key];
                return (
                  <div key={t.key}>
                    <CoverageChart type={t} rows={own} ranges={data!.ranges[t.key] ?? []} />
                    <p className="hint-text coverage-type-summary">
                      {t.label}: {s.covered} of {own.length} covered
                      {s.partial > 0 && ` · ${s.partial} partly`}
                      {s.not_covered > 0 && ` · ${s.not_covered} not`}
                    </p>
                  </div>
                );
              })}
            </div>
            {adding && (
              <AddValueToModesDialog
                emitterId={emitterId}
                seed={seedOf(adding)!}
                context={`From ${rowValues(adding, TYPES.find((t) => t.key === adding.element_type)?.unit ?? "")} — the new Modes also get its Sources.`}
                extraSourceIds={[...new Set(adding.occurrences.map((o) => o.source_id))]}
                onClose={() => setAdding(null)}
              />
            )}
            {rows.length === 0 ? null : gaps.length === 0 ? (
              <p className="coverage-all-good">
                <span className="viz-swatch status-good" /> ✓ Every{" "}
                {types.length < present.length ? types.map((t) => t.label).join(", ") + " " : ""}Element is covered.
              </p>
            ) : (
              <div className="table-scroll">
                <table className="data-table coverage-gaps">
                  <caption>Not, or not wholly, covered</caption>
                  <thead>
                    <tr>
                      <th>Coverage</th>
                      <th>Type</th>
                      <th>Values</th>
                      <th>In Sources</th>
                      <th>Why</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gaps.map((r) => {
                      const st = STATE[r.coverage];
                      const sources = [...new Map(r.occurrences.map((o) => [o.source_id, o.source_name])).entries()];
                      return (
                        <tr key={elementKey(r)}>
                          <td className="coverage-state">
                            <span className={`viz-swatch ${st.cls}`} /> {st.icon} {st.label}
                          </td>
                          <td>{TYPES.find((t) => t.key === r.element_type)?.label}</td>
                          <td>{rowValues(r, TYPES.find((t) => t.key === r.element_type)?.unit ?? "")}</td>
                          <td>
                            {sources.map(([id, name], i) => (
                              <span key={id}>
                                {i > 0 && ", "}
                                <Link to={`/emitters/${emitterId}?tab=setup&source=${id}`}>{name}</Link>
                              </span>
                            ))}
                          </td>
                          <td>
                            {r.note ??
                              (r.covered_by.length ? `Partly by ${r.covered_by.map((c) => c.name).join(", ")}` : "—")}
                            {canWrite && seedOf(r) && (
                              <div>
                                <button type="button" className="link-button" onClick={() => setAdding(r)}>
                                  Add to the Modes…
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ))}
    </div>
  );
}
