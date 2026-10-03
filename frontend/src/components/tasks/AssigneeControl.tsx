import { ApiRequestError } from "../../api/client";
import { useHasRole } from "../../auth/RequireAuth";
import { useAuth } from "../../auth/AuthContext";
import { useAssignEmitter, usePeople } from "../../state/hooks/useTasks";
import type { Emitter } from "../../types/domain";

/** "Assigned to ▾" on an Emitter page. Who's responsible for it — not part of
 * its saved versions, so it can be changed without editing the Emitter. */
export function AssigneeControl({ emitter }: { emitter: Emitter }) {
  const { user } = useAuth();
  const canAssign = useHasRole("editor") && !emitter.is_deleted;
  const { data: people } = usePeople();
  const assign = useAssignEmitter();
  const editors = (people ?? []).filter((p) => p.role !== "viewer");
  const name = emitter.assignee_id === user?.id ? "You" : (emitter.assignee_username ?? "Nobody");

  if (!canAssign) {
    return (
      <span className={emitter.assignee_id ? "assignee-chip" : "assignee-chip none"}>Assigned to {name}</span>
    );
  }
  // The current assignee stays listed even if they've since become a viewer.
  const current = emitter.assignee_id && !editors.some((p) => p.id === emitter.assignee_id);
  return (
    <label className={emitter.assignee_id ? "assignee-chip" : "assignee-chip none"} title="Who's responsible for this Emitter">
      Assigned to
      <select
        value={emitter.assignee_id ?? ""}
        disabled={assign.isPending}
        onChange={(e) => assign.mutate({ emitterId: emitter.id, assigneeId: e.target.value || null })}
      >
        <option value="">Nobody</option>
        {current && <option value={emitter.assignee_id!}>{emitter.assignee_username}</option>}
        {editors.map((p) => (
          <option key={p.id} value={p.id}>
            {p.id === user?.id ? `${p.username} (you)` : p.username}
          </option>
        ))}
      </select>
      {assign.error && (
        <span className="error-text">{assign.error instanceof ApiRequestError ? assign.error.message : "Couldn't assign"}</span>
      )}
    </label>
  );
}
