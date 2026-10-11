import { useState } from "react";
import { Link } from "react-router-dom";
import type { ReadinessItem } from "../../api/mdfs";
import { useMdfReadinessChecklist } from "../../state/hooks/useMdfs";

const ICON: Record<ReadinessItem["status"], string> = { ok: "✓", warn: "!", fail: "✕" };
const SHOWN = 5;

function Check({ item, mdfId }: { item: ReadinessItem; mdfId: string }) {
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
export function MdfReadinessPanel({ mdfId }: { mdfId: string }) {
  const { data, isLoading } = useMdfReadinessChecklist(mdfId);
  const [open, setOpen] = useState(true);
  if (isLoading || !data) return null;
  const count = (s: ReadinessItem["status"]) => data.filter((i) => i.status === s).length;
  const order = { fail: 0, warn: 1, ok: 2 };
  const sorted = [...data].sort((a, b) => order[a.status] - order[b.status]);
  const fails = count("fail");
  const warns = count("warn");
  return (
    <section className={`card readiness-panel ${fails ? "has-fail" : warns ? "has-warn" : "all-ok"}`}>
      <button type="button" className="link-button section-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? "▾" : "▸"} <h4>Readiness</h4>{" "}
        <span className="hint-text">
          {count("ok")} of {data.length} ready
          {fails ? ` · ${fails} problem${fails === 1 ? "" : "s"}` : ""}
          {warns ? ` · ${warns} warning${warns === 1 ? "" : "s"}` : ""}
        </span>
      </button>
      {open && (
        <ul className="readiness-list">
          {sorted.map((item) => (
            <Check key={item.key} item={item} mdfId={mdfId} />
          ))}
        </ul>
      )}
    </section>
  );
}
