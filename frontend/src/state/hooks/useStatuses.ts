import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  statusesApi,
  type ItemMilestone,
  type StatusDefinition,
  type StatusEntityType,
} from "../../api/statuses";

export const statusesKey = ["statuses"] as const;
const defaultsKey = (t: StatusEntityType) => ["milestones", "defaults", t] as const;
const itemMilestonesKey = (t: StatusEntityType, id: string) => ["milestones", t, id] as const;

/** Every type's statuses — small, rarely changed, read everywhere a badge shows. */
export function useAllStatuses() {
  return useQuery({ queryKey: statusesKey, queryFn: () => statusesApi.list(), staleTime: 5 * 60_000 });
}

// What a status is called and coloured before the list has loaded (or for
// a key it doesn't know): the built-in names.
const FALLBACK: Record<StatusEntityType, Record<string, string>> = {
  emitter: {
    draft: "In progress",
    in_review: "Testing",
    partially_operational: "Partially operational",
    validated: "Operational",
    deprecated: "Needs rework",
  },
  platform: {
    draft: "In progress",
    in_review: "Testing",
    partially_operational: "Partially operational",
    validated: "Operational",
    deprecated: "Needs rework",
  },
  mdf: {
    draft: "Draft",
    pending_review: "Pending review",
    approved: "Approved",
    released: "Released",
    deprecated: "Deprecated",
  },
};

export interface StatusLookup {
  list: StatusDefinition[];
  byKey: Record<string, StatusDefinition>;
  label: (key: string | null | undefined) => string;
  color: (key: string | null | undefined) => string;
}

/** One type's statuses in order, and their names and colours by key. */
export function useStatuses(entityType: StatusEntityType): StatusLookup {
  const { data } = useAllStatuses();
  return useMemo(() => {
    const list = (data ?? []).filter((s) => s.entity_type === entityType);
    const byKey = Object.fromEntries(list.map((s) => [s.key, s]));
    return {
      list,
      byKey,
      label: (key) =>
        !key ? "—" : (byKey[key]?.label ?? FALLBACK[entityType][key] ?? key.replace(/_/g, " ")),
      color: (key) => (key && byKey[key]?.color) || "grey",
    };
  }, [data, entityType]);
}

export function useStatusAdmin() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: statusesKey });
  return {
    create: useMutation({
      mutationFn: (v: Parameters<typeof statusesApi.create>) => statusesApi.create(...v),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: (v: Parameters<typeof statusesApi.update>) => statusesApi.update(...v),
      onSuccess: refresh,
    }),
    reorder: useMutation({
      mutationFn: (v: Parameters<typeof statusesApi.reorder>) => statusesApi.reorder(...v),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => statusesApi.delete(id),
      onSuccess: () => {
        refresh();
        qc.invalidateQueries({ queryKey: ["milestones"] });
      },
    }),
  };
}

export function useDefaultMilestones(entityType: StatusEntityType) {
  return useQuery({ queryKey: defaultsKey(entityType), queryFn: () => statusesApi.defaults(entityType) });
}

export function useMilestoneAdmin() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["milestones"] });
  return {
    create: useMutation({
      mutationFn: (v: Parameters<typeof statusesApi.createDefault>) => statusesApi.createDefault(...v),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: (v: Parameters<typeof statusesApi.updateMilestone>) => statusesApi.updateMilestone(...v),
      onSuccess: refresh,
    }),
    reorder: useMutation({
      mutationFn: (ids: string[]) => statusesApi.reorderMilestones(ids),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: (id: string) => statusesApi.deleteMilestone(id), onSuccess: refresh }),
  };
}

export function useItemMilestones(entityType: StatusEntityType, entityId: string | undefined) {
  return useQuery({
    queryKey: itemMilestonesKey(entityType, entityId ?? ""),
    queryFn: () => statusesApi.itemMilestones(entityType, entityId as string),
    enabled: !!entityId,
  });
}

/** Ticking, unticking and adding an item's milestones; each returns its new list. */
export function useItemMilestoneActions(entityType: StatusEntityType, entityId: string) {
  const qc = useQueryClient();
  const store = (list: ItemMilestone[]) => qc.setQueryData(itemMilestonesKey(entityType, entityId), list);
  return {
    tick: useMutation({
      mutationFn: ({ id, note }: { id: string; note?: string }) => statusesApi.tick(id, entityId, note),
      onSuccess: store,
    }),
    untick: useMutation({ mutationFn: (id: string) => statusesApi.untick(id, entityId), onSuccess: store }),
    add: useMutation({
      mutationFn: ({ statusKey, title }: { statusKey: string; title: string }) =>
        statusesApi.addItemMilestone(entityType, entityId, statusKey, title),
      onSuccess: store,
    }),
    remove: useMutation({
      mutationFn: (id: string) => statusesApi.deleteMilestone(id),
      onSuccess: () => qc.invalidateQueries({ queryKey: itemMilestonesKey(entityType, entityId) }),
    }),
  };
}
