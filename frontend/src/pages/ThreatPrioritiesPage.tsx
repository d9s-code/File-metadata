import { EMITTERS_SECTION, PageHeader } from "../components/common/PageHeader";
import { ThreatPriorities } from "../components/emitters/ThreatPriorities";

/** Every Emitter's EW Groups and their threat priority, in one place. */
export function ThreatPrioritiesPage() {
  return (
    <div className="page">
      <PageHeader
        title="Threat priorities"
        info="Every Emitter's EW Groups and their threat priority (the PRS XML's ThreatPriority), with the Platforms each Emitter is on and their allegiance. Edit a priority in place, or tick rows to set several; group by priority, Emitter, Platform or allegiance."
        section={EMITTERS_SECTION}
      />
      <ThreatPriorities />
    </div>
  );
}
