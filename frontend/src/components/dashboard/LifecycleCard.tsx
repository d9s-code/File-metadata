import { Link } from "react-router-dom";
import { useStatuses } from "../../state/hooks/useStatuses";
import { StatusTiles } from "./StatusTiles";

/** How many Emitters and MDFs sit at each lifecycle stage. */
export function LifecycleCard({
  emitterCounts,
  mdfCounts,
}: {
  emitterCounts: Record<string, number>;
  mdfCounts: Record<string, number>;
}) {
  const emitter = useStatuses("emitter");
  const mdf = useStatuses("mdf");
  return (
    <div className="card lifecycle-card">
      <h4>
        <Link to="/emitters">Emitters</Link>
      </h4>
      <StatusTiles counts={emitterCounts} labelFor={emitter.label} colorFor={emitter.color} />
      <h4 className="lifecycle-second">
        <Link to="/mdfs">MDFs</Link>
      </h4>
      <StatusTiles counts={mdfCounts} labelFor={mdf.label} colorFor={mdf.color} />
    </div>
  );
}
