import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEmitter } from "../state/hooks/useEmitters";
import { useEmitterModes } from "../state/hooks/useModes";
import { useIntercept, useInterceptEntries } from "../state/hooks/useIntercepts";
import { useHasRole } from "../auth/RequireAuth";
import { ApiRequestError } from "../api/client";
import { interceptsApi, MAX_IMPORT_ENTRIES, type AllReports, type RegroupGroup } from "../api/intercepts";
import { LoadingState } from "../components/common/LoadingState";
import { useConfirmDialog } from "../components/common/ConfirmDialog";
import { ImportGroupsPanel } from "../components/intercepts/ImportGroupsPanel";
import type { CsvReport, ReportPriType } from "../components/intercepts/interceptCsv";
import { summarize, toEntryInput, toMissionTime, type ReportGroup } from "../components/intercepts/interceptGroups";
import {
  clearRegroupDraft,
  loadRegroupDraft,
  saveRegroupDraft,
  type RegroupDraft,
} from "../components/intercepts/importDraft";

/** The stored reports as the grouping tools take them — numbered 1..n on
 * this page (an Intercept can hold several files), each keeping its own
 * file and line — with their report ids, and the grouping as it is now. */
function fromStored(all: AllReports) {
  const at = (name: string) => all.fields.indexOf(name) + 2;
  const f = {
    file: at("source_file"),
    line: at("file_line"),
    time: at("mission_time"),
    track: at("track"),
    modeTrack: at("mode_track"),
    power: at("power"),
    designation: at("designation"),
    modeName: at("mode_name"),
    ambiguity: at("ambiguity_count"),
    type: at("pri_type"),
    rf: at("rf_mhz"),
    pri: at("pri_us"),
    pw: at("pw_us"),
    jitter: at("jitter_us"),
    stagger: at("stagger_us"),
  };
  const ids: string[] = [];
  const reports: CsvReport[] = all.reports.map((row, i) => {
    ids.push(row[0] as string);
    return {
      line: i + 1,
      fileLine: row[f.line] as number,
      sourceFile: (row[f.file] as string | null) ?? null,
      missionTime: toMissionTime(row[f.time] as string | null),
      track: row[f.track] as string | null,
      modeTrack: row[f.modeTrack] as string | null,
      power: row[f.power] as number | null,
      designation: row[f.designation] as string | null,
      modeName: row[f.modeName] as string | null,
      ambiguityCount: row[f.ambiguity] as number | null,
      priType: row[f.type] as ReportPriType,
      rfMhz: row[f.rf] as number,
      priUs: row[f.pri] as number | null,
      pwUs: row[f.pw] as number | null,
      jitterUs: row[f.jitter] as number | null,
      staggerUs: row[f.stagger] as number[] | null,
    };
  });
  const byEntry = new Map<number, number[]>();
  const loose: number[] = [];
  all.reports.forEach((row, i) => {
    const entry = row[1] as number | null;
    if (entry == null) loose.push(i + 1);
    else byEntry.set(entry, [...(byEntry.get(entry) ?? []), i + 1]);
  });
  const groups: ReportGroup[] = [
    ...[...byEntry.values()].map((lines) => ({ id: lines[0], lines, excluded: false })),
    // Reports in no entry start out excluded, one row each — as they were left.
    ...loose.map((l) => ({ id: l, lines: [l], excluded: true })),
  ];
  return { reports, ids, groups };
}

/** Regroup a saved Intercept's reports with the same tools as the import.
 * Saving replaces the entries built from reports; entries keep their ids
 * (and Mode links) where a new group is mostly the same reports. */
export function InterceptRegroupPage() {
  const { interceptId = "" } = useParams<{ interceptId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canWrite = useHasRole("editor");
  const { data: intercept } = useIntercept(interceptId);
  const { data: emitter } = useEmitter(intercept?.emitter_id);
  const { data: modes } = useEmitterModes(intercept?.emitter_id ?? "");
  const { data: entries } = useInterceptEntries(interceptId);
  const { confirmDelete: confirm, dialog } = useConfirmDialog();
  const all = useQuery({
    queryKey: ["intercept-entries", "all-reports", interceptId],
    queryFn: () => interceptsApi.allReports(interceptId),
    enabled: !!interceptId,
    // Refetching under someone's feet would reset their work.
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  const stored = useMemo(() => (all.data ? fromStored(all.data) : null), [all.data]);
  const [groups, setGroups] = useState<ReportGroup[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [draftOffer, setDraftOffer] = useState<RegroupDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);

  // Start from the grouping as it is — once, when the reports arrive.
  useEffect(() => {
    if (!stored || !all.data) return;
    setGroups(stored.groups);
    setDirty(false);
    const version = all.data.grouping_version;
    void loadRegroupDraft(interceptId).then((draft) => {
      if (draft && draft.groupingVersion === version) setDraftOffer(draft);
    });
  }, [stored, all.data, interceptId]);

  const lineOfId = useMemo(() => new Map((stored?.ids ?? []).map((id, i) => [id, i + 1])), [stored]);

  // Keep the work as a draft, and ask before the tab closes on it.
  useEffect(() => {
    if (!dirty || !groups || !stored || !all.data) return;
    const version = all.data.grouping_version;
    const handle = window.setTimeout(() => {
      void saveRegroupDraft(interceptId, {
        groupingVersion: version,
        groups: groups.map((g) => ({ reportIds: g.lines.map((l) => stored.ids[l - 1]), excluded: g.excluded })),
        savedAt: Date.now(),
      });
    }, 800);
    return () => window.clearTimeout(handle);
  }, [dirty, groups, stored, all.data, interceptId]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (!canWrite) {
    return (
      <div className="page">
        <h1>Regroup reports</h1>
        <p className="hint-text">Regrouping needs editor access.</p>
      </div>
    );
  }
  if (!intercept || all.isLoading || !groups || !stored || !all.data) {
    return <LoadingState label="Loading the reports…" />;
  }
  if (all.data.reports.length === 0) {
    return (
      <div className="page">
        <Link to={`/intercepts/${interceptId}`}>← {intercept.name}</Link>
        <h1>Regroup reports</h1>
        <p className="hint-text">
          This Intercept has no reports kept — it was typed in by hand, or imported before reports were kept.
          Importing the file again (into a new Intercept) keeps them.
        </p>
      </div>
    );
  }

  const byLine = new Map(stored.reports.map((r) => [r.line, r]));
  const included = groups.filter((g) => !g.excluded);
  const leftOut = groups.filter((g) => g.excluded).reduce((n, g) => n + g.lines.length, 0);
  const withReports = new Set(all.data.entries);
  const handTyped = (entries ?? []).filter((e) => !withReports.has(e.id)).length;
  const tooMany = included.length > MAX_IMPORT_ENTRIES;
  const version = all.data.grouping_version;

  function change(next: ReportGroup[]) {
    setGroups(next);
    setDirty(true);
  }

  function resume(draft: RegroupDraft) {
    const next: ReportGroup[] = [];
    for (const g of draft.groups) {
      const lines = g.reportIds.map((id) => lineOfId.get(id)).filter((l): l is number => l != null).sort((a, b) => a - b);
      if (lines.length) next.push({ id: lines[0], lines, excluded: g.excluded });
    }
    setDraftOffer(null);
    change(next);
  }

  async function save() {
    if (!groups || !stored) return;
    setError(null);
    setConflict(false);
    const payload: RegroupGroup[] = included.map((g) => {
      const groupReports = g.lines.map((l) => byLine.get(l)!);
      return {
        entry: toEntryInput(summarize(groupReports), groupReports, ""),
        report_ids: g.lines.map((l) => stored.ids[l - 1]),
      };
    });
    setSaving(true);
    try {
      const preview = await interceptsApi.regroup(interceptId, version, payload, true);
      const n = (v: number) => v.toLocaleString();
      const lines = [
        `${n(preview.unchanged)} entr${preview.unchanged === 1 ? "y stays" : "ies stay"} as ${preview.unchanged === 1 ? "it is" : "they are"}, ${n(preview.changed)} change${preview.changed === 1 ? "s" : ""}, ${n(preview.created)} ${preview.created === 1 ? "is" : "are"} new and ${n(preview.removed)} ${preview.removed === 1 ? "is" : "are"} removed.`,
        preview.mode_links_moved > 0 &&
          `${preview.mode_links_moved} link${preview.mode_links_moved === 1 ? "" : "s"} to Modes created from removed entries move${preview.mode_links_moved === 1 ? "s" : ""} to the entry that took most of their reports.`,
        preview.mode_links_dropped > 0 &&
          `${preview.mode_links_dropped} Mode link${preview.mode_links_dropped === 1 ? " is" : "s are"} dropped — those entries' reports are all left out (the Modes keep their values).`,
        preview.reports_left_out > 0 &&
          `${preview.reports_left_out.toLocaleString()} report${preview.reports_left_out === 1 ? "" : "s"} will be in no entry.`,
        handTyped > 0 && `${handTyped} entr${handTyped === 1 ? "y" : "ies"} typed in by hand ${handTyped === 1 ? "isn't" : "aren't"} affected.`,
      ]
        .filter(Boolean)
        .join(" ");
      setSaving(false);
      if (!(await confirm(`Save the new grouping? ${lines}`, { confirmLabel: "Save grouping" }))) return;
      setSaving(true);
      await interceptsApi.regroup(interceptId, version, payload);
      await clearRegroupDraft(interceptId);
      setDirty(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["intercept-entries"] }),
        qc.invalidateQueries({ queryKey: ["intercept"] }),
        qc.invalidateQueries({ queryKey: ["intercepts"] }),
        qc.invalidateQueries({ queryKey: ["modes"] }),
      ]);
      navigate(`/intercepts/${interceptId}`);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 409) {
        setConflict(true);
        setError(err.message);
      } else setError(err instanceof ApiRequestError ? err.message : "Couldn't save the grouping — nothing was changed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <Link to={`/intercepts/${interceptId}`}>← {intercept.name}</Link>
      <h1>Regroup reports</h1>
      <p className="hint-text">
        The {stored.reports.length.toLocaleString()} reports kept with {intercept.name}
        {emitter ? ` (${emitter.name})` : ""}, grouped as the entries are now — reports in no entry start out
        excluded. Regroup them with the same tools as the import; nothing changes until you save. Saving replaces the
        entries built from these reports: each new group keeps the id, and so the Mode links, of the entry it shares
        the most reports with, and a removed entry&apos;s Mode links move to the group that took most of its reports.
        {handTyped > 0 && ` The ${handTyped} entr${handTyped === 1 ? "y" : "ies"} typed in by hand ${handTyped === 1 ? "isn't" : "aren't"} touched.`}
      </p>
      {draftOffer && (
        <div className="import-draft">
          <span>
            <strong>Unfinished regrouping</strong> from {new Date(draftOffer.savedAt).toLocaleString()} —{" "}
            {draftOffer.groups.filter((g) => !g.excluded).length.toLocaleString()} rows.
          </span>
          <span className="import-selection-actions">
            <button type="button" className="button primary small" onClick={() => resume(draftOffer)}>
              Resume it
            </button>
            <button
              type="button"
              className="button secondary small"
              onClick={() => {
                setDraftOffer(null);
                void clearRegroupDraft(interceptId);
              }}
            >
              Discard it
            </button>
          </span>
        </div>
      )}

      <ImportGroupsPanel
        reports={stored.reports}
        groups={groups}
        onChange={change}
        modes={modes}
        emitterId={intercept.emitter_id}
        defaultShow={leftOut > 0 ? "included" : "all"}
        heading="Group the reports into entries"
        startsFrom="The rows start as the entries are now; reports in no entry are listed as excluded (Show → Excluded)."
      />

      <section className="card import-footer">
        <p>
          <strong>{included.length.toLocaleString()}</strong> entr{included.length === 1 ? "y" : "ies"} from{" "}
          {(stored.reports.length - leftOut).toLocaleString()} reports
          {leftOut > 0 && <span className="hint-text"> · {leftOut.toLocaleString()} left out</span>}
          {!dirty && <span className="hint-text"> · no changes yet</span>}
        </p>
        {tooMany && (
          <p className="error-text">
            An Intercept takes at most {MAX_IMPORT_ENTRIES.toLocaleString()} entries from one regroup — group or exclude
            reports first.
          </p>
        )}
        {error && (
          <div className="error-text">
            {error}{" "}
            {conflict && (
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setError(null);
                  setConflict(false);
                  void clearRegroupDraft(interceptId);
                  void all.refetch();
                }}
              >
                Reload the current grouping
              </button>
            )}
          </div>
        )}
        <span className="import-selection-actions">
          {dirty && (
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setGroups(stored.groups);
                setDirty(false);
                void clearRegroupDraft(interceptId);
              }}
            >
              Undo my changes
            </button>
          )}
          <Link className="button secondary" to={`/intercepts/${interceptId}`}>
            Cancel
          </Link>
          <button type="button" className="button primary" disabled={!dirty || tooMany || saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save grouping"}
          </button>
        </span>
      </section>
      {dialog}
    </div>
  );
}
