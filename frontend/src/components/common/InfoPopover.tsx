import type { ReactNode } from "react";

export function HoverInfo({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <span className="info-popover">
      <span className="info-popover-trigger">{label}</span>
      <span className="info-popover-content">{children}</span>
    </span>
  );
}
