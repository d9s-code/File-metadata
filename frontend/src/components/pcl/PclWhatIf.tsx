import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { pclRulesApi, type MdfUniqueness } from "../../api/pcl";
import { LevelBadge } from "./PclRules";

/** "What if": tick what's heard and see which Platforms it points to, and
 * how surely — each one's highest level whose rule is met. */
export function PclWhatIf({ data }: { data: MdfUniqueness }) {
  const [emitters, setEmitters] = useState<Set<string>>(new Set());
  const [modes, setModes] = useState<Set<string>>(new Set()); // `${emitterId}|${mode}`
  // Every Emitter in the MDF once; a unique one's Modes can be ticked on their own.
  const all = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; modes: string[] }>();
    for (const p of data.platforms)
      for (const e of p.emitters) {
        const entry = seen.get(e.emitter_id) ?? { id: e.emitter_id, name: e.emitter_name, modes: [] };
        for (const m of e.modes) if (!entry.modes.includes(m.mode_name)) entry.modes.push(m.mode_name);
        seen.set(e.emitter_id, entry);
      }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);
  const heard = {
    emitter_ids: [...emitters],
    modes: [...modes].map((k) => {
      const [emitter_id, mode] = k.split("|");
      return { emitter_id, mode };
    }),
  };
  const any = emitters.size + modes.size > 0;
  const { data: result } = useQuery({
    queryKey: ["pcl", "what-if", data.mdf_id, heard],
    queryFn: () => pclRulesApi.whatIf(data.mdf_id, heard),
    enabled: any,
    placeholderData: (prev) => prev,
  });
  const flip = (set: Set<string>, key: string, put: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    put(next);
  };

  return (
    <details className="card pcl-whatif">
      <summary>
        <strong>What if…</strong> <span className="hint-text">tick what&apos;s heard and see which Platforms it points to</span>
      </summary>
      <div className="pcl-whatif-body">
        <div className="pcl-chips" role="group" aria-label="Heard">
          {all.map((e) => (
            <span key={e.id} className="pcl-chip-group">
              <button
                type="button"
                className={emitters.has(e.id) ? "pcl-chip on" : "pcl-chip"}
                aria-pressed={emitters.has(e.id)}
                onClick={() => flip(emitters, e.id, setEmitters)}
              >
                {e.name}
              </button>
              {e.modes.map((m) => {
                const key = `${e.id}|${m}`;
                return (
                  <button
                    key={key}
                    type="button"
                    className={modes.has(key) ? "pcl-chip pcl-chip-mode on" : "pcl-chip pcl-chip-mode"}
                    aria-pressed={modes.has(key)}
                    title={`Only ${e.name}'s ${m} heard`}
                    onClick={() => flip(modes, key, setModes)}
                  >
                    · {m}
                  </button>
                );
              })}
            </span>
          ))}
        </div>
        {!any ? (
          <p className="hint-text">Nothing ticked.</p>
        ) : result ? (
          <ul className="pcl-whatif-result">
            {result.platforms.map((p) => (
              <li key={p.platform_id} className={p.level ? undefined : "pcl-dim"}>
                <LevelBadge level={p.level} /> <strong>{p.platform_name}</strong>{" "}
                {p.met.length > 0 ? (
                  <span className="hint-text">— {p.met.find((m) => m.level === p.level)?.text}</span>
                ) : (
                  <span className="hint-text">{p.rule_count ? "— no rule met" : "— no rules yet"}</span>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        {any && (
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setEmitters(new Set());
              setModes(new Set());
            }}
          >
            Clear
          </button>
        )}
      </div>
    </details>
  );
}
