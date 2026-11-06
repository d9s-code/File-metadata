import { useState } from "react";

/** The app's look, apart from light/dark: Workbench and Instrument each add a
 * stylesheet (src/styles/) on top of Classic, scoped to <html data-style>.
 * Saved in this browser, like the light/dark choice; public/theme-init.js
 * applies it before the first paint. */
export type UiStyle = "workbench" | "instrument" | "classic";

export const UI_STYLES: { value: UiStyle; label: string; hint: string }[] = [
  {
    value: "workbench",
    label: "Workbench",
    hint: "Roomy. Key numbers as readouts, panels with title bars, status as a dot, the Mode editor from the right.",
  },
  {
    value: "instrument",
    label: "Instrument",
    hint: "Compact, like a console. Dense tables with column lines, monospace titles and tags.",
  },
  { value: "classic", label: "Classic", hint: "The original look." },
];

export const DEFAULT_UI_STYLE: UiStyle = "workbench";
const STORAGE_KEY = "ui-style";

export function readUiStyle(): UiStyle {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (UI_STYLES.some((s) => s.value === stored)) return stored as UiStyle;
  } catch {
    // localStorage unavailable — the default applies.
  }
  return DEFAULT_UI_STYLE;
}

export function useUiStyle(): [UiStyle, (next: UiStyle) => void] {
  const [style, setStyleState] = useState<UiStyle>(readUiStyle);
  function setStyle(next: UiStyle) {
    setStyleState(next);
    document.documentElement.setAttribute("data-style", next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore — the style just won't persist across reloads.
    }
  }
  return [style, setStyle];
}
