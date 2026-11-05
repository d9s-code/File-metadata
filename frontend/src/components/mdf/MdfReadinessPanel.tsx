import { useState } from "react";
import { Link } from "react-router-dom";
import type { ReadinessItem } from "../../api/mdfs";
import { useMdfReadinessChecklist } from "../../state/hooks/useMdfs";

const ICON: Record<ReadinessItem["status"], string> = { ok: "✓", warn: "!", fail: "✕" };
const SHOWN = 5;

/** Where on the MDF page each check is dealt with. */
export type ReadinessGo = (key: string) => void;
const GO_LABEL: Record<string, string> = {
  pinned: "Pinned Platforms",
  platform_pins: "Pinned Platforms",
  emitter_pins: "Pinned Platforms",
  dwells: "Dwells",
  operational: "Emitters",
  simulation: "Emitters",
  mdf_test: "Test History",
};

function Check({ item, mdfId, onGo }: { item: ReadinessItem; mdfId: string; onGo?: ReadinessGo }) {
  const [all, setAll] = useState(false);
  const shown = all ? item.items : item.items.slice(0, SHOWN);
  return (
    <li className={`readiness-item readiness-${item.status}`}>
      <span className="readiness-icon" aria-label={item.status}>
        {ICON[item.status]}
      </span>
      <div>
        <strong>{item.label}</strong> <span className="hint-text">— {item.detail}</span>
        {item.key === "ambiguity" && item.status !== "ok" && (
          <>
            {" "}
            <Link to={`/ambiguity/mdf/${mdfId}`}>Open the ambiguity check</Link>
          </>
        )}
        {onGo && item.status !== "ok" && GO_LABEL[item.key] && (
          <>
            {" "}
            <button type="button" className="link-button" onClick={() => onGo(item.key)}>
              Go to {GO_LABEL[item.key]}
            </button>
          </>
        )}
        {shown.length > 0 && (
          <ul className="readiness-sublist">
            {shown.map((s) => (
              <li key={s}>{s}</li>
            ))}
            {item.items.length > SHOWN && (
              <li>
                <button type="button" className="link-button" onClick={() => setAll((v) => !v)}>
                  {all ? "Show fewer" : `Show all ${item.items.length}`}
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
    </li>
  );
}

/** Whether the MDF is ready to go out: its pins saved and current, every
 * Emitter Operational and passing its latest Simulation Test, no open
 * High/Exact ambiguity, a passing MDF test. Problems first. */
export function MdfReadinessPanel({ mdfId, onGo }: { mdfId: string; onGo?: ReadinessGo }) {
  const { data, isLoading } = useMdfReadinessChecklist(mdfId);
  const [showReady, setShowReady] = useState(false);
  if (isLoading || !data) return null;
  const count = (s: ReadinessItem["status"]) => data.filter((i) => i.status === s).length;
  const order = { fail: 0, warn: 1, ok: 2 };
  const sorted = [...data].sort((a, b) => order[a.status] - order[b.status]);
  const fails = count("fail");
  const warns = count("warn");
  const ready = sorted.filter((i) => i.status === "ok");
  const listed = fails + warns === 0 || showReady ? sorted : sorted.filter((i) => i.status !== "ok");
  return (
    <section className={`card readiness-panel ${fails ? "has-fail" : warns ? "has-warn" : "all-ok"}`}>
      <div className="card-header">
        <h2 className="as-h4">
          Readiness{" "}
          <span className="hint-text">
            {count("ok")} of {data.length} ready
            {fails ? ` · ${fails} problem${fails === 1 ? "" : "s"}` : ""}
            {warns ? ` · ${warns} warning${warns === 1 ? "" : "s"}` : ""}
          </span>
        </h2>
      </div>
      <p className="hint-text">
        Whether the MDF is ready to go out: its pins saved and current, every Emitter Operational and passing its latest
        Simulation Test, its dwell files, no open High/Exact ambiguity and a passing MDF test. Problems first.
      </p>
      <>
          <ul className="readiness-list">
            {listed.map((item) => (
              <Check key={item.key} item={item} mdfId={mdfId} onGo={onGo} />
            ))}
          </ul>
          {fails + warns > 0 && ready.length > 0 && (
            <button type="button" className="link-button" onClick={() => setShowReady((v) => !v)}>
              {showReady ? "Hide the ready ones" : `Show the ${ready.length} ready`}
            </button>
          )}
      </>
    </section>
  );
}

/** "Readiness: 2 problems · 1 warning" for the MDF's header and its tab. */
export function useReadinessCounts(mdfId: string) {
  const { data } = useMdfReadinessChecklist(mdfId);
  return {
    loaded: !!data,
    fails: (data ?? []).filter((i) => i.status === "fail").length,
    warns: (data ?? []).filter((i) => i.status === "warn").length,
    total: data?.length ?? 0,
  };
}
