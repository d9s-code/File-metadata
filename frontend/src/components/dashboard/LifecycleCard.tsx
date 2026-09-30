import { Link } from "react-router-dom";
import type { EmitterStatus } from "../../types/domain";
import { emitterStatusLabel } from "../common/emitterStatusLabel";
import { StatusTiles } from "./StatusTiles";

function sentenceCase(status: string): string {
  const words = status.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** How many Emitters and MDFs sit at each lifecycle stage. */
export function LifecycleCard({
  emitterCounts,
  mdfCounts,
}: {
  emitterCounts: Record<string, number>;
  mdfCounts: Record<string, number>;
}) {
  return (
    <div className="card lifecycle-card">
      <h4>
        <Link to="/emitters">Emitters</Link>
      </h4>
      <StatusTiles counts={emitterCounts} labelFor={(s) => emitterStatusLabel(s as EmitterStatus)} />
      <h4 className="lifecycle-second">
        <Link to="/mdfs">MDFs</Link>
      </h4>
      <StatusTiles counts={mdfCounts} labelFor={sentenceCase} />
    </div>
  );
}
