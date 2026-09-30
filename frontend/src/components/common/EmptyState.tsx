import type { ReactNode } from "react";

export function EmptyState({
  icon = "○",
  title,
  message,
  action,
  compact = false,
}: {
  icon?: string;
  title: string;
  message?: string;
  action?: ReactNode;
  /** One muted line, for secondary sections where a big empty block wastes space. */
  compact?: boolean;
}) {
  if (compact) {
    return (
      <p className="empty-state-compact">
        <strong>{title}.</strong> {message}
        {action && <> {action}</>}
      </p>
    );
  }
  return (
    <div className="empty-state">
      <div className="empty-state-icon" aria-hidden="true">
        {icon}
      </div>
      <p className="empty-state-title">{title}</p>
      {message && <p className="empty-state-message">{message}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
