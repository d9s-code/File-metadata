import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { TEST_RESULT_COLORS } from "./chartColors";

export function TestResultsChart({ counts }: { counts: Record<string, number> }) {
  const data = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([result, count]) => ({ name: result, count }));

  if (data.length === 0) return <p className="hint-text">No tests logged yet.</p>;

  return (
    <ResponsiveContainer width={92} height={92}>
      <PieChart>
        <Pie data={data} dataKey="count" nameKey="name" innerRadius={22} outerRadius={42}>
          {data.map((entry) => (
            <Cell key={entry.name} fill={TEST_RESULT_COLORS[entry.name] ?? "#9ca3af"} />
          ))}
        </Pie>
        <Tooltip />
      </PieChart>
    </ResponsiveContainer>
  );
}
