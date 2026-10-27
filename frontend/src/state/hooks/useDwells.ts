import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  dwellsApi,
  type AppSettings,
  type ModeDefaults,
  type DwellFile,
  type DwellFileUpdate,
  type DwellKind,
  type DwellStrategyUpdate,
} from "../../api/dwells";

// Strategies and files lean on each other (a file shows which pinned
// versions are outdated; a Strategy, the files it's in), so a change to
// either refreshes both families.
export const strategiesKey = ["dwell-strategies"] as const;
export const filesKey = ["dwell-files"] as const;
export const settingsKey = ["settings"] as const;

function useRefreshDwells() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: strategiesKey });
    qc.invalidateQueries({ queryKey: filesKey });
  };
}

/** All Strategies, or those covering a Platform — with the default dwells too if asked. */
export function useDwellStrategies(platformId?: string, includeDefault = false) {
  return useQuery({
    queryKey: [...strategiesKey, "list", platformId ?? "all", includeDefault],
    queryFn: () => dwellsApi.strategies(platformId, includeDefault),
  });
}

export function useDwellStrategy(id: string) {
  return useQuery({ queryKey: [...strategiesKey, id], queryFn: () => dwellsApi.strategy(id), enabled: !!id });
}

/** Whether each Emitter pinned to the Strategy's Platforms is tested with it. */
export function useStrategyTesting(id: string) {
  return useQuery({ queryKey: [...strategiesKey, id, "testing"], queryFn: () => dwellsApi.testing(id), enabled: !!id });
}

export function useUpdateDwellStrategy(id: string) {
  const qc = useQueryClient();
  const refresh = useRefreshDwells();
  return useMutation({
    mutationFn: (input: DwellStrategyUpdate) => dwellsApi.updateStrategy(id, input),
    onSuccess: (strategy) => {
      qc.setQueryData([...strategiesKey, id], strategy);
      refresh();
    },
  });
}

export function useDwellStrategyNotes(id: string) {
  return useQuery({ queryKey: [...strategiesKey, id, "notes"], queryFn: () => dwellsApi.notes(id), enabled: !!id });
}

export function useAddDwellStrategyNote(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => dwellsApi.addNote(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...strategiesKey, id, "notes"] }),
  });
}

export function useDeleteDwellStrategyNote(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) => dwellsApi.deleteNote(id, noteId),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...strategiesKey, id, "notes"] }),
  });
}

export function useDwellFiles() {
  return useQuery({ queryKey: [...filesKey, "list"], queryFn: dwellsApi.files });
}

export function useDwellFile(id: string) {
  return useQuery({ queryKey: [...filesKey, id], queryFn: () => dwellsApi.file(id), enabled: !!id });
}

/** Every change to a dwell file answers with the whole file: kept as is. */
export function useDwellFileMutation<V>(id: string, fn: (vars: V) => Promise<DwellFile>) {
  const qc = useQueryClient();
  const refresh = useRefreshDwells();
  return useMutation({
    mutationFn: fn,
    onSuccess: (file) => {
      qc.setQueryData([...filesKey, id], file);
      refresh();
    },
  });
}

export function useUpdateDwellFile(id: string) {
  return useDwellFileMutation(id, (input: DwellFileUpdate) => dwellsApi.updateFile(id, input));
}

export function useDwellVersions(kind: DwellKind, id: string) {
  const key = kind === "strategies" ? strategiesKey : filesKey;
  return useQuery({ queryKey: [...key, id, "versions"], queryFn: () => dwellsApi.versions(kind, id), enabled: !!id });
}

export function useDwellVersion(kind: DwellKind, id: string, n: number | null) {
  const key = kind === "strategies" ? strategiesKey : filesKey;
  return useQuery({
    queryKey: [...key, id, "versions", n],
    queryFn: () => dwellsApi.version(kind, id, n as number),
    enabled: !!id && n != null && n > 0,
  });
}

export function useDwellVersionDiff(kind: DwellKind, id: string, n: number, against?: number) {
  const key = kind === "strategies" ? strategiesKey : filesKey;
  return useQuery({
    queryKey: [...key, id, "versions", n, "diff", against ?? "previous"],
    queryFn: () => dwellsApi.diff(kind, id, n, against),
    enabled: !!id && n > 0,
  });
}

export function useCommitDwellVersion(kind: DwellKind, id: string) {
  const refresh = useRefreshDwells();
  return useMutation({
    mutationFn: (summary: string | undefined) => dwellsApi.commit(kind, id, summary),
    onSuccess: refresh,
  });
}

export function useAppSettings() {
  return useQuery({ queryKey: settingsKey, queryFn: dwellsApi.settings });
}

/** As the backend has them until an admin changes them (app_settings.MODE_DEFAULT_VALUES). */
export const BUILT_IN_MODE_DEFAULTS: ModeDefaults = {
  confirmation_quality: 100,
  confirmation_quantity: 2,
  frame_time_delta_us: 3,
  rf_delta: 0,
  pri_delta: 0,
  pw_delta: 0,
};

/** The admin's Mode defaults — the built-in ones until they've loaded. */
export function useModeDefaults(): { defaults: ModeDefaults; loaded: boolean } {
  const { data } = useAppSettings();
  return { defaults: data?.mode_defaults ?? BUILT_IN_MODE_DEFAULTS, loaded: !!data };
}

export function useUpdateAppSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<AppSettings>) => dwellsApi.updateSettings(input),
    onSuccess: (settings) => qc.setQueryData(settingsKey, settings),
  });
}

/** Strategies, refreshed after a create, copy or delete made outside a hook. */
export function useRefreshDwellLists() {
  return useRefreshDwells();
}
