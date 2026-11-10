import { api } from "./client";

/** What kind of emitter an Emitter is — an Admin-kept list. */
export interface FunctionCode {
  id: string;
  code: string;
  name: string;
  description: string | null;
  sort_order: number;
  /** Emitters (not deleted) with it. */
  emitter_count: number;
  created_at: string;
  updated_at: string;
}

export interface FunctionCodeInput {
  code: string;
  name: string;
  description?: string | null;
  sort_order?: number;
}

export const functionCodesApi = {
  list: () => api.get<FunctionCode[]>("/function-codes"),
  create: (input: FunctionCodeInput) => api.post<FunctionCode>("/function-codes", input),
  update: (id: string, input: Partial<FunctionCodeInput>) => api.patch<FunctionCode>(`/function-codes/${id}`, input),
  /** Refused while Emitters have it, unless moveTo names one to move them to. */
  delete: (id: string, moveTo?: string) =>
    api.delete<void>(`/function-codes/${id}${moveTo ? `?move_to=${encodeURIComponent(moveTo)}` : ""}`),
};

/** "FC — Fire control". */
export function functionCodeLabel(fc: Pick<FunctionCode, "code" | "name"> | undefined | null): string {
  return fc ? `${fc.code} — ${fc.name}` : "No function code";
}
