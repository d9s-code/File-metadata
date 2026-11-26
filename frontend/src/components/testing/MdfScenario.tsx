import { useQuery } from "@tanstack/react-query";
import { pclRulesApi } from "../../api/pcl";
import { testRecordsApi, type MdfScenarioInput, type MdfScenarioOptions, type TestRecord } from "../../api/testRecords";
import type { TestResult } from "../../types/domain";
import { MenuButton } from "../common/MenuButton";
import { computeOverallResult } from "./modeResultAggregate";
import {
  blankObserved,
  DetectionCell,
  MixupsList,
  ObservedDetection,
  ObservedReported,
  observedInput,
  previewVerdicts,
  ReportedAsCell,
  timeError,
  VerdictsLine,
  workedOut,
  type ObservedRun,
  type ReportOption,
} from "./ObservedEmitter";
import { testResultLabel } from "./testFormat";

/** One Platform presented in an MDF test being filled in. */
export interface PresentedDraft {
  platformId: string;
  /** "" — not recorded; "unknown" — not as any Platform; else a Platform's id. */
  interceptedAs: string;
  /** The Platform's Emitters on the air, by id, with what was observed of each. */
  emitters: Record<string, ObservedRun & { on: boolean }>;
}

export function useMdfScenarioOptions(mdfId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["mdfScenarioOptions", mdfId],
    queryFn: () => testRecordsApi.mdfScenarioOptions(mdfId),
    enabled,
    retry: false,
  });
}

/** A new Platform presented: every one of its Emitters on the air, nothing recorded yet. */
export function presentPlatform(options: MdfScenarioOptions, platformId: string): PresentedDraft {
  const p = options.platforms.find((x) => x.platform_id === platformId);
  return {
    platformId,
    interceptedAs: "",
    emitters: Object.fromEntries((p?.emitters ?? []).map((e) => [e.emitter_id, { ...blankObserved(), on: true }])),
  };
}

const onAir = (d: PresentedDraft) => Object.entries(d.emitters).filter(([, o]) => o.on);

/** What's wrong with the scenario as typed in, or null. */
export function scenarioError(drafts: PresentedDraft[]): string | null {
  for (const d of drafts) for (const [, o] of onAir(d)) if (timeError(o)) return timeError(o);
  return null;
}

/** The API's scenario; undefined when no Platform is presented. */
export function scenarioInput(drafts: PresentedDraft[]): MdfScenarioInput | undefined {
  if (!drafts.length) return undefined;
  return {
    platforms: drafts.map((d) => ({
      platform_id: d.platformId,
      intercepted_as_platform_id: d.interceptedAs && d.interceptedAs !== "unknown" ? d.interceptedAs : undefined,
      intercepted_unknown: d.interceptedAs === "unknown" || undefined,
      emitters: onAir(d).map(([id, o]) => ({ emitter_id: id, ...observedInput(o) })),
    })),
  };
}

/** The test's result as the server will work it out; null when nothing was recorded. */
export function scenarioResult(drafts: PresentedDraft[]): TestResult | null {
  const rows = drafts.flatMap((d) => onAir(d).map(([, o]) => o));
  const results = rows.map(workedOut).filter((r): r is TestResult => !!r);
  const v = previewVerdicts(rows);
  if (!results.length && !v) return drafts.length ? "inconclusive" : null;
  return computeOverallResult([
    ...(results.length ? results : ["inconclusive" as TestResult]),
    ...(v ? [v.detection, v.identification, v.mixups].filter((x): x is TestResult => !!x) : []),
  ]);
}

/** What the system reported for one presented Platform, as the PCL what-if reads it. */
function heardOf(d: PresentedDraft) {
  const emitterIds = new Set<string>();
  const modes: { emitter_id: string; mode: string }[] = [];
  for (const [id, o] of onAir(d)) {
    if (o.detected !== "yes") continue;
    if (o.reportedSelf) emitterIds.add(id);
    for (const r of o.reports) {
      emitterIds.add(r.emitterId);
      if (r.reportedMode) modes.push({ emitter_id: r.emitterId, mode: r.reportedMode });
    }
  }
  return { emitter_ids: [...emitterIds].sort(), modes };
}

/** "Today's rules: Frigate 3 · Corvette 1" for what's been reported so far. */
function LivePcl({ mdfId, draft, platformName }: { mdfId: string; draft: PresentedDraft; platformName: string }) {
  const heard = heardOf(draft);
  const { data } = useQuery({
    queryKey: ["pclWhatIf", mdfId, heard],
    queryFn: () => pclRulesApi.whatIf(mdfId, heard),
    enabled: heard.emitter_ids.length > 0,
    retry: false,
  });
  if (!heard.emitter_ids.length) return null;
  return <PclLevels levels={(data?.platforms ?? []).filter((p) => p.level > 0)} presented={platformName} loading={!data} />;
}

function PclLevels({
  levels,
  presented,
  loading = false,
}: {
  levels: { platform_id: string; platform_name: string; level: number; met: { text: string }[] }[];
  presented: string;
  loading?: boolean;
}) {
  return (
    <div className="mdf-scenario-pcl">
      <span className="verdict-label" title="The confidence level each Platform's rules give what was reported">
        Confidence today
      </span>
      {loading ? (
        <span className="hint-text">…</span>
      ) : levels.length === 0 ? (
        <span className="hint-text">No Platform's rules are met by what was reported</span>
      ) : (
        levels.map((lv) => (
          <span
            key={lv.platform_id}
            className={`pcl-level pcl-level-${lv.level} mdf-scenario-level${lv.platform_name === presented ? " own" : ""}`}
            title={`Level ${lv.level}${lv.platform_name === presented ? " — the Platform presented" : ""}\n${lv.met.map((m) => m.text).join("\n")}`}
          >
            {lv.platform_name} · {lv.level}
          </span>
        ))
      )}
    </div>
  );
}

/** The form's "What was observed" section: the Platforms presented, their
 * Emitters on the air, what each was reported as, which Platform each was
 * intercepted as — and the level today's rules give for it. */
export function MdfScenarioSection({
  mdfId,
  options,
  value,
  onChange,
  dwells = [],
}: {
  mdfId: string;
  options: MdfScenarioOptions;
  value: PresentedDraft[];
  onChange: (v: PresentedDraft[]) => void;
  /** The dwells of the Strategy version it ran with, for "caught by dwell". */
  dwells?: { freq_mhz?: number }[];
}) {
  const nameOf = (platformId: string) => options.platforms.find((p) => p.platform_id === platformId)?.platform_name ?? "(gone)";
  const addable = options.platforms.filter((p) => !value.some((d) => d.platformId === p.platform_id));
  const allReportable: ReportOption[] = options.platforms.flatMap((p) =>
    p.emitters.map((e) => ({ emitterId: e.emitter_id, platformId: p.platform_id, label: `${e.emitter_name} (${p.platform_name})`, modes: e.modes })),
  );
  const patch = (i: number, d: PresentedDraft) => onChange(value.map((x, j) => (j === i ? d : x)));
  const verdicts = previewVerdicts(value.flatMap((d) => onAir(d).map(([, o]) => o)));

  return (
    <fieldset className="mdf-scenario">
      <legend>What was observed (optional)</legend>
      <p className="hint-text">
        Present the Platforms of v{options.version_number} that were in the scenario, tick the Emitters that were transmitting, and say what each
        was reported as. The result is worked out from it unless you pick one.
      </p>
      {value.map((d, i) => {
        const platform = options.platforms.find((p) => p.platform_id === d.platformId);
        return (
          <div key={d.platformId} className="mdf-scenario-platform card">
            <div className="mdf-scenario-platform-head">
              <strong>{nameOf(d.platformId)}</strong>
              <label className="inline-date-label">
                Intercepted as
                <select value={d.interceptedAs} onChange={(e) => patch(i, { ...d, interceptedAs: e.target.value })}>
                  <option value="">Not recorded</option>
                  {options.platforms.map((p) => (
                    <option key={p.platform_id} value={p.platform_id}>
                      {p.platform_name}
                      {p.platform_id === d.platformId ? " (itself)" : ""}
                    </option>
                  ))}
                  <option value="unknown">Not as any Platform</option>
                </select>
              </label>
              {d.interceptedAs && d.interceptedAs !== "unknown" && (
                <span className={`detected-tag${d.interceptedAs === d.platformId ? "" : " missed"}`}>
                  {d.interceptedAs === d.platformId ? "Right Platform" : "Wrong Platform"}
                </span>
              )}
              <button
                type="button"
                className="link-button"
                aria-label={`Remove ${nameOf(d.platformId)} from the scenario`}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </div>
            {!platform?.emitters.length ? (
              <p className="hint-text">No Emitters pinned on this Platform in that version.</p>
            ) : (
              <table className="data-table mdf-scenario-table">
                <thead>
                  <tr>
                    <th title="On the air in this test">Transmitting</th>
                    <th>Emitter</th>
                    <th>Detected</th>
                    <th>Reported as</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {platform.emitters.map((e) => {
                    const o = d.emitters[e.emitter_id] ?? { ...blankObserved(), on: false };
                    const set = (next: ObservedRun & { on: boolean }) => patch(i, { ...d, emitters: { ...d.emitters, [e.emitter_id]: next } });
                    const result = o.on ? workedOut(o) : null;
                    return (
                      <tr key={e.emitter_id} className={o.on ? undefined : "row-muted"}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`${e.emitter_name} transmitting`}
                            checked={o.on}
                            onChange={(ev) => set({ ...o, on: ev.target.checked })}
                          />
                        </td>
                        <td>
                          {e.emitter_name}
                          <span className="jitter-subline">
                            {e.modes.length} Mode{e.modes.length === 1 ? "" : "s"}
                          </span>
                        </td>
                        <td>
                          {o.on ? (
                            <DetectionCell value={o} onChange={(n) => set({ ...n, on: true })} dwells={dwells} label={e.emitter_name} />
                          ) : (
                            <span className="hint-text">Not on the air</span>
                          )}
                        </td>
                        <td>
                          {o.on && (
                            <ReportedAsCell
                              value={o}
                              onChange={(n) => set({ ...n, on: true })}
                              ownModes={e.modes}
                              options={allReportable.filter((r) => !(r.emitterId === e.emitter_id && r.platformId === d.platformId))}
                              label={e.emitter_name}
                            />
                          )}
                        </td>
                        <td>
                          {result ? (
                            <span className={`test-result-badge test-result-${result}`}>{testResultLabel(result)}</span>
                          ) : (
                            <span className="hint-text">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <LivePcl mdfId={mdfId} draft={d} platformName={nameOf(d.platformId)} />
          </div>
        );
      })}
      <div className="form-row">
        {addable.length > 0 && (
          <MenuButton
            label="+ Present a Platform ▾"
            className="button secondary small"
            align="start"
            items={addable.map((p) => ({ label: p.platform_name, onSelect: () => onChange([...value, presentPlatform(options, p.platform_id)]) }))}
          />
        )}
        {verdicts && <VerdictsLine v={verdicts} />}
      </div>
    </fieldset>
  );
}

/** A logged MDF test's scenario: per Platform presented, which Platform it
 * was intercepted as, its Emitters on the air, and the level today's rules
 * give for what was reported; then every mix-up across the test. */
export function MdfScenarioView({ record }: { record: TestRecord }) {
  const presented = record.mdf_test_platforms ?? [];
  const rows = record.scenario_emitters ?? [];
  const { data: pcl } = useQuery({
    queryKey: ["mdfTestConfidence", record.id],
    queryFn: () => testRecordsApi.mdfTestConfidence(record.id),
    enabled: presented.length > 0,
    retry: false,
  });
  if (!presented.length) return null;
  return (
    <div className="mdf-scenario-view">
      {record.scenario_verdicts && (
        <div className="mdf-scenario-verdicts">
          <VerdictsLine v={record.scenario_verdicts} />
        </div>
      )}
      {presented.map((p) => {
        const mine = rows.filter((r) => r.platform_id === p.platform_id);
        const levels = pcl?.platforms.find((x) => x.platform_id === p.platform_id);
        const right = p.intercepted_as_platform_id === p.platform_id;
        return (
          <div key={p.platform_id} className="mdf-scenario-platform card">
            <div className="mdf-scenario-platform-head">
              <strong>{p.platform_name}</strong>
              <span className="hint-text">intercepted as</span>
              {p.intercepted_unknown ? (
                <span className="detected-tag missed">Not as any Platform</span>
              ) : p.intercepted_as_name ? (
                <span className={`detected-tag${right ? "" : " missed"}`} title={right ? "The right Platform" : "The wrong Platform"}>
                  {p.intercepted_as_name}
                </span>
              ) : (
                <span className="hint-text">— not recorded</span>
              )}
            </div>
            {mine.length === 0 ? (
              <p className="hint-text">No Emitter was recorded as on the air.</p>
            ) : (
              <table className="data-table mdf-scenario-table">
                <thead>
                  <tr>
                    <th>Emitter</th>
                    <th>Detected</th>
                    <th>Reported as</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {mine.map((r) => (
                    <tr key={r.emitter_id}>
                      <td>{r.emitter_name}</td>
                      <td>
                        <ObservedDetection o={r} />
                      </td>
                      <td>
                        <ObservedReported o={r} showPlatform />
                      </td>
                      <td>
                        {r.result ? (
                          <span className={`test-result-badge test-result-${r.result}`}>{testResultLabel(r.result)}</span>
                        ) : (
                          <span className="hint-text">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {levels && levels.heard.length > 0 && <PclLevels levels={levels.levels} presented={p.platform_name} />}
          </div>
        );
      })}
      <h4 className="mdf-scenario-subhead">Mix-ups</h4>
      <MixupsList rows={rows} withPlatforms />
    </div>
  );
}
