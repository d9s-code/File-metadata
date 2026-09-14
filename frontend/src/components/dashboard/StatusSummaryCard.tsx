import { StatusTiles } from "./StatusTiles";
import { StatusDistributionChart } from "./StatusDistributionChart";

export function StatusSummaryCard({
  title,
  counts,
  labelFor,
}: {
  title: string;
  counts: Record<string, number>;
  labelFor?: (status: string) => string;
}) {
  return (
    <div className="card status-tiles">
      <h4>{title}</h4>
      <div className="status-summary-row">
        <StatusTiles counts={counts} labelFor={labelFor} />
        <StatusDistributionChart counts={counts} labelFor={labelFor} />
      </div>
    </div>
  );
}
