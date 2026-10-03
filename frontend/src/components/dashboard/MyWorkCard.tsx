import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { useMyWork } from "../../state/hooks/useTasks";
import { heldFor, LONG_HELD_MS, useCheckouts } from "../../state/hooks/useEmitterCheckout";
import { emitterStatusLabel } from "../common/emitterStatusLabel";
import { TaskList } from "../tasks/TaskList";
import type { EmitterStatus } from "../../types/domain";

/** Tasks listed before "All my tasks". */
const SHOWN_TASKS = 6;
/** Emitters listed before "Show all". */
const SHOWN_LIST = 6;

/** The top of the dashboard: what's yours — your open tasks, the Emitters
 * assigned to you, and the ones you're editing right now. */
export function MyWorkCard() {
  const { user } = useAuth();
  const { data: work } = useMyWork();
  const { data: checkouts } = useCheckouts(!!user);
  const editing = (checkouts ?? []).filter((c) => c.checked_out_by_id === user?.id);
  const [allEditing, setAllEditing] = useState(false);
  const [allAssigned, setAllAssigned] = useState(false);
  const now = Date.now();
  if (!work) return <div className="card dashboard-full my-work" />;

  return (
    <div className="card dashboard-full my-work">
      <div className="my-work-grid">
        <section>
          <h4>
            <Link to="/tasks">My tasks</Link> <span className="section-count">{work.tasks.length}</span>
          </h4>
          {work.tasks.length === 0 ? (
            <p className="hint-text">Nothing on your list.</p>
          ) : (
            <TaskList tasks={work.tasks.slice(0, SHOWN_TASKS)} />
          )}
          <p className="my-work-links">
            {work.tasks.length > SHOWN_TASKS && <Link to="/tasks">All {work.tasks.length} of your tasks</Link>}
            {work.unassigned_open > 0 && (
              <Link to="/tasks?view=grabs">
                {work.unassigned_open} up for grabs
              </Link>
            )}
            {work.tasks.length <= SHOWN_TASKS && work.unassigned_open === 0 && <Link to="/tasks">Add a task</Link>}
          </p>
        </section>

        <section>
          <h4>
            <Link to="/emitters">Assigned to me</Link> <span className="section-count">{work.emitters.length}</span>
          </h4>
          {work.emitters.length === 0 ? (
            <p className="hint-text">No Emitters are assigned to you. Assign one from its page.</p>
          ) : (
            <ul className="my-work-list">
              {(allAssigned ? work.emitters : work.emitters.slice(0, SHOWN_LIST)).map((e) => (
                <li key={e.id}>
                  <Link to={`/emitters/${e.id}`}>{e.name}</Link>
                  <span className={`status-badge status-${e.status}`}>{emitterStatusLabel(e.status as EmitterStatus)}</span>
                  {e.open_tasks > 0 && (
                    <span className="hint-text">
                      {e.open_tasks} task{e.open_tasks === 1 ? "" : "s"}
                    </span>
                  )}
                  {e.checked_out_by_username && e.checked_out_by_username !== user?.username && (
                    <span className="hint-text">· {e.checked_out_by_username} is editing</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {work.emitters.length > SHOWN_LIST && (
            <button type="button" className="link-button" onClick={() => setAllAssigned((v) => !v)}>
              {allAssigned ? "Show fewer" : `Show all ${work.emitters.length}`}
            </button>
          )}
        </section>

        <section>
          <h4>
            Editing now <span className="section-count">{editing.length}</span>
          </h4>
          {editing.length === 0 ? (
            <p className="hint-text">You aren&apos;t editing any Emitters.</p>
          ) : (
            <ul className="my-work-list">
              {(allEditing ? editing : editing.slice(0, SHOWN_LIST)).map((c) => {
                const long = !!c.checked_out_at && now - Date.parse(c.checked_out_at) > LONG_HELD_MS;
                return (
                  <li key={c.emitter_id}>
                    <Link to={`/emitters/${c.emitter_id}`}>{c.emitter_name}</Link>
                    <span className={long ? "checkout-held long" : "checkout-held"}>{heldFor(c.checked_out_at, now)}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {editing.length > SHOWN_LIST && (
            <button type="button" className="link-button" onClick={() => setAllEditing((v) => !v)}>
              {allEditing ? "Show fewer" : `Show all ${editing.length}`}
            </button>
          )}
          {editing.some((c) => c.checked_out_at && now - Date.parse(c.checked_out_at) > LONG_HELD_MS) && (
            <p className="hint-text">Held over 8 hours — save or discard if you&apos;re done, so others can edit.</p>
          )}
        </section>
      </div>
    </div>
  );
}
