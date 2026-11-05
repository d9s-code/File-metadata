import { reportsApi } from "../../api/reports";

/** Downloads an MDF's report: the Emitter report's sheet — a line per Mode
 * of every Emitter its pinned Platform versions pin — and a sheet of what's
 * pinned. Throws (an ApiRequestError) when there's nothing to report. */
export async function downloadMdfReport(mdf: { id: string; name: string }) {
  const blob = await reportsApi.mdf(mdf.id);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `MDF report ${mdf.name} ${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  a.remove();
}
