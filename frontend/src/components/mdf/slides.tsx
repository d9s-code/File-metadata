/** The release notes or a progress note as 16:9 slides — the same blocks
 * as the Word file, laid out a section to a slide (a long table or text
 * carries on to the next) — each with Copy image (to paste into PowerPoint)
 * and Save PNG. The image is drawn in the browser: no library. */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { ChangeMark, DocBlock } from "../../api/mdfPlan";

export const SLIDE_W = 1280;
export const SLIDE_H = 720;
/** Lines of body text a slide holds under its title. */
const LINES = 15;
/** Characters on a line of body text across a slide. */
const LINE_CHARS = 100;

const MARK_COLOURS: Record<ChangeMark, [string, string, string]> = {
  added: ["#F3FAF5", "#DDF2E3", "#1E7B34"],
  removed: ["#FDF3F2", "#FADCD9", "#B3261E"],
  updated: ["#FFFAEC", "#FCEFC7", "#8A5A00"],
};

export interface Slide {
  cover?: boolean;
  title: string;
  blocks: DocBlock[];
}

const text = (c: string | string[]) => (Array.isArray(c) ? c.join(" · ") : c);
const lines = (s: string, chars = LINE_CHARS) => Math.max(1, Math.ceil(s.length / chars));

function rowLines(row: (string | string[])[], widths: number[]): number {
  const total = widths.reduce((a, w) => a + w, 0) || row.length;
  return Math.max(
    ...row.map((c, i) => {
      const share = widths.length ? widths[i] / total : 1 / row.length;
      const chars = Math.max(6, Math.floor(share * LINE_CHARS * 1.15));
      return Array.isArray(c) ? c.reduce((n, x) => n + lines(x, chars), 0) : lines(c, chars);
    }),
  );
}

function blockLines(b: DocBlock): number {
  if (b.kind === "h2") return 1.6;
  if (b.kind === "meta") return lines(b.text) * 0.9;
  return lines(b.text);
}

/** The blocks as slides: the title and its details on the first, then a
 * section (each top heading) to a slide — carried on to the next slide, its
 * table's heading row repeated, when it doesn't fit. */
export function toSlides(blocks: DocBlock[]): Slide[] {
  const slides: Slide[] = [];
  let i = 0;
  if (blocks[0]?.kind === "title") {
    const cover: Slide = { cover: true, title: blocks[0].text, blocks: [] };
    i = 1;
    while (i < blocks.length && blocks[i].kind !== "h1") cover.blocks.push(blocks[i++]);
    slides.push(cover);
  }
  while (i < blocks.length) {
    const title = blocks[i].kind === "h1" ? blocks[i++].text : "";
    let slide: Slide = { title, blocks: [] };
    let used = 0;
    const next = () => {
      slides.push(slide);
      slide = { title: `${title} (continued)`, blocks: [] };
      used = 0;
    };
    while (i < blocks.length && blocks[i].kind !== "h1") {
      const b = blocks[i++];
      if (b.kind !== "table") {
        const n = blockLines(b);
        if (used > 0 && used + n > LINES) next();
        slide.blocks.push(b);
        used += n;
        continue;
      }
      const [head, ...rows] = b.rows;
      const scale = (b.font_pt ?? 10.5) / 10.5;
      let chunk: number[] = [];
      const flush = () => {
        if (!chunk.length) return;
        slide.blocks.push({ ...b, rows: [head, ...chunk.map((r) => rows[r])], marks: chunk.map((r) => b.marks[r] ?? null) });
        chunk = [];
      };
      used += 1.3;
      rows.forEach((row, r) => {
        const n = rowLines(row, b.widths) * scale + 0.35;
        if (used + n > LINES && (chunk.length || used > 1.3)) {
          flush();
          next();
          used = 1.3;
        }
        chunk.push(r);
        used += n;
      });
      flush();
    }
    slides.push(slide);
  }
  return slides;
}

function SlideTable({ b }: { b: DocBlock }) {
  const [head, ...rows] = b.rows;
  const total = b.widths.reduce((a, w) => a + w, 0);
  const size = b.font_pt && b.font_pt < 10 ? 17 : 19;
  return (
    <table className="slide-table" style={{ fontSize: size }}>
      {total > 0 && (
        <colgroup>
          {b.widths.map((w, i) => (
            <col key={i} style={{ width: `${(w / total) * 100}%` }} />
          ))}
        </colgroup>
      )}
      <thead>
        <tr>
          {head.map((c, i) => (
            <th key={i}>{text(c)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, r) => {
          const mark = b.marks[r] ?? null;
          const [tint, fill, ink] = mark ? MARK_COLOURS[mark] : [undefined, undefined, undefined];
          return (
            <tr key={r}>
              {row.map((c, k) => {
                const strong = !!mark && k === b.mark_column;
                const style: CSSProperties = { background: strong ? fill : tint, color: strong ? ink : undefined, fontWeight: strong ? 700 : undefined };
                return (
                  <td key={k} style={style}>
                    {Array.isArray(c) ? (c.length > 1 ? c.map((x, n) => <div key={n}>• {x}</div>) : c[0]) : c}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function SlideView({ slide, index, count, footer }: { slide: Slide; index: number; count: number; footer: string }) {
  return (
    <div className={slide.cover ? "slide cover" : "slide"} style={{ width: SLIDE_W, height: SLIDE_H }}>
      <div className="slide-bar" />
      {slide.cover ? (
        <div className="slide-cover-body">
          <div className="slide-cover-title">{slide.title}</div>
          {slide.blocks.map((b, i) => (
            <div key={i} className="slide-cover-meta">
              {b.text}
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="slide-title">{slide.title}</div>
          <div className="slide-body">
            {slide.blocks.map((b, i) =>
              b.kind === "table" ? (
                <SlideTable key={i} b={b} />
              ) : b.kind === "h2" ? (
                <div key={i} className="slide-h2">
                  {b.text}
                </div>
              ) : b.kind === "meta" ? (
                <div key={i} className="slide-meta">
                  {b.text}
                </div>
              ) : (
                <p key={i} className={b.kind === "bullet" ? "slide-p bullet" : "slide-p"}>
                  {b.kind === "bullet" ? `• ${b.text}` : b.text}
                </p>
              ),
            )}
          </div>
        </>
      )}
      <div className="slide-footer">
        <span>{footer}</span>
        <span>
          {index + 1} / {count}
        </span>
      </div>
    </div>
  );
}

/** Every computed style written onto the copy, so it draws the same outside the page. */
function inlineStyles(src: Element, dst: Element) {
  const cs = getComputedStyle(src);
  const style = (dst as HTMLElement).style;
  for (let i = 0; i < cs.length; i++) {
    const p = cs[i];
    style.setProperty(p, cs.getPropertyValue(p), cs.getPropertyPriority(p));
  }
  for (let i = 0; i < src.children.length; i++) inlineStyles(src.children[i], dst.children[i]);
}

/** A slide as a PNG, at twice its size (sharp when pasted). */
export async function slidePng(node: HTMLElement, scale = 2): Promise<Blob> {
  const w = node.offsetWidth;
  const h = node.offsetHeight;
  const clone = node.cloneNode(true) as HTMLElement;
  inlineStyles(node, clone);
  clone.style.transform = "none";
  clone.style.margin = "0";
  const xml = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject x="0" y="0" width="${w}" height="${h}">${xml}</foreignObject></svg>`;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas");
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't draw the slide"))), "image/png"));
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The slides, each scaled to the width there is, with its buttons. */
export function SlideDeck({ blocks, footer, fileStem }: { blocks: DocBlock[]; footer: string; fileStem: string }) {
  const slides = toSlides(blocks);
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.6);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, el.clientWidth / SLIDE_W));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const nodes = useRef<(HTMLDivElement | null)[]>([]);

  async function copy(i: number) {
    const node = nodes.current[i]?.firstElementChild as HTMLElement | null;
    if (!node) return;
    try {
      const blob = await slidePng(node);
      if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) throw new Error("no clipboard");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setMessage(`Slide ${i + 1} copied — paste it into PowerPoint.`);
    } catch {
      const blob = await slidePng(node).catch(() => null);
      if (blob) saveBlob(blob, `${fileStem} slide ${i + 1}.png`);
      setMessage("This browser doesn't allow copying images here (it needs https or this computer) — saved as a PNG instead.");
    }
  }

  async function save(i: number) {
    const node = nodes.current[i]?.firstElementChild as HTMLElement | null;
    if (!node) return;
    try {
      saveBlob(await slidePng(node), `${fileStem} slide ${i + 1}.png`);
    } catch {
      setMessage("Couldn't draw the slide as an image.");
    }
  }

  return (
    <div className="slide-deck" ref={box}>
      {message && (
        <p className="hint-text slide-message" role="status">
          {message}
        </p>
      )}
      {slides.map((slide, i) => (
        <figure key={i} className="slide-frame" aria-label={`Slide ${i + 1}`}>
          <div className="slide-scaler" style={{ height: SLIDE_H * scale }}>
            <div
              ref={(el) => {
                nodes.current[i] = el;
              }}
              style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: SLIDE_W }}
            >
              <SlideView slide={slide} index={i} count={slides.length} footer={footer} />
            </div>
          </div>
          <figcaption className="slide-actions">
            <span className="hint-text">Slide {i + 1}</span>
            <button type="button" className="button secondary small" onClick={() => void copy(i)}>
              Copy image
            </button>
            <button type="button" className="button secondary small" onClick={() => void save(i)}>
              Save PNG
            </button>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
