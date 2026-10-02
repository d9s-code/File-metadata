import { useMemo, useRef, useState, type PointerEvent } from "react";
import { useWidth } from "./Histogram";
import { formatTime } from "./timeAxis";

const HEIGHT = 34;
const BINS = 160;
// Narrowest window: one second, or a 2000th of the recording.
const minSpan = (full: [number, number]) => Math.max(1000, (full[1] - full[0]) / 2000);

export type TimeWindow = [number, number] | null;

function clampWindow(w: [number, number], full: [number, number]): [number, number] {
  const span = Math.min(Math.max(w[1] - w[0], minSpan(full)), full[1] - full[0]);
  let lo = w[0];
  if (lo < full[0]) lo = full[0];
  if (lo + span > full[1]) lo = full[1] - span;
  return [lo, lo + span];
}

function duration(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 120) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 120) return `${m} min`;
  const h = m / 60;
  return h < 48 ? `${h.toFixed(1).replace(/\.0$/, "")} h` : `${(h / 24).toFixed(1).replace(/\.0$/, "")} days`;
}

/** Zoom for the Over time charts: an overview of the whole recording (how
 * many reports at each moment) with the window shown on the charts
 * highlighted. Drag across the strip to zoom to that stretch, drag the
 * window to pan, click to centre it there; the buttons zoom in and out
 * around the middle. */
export function TimeZoom({
  full,
  window,
  onChange,
  times,
}: {
  full: [number, number];
  window: TimeWindow;
  onChange: (w: TimeWindow) => void;
  /** Every time in view — drawn as the overview's density. */
  times: number[];
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [lo, hi] = full;
  const span = hi - lo || 1;
  const shown = window ?? full;
  const x = (t: number) => ((t - lo) / span) * width;
  const t = (px: number) => lo + (Math.min(Math.max(px, 0), width) / (width || 1)) * span;
  type Drag = { mode: "select" | "pan"; x0: number; x1: number; start: [number, number] };
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDragState] = useState<Drag | null>(null);
  const setDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDragState(d);
  };

  const bars = useMemo(() => {
    const counts = Array.from({ length: BINS }, () => 0);
    for (const v of times) {
      const b = Math.min(BINS - 1, Math.floor(((v - lo) / span) * BINS));
      if (b >= 0) counts[b]++;
    }
    const max = Math.max(1, ...counts);
    return counts.map((c) => c / max);
  }, [times, lo, span]);

  function zoomBy(factor: number) {
    const mid = (shown[0] + shown[1]) / 2;
    const half = ((shown[1] - shown[0]) * factor) / 2;
    const next = clampWindow([mid - half, mid + half], full);
    onChange(next[1] - next[0] >= span * 0.999 ? null : next);
  }
  function local(e: PointerEvent<HTMLDivElement>) {
    return e.clientX - e.currentTarget.getBoundingClientRect().left;
  }

  const zoomed = window != null;
  const band = drag?.mode === "select" ? [Math.min(drag.x0, drag.x1), Math.max(drag.x0, drag.x1)] : [x(shown[0]), x(shown[1])];

  return (
    <div className="time-zoom">
      <div className="time-zoom-bar">
        <span className="hint-text">
          {zoomed ? (
            <>
              Showing {formatTime(shown[0])} – {formatTime(shown[1]).slice(11)} ({duration(shown[1] - shown[0])} of{" "}
              {duration(span)}) · drag along a chart&apos;s value axis to zoom it vertically
            </>
          ) : (
            <>
              Whole recording — {duration(span)}. Drag across the strip to zoom in on time, or up and down along a
              chart&apos;s value axis to zoom it vertically.
            </>
          )}
        </span>
        <span className="time-zoom-buttons">
          <button type="button" className="button secondary small" onClick={() => zoomBy(0.5)} title="Zoom in">
            +
          </button>
          <button
            type="button"
            className="button secondary small"
            disabled={!zoomed}
            onClick={() => zoomBy(2)}
            title="Zoom out"
          >
            −
          </button>
          <button type="button" className="button secondary small" disabled={!zoomed} onClick={() => onChange(null)}>
            Show all
          </button>
        </span>
      </div>
      <div
        ref={ref}
        className="time-zoom-strip"
        style={{ height: HEIGHT }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const px = local(e);
          const inside = zoomed && px >= x(shown[0]) && px <= x(shown[1]);
          setDrag({ mode: inside ? "pan" : "select", x0: px, x1: px, start: shown });
        }}
        onPointerMove={(e) => {
          const d = dragRef.current;
          if (!d) return;
          const px = local(e);
          if (d.mode === "pan") {
            const shift = ((px - d.x0) / (width || 1)) * span;
            onChange(clampWindow([d.start[0] + shift, d.start[1] + shift], full));
          } else setDrag({ ...d, x1: px });
        }}
        onPointerUp={(e) => {
          const d = dragRef.current;
          setDrag(null);
          if (!d || d.mode === "pan") return;
          const px = local(e);
          if (Math.abs(px - d.x0) < 4) {
            // A click: centre the current window there (or, at full view, zoom in around it).
            const width0 = zoomed ? shown[1] - shown[0] : span / 4;
            const c = t(px);
            onChange(clampWindow([c - width0 / 2, c + width0 / 2], full));
            return;
          }
          const a = t(Math.min(d.x0, px));
          const b = t(Math.max(d.x0, px));
          const next = clampWindow([a, b], full);
          onChange(next[1] - next[0] >= span * 0.999 ? null : next);
        }}
      >
        <svg width={width} height={HEIGHT} aria-label="Time overview — drag to zoom">
          {bars.map((h, i) =>
            h > 0 ? (
              <rect
                key={i}
                className="time-zoom-density"
                x={(i / BINS) * width}
                y={HEIGHT - 4 - h * (HEIGHT - 8)}
                width={Math.max(1, width / BINS - 0.5)}
                height={h * (HEIGHT - 8)}
              />
            ) : null,
          )}
          {(zoomed || drag?.mode === "select") && (
            <>
              <rect className="time-zoom-shade" x={0} y={0} width={Math.max(0, band[0])} height={HEIGHT} />
              <rect className="time-zoom-shade" x={band[1]} y={0} width={Math.max(0, width - band[1])} height={HEIGHT} />
              <rect className="time-zoom-window" x={band[0]} y={0.5} width={Math.max(2, band[1] - band[0])} height={HEIGHT - 1} />
            </>
          )}
        </svg>
      </div>
    </div>
  );
}

/** A window still worth keeping for a (possibly changed) full span — none if it no longer overlaps. */
export function fitWindow(w: TimeWindow, full: [number, number]): TimeWindow {
  if (!w) return null;
  if (w[1] < full[0] || w[0] > full[1]) return null;
  return clampWindow([Math.max(w[0], full[0]), Math.min(w[1], full[1])], full);
}
