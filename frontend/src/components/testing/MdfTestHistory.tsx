import { useCreateMdfTestRecord, useDeleteMdfTestRecord, useMdfTestRecords } from "../../state/hooks/useTestRecords";
import { TestHistoryView } from "./TestHistoryView";

export function MdfTestHistory({
  mdfId,
  highlightTestRecordId,
}: {
  mdfId: string;
  highlightTestRecordId?: string;
}) {
  const { data: records } = useMdfTestRecords(mdfId);
  const create = useCreateMdfTestRecord(mdfId);
  const del = useDeleteMdfTestRecord(mdfId);

  return (
    <TestHistoryView
      records={records ?? []}
      onCreate={(input) => create.mutateAsync(input)}
      onDelete={(id) => del.mutateAsync(id)}
      creating={create.isPending}
      highlightId={highlightTestRecordId}
    />
  );
}
