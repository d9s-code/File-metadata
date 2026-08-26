import type { EwGroup, Mode, Source } from "../../types/domain";
import { HoverInfo } from "../common/InfoPopover";
import { RequireRole } from "../../auth/RequireAuth";
import type { ModeSortKey, SortDir } from "./modeFormat";
import { EwGroupHoverDetail, ModeHoverDetail, SourceHoverDetail, StaggerSequenceBox } from "./ModeHoverDetails";

function SortableHeader({
  label,
  sortKey,
  currentKey,
  currentDir,
  onSort,
}: {
  label: string;
  sortKey: ModeSortKey;
  currentKey: ModeSortKey;
  currentDir: SortDir;
  onSort: (key: ModeSortKey) => void;
}) {
  const active = currentKey === sortKey;
  return (
    <th className="sortable-th" onClick={() => onSort(sortKey)}>
      {label}
      {active && <span className="sort-indicator">{currentDir === "asc" ? "▲" : "▼"}</span>}
    </th>
  );
}

export function ModesTable({
  emitterId,
  modes,
  ewGroupsById,
  sourcesById,
  sortKey,
  sortDir,
  onSort,
  onDelete,
}: {
  emitterId: string;
  modes: Mode[];
  ewGroupsById: Record<string, EwGroup>;
  sourcesById: Record<string, Source>;
  sortKey: ModeSortKey;
  sortDir: SortDir;
  onSort: (key: ModeSortKey) => void;
  onDelete: (modeId: string, ewGroupId: string, name: string) => void;
}) {
  const header = (label: string, key: ModeSortKey) => (
    <SortableHeader label={label} sortKey={key} currentKey={sortKey} currentDir={sortDir} onSort={onSort} />
  );

  return (
    <div className="matrix-scroll">
      <table className="data-table">
        <thead>
          <tr>
            {header("Name", "name")}
            {header("EW Group", "ew_group")}
            {header("Source", "source")}
            {header("RF Min", "rf_min")}
            {header("RF Max", "rf_max")}
            {header("PW Min", "pw_min")}
            {header("PW Max", "pw_max")}
            {header("PRI Type", "pri_type")}
            {header("PRI Min", "pri_min")}
            {header("PRI Max", "pri_max")}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {modes.map((m) => {
            const ewGroup = ewGroupsById[m.ew_group_id];
            const source = sourcesById[m.source_id];
            return (
              <tr key={m.id}>
                <td>
                  <HoverInfo label={m.name}>
                    <ModeHoverDetail mode={m} />
                  </HoverInfo>
                </td>
                <td>
                  {ewGroup ? (
                    <HoverInfo label={ewGroup.name}>
                      <EwGroupHoverDetail ewGroup={ewGroup} />
                    </HoverInfo>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  {source ? (
                    <HoverInfo label={source.name}>
                      <SourceHoverDetail emitterId={emitterId} source={source} />
                    </HoverInfo>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{m.line?.rf_min_mhz ?? "—"}</td>
                <td>
                  {m.line?.rf_max_mhz ?? "—"}
                  {m.line?.rf_delta != null && (
                    <span className="jitter-subline">
                      eng {m.line.engineered_rf_min_mhz}–{m.line.engineered_rf_max_mhz} (±{m.line.rf_delta})
                    </span>
                  )}
                </td>
                <td>{m.line?.pw_min_us ?? "—"}</td>
                <td>
                  {m.line?.pw_max_us ?? "—"}
                  {m.line?.pw_delta != null && (
                    <span className="jitter-subline">
                      eng {m.line.engineered_pw_min_us}–{m.line.engineered_pw_max_us} (±{m.line.pw_delta})
                    </span>
                  )}
                </td>
                <td>{m.pri_type.toUpperCase()}</td>
                {m.pri_type === "stagger" ? (
                  <td colSpan={2}>
                    <StaggerSequenceBox mode={m} />
                  </td>
                ) : m.pri_type === "fixed" ? (
                  <>
                    <td>{m.line?.pri_min_us ?? "—"}</td>
                    <td>
                      {m.line?.pri_max_us ?? "—"}
                      {m.line?.jitter_min_us != null && (
                        <span className="jitter-subline">
                          jitter {m.line.jitter_min_us}–{m.line.jitter_max_us}
                        </span>
                      )}
                      {m.line?.pri_delta != null && (
                        <span className="jitter-subline">
                          eng {m.line.engineered_pri_min_us}–{m.line.engineered_pri_max_us} (±{m.line.pri_delta})
                        </span>
                      )}
                    </td>
                  </>
                ) : (
                  <td colSpan={2}>{m.pri_type === "cw" ? "CW (constant)" : "—"}</td>
                )}
                <td>
                  <RequireRole minimum="editor">
                    <button className="link-button" onClick={() => onDelete(m.id, m.ew_group_id, m.name)}>
                      Delete
                    </button>
                  </RequireRole>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
