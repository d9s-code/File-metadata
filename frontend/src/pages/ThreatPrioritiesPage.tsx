import { EMITTERS_SECTION, PageHeader } from "../components/common/PageHeader";
import { ThreatPriorities } from "../components/emitters/ThreatPriorities";

/** Every Emitter's EW Groups and their priority, in one place. */
export function ThreatPrioritiesPage() {
  return (
    <div className="page">
      <PageHeader
        title="Priorities"
        info="Every Emitter's EW Groups and their priority (the PRS XML's ThreatPriority), with its function code and the Platforms each Emitter is on with their affiliation. Edit a priority in place, or tick rows to set several; group by function code, priority, Emitter, Platform or affiliation."
        section={EMITTERS_SECTION}
      />
      <ThreatPriorities />
    </div>
  );
}
