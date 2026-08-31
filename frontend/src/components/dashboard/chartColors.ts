/** Hardcoded hex, matched to this app's badge/status CSS tokens — recharts
 * fills can't consume CSS custom properties directly, so these are kept in
 * sync with index.css by hand (same approach as
 * components/ambiguity/RfPriScatterPlot.tsx's COLOR_A/COLOR_B). */
export const STATUS_COLORS: Record<string, string> = {
  draft: "#9ca3af",
  in_review: "#f59e0b",
  validated: "#10b981",
  deprecated: "#ef4444",
  pending_review: "#f59e0b",
  approved: "#10b981",
  released: "#3b82f6",
  rejected: "#ef4444",
};

export const TEST_RESULT_COLORS: Record<string, string> = {
  pass: "#10b981",
  fail: "#ef4444",
  partial: "#f59e0b",
  inconclusive: "#9ca3af",
};

export const ACTIVITY_TREND_COLOR = "#3b82f6";
