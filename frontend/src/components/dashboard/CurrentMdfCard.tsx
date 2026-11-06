import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ApiRequestError } from "../../api/client";
import type { DashboardRelease } from "../../api/dashboard";
import { useAuth } from "../../auth/AuthContext";
import { usePinCurrentMdf } from "../../state/hooks/useDashboard";
import { useMdfs } from "../../state/hooks/useMdfs";
import { useStatuses } from "../../state/hooks/useStatuses";
import { formatDate, toDate } from "../common/dates";
import { EmptyState } from "../common/EmptyState";
import { StatusBadge } from "../status/StatusBadge";
import { notDone, releaseTotals } from "./releaseProgress";

/** How many Emitters Next up lists, whatever the MDF's size. */
const NEXT_UP = 6;

function dueText(due: string | null) {
  const d = toDate(due);
  if (!d) return <span className="hint-text">No due date</span>;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  const rel = days < 0 ? `${-days} day${days === -1 ? "" : "s"} late` : days === 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`;
  return (
    <span>
      <span className="figure">{formatDate(d)}</span>{" "}
      <span className={days < 0 ? "release-late" : "hint-text"}>· {rel}</span>
    </span>
  );
}

/** Admins: which MDF the dashboard is about — automatic until one is pinned. */
function PinControl({ release }: { release: DashboardRelease }) {
  const { data: mdfs } = useMdfs();
  const pin = usePinCurrentMdf();
  const choices = (mdfs ?? []).filter((m) => !m.is_deleted);
  return (
    <label className="release-pin">
      <span className="hint-text">Pinned MDF</span>
      <select
        value={release.pinned && release.mdf ? release.mdf.id : ""}
        disabled={pin.isPending}
        onChange={(e) => pin.mutate(e.target.value || null)}
        aria-label="The MDF the dashboard is about"
      >
        <option value="">None — the latest not released</option>
        {choices.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      {pin.error && (
        <span className="error-text">{pin.error instanceof ApiRequestError ? pin.error.message : "Couldn't pin it"}</span>
      )}
    </label>
  );
}

/** The MDF being worked towards: how far its Emitters are, as a whole and as
 * the few furthest from done — the same size however many it holds. */
export function CurrentMdfCard({ release }: { release: DashboardRelease }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const statuses = useStatuses("emitter");
  const { mdf, emitters } = release;
  const left = useMemo(() => notDone(emitters, statuses.label), [emitters, statuses.label]);
  const t = useMemo(() => releaseTotals(emitters, statuses.label), [emitters, statuses.label]);

  if (!mdf) {
    return (
      <div className="card release-card">
        <div className="dashboard-card-header">
          <h2 className="as-h4">Current MDF</h2>
          {isAdmin && <PinControl release={release} />}
        </div>
        <EmptyState
          icon="○"
          title="No MDF in progress"
          message={isAdmin ? "Pin the MDF you're working towards above." : "Every MDF is released. An admin can pin one here."}
        />
      </div>
    );
  }

  const emittersTab = `/mdfs/${mdf.id}?tab=emitters`;
  const simLines = t.sim.pass + t.sim.partial + t.sim.fail + t.sim.untested;
  const sim: [keyof typeof t.sim, string][] = [
    ["pass", "correct"],
    ["partial", "partial"],
    ["fail", "missed"],
    ["untested", "untested"],
  ];
  return (
    <div className="card release-card">
      <div className="dashboard-card-header">
        <h2 className="as-h4">Current MDF</h2>
        {isAdmin && <PinControl release={release} />}
      </div>
      <div className="release-head">
        <div>
          <Link className="release-name" to={`/mdfs/${mdf.id}`}>
            {mdf.name}
          </Link>
          <div className="hint-text">
            {mdf.customer ?? "No customer"}
            {mdf.based_on_mdf_name && ` · the next release after ${mdf.based_on_mdf_name} v${mdf.based_on_version_number}`}
            {!release.pinned && " · not pinned: the latest MDF not released"}
          </div>
        </div>
        <dl className="release-facts">
          <div>
            <dt>Status</dt>
            <dd>
              <StatusBadge type="mdf" status={mdf.status} />
            </dd>
          </div>
          <div>
            <dt>Due</dt>
            <dd>{dueText(mdf.due_date)}</dd>
          </div>
          <div>
            <dt>Operational</dt>
            <dd className="release-big">
              {t.operational}
              <small>/{emitters.length}</small>
            </dd>
          </div>
        </dl>
      </div>

      {emitters.length === 0 ? (
        <EmptyState icon="○" title="No Emitters yet" message="Pin Platforms on the MDF and their Emitters show up here." compact />
      ) : (
        <>
          <div className="release-bars">
            <div>
              <span className="readout-label">Emitters by status</span>
              <div className="release-bar" role="img" aria-label={t.byStatus.map(([k, n]) => `${n} ${statuses.label(k)}`).join(", ")}>
                {t.byStatus.map(([k, n]) => (
                  <i key={k} className={`status-color-${statuses.color(k)}`} style={{ flex: n }} title={`${n} ${statuses.label(k)}`} />
                ))}
              </div>
              <div className="release-legend hint-text">
                {t.byStatus.map(([k, n]) => (
                  <span key={k}>
                    <i className={`status-color-${statuses.color(k)}`} />
                    {n} {statuses.label(k)}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <span className="readout-label">SIM Test Lines · {simLines}</span>
              <div className="release-bar" role="img" aria-label={sim.map(([k, l]) => `${t.sim[k]} ${l}`).join(", ")}>
                {sim
                  .filter(([k]) => t.sim[k] > 0)
                  .map(([k, l]) => (
                    <i key={k} className={`release-sim-${k}`} style={{ flex: t.sim[k] }} title={`${t.sim[k]} ${l}`} />
                  ))}
              </div>
              <div className="release-legend hint-text">
                {sim.map(([k, l]) => (
                  <span key={k}>
                    <i className={`release-sim-${k}`} />
                    {t.sim[k]} {l}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="release-counts">
            <Link to={emittersTab}>
              <b>{t.behind}</b> pinned behind a newer version
            </Link>
            <Link to={emittersTab}>
              <b>{t.neverTested}</b> never simulation-tested
            </Link>
            <Link to={emittersTab}>
              <b>{t.noLines}</b> without SIM Test Lines
            </Link>
            <Link to={emittersTab}>
              <b>{t.nobodyOnIt}</b> not done, assigned to nobody
            </Link>
          </div>

          <div className="release-next-head">
            <span className="readout-label">Next up</span>
            <span className="hint-text">
              {left.length === 0
                ? "Every Emitter is done."
                : `${left.length} of ${emitters.length} not done — the furthest from done first`}
            </span>
          </div>
          {left.length > 0 && (
            <ul className="release-next">
              {left.slice(0, NEXT_UP).map(({ emitter: e, reasons }) => (
                <li key={e.emitter_id}>
                  <Link to={`/emitters/${e.emitter_id}`}>{e.designation ? `${e.designation} — ${e.name}` : e.name}</Link>
                  <StatusBadge type="emitter" status={e.status} />
                  <span className={reasons[0].rank === 0 ? "release-reason bad" : "release-reason"}>
                    {reasons[0].text}
                    {reasons.length > 1 && <span className="hint-text"> · +{reasons.length - 1} more</span>}
                  </span>
                  <span className="hint-text release-who">{e.assignee ?? "Nobody"}</span>
                </li>
              ))}
            </ul>
          )}
          <Link className="release-all" to={emittersTab}>
            All {emitters.length} Emitters on this MDF →
          </Link>
        </>
      )}
    </div>
  );
}
