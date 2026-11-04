import { emittersApi } from "../../api/emitters";

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  a.remove();
}

/** Downloads one Emitter's XML archive. */
export async function exportEmitterXml(emitter: { id: string; name: string }) {
  const blob = await emittersApi.exportXml(emitter.id, { responseType: "blob" });
  save(blob as Blob, `${emitter.name}_xml_export.zip`);
}

/** Downloads several Emitters in one XML archive (emitters/<name>.xml each). */
export async function exportEmittersXml(ids: string[]) {
  const blob = await emittersApi.exportXmlMany(ids);
  save(blob as Blob, `emitters_xml_export_${ids.length}.zip`);
}
