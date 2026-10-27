import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/** The way back up, above a page's title — "← Where you go back to", or
 * "← Name · Tab" when it goes back to one of a page's tabs. The same look on
 * every page that has one. */
export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="back-link">
      ← {children}
    </Link>
  );
}
