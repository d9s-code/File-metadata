/** Images sent with a question: at most this many, each shrunk in the
 * browser so its longer side is at most MAX_SIDE px (the server takes up to
 * 2 MB each). */
export const MAX_IMAGES = 4;
const MAX_SIDE = 1600;
const MAX_BYTES = 1_900_000;

function load(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`${file.name || "That file"} isn't an image the browser can read`));
    };
    img.src = url;
  });
}

/** The image as a data URL the chat can send: shrunk, and as JPEG unless
 * it's a small PNG (a screenshot of text stays sharp). */
export async function imageForChat(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error(`${file.name || "That file"} isn't an image`);
  const img = await load(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't prepare the image");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const png = file.type === "image/png" ? canvas.toDataURL("image/png") : null;
  if (png && png.length * 0.75 <= MAX_BYTES / 2) return png;
  for (const quality of [0.85, 0.7, 0.55]) {
    const jpeg = canvas.toDataURL("image/jpeg", quality);
    if (jpeg.length * 0.75 <= MAX_BYTES) return jpeg;
  }
  throw new Error(`${file.name || "That image"} is too large even shrunk`);
}
