import type { ReactNode } from "react";

/** The top of an Emitter, Platform or MDF page — the same everywhere: the
 * name with its actions on the right (the main action first, then exports,
 * then "More ▾"), a status row under it, then whatever the page adds (a
 * description, a summary strip). `editing` gives it the blue edge Emitters
 * show while you hold the checkout. */
export function EntityHeader({
  title,
  subtitle,
  editing = false,
  actions,
  status,
  children,
}: {
  title: ReactNode;
  /** Shown muted after the title — an Emitter's designation, say. */
  subtitle?: ReactNode;
  editing?: boolean;
  actions?: ReactNode;
  status?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={editing ? "emitter-header editing" : "emitter-header"}>
      <div className="emitter-title-row">
        <h1>
          {title} {subtitle && <span className="muted">({subtitle})</span>}
        </h1>
        {actions && <div className="emitter-actions">{actions}</div>}
      </div>
      {status && <div className="status-row">{status}</div>}
      {children}
    </div>
  );
}
