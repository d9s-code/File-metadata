import { api } from "./client";
import type { ModeGenerationBatch } from "../types/domain";

export const modeBatchesApi = {
  listByEmitter: (emitterId: string) =>
    api.get<ModeGenerationBatch[]>(`/emitters/${emitterId}/generation-batches`),
  delete: (emitterId: string, batchId: string) =>
    api.delete<void>(`/emitters/${emitterId}/generation-batches/${batchId}`),
};
