import { StatusTiles } from "./StatusTiles";

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
      <StatusTiles counts={counts} labelFor={labelFor} />
    </div>
  );
}
