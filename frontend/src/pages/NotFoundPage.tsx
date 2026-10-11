import { Link, useLocation } from "react-router-dom";
import { EmptyState } from "../components/common/EmptyState";

/** Any address no route matches — a mistyped or outdated link. */
export function NotFoundPage() {
  const { pathname } = useLocation();
  return (
    <div className="page">
      <EmptyState
        icon="?"
        title="Page not found"
        message={`Nothing lives at ${pathname} — the link may be mistyped or out of date. Search (Ctrl+K) finds anything by name.`}
        action={<Link to="/dashboard">Go to the Dashboard</Link>}
      />
    </div>
  );
}
