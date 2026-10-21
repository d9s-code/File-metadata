import { api } from "./client";

export const reportsApi = {
  /** The Emitter report for the Platforms and Emitters picked, as an .xlsx file. */
  emitters: (input: { platform_ids: string[]; emitter_ids: string[] }) =>
    api.post<Blob>("/reports/emitters", input, { responseType: "blob" }),
};
