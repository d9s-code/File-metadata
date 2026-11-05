import { ApiRequestError } from "../../api/client";
import { Icon } from "../common/Icon";
import { useHasRole } from "../../auth/RequireAuth";
import { useAuth } from "../../auth/AuthContext";
import { useAssignEmitter, usePeople } from "../../state/hooks/useTasks";
import type { Emitter } from "../../types/domain";
import { MenuButton } from "../common/MenuButton";

/** Who's responsible for an Emitter, as a chip (a person icon, "Nobody ▾") that opens the
 * editors to pick from. Not part of its saved versions, so it can be changed
 * without editing the Emitter. */
export function AssigneeControl({ emitter }: { emitter: Emitter }) {
  const { user } = useAuth();
  const canAssign = useHasRole("editor") && !emitter.is_deleted;
  const { data: people } = usePeople();
  const assign = useAssignEmitter();
  const editors = (people ?? []).filter((p) => p.role !== "viewer");
  const name = emitter.assignee_id === user?.id ? "You" : (emitter.assignee_username ?? "Nobody");
  const chipClass = emitter.assignee_id ? "meta-chip" : "meta-chip none";

  if (!canAssign) {
    return (
      <span className={chipClass} title="Who's responsible for this Emitter">
        <Icon name="user" /> {name}
      </span>
    );
  }
  const pick = (assigneeId: string | null) => assign.mutate({ emitterId: emitter.id, assigneeId });
  const mark = (id: string | null) => (id === (emitter.assignee_id ?? null) ? "✓ " : "");
  // The current assignee stays listed even if they've since become a viewer.
  const current = emitter.assignee_id && !editors.some((p) => p.id === emitter.assignee_id);
  return (
    <>
      <MenuButton
        align="start"
        className={chipClass}
        title="Who's responsible for this Emitter"
        ariaLabel={`Assigned to ${name} — change`}
        disabled={assign.isPending}
        label={
          <>
            <Icon name="user" /> {name} <span className="chip-caret">▾</span>
          </>
        }
        items={[
          { label: `${mark(null)}Nobody`, onSelect: () => pick(null) },
          ...(current ? [{ label: `${mark(emitter.assignee_id)}${emitter.assignee_username}`, onSelect: () => pick(emitter.assignee_id) }] : []),
          ...editors.map((p) => ({
            label: `${mark(p.id)}${p.id === user?.id ? `${p.username} (you)` : p.username}`,
            onSelect: () => pick(p.id),
          })),
        ]}
      />
      {assign.error && (
        <span className="error-text">{assign.error instanceof ApiRequestError ? assign.error.message : "Couldn't assign"}</span>
      )}
    </>
  );
}
