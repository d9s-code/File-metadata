import {
  useCreateEmitterTestRecord,
  useDeleteEmitterTestRecord,
  useEmitterTestRecords,
} from "../../state/hooks/useTestRecords";
import { useEmitterModes } from "../../state/hooks/useModes";
import { TestHistoryView } from "./TestHistoryView";
import type { EwGroup, Source } from "../../types/domain";

export function EmitterTestHistory({
  emitterId,
  ewGroups,
  sources,
  highlightTestRecordId,
}: {
  emitterId: string;
  ewGroups: EwGroup[];
  sources: Source[];
  highlightTestRecordId?: string;
}) {
  const { data: records } = useEmitterTestRecords(emitterId);
  const { data: modes } = useEmitterModes(emitterId);
  const create = useCreateEmitterTestRecord(emitterId);
  const del = useDeleteEmitterTestRecord(emitterId);

  return (
    <TestHistoryView
      records={records ?? []}
      onCreate={(input) => create.mutateAsync(input)}
      onDelete={(id) => del.mutateAsync(id)}
      creating={create.isPending}
      availableModes={(modes ?? []).map((m) => ({
        id: m.id,
        name: m.name,
        status: m.status,
        last_tested_at: m.last_tested_at,
        last_test_result: m.last_test_result,
      }))}
      emitterId={emitterId}
      ewGroups={ewGroups}
      sources={sources}
      highlightId={highlightTestRecordId}
    />
  );
}
