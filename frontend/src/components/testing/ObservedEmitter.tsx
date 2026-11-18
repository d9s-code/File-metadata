import { useQuery } from "@tanstack/react-query";
import { dwellsApi } from "../../api/dwells";
import type { ScenarioEmitter, ScenarioReport, ScenarioReportInput, ScenarioVerdicts } from "../../api/platformTests";
import type { TestResult } from "../../types/domain";
import { useDwellStrategies } from "../../state/hooks/useDwells";
import { MenuButton } from "../common/MenuButton";
import { testResultLabel } from "./testFormat";

/** What was observed of one Emitter on the air in a Platform or MDF test,
 * as typed in (kept in the run's draft). */
export interface ObservedRun {
  /** "" — not recorded. */
  detected: "" | "yes" | "no";
  /** Seconds, as typed; optional. */
  timeToDetect: string;
  /** The dwell that caught it, "1" for the first; "" — not said. */
  dwellIndex: string;
  reportedSelf: boolean;
  reportedUnknown: boolean;
  /** Mix-ups: reported as another Emitter (on a Platform, in an MDF test), optionally Mode for Mode. */
  reports: { emitterId: string; platformId?: string; expectedMode: string; reportedMode: string }[];
}

export function blankObserved(): ObservedRun {
  return { detected: "", timeToDetect: "", dwellIndex: "", reportedSelf: false, reportedUnknown: false, reports: [] };
}

/** An Emitter that can be reported: its id, how it reads, its Platform (MDF tests), its Modes. */
export interface ReportOption {
  emitterId: string;
  platformId?: string;
  label: string;
  modes: string[];
}

/** The result what was observed gives, as the server works it out: missed —
 * fail; reported as itself alone — pass; itself and something else —
 * partial; only something else — fail; nothing reported — inconclusive. */
export function workedOut(o: ObservedRun | undefined): TestResult | null {
  if (!o || !o.detected) return null;
  if (o.detected === "no") return "fail";
  const other = o.reports.length > 0 || o.reportedUnknown;
  if (o.reportedSelf) return other ? "partial" : "pass";
  return other ? "fail" : "inconclusive";
}

/** The API's fields for what was observed; none when nothing was recorded. */
export function observedInput(o: ObservedRun | undefined) {
  if (!o || !o.detected) return {};
  const detected = o.detected === "yes";
  const time = o.timeToDetect.trim();
  return {
    detected,
    time_to_detect_s: detected && time ? Number(time) : undefined,
    dwell_index: detected && o.dwellIndex ? Number(o.dwellIndex) : undefined,
    reported_self: detected ? o.reportedSelf : undefined,
    reported_unknown: detected ? o.reportedUnknown : undefined,
    reports: detected
      ? o.reports.map(
          (r): ScenarioReportInput => ({
            reported_emitter_id: r.emitterId,
            reported_platform_id: r.platformId || undefined,
            expected_mode: r.expectedMode || undefined,
            reported_mode: r.reportedMode || undefined,
          }),
        )
      : undefined,
  };
}

/** What's wrong with a typed time to detect, or null. */
export function timeError(o: ObservedRun | undefined): string | null {
  const t = o?.timeToDetect.trim();
  if (!t || o?.detected !== "yes") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? null : "Time to detect is a number of seconds, 0 or more";
}

const share = (n: number, total: number): TestResult => (total === 0 ? "inconclusive" : n === total ? "pass" : n === 0 ? "fail" : "partial");

/** The run's three verdicts, as the server will give them — a preview while filling in. */
export function previewVerdicts(rows: (ObservedRun | undefined)[]): ScenarioVerdicts | null {
  const observed = rows.filter((o): o is ObservedRun => !!o?.detected);
  if (!observed.length) return null;
  const detected = observed.filter((o) => o.detected === "yes");
  const identified = detected.filter((o) => o.reportedSelf);
  const mixups = detected.reduce((n, o) => n + o.reports.length, 0);
  return {
    detection: share(detected.length, observed.length),
    identification: share(identified.length, detected.length),
    mixups: detected.length ? (mixups ? "fail" : "pass") : "inconclusive",
    detected: detected.length,
    observed: observed.length,
    identified: identified.length,
    mixup_count: mixups,
  };
}

/** The three verdicts as a line of badges: "Detection 2/3 · Identification 1/2 · Mix-ups 1". */
export function VerdictsLine({ v }: { v: ScenarioVerdicts }) {
  const badge = (label: string, r: TestResult | null, detail: string, title: string) => (
    <span className="verdict" title={title}>
      <span className="verdict-label">{label}</span>{" "}
      <span className={`test-result-badge test-result-${r ?? "inconclusive"}`}>{testResultLabel(r ?? "inconclusive")}</span>{" "}
      <span className="hint-text">{detail}</span>
    </span>
  );
  return (
    <span className="verdicts">
      {badge("Detection", v.detection, `${v.detected}/${v.observed}`, "Emitters on the air that were detected")}
      {badge("Identification", v.identification, `${v.identified}/${v.detected}`, "Detected Emitters reported as themselves")}
      {badge("Mix-ups", v.mixups, String(v.mixup_count), "Times an Emitter was reported as another")}
    </span>
  );
}

/** The dwells of a Dwell Strategy version, for "caught by dwell". */
export function useStrategyDwells(platformId: string | undefined, versionId: string | undefined) {
  const { data: strategies } = useDwellStrategies(platformId, true);
  const strategy = (strategies ?? []).find((s) => s.latest_version_id === versionId);
  const { data } = useQuery({
    queryKey: ["dwellStrategyVersion", strategy?.id, strategy?.latest_version_number],
    queryFn: () => dwellsApi.version("strategies", strategy!.id, strategy!.latest_version_number!),
    enabled: !!versionId && !!strategy?.latest_version_number,
  });
  const dwells = (data?.snapshot?.dwells as { freq_mhz?: number }[] | undefined) ?? [];
  return versionId ? dwells : [];
}

/** Detected / missed, time to detect and the dwell that caught it. */
export function DetectionCell({
  value,
  onChange,
  dwells,
  disabled,
  label,
}: {
  value: ObservedRun;
  onChange: (o: ObservedRun) => void;
  dwells: { freq_mhz?: number }[];
  disabled?: boolean;
  label: string;
}) {
  const detected = value.detected === "yes";
  return (
    <div className="observed-detection">
      <select
        value={value.detected}
        disabled={disabled}
        aria-label={`${label} detected`}
        className={value.detected === "yes" ? "detected-yes" : value.detected === "no" ? "detected-no" : undefined}
        onChange={(e) => {
          const d = e.target.value as ObservedRun["detected"];
          // A missed Emitter was reported as nothing.
          onChange(d === "yes" ? { ...value, detected: d, reportedSelf: value.detected === "" ? true : value.reportedSelf } : { ...blankObserved(), detected: d });
        }}
      >
        <option value="">Not recorded</option>
        <option value="yes">Detected</option>
        <option value="no">Missed</option>
      </select>
      {detected && (
        <span className="observed-detection-more">
          <input
            className="observed-time"
            inputMode="decimal"
            placeholder="time"
            title="Time to detect, in seconds (optional)"
            aria-label={`${label} time to detect, seconds`}
            value={value.timeToDetect}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, timeToDetect: e.target.value })}
          />
          <span className="hint-text">s</span>
          {dwells.length > 0 && (
            <select
              value={value.dwellIndex}
              disabled={disabled}
              aria-label={`${label} caught by dwell`}
              title="The dwell that caught it (optional)"
              onChange={(e) => onChange({ ...value, dwellIndex: e.target.value })}
            >
              <option value="">Dwell…</option>
              {dwells.map((d, i) => (
                <option key={i} value={String(i + 1)}>
                  Dwell {i + 1}
                  {d.freq_mhz != null ? ` · ${d.freq_mhz} MHz` : ""}
                </option>
              ))}
            </select>
          )}
        </span>
      )}
    </div>
  );
}

/** What a detected Emitter was reported as: itself, Default Unknown, and/or
 * other Emitters — each a mix-up, optionally Mode for Mode. */
export function ReportedAsCell({
  value,
  onChange,
  ownModes,
  options,
  disabled,
  label,
}: {
  value: ObservedRun;
  onChange: (o: ObservedRun) => void;
  ownModes: string[];
  options: ReportOption[];
  disabled?: boolean;
  label: string;
}) {
  if (value.detected !== "yes")
    return <span className="hint-text observed-reported-hint">{value.detected === "no" ? "—" : "Say whether it was detected"}</span>;
  const key = (o: { emitterId: string; platformId?: string }) => `${o.emitterId}|${o.platformId ?? ""}`;
  const taken = new Set(value.reports.map(key));
  const addable = options.filter((o) => !taken.has(key(o)));
  const patchReport = (i: number, change: Partial<ObservedRun["reports"][number]>) =>
    onChange({ ...value, reports: value.reports.map((r, j) => (j === i ? { ...r, ...change } : r)) });
  return (
    <div className="observed-reported">
      <div className="observed-reported-flags">
        <label className="inline-check">
          <input
            type="checkbox"
            checked={value.reportedSelf}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, reportedSelf: e.target.checked })}
          />
          Itself
        </label>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={value.reportedUnknown}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, reportedUnknown: e.target.checked })}
          />
          Default Unknown
        </label>
        {addable.length > 0 && (
          <MenuButton
            label="+ Mix-up ▾"
            className="button secondary small"
            ariaLabel={`${label}: reported as another Emitter`}
            title="Reported as another Emitter — a mix-up"
            items={addable.map((o) => ({
              label: o.label,
              onSelect: () =>
                onChange({ ...value, reports: [...value.reports, { emitterId: o.emitterId, platformId: o.platformId, expectedMode: "", reportedMode: "" }] }),
            }))}
          />
        )}
      </div>
      {value.reports.map((r, i) => {
        const other = options.find((o) => key(o) === key(r));
        return (
          <div key={key(r)} className="observed-mixup">
            <span className="run-mode-tag mixup">→ {other?.label ?? "(gone)"}</span>
            <select
              aria-label={`${label}: its Mode taken for ${other?.label ?? "the other"}`}
              title="Which of its Modes was taken (optional)"
              value={r.expectedMode}
              disabled={disabled}
              onChange={(e) => patchReport(i, { expectedMode: e.target.value })}
            >
              <option value="">its Mode…</option>
              {ownModes.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <span className="hint-text">as</span>
            <select
              aria-label={`${label}: reported as which Mode of ${other?.label ?? "the other"}`}
              title={`Reported as which Mode of ${other?.label ?? "the other"} (optional)`}
              value={r.reportedMode}
              disabled={disabled}
              onChange={(e) => patchReport(i, { reportedMode: e.target.value })}
            >
              <option value="">their Mode…</option>
              {(other?.modes ?? []).map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <button
              type="button"
              className="link-button"
              aria-label={`Remove the mix-up with ${other?.label ?? "it"}`}
              disabled={disabled}
              onClick={() => onChange({ ...value, reports: value.reports.filter((_, j) => j !== i) })}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

// --- Showing a logged run -----------------------------------------------------

/** Detected / missed, with how soon and by which dwell. */
export function ObservedDetection({ o }: { o: ScenarioEmitter | null | undefined }) {
  if (!o || o.detected == null) return <span className="hint-text">—</span>;
  if (!o.detected) return <span className="detected-tag missed">Missed</span>;
  return (
    <span className="observed-detected">
      <span className="detected-tag">Detected</span>
      {o.time_to_detect_s != null && <span className="obs-num"> {o.time_to_detect_s} s</span>}
      {o.dwell_label && <span className="hint-text"> · {o.dwell_label}</span>}
    </span>
  );
}

/** What it was reported as: tags for itself, Default Unknown and each mix-up. */
export function ObservedReported({ o, showPlatform = false }: { o: ScenarioEmitter | null | undefined; showPlatform?: boolean }) {
  if (!o || !o.detected) return <span className="hint-text">—</span>;
  const nothing = !o.reported_self && !o.reported_unknown && o.reports.length === 0;
  return (
    <span className="run-mode-tags">
      {o.reported_self && <span className="run-mode-tag">Itself</span>}
      {o.reported_unknown && <span className="run-mode-tag unknown">Default Unknown</span>}
      {o.reports.map((r, i) => (
        <span key={i} className="run-mode-tag mixup" title={mixupText(o, r, true)}>
          → {r.reported_emitter_name}
          {showPlatform && r.reported_platform_name ? ` (${r.reported_platform_name})` : ""}
          {r.expected_mode || r.reported_mode ? ` · ${r.expected_mode ?? "?"} as ${r.reported_mode ?? "?"}` : ""}
        </span>
      ))}
      {nothing && <span className="hint-text">Nothing reported</span>}
    </span>
  );
}

function mixupText(o: ScenarioEmitter, r: ScenarioReport, withPlatforms: boolean): string {
  const where = (name: string, platform: string | null) => (withPlatforms && platform ? `${name} (${platform})` : name);
  const modes = r.expected_mode || r.reported_mode ? ` — its ${r.expected_mode ?? "Mode"} as ${r.reported_mode ?? "a Mode"}` : "";
  return `${where(o.emitter_name, o.platform_name)} reported as ${where(r.reported_emitter_name, r.reported_platform_name)}${modes}`;
}

/** Every mix-up in a run, one line each: "Bravo → reported as Charlie — its M1 as M1". */
export function MixupsList({ rows, withPlatforms = false }: { rows: ScenarioEmitter[]; withPlatforms?: boolean }) {
  const all = rows.flatMap((o) => o.reports.map((r) => ({ o, r })));
  if (!all.length) return <p className="hint-text">No Emitter was reported as another.</p>;
  return (
    <ul className="mixups-list">
      {all.map(({ o, r }, i) => (
        <li key={i}>
          <strong>{withPlatforms && o.platform_name ? `${o.emitter_name} (${o.platform_name})` : o.emitter_name}</strong>
          <span className="hint-text"> reported as </span>
          <span className="run-mode-tag mixup">
            {withPlatforms && r.reported_platform_name ? `${r.reported_emitter_name} (${r.reported_platform_name})` : r.reported_emitter_name}
          </span>
          {(r.expected_mode || r.reported_mode) && (
            <span className="hint-text">
              {" "}
              — its <span className="obs-num">{r.expected_mode ?? "?"}</span> as <span className="obs-num">{r.reported_mode ?? "?"}</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
