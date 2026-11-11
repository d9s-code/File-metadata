import { Fragment, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { InfoTip, MDFS_SECTION, PageHeader } from "../components/common/PageHeader";
import { LoadingState } from "../components/common/LoadingState";
import { EmptyState } from "../components/common/EmptyState";
import { ApiRequestError } from "../api/client";
import { pclApi, type UniquenessEmitter, type UniquenessPlatform } from "../api/pcl";
import { useMdfs } from "../state/hooks/useMdfs";

const PARAM_LABEL: Record<string, string> = { rf: "RF", pri: "PRI", pw: "PW", scan: "Scan" };
const PRI_TYPE: Record<string, string> = { fixed: "Fixed", stagger: "Stagger", cw: "CW", xlet: "X-let" };

function emitterName(e: { emitter_name: string; designation: string | null }) {
  return e.designation ? `${e.designation} — ${e.emitter_name}` : e.emitter_name;
}

/** How easy the Platform is to tell apart, in one word. */
function standing(p: UniquenessPlatform): { cls: string; label: string; title: string } {
  if (p.unique_set_count > 0)
    return { cls: "pcl-strong", label: "Has unique Modes", title: "A unique Emitter with a Mode no other Platform's could be taken for" };
  if (p.unique_emitter_count > 0 || p.unique_pair_count > 0)
    return {
      cls: "pcl-some",
      label: p.unique_emitter_count > 0 ? "Unique Emitter, no unique Mode" : "Only unique pairs",
      title:
        p.unique_emitter_count > 0
          ? "It has an Emitter no other Platform has, but each of its Modes could be taken for another Platform's"
          : "No Emitter of its own, but shared Emitters no other Platform has together",
    };
  return { cls: "pcl-none", label: "Nothing unique", title: "Every Emitter it has, another Platform has too" };
}

function UniqueEmitterModes({ e }: { e: UniquenessEmitter }) {
  return (
    <table className="data-table compact pcl-modes">
      <thead>
        <tr>
          <th>Mode</th>
          <th>EW Group</th>
          <th>PRI type</th>
          <th title="No Mode on another Platform could be taken for it — overlapping RF, PW and PRI at once, the ambiguity check's test">
            Parameter set
          </th>
          <th title="Parameters no other Platform's Mode overlaps on their own">Unique parameters</th>
        </tr>
      </thead>
      <tbody>
        {e.modes.map((m) => (
          <tr key={m.mode_id}>
            <td>{m.mode_name}</td>
            <td className="hint-text">{m.ew_group_name}</td>
            <td>{PRI_TYPE[m.pri_type] ?? m.pri_type}</td>
            <td>
              {m.unique_set ? (
                <span className="pcl-flag pcl-strong">Unique</span>
              ) : (
                <span
                  className="hint-text"
                  title={m.overlaps.map((o) => `${o.platform_name}: ${o.emitter_name} · ${o.mode_name}`).join("\n")}
                >
                  Like {m.overlaps[0] ? `${m.overlaps[0].emitter_name} · ${m.overlaps[0].mode_name} (${m.overlaps[0].platform_name})` : "another"}
                  {m.overlap_count > 1 && ` +${m.overlap_count - 1}`}
                </span>
              )}
            </td>
            <td>
              {m.unique_params.length ? (
                m.unique_params.map((p) => (
                  <span key={p} className="pcl-param">
                    {PARAM_LABEL[p] ?? p}
                  </span>
                ))
              ) : (
                <span className="hint-text">—</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One Platform opened: its Emitters (unique ones with their Modes), its
 * unique pairs, and who has everything it has. */
function PlatformDetail({ p }: { p: UniquenessPlatform }) {
  const unique = p.emitters.filter((e) => e.unique);
  const shared = p.emitters.filter((e) => !e.unique);
  return (
    <div className="pcl-detail">
      {p.covered_by.length > 0 && (
        <p className="pcl-warn">
          Everything it has, {p.covered_by.map((c) => c.platform_name).join(", ")} {p.covered_by.length === 1 ? "has" : "have"} too —
          hearing its Emitters can&apos;t tell it from {p.covered_by.length === 1 ? "that one" : "those"}.
        </p>
      )}
      {unique.length > 0 && (
        <section>
          <h3 className="as-h5">Unique Emitters</h3>
          {unique.map((e) => (
            <div key={e.emitter_id} className="pcl-emitter">
              <div className="pcl-emitter-head">
                <Link to={`/emitters/${e.emitter_id}`}>{emitterName(e)}</Link>
                <span className="hint-text">v{e.version_number ?? "?"}</span>
                <span className="pcl-flag pcl-strong">Only on this Platform</span>
                <span className="hint-text">
                  {e.unique_set_count} of {e.mode_count} Mode{e.mode_count === 1 ? "" : "s"} unique
                </span>
              </div>
              {e.modes.length > 0 && <UniqueEmitterModes e={e} />}
            </div>
          ))}
        </section>
      )}
      {shared.length > 0 && (
        <section>
          <h3 className="as-h5">Shared Emitters</h3>
          <ul className="pcl-shared">
            {shared.map((e) => (
              <li key={e.emitter_id}>
                <Link to={`/emitters/${e.emitter_id}`}>{emitterName(e)}</Link>{" "}
                <span className="hint-text">also on {e.shared_with.map((s) => s.platform_name).join(", ")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {p.unique_pair_count > 0 && (
        <section>
          <h3 className="as-h5">
            Unique pairs{" "}
            <InfoTip label="About unique pairs">
              Two shared Emitters no other Platform in this MDF has together — hearing both points to this Platform.
            </InfoTip>
          </h3>
          <ul className="pcl-shared">
            {p.unique_pairs.map((pair, i) => (
              <li key={i}>{pair.emitters.map(emitterName).join(" + ")}</li>
            ))}
            {p.unique_pair_count > p.unique_pairs.length && (
              <li className="hint-text">and {p.unique_pair_count - p.unique_pairs.length} more</li>
            )}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Platform confidence (experimental): what in an MDF tells its Platforms
 * apart — the building blocks for confidence rules. Read-only for now. */
export function PlatformConfidencePage() {
  const [params, setParams] = useSearchParams();
  const mdfId = params.get("mdf") ?? "";
  const { data: mdfs } = useMdfs();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [find, setFind] = useState("");
  const { data, isLoading, error } = useQuery({
    queryKey: ["pcl", "uniqueness", mdfId],
    queryFn: () => pclApi.uniqueness(mdfId),
    enabled: !!mdfId,
    retry: false,
  });

  const shown = (data?.platforms ?? []).filter((p) => p.platform_name.toLowerCase().includes(find.trim().toLowerCase()));
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="page">
      <PageHeader
        title={
          <>
            Platform confidence <span className="pcl-experimental">Experimental</span>
          </>
        }
        info="What in an MDF tells its Platforms apart: Emitters only one Platform has, their Modes no other Platform's could be taken for, the parameters that alone set them apart, and pairs of shared Emitters only one Platform has together. The building blocks for confidence rules — nothing here is saved or exported."
        section={MDFS_SECTION}
      />

      <div className="filter-bar">
        <select
          aria-label="MDF"
          value={mdfId}
          onChange={(e) => {
            setOpen(new Set());
            setParams(e.target.value ? { mdf: e.target.value } : {});
          }}
        >
          <option value="">Pick an MDF…</option>
          {(mdfs ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        {data && data.platforms.length > 6 && (
          <input type="search" placeholder="Find a Platform…" aria-label="Find a Platform" value={find} onChange={(e) => setFind(e.target.value)} />
        )}
        {data && (
          <span className="filter-bar-end hint-text">
            Reads <Link to={`/mdfs/${data.mdf_id}`}>{data.mdf_name}</Link> v{data.mdf_version_number} · overlaps as the ambiguity check
            sees them (deltas, jitter, stagger steps ±{data.stagger_step_delta_us} µs)
          </span>
        )}
      </div>

      {!mdfId ? (
        <EmptyState icon="◇" title="Pick an MDF" message="Its saved Platforms are compared with each other." />
      ) : isLoading ? (
        <LoadingState label="Comparing the Platforms…" />
      ) : error ? (
        <p className="error-text">{error instanceof ApiRequestError ? error.message : "Couldn't compare the Platforms"}</p>
      ) : data && data.platforms.length === 0 ? (
        <EmptyState icon="◇" title="No Platforms" message="This MDF's saved version pins no Platforms." />
      ) : data ? (
        <div className="card table-card">
          <table className="data-table pcl-table">
            <thead>
              <tr>
                <th className="expand-col" aria-label="Open" />
                <th>Platform</th>
                <th className="num">Emitters</th>
                <th className="num" title="Emitters only this Platform has">Unique Emitters</th>
                <th className="num" title="Modes of its unique Emitters no other Platform's Mode could be taken for">Unique Modes</th>
                <th className="num" title="Pairs of shared Emitters no other Platform has together">Unique pairs</th>
                <th>Standing</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const s = standing(p);
                const isOpen = open.has(p.platform_id);
                return (
                  <Fragment key={p.platform_id}>
                    <tr className={isOpen ? "row-open" : undefined}>
                      <td className="expand-col">
                        <button
                          type="button"
                          className="link-button"
                          aria-expanded={isOpen}
                          aria-label={`${isOpen ? "Hide" : "Show"} ${p.platform_name}`}
                          onClick={() => toggle(p.platform_id)}
                        >
                          {isOpen ? "▾" : "▸"}
                        </button>
                      </td>
                      <td>
                        <Link to={`/platforms/${p.platform_id}`}>{p.platform_name}</Link>{" "}
                        {p.version_label && <span className="hint-text">{p.version_label}</span>}
                      </td>
                      <td className="num">{p.emitters.length}</td>
                      <td className="num">{p.unique_emitter_count || <span className="hint-text">0</span>}</td>
                      <td className="num">{p.unique_set_count || <span className="hint-text">0</span>}</td>
                      <td className="num">{p.unique_pair_count || <span className="hint-text">0</span>}</td>
                      <td>
                        <span className={`pcl-flag ${s.cls}`} title={s.title}>
                          {s.label}
                        </span>
                        {p.covered_by.length > 0 && (
                          <span className="hint-text"> · all also on {p.covered_by.map((c) => c.platform_name).join(", ")}</span>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="row-detail">
                        <td />
                        <td colSpan={6}>
                          <PlatformDetail p={p} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
