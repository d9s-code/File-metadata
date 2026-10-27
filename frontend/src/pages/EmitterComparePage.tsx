import { useMemo } from "react";
import { PageHeader } from "../components/common/PageHeader";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { compareApi, type CompareFinding } from "../api/compare";
import type { AmbiguityFinding } from "../api/ambiguity";
import type { CoverageMode, EmitterCoverage } from "../api/platforms";
import { ApiRequestError } from "../api/client";
import { useEmitters } from "../state/hooks/useEmitters";
import { useEmitterVersions } from "../state/hooks/useEmitterVersions";
import { CoverageCharts, emitterNode } from "../components/platform/PlatformCharts";
import { SeverityBadge } from "../components/ambiguity/SeverityBadge";
import { SEVERITY_ORDER, SEVERITY_RANK, limitingParam, overlapPct } from "../components/ambiguity/ambiguityText";
import { LoadingState } from "../components/common/LoadingState";
import type { Emitter } from "../types/domain";

function label(e: { designation: string | null; name?: string; emitter_name?: string }) {
  const name = e.name ?? e.emitter_name ?? "";
  return e.designation ? `${e.designation} — ${name}` : name;
}

function span(lo: number | undefined, hi: number | undefined) {
  if (lo == null || hi == null) return "—";
  return lo === hi ? `${lo}` : `${lo}–${hi}`;
}

/** The lowest and highest value of a parameter across an Emitter's Modes. */
function extremes(modes: CoverageMode[], key: "rf" | "pri" | "pw") {
  const spans = modes.map((m) => m[key]).filter((s): s is [number, number] => !!s);
  if (!spans.length) return "—";
  return span(Math.min(...spans.map((s) => s[0])), Math.max(...spans.map((s) => s[1])));
}

function Picker({
  side,
  emitters,
  emitterId,
  version,
  onChange,
}: {
  side: "A" | "B";
  emitters: Emitter[];
  emitterId: string;
  version: string;
  onChange: (emitterId: string, version: string) => void;
}) {
  const { data: versions } = useEmitterVersions(emitterId);
  const sorted = [...emitters].sort((x, y) => label(x).localeCompare(label(y)));
  return (
    <div className="compare-picker">
      <span className="compare-side">{side}</span>
      <select value={emitterId} onChange={(e) => onChange(e.target.value, "")} aria-label={`Emitter ${side}`}>
        <option value="">Choose an Emitter…</option>
        {sorted.map((e) => (
          <option key={e.id} value={e.id}>
            {label(e)}
          </option>
        ))}
      </select>
      <select
        value={version}
        onChange={(e) => onChange(emitterId, e.target.value)}
        disabled={!emitterId || !versions?.length}
        aria-label={`Version of ${side}`}
      >
        <option value="">Latest saved version</option>
        {[...(versions ?? [])]
          .sort((x, y) => y.version_number - x.version_number)
          .map((v) => (
            <option key={v.id} value={v.version_number}>
              v{v.version_number}
              {v.change_summary ? ` — ${v.change_summary}` : ""}
            </option>
          ))}
      </select>
    </div>
  );
}

function Side({ data, findings, which }: { data: EmitterCoverage; findings: CompareFinding[]; which: "a" | "b" }) {
  const involved = new Set(findings.map((f) => (which === "a" ? f.mode_id_a : f.mode_id_b)));
  return (
    <div className="card compare-side-card">
      <h4>
        <Link to={`/emitters/${data.emitter_id}`}>{label(data)}</Link>{" "}
        <span className="hint-text">v{data.version_number}</span>
      </h4>
      <dl className="run-facts">
        <div className="run-fact">
          <dt>Modes</dt>
          <dd>{data.modes.length}</dd>
        </div>
        <div className="run-fact">
          <dt>RF <span className="unit">(MHz)</span></dt>
          <dd>{extremes(data.modes, "rf")}</dd>
        </div>
        <div className="run-fact">
          <dt>PRI <span className="unit">(µs)</span></dt>
          <dd>{extremes(data.modes, "pri")}</dd>
        </div>
        <div className="run-fact">
          <dt>PW <span className="unit">(µs)</span></dt>
          <dd>{extremes(data.modes, "pw")}</dd>
        </div>
      </dl>
      <table className="data-table">
        <thead>
          <tr>
            <th>Mode</th>
            <th>PRI type</th>
            <th>RF (MHz)</th>
            <th>PRI (µs)</th>
            <th>PW (µs)</th>
          </tr>
        </thead>
        <tbody>
          {data.modes.map((m, i) => (
            <tr key={m.id ?? i} className={m.id && involved.has(m.id) ? "compare-overlapping" : undefined}>
              <td>{m.name}</td>
              <td>{m.pri_type}</td>
              <td>{span(m.rf?.[0], m.rf?.[1])}</td>
              <td>{span(m.pri?.[0], m.pri?.[1])}</td>
              <td>{span(m.pw?.[0], m.pw?.[1])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 10) / 10}%`);

/** Two Emitters side by side, each as of a saved version: what they cover,
 * drawn together, their Modes, and every pair of Modes (one from each) the
 * ambiguity check would flag. */
export function EmitterComparePage() {
  const [params, setParams] = useSearchParams();
  const a = params.get("a") ?? "";
  const b = params.get("b") ?? "";
  const av = params.get("av") ?? "";
  const bv = params.get("bv") ?? "";
  const { data: emitters } = useEmitters();
  const { data, error, isFetching } = useQuery({
    queryKey: ["emitter-compare", a, b, av, bv],
    queryFn: () => compareApi.emitters(a, b, av ? Number(av) : undefined, bv ? Number(bv) : undefined),
    enabled: !!a && !!b && a !== b,
    retry: false,
  });

  function set(next: Record<string, string>) {
    const merged = { a, b, av, bv, ...next };
    setParams(Object.fromEntries(Object.entries(merged).filter(([, v]) => v)), { replace: true });
  }

  const findings = useMemo(
    () =>
      [...(data?.findings ?? [])].sort(
        (x, y) =>
          SEVERITY_RANK[x.combined_severity] - SEVERITY_RANK[y.combined_severity] ||
          x.details.mode_a.mode_name.localeCompare(y.details.mode_a.mode_name),
      ),
    [data],
  );
  const nodes = useMemo(() => (data ? [emitterNode(data.a, "a:"), emitterNode(data.b, "b:")] : []), [data]);
  // The charts mark overlaps from findings shaped like an ambiguity check's.
  const chartFindings = useMemo(
    () => findings.map((f, i) => ({ ...f, id: `compare-${i}`, resolution: null }) as unknown as AmbiguityFinding),
    [findings],
  );
  const bySeverity = SEVERITY_ORDER.map((s) => [s, findings.filter((f) => f.combined_severity === s).length] as const).filter(
    ([, n]) => n > 0,
  );

  if (!emitters) return <LoadingState label="Loading Emitters…" />;
  const empty = data ? [data.a, data.b].filter((e) => e.modes.length === 0) : [];
  const live = emitters.filter((e) => !e.is_deleted);

  return (
    <div className="page">
      <PageHeader
        title="Compare Emitters"
        info="Two Emitters side by side, each as of a saved version: what they cover, their Modes, and every pair of Modes — one from each — that the ambiguity check would flag (with its usual thresholds and deltas)."
      />
      <div className="card compare-pickers">
        <Picker side="A" emitters={live} emitterId={a} version={av} onChange={(id, v) => set({ a: id, av: v })} />
        <button
          type="button"
          className="button secondary small"
          onClick={() => set({ a: b, b: a, av: bv, bv: av })}
          disabled={!a && !b}
          title="Swap A and B"
        >
          ⇄ Swap
        </button>
        <Picker side="B" emitters={live} emitterId={b} version={bv} onChange={(id, v) => set({ b: id, bv: v })} />
      </div>

      {!a || !b ? (
        <p className="hint-text">Pick two Emitters to compare.</p>
      ) : a === b ? (
        <p className="hint-text">Pick two different Emitters.</p>
      ) : error ? (
        <p className="error-text">{error instanceof ApiRequestError ? error.message : "Couldn't compare them"}</p>
      ) : !data ? (
        <LoadingState label={isFetching ? "Comparing…" : "Loading…"} />
      ) : (
        <>
          <div className="card compare-verdict">
            {empty.length > 0 ? (
              <strong>
                {empty.map((e) => `${label(e)} has no Modes in v${e.version_number}`).join("; ")} — nothing to compare
                yet.
              </strong>
            ) : findings.length === 0 ? (
              <strong>No pair of their Modes overlaps on every parameter — the two can be told apart.</strong>
            ) : (
              <>
                <strong>
                  {findings.length} pair{findings.length === 1 ? "" : "s"} of Modes could be taken for each other
                </strong>{" "}
                {bySeverity.map(([s, n]) => (
                  <span key={s} className="compare-severity">
                    <SeverityBadge severity={s} /> {n}
                  </span>
                ))}
              </>
            )}
          </div>

          <CoverageCharts
            nodes={nodes}
            levels={["Emitter", "Mode"]}
            storageKey="compareChartLevel"
            note="As of the versions picked."
            legend={null}
            ambiguity={{
              run: null,
              findings: chartFindings,
              on: findings.length > 0,
              note: `Where a Mode of one overlaps a Mode of the other (${findings.length} pair${findings.length === 1 ? "" : "s"}) — hover a mark for the Modes.`,
            }}
          />

          {findings.length > 0 && (
            <div className="card">
              <h4>Overlapping Mode pairs ({findings.length})</h4>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{label(data.a)}</th>
                    <th>{label(data.b)}</th>
                    <th>Severity</th>
                    <th className="num">RF</th>
                    <th className="num" title="A Fixed PRI's range; a Stagger's frame time (both range-matched) or its identical steps">
                      PRI
                    </th>
                    <th className="num">PW</th>
                    <th className="num" title="Compared when both are Fixed">Jitter</th>
                  </tr>
                </thead>
                <tbody>
                  {findings.map((f) => {
                    const limiting = limitingParam(f);
                    // The overlap, bold where it's the one that set the severity.
                    const cell = (p: "rf" | "pri" | "pw" | "jitter", note?: string) => (
                      <td className={p === limiting ? "num limiting" : "num"}>
                        {pct(overlapPct(f, p))}
                        {note && overlapPct(f, p) != null && <span className="hint-text"> {note}</span>}
                      </td>
                    );
                    const basis = f.details.pri_basis;
                    return (
                      <tr key={`${f.mode_id_a}:${f.mode_id_b}`}>
                        <td>{f.details.mode_a.mode_name}</td>
                        <td>{f.details.mode_b.mode_name}</td>
                        <td>
                          <SeverityBadge severity={f.combined_severity} />
                        </td>
                        {cell("rf")}
                        {cell("pri", basis === "frame_time" ? "frame time" : basis === "steps" ? "steps" : undefined)}
                        {cell("pw")}
                        {cell("jitter")}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="hint-text">
                Overlap is the share of the narrower range the other covers, with deltas; the bold one set the severity.
                Two Fixed Modes are compared on jitter too; two Staggers on their frame time when both are range-matched,
                else on their identical steps; CW and X-let have no PRI (—).
              </p>
            </div>
          )}

          <div className="compare-sides">
            <Side data={data.a} findings={findings} which="a" />
            <Side data={data.b} findings={findings} which="b" />
          </div>
        </>
      )}
    </div>
  );
}
