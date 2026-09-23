import { useMutation, useQueryClient } from "@tanstack/react-query";
import { emittersApi } from "../../api/emitters";
import type { Emitter } from "../../types/domain";
import { useAuth } from "../../auth/AuthContext";
import { emittersKey } from "./useEmitters";

/** The single source of truth every gated form/table should read instead of
 * re-deriving "am I allowed to edit this" locally. */
export function useEmitterCheckoutState(emitter: Emitter | undefined) {
  const { user } = useAuth();
  const isCheckedOut = !!emitter?.checked_out_by_id;
  const isMine = !!emitter && !!user && emitter.checked_out_by_id === user.id;
  return {
    isCheckedOut,
    isMine,
    canEdit: isMine,
    holderUsername: emitter?.checked_out_by_username ?? null,
    checkedOutAt: emitter?.checked_out_at ?? null,
  };
}

function invalidateEmitter(qc: ReturnType<typeof useQueryClient>, emitterId: string) {
  qc.invalidateQueries({ queryKey: [...emittersKey, emitterId] });
  qc.invalidateQueries({ queryKey: emittersKey });
}

export function useCheckoutEmitter(emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => emittersApi.checkout(emitterId),
    onSuccess: () => invalidateEmitter(qc, emitterId),
  });
}

export function useCheckinEmitter(emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => emittersApi.checkin(emitterId),
    onSuccess: () => invalidateEmitter(qc, emitterId),
  });
}

export function useDiscardEmitterChanges(emitterId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => emittersApi.discard(emitterId),
    // Discard rewrites every EW Group/Source/Mode/Element/Test Line back to
    // the latest commit, and those live under many differently-shaped query
    // keys (per Source, per EW Group, per Emitter…). Refetching everything
    // is the only way to be sure nothing discarded stays on screen.
    onSuccess: () => qc.invalidateQueries(),
  });
}
