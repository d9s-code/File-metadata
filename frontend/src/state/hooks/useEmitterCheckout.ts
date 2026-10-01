import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

/** Who holds which Emitter. Under the "emitters" key, so any checkout,
 * check-in or save refreshes it; also re-checked every minute. */
export function useCheckouts(enabled = true) {
  return useQuery({
    queryKey: [...emittersKey, "checkouts"],
    queryFn: () => emittersApi.checkouts(),
    refetchInterval: 60_000,
    enabled,
  });
}

/** Held this long, a checkout is called out as long-held. */
export const LONG_HELD_MS = 8 * 60 * 60 * 1000;

/** "12 min", "3 h", "2 days". */
export function heldFor(since: string | null, now = Date.now()): string {
  if (!since) return "";
  const minutes = Math.max(0, Math.round((now - Date.parse(since)) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} days`;
}
