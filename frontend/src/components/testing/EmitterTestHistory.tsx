import {
  useCreateEmitterTestRecord,
  useDeleteEmitterTestRecord,
  useEmitterTestRecords,
} from "../../state/hooks/useTestRecords";
import { useEmitterModes } from "../../state/hooks/useModes";
import { useEmitterTestLines } from "../../state/hooks/useTestLines";
import { TestHistoryView } from "./TestHistoryView";
import { TestLinesPanel } from "./TestLinesPanel";
import type { EwGroup, FunctionGroup, Source } from "../../types/domain";

export function EmitterTestHistory({
  emitterId,
  ewGroups,
  sources,
  functionGroups,
  highlightTestRecordId,
}: {
  emitterId: string;
  ewGroups: EwGroup[];
  sources: Source[];
  functionGroups?: FunctionGroup[];
  highlightTestRecordId?: string;
}) {
  const { data: records } = useEmitterTestRecords(emitterId);
  const { data: modes } = useEmitterModes(emitterId);
  const { data: testLines } = useEmitterTestLines(emitterId);
  const create = useCreateEmitterTestRecord(emitterId);
  const del = useDeleteEmitterTestRecord(emitterId);

  const modeOptions = (modes ?? []).map((m) => ({
    id: m.id,
    name: m.name,
    last_tested_at: m.last_tested_at,
    last_test_result: m.last_test_result,
    function_group_id: m.function_group_id,
  }));

  return (
    <div>
      <TestLinesPanel emitterId={emitterId} lines={testLines ?? []} modes={modeOptions} />
      <TestHistoryView
        records={records ?? []}
        onCreate={(input) => create.mutateAsync(input)}
        onDelete={(id) => del.mutateAsync(id)}
        creating={create.isPending}
        availableModes={modeOptions}
        availableLines={(testLines ?? []).map((l) => ({
          id: l.id,
          label: l.label,
          expected_mode_id: l.expected_mode_id,
          expected_mode_name: l.expected_mode_name,
        }))}
        emitterId={emitterId}
        ewGroups={ewGroups}
        sources={sources}
        functionGroups={functionGroups}
        highlightId={highlightTestRecordId}
      />
    </div>
  );
}
