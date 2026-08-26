import {
  useCreateEmitterTestRecord,
  useDeleteEmitterTestRecord,
  useEmitterTestRecords,
} from "../../state/hooks/useTestRecords";
import { useEmitterModes } from "../../state/hooks/useModes";
import { TestHistoryView } from "./TestHistoryView";

export function EmitterTestHistory({ emitterId }: { emitterId: string }) {
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
      availableModes={(modes ?? []).map((m) => ({ id: m.id, name: m.name }))}
    />
  );
}
