import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import interUrl from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";
import { weeklyApi } from "../../api/reports";
import { ApiRequestError } from "../../api/client";
import { DateInput } from "../common/DateInput";
import { Modal } from "../common/Modal";
import { SECTIONS, SLIDE_H, SLIDE_W, periodText, slideSvg, type Measure, type SectionKey } from "./weeklySlide";

/** Today in the browser's time zone, as YYYY-MM-DD. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Inter as an @font-face rule with the font inline, so the slide image
 * draws in it outside the page (an SVG drawn as an image loads nothing). */
async function interFontCss(): Promise<string> {
  const blob = await (await fetch(interUrl)).blob();
  const data = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  return `@font-face{font-family:"Inter Variable";font-weight:100 900;src:url(${data}) format("woff2");}`;
}

/** Text widths as the page draws them in Inter. */
function canvasMeasure(): Measure {
  const ctx = document.createElement("canvas").getContext("2d")!;
  return (text, size, weight) => {
    ctx.font = `${weight} ${size}px "Inter Variable", Inter, sans-serif`;
    return ctx.measureText(text).width;
  };
}

const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** The slide as a PNG, 1920 × 1080. */
async function toPng(svg: string): Promise<Blob> {
  const img = new Image();
  img.src = svgUrl(svg);
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = SLIDE_W;
  canvas.height = SLIDE_H;
  canvas.getContext("2d")!.drawImage(img, 0, 0, SLIDE_W, SLIDE_H);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No image"))), "image/png"));
}

const canCopy = () => typeof window !== "undefined" && window.isSecureContext && "ClipboardItem" in window && !!navigator.clipboard?.write;

/** The weekly progress update: the 7 days up to a date, as one 16:9 slide
 * for the section's morning brief — pick what goes on it, see it, then
 * download it as a PNG or copy it to paste into PowerPoint. */
export function WeeklyUpdateDialog({ onClose }: { onClose: () => void }) {
  const [end, setEnd] = useState(today);
  const [sections, setSections] = useState<SectionKey[]>(() => SECTIONS.filter((s) => s.on).map((s) => s.key));
  const [title, setTitle] = useState("Weekly progress update");
  const [note, setNote] = useState("");
  const [fontCss, setFontCss] = useState<string | null>(null);
  const [fontsReady, setFontsReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { data, error, isFetching } = useQuery({
    queryKey: ["weeklyUpdate", end],
    queryFn: () => weeklyApi.get(end),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(end),
  });

  useEffect(() => {
    let live = true;
    interFontCss()
      .then((css) => live && setFontCss(css))
      .catch(() => live && setFontCss(""));
    document.fonts.ready.then(() => live && setFontsReady(true));
    return () => {
      live = false;
    };
  }, []);

  const measure = useMemo(() => (fontsReady ? canvasMeasure() : null), [fontsReady]);
  const svg = useMemo(
    () => (data && measure && fontCss !== null ? slideSvg(data, { sections, title, note }, measure, fontCss) : null),
    [data, measure, fontCss, sections, title, note],
  );

  const toggle = (key: SectionKey) =>
    setSections((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));

  async function download() {
    if (!svg) return;
    setBusy(true);
    setMessage(null);
    try {
      const url = URL.createObjectURL(await toPng(svg));
      const a = document.createElement("a");
      a.href = url;
      a.download = `Weekly progress ${data!.start} to ${data!.end}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setMessage("Couldn't make the image.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!svg) return;
    setBusy(true);
    setMessage(null);
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": toPng(svg) })]);
      setMessage("Copied — paste it into the slide.");
    } catch {
      setMessage("Couldn't copy the image here — download it instead.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Weekly progress update" onClose={onClose} className="weekly-dialog">
      <div className="weekly-layout">
        <div className="weekly-options">
          <label>
            Week ending
            <DateInput value={end} onChange={(e) => setEnd(e.target.value)} max={today()} />
            <span className="hint-text">{data ? `${periodText(data.start, data.end)} — the 7 days up to it` : "The 7 days up to it"}</span>
          </label>
          <fieldset className="weekly-sections">
            <legend>On the slide</legend>
            {SECTIONS.map((s) => (
              <label key={s.key} className="inline-check weekly-section">
                <input type="checkbox" checked={sections.includes(s.key)} onChange={() => toggle(s.key)} />
                <span>
                  <strong>{s.label}</strong>
                  <span className="hint-text">{s.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <label>
            Title
            <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            Headline (optional)
            <textarea
              rows={2}
              maxLength={220}
              value={note}
              placeholder="The week in a sentence, e.g. “Fleet MDF on track; Fire Control signed off.”"
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className="weekly-actions">
            <button type="button" className="button primary" disabled={!svg || busy || !sections.length} onClick={() => void download()}>
              Download PNG
            </button>
            {canCopy() && (
              <button type="button" className="button secondary" disabled={!svg || busy || !sections.length} onClick={() => void copy()}>
                Copy image
              </button>
            )}
          </div>
          <p className="hint-text">1920 × 1080 — fills a 16:9 slide. Light, like a slide, whatever the app&apos;s theme.</p>
          {message && <p className="hint-text weekly-message">{message}</p>}
          {error && <p className="error-text">{error instanceof ApiRequestError ? error.message : "Couldn't load the week"}</p>}
        </div>
        <div className="weekly-preview" aria-busy={isFetching || !svg}>
          {svg ? (
            <img src={svgUrl(svg)} alt={`The slide: ${title}, ${data ? periodText(data.start, data.end) : ""}`} />
          ) : (
            <div className="weekly-preview-empty hint-text">{error ? "—" : "Making the preview…"}</div>
          )}
        </div>
      </div>
    </Modal>
  );
}
