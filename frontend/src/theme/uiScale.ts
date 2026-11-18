import { useState } from "react";

/** How big the app is drawn, for people who want more on screen (or less):
 * it scales the root font size every size in the app is measured from, so
 * text, spacing and controls shrink or grow together. Saved in this browser,
 * like the style; public/theme-init.js applies it before the first paint. */
export const UI_SCALES: { value: number; label: string }[] = [
  { value: 0.8, label: "80%" },
  { value: 0.9, label: "90%" },
  { value: 1, label: "100%" },
  { value: 1.1, label: "110%" },
  { value: 1.25, label: "125%" },
];

const STORAGE_KEY = "ui-scale";

export function readUiScale(): number {
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    if (UI_SCALES.some((s) => s.value === stored)) return stored;
  } catch {
    // localStorage unavailable — 100%.
  }
  return 1;
}

export function applyUiScale(scale: number) {
  document.documentElement.style.setProperty("--ui-scale", String(scale));
}

export function useUiScale(): [number, (next: number) => void] {
  const [scale, setScaleState] = useState<number>(readUiScale);
  function setScale(next: number) {
    setScaleState(next);
    applyUiScale(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // Ignore — the size just won't persist across reloads.
    }
  }
  return [scale, setScale];
}
