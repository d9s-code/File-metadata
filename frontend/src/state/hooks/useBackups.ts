import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { backupsApi } from "../../api/backups";

export const backupsKey = ["backups"] as const;

export function useBackups() {
  return useQuery({ queryKey: backupsKey, queryFn: () => backupsApi.list() });
}

/** Whether backups are in order — polled for the admin warning on every page. */
export function useBackupHealth(enabled: boolean) {
  return useQuery({
    queryKey: [...backupsKey, "health"],
    queryFn: () => backupsApi.health(),
    enabled,
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });
}

/** The dashboard's Backup card: time since the latest backup and changes since. */
export function useBackupStatus() {
  return useQuery({
    queryKey: [...backupsKey, "status"],
    queryFn: () => backupsApi.status(),
    refetchInterval: 5 * 60_000,
  });
}

export function useBackupDiff(from: string | null, to: string) {
  return useQuery({
    queryKey: [...backupsKey, "diff", from, to],
    queryFn: () => backupsApi.diff(from as string, to),
    enabled: !!from && from !== to,
    retry: false,
  });
}

export function useBackUpNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => backupsApi.backUpNow(),
    onSuccess: () => qc.invalidateQueries({ queryKey: backupsKey }),
  });
}

export function useVerifyBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: string) => backupsApi.verify(file),
    onSuccess: () => qc.invalidateQueries({ queryKey: backupsKey }),
  });
}
