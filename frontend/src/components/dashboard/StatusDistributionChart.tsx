import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { STATUS_COLORS } from "./chartColors";

export function StatusDistributionChart({
  counts,
  labelFor = (status) => status.replace("_", " "),
}: {
  counts: Record<string, number>;
  labelFor?: (status: string) => string;
}) {
  const data = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => ({ name: labelFor(status), status, count }));

  if (data.length === 0) return null;

  return (
    <ResponsiveContainer width={92} height={92}>
      <PieChart>
        <Pie data={data} dataKey="count" nameKey="name" innerRadius={22} outerRadius={42}>
          {data.map((entry) => (
            <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? "#9ca3af"} />
          ))}
        </Pie>
        <Tooltip />
      </PieChart>
    </ResponsiveContainer>
  );
}
