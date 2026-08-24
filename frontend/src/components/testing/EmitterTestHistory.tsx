import {
  useCreateEmitterTestRecord,
  useDeleteEmitterTestRecord,
  useEmitterTestRecords,
} from "../../state/hooks/useTestRecords";
import { TestHistoryView } from "./TestHistoryView";

export function EmitterTestHistory({ emitterId }: { emitterId: string }) {
  const { data: records } = useEmitterTestRecords(emitterId);
  const create = useCreateEmitterTestRecord(emitterId);
  const del = useDeleteEmitterTestRecord(emitterId);

  return (
    <TestHistoryView
      records={records ?? []}
      onCreate={(input) => create.mutateAsync(input)}
      onDelete={(id) => del.mutateAsync(id)}
      creating={create.isPending}
    />
  );
}
