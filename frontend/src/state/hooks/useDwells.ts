import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dwellsApi, type AppSettings, type DwellFile, type DwellFileUpdate, type DwellStrategyUpdate } from "../../api/dwells";

export const dwellsKey = ["dwells"] as const;
const dwellKey = (id: string) => ["dwells", id] as const;
export const settingsKey = ["settings"] as const;

export function useDwellFiles() {
  return useQuery({ queryKey: dwellsKey, queryFn: dwellsApi.list });
}

export function useDwellFile(id: string) {
  return useQuery({ queryKey: dwellKey(id), queryFn: () => dwellsApi.get(id), enabled: !!id });
}

/** Every change to a dwell file answers with the whole file: kept as is. */
function useFileMutation<V>(id: string, fn: (vars: V) => Promise<DwellFile>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (file) => {
      qc.setQueryData(dwellKey(id), file);
      qc.invalidateQueries({ queryKey: dwellsKey, exact: true });
    },
  });
}

export function useUpdateDwellFile(id: string) {
  return useFileMutation(id, (input: DwellFileUpdate) => dwellsApi.update(id, input));
}

export function useAddDwellStrategy(id: string) {
  return useFileMutation(id, (platformId: string | null) => dwellsApi.addStrategy(id, platformId));
}

export function useUpdateDwellStrategy(id: string) {
  return useFileMutation(id, ({ strategyId, input }: { strategyId: string; input: DwellStrategyUpdate }) =>
    dwellsApi.updateStrategy(strategyId, input),
  );
}

export function useDeleteDwellStrategy(id: string) {
  return useFileMutation(id, (strategyId: string) => dwellsApi.deleteStrategy(strategyId));
}

export function useAppSettings() {
  return useQuery({ queryKey: settingsKey, queryFn: dwellsApi.settings });
}

export function useUpdateAppSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<AppSettings>) => dwellsApi.updateSettings(input),
    onSuccess: (settings) => qc.setQueryData(settingsKey, settings),
  });
}
