import type { TestRecord } from "../../api/testRecords";
import type { TestResult } from "../../types/domain";
import { DEFAULT_UNKNOWN } from "./ModeMultiSelect";
import { blankSimLineEntry, type SimLineEntry } from "./SimLineResultsTable";
import { blankInterceptModeEntry, type InterceptModeEntry } from "./InterceptModeResultsTable";

/** Outcomes and intercepted Modes carry over from an earlier run; parameters
 * and notes describe that specific run, so they don't. */
export function lineEntriesFrom(previous: TestRecord | undefined, lineIds: string[]): Record<string, SimLineEntry> {
  const prior = new Map((previous?.lines ?? []).map((l) => [l.test_line_id, l]));
  return Object.fromEntries(
    lineIds.map((id) => {
      const p = prior.get(id);
      return [
        id,
        p
          ? {
              ...blankSimLineEntry(),
              outcome: p.outcome,
              interceptedModeIds: [
                ...(p.intercepted_as_unknown ? [DEFAULT_UNKNOWN.id] : []),
                ...p.intercepted_modes.map((m) => m.mode_id),
              ],
            }
          : blankSimLineEntry(),
      ];
    }),
  );
}

export function modeEntriesFrom(previous: TestRecord | undefined): Record<string, InterceptModeEntry> {
  return Object.fromEntries(
    (previous?.modes ?? [])
      .filter((m) => m.link_type === "exercised" && m.result)
      .map((m) => [m.mode_id, { ...blankInterceptModeEntry(), included: true, result: m.result as TestResult }]),
  );
}

