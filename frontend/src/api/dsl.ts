import { api } from "./client";
import type { Mode } from "../types/domain";

export interface ModeFromDslInput {
  source_id: string;
  name: string;
  dsl_text: string;
  notes?: string | null;
  sort_order?: number;
}

export const dslApi = {
  createModeFromDsl: (ewGroupId: string, input: ModeFromDslInput) =>
    api.post<Mode>(`/ew-groups/${ewGroupId}/modes/from-dsl`, input),
};
