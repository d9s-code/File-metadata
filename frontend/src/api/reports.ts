import { api } from "./client";

export const reportsApi = {
  /** The Emitter report for the Platforms and Emitters picked, as an .xlsx file. */
  emitters: (input: { platform_ids: string[]; emitter_ids: string[] }) =>
    api.post<Blob>("/reports/emitters", input, { responseType: "blob" }),
  /** The analysis sheet for the same picks: Modes with Sources and notes, values as typed and with their delta. */
  analysis: (input: { platform_ids: string[]; emitter_ids: string[] }) =>
    api.post<Blob>("/reports/analysis", input, { responseType: "blob" }),
};
