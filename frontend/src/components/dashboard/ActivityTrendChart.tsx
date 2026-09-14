import { useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ActivityTrendPoint } from "../../api/dashboard";
import type { AuditAction } from "../../types/domain";
import { useActivityTrend } from "../../state/hooks/useDashboard";
import { useAuditActionCounts } from "../../state/hooks/useAuditLog";
import { actionLabel } from "../audit/auditFormat";
import { ACTIVITY_TREND_COLOR } from "./chartColors";

function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function ActivityTrendChart({ points: defaultPoints }: { points: ActivityTrendPoint[] }) {
  const [action, setAction] = useState<AuditAction | "">("");
  const { data: actionCounts } = useAuditActionCounts();
  const { data: filteredPoints } = useActivityTrend(action || undefined);

  const points = action ? filteredPoints ?? [] : defaultPoints;
  const data = points.map((p) => ({ ...p, label: shortDate(p.date) }));

  return (
    <div className="card">
      <div className="card-header-row">
        <h4>Activity Trend</h4>
        <select value={action} onChange={(e) => setAction(e.target.value as AuditAction | "")}>
          <option value="">All actions</option>
          {(actionCounts ?? [])
            .filter((a) => a.count > 0)
            .map((a) => (
              <option key={a.action} value={a.action}>
                {actionLabel(a.action)} ({a.count})
              </option>
            ))}
        </select>
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <BarChart data={data} margin={{ left: 0, right: 10 }}>
          <XAxis dataKey="label" interval={2} />
          <YAxis allowDecimals={false} width={30} />
          <Tooltip labelFormatter={(_, payload) => payload?.[0]?.payload?.date ?? ""} />
          <Bar dataKey="count" fill={ACTIVITY_TREND_COLOR} radius={2} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
