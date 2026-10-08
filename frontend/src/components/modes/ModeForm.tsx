import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useCreateMode, useEmitterModes } from "../../state/hooks/useModes";
import { ApiRequestError } from "../../api/client";
import type { EwGroup, FunctionGroup, Mode, Source } from "../../types/domain";
import type { ModeCreateInput } from "../../api/modes";
import type { ObservedValueOption } from "../testing/testFormat";
import { BLANK_LINE, lineValuesFrom, nameAfter, nextFreeName } from "./modeLine";
import { modeSourceIds } from "./modeFormat";
import { SourcesPicker } from "./SourcesPicker";
import { ModeLineFields, friendlyServerError, useModeLine } from "./ModeLineFields";
import {
  DEFAULT_CONFIRMATION_QUALITY,
  DEFAULT_CONFIRMATION_QUANTITY,
  ModeMoreOptions,
  confirmationProblem,
  type MoreOptionsValues,
} from "./ModeMoreOptions";

const DEFAULT_OPTIONS: MoreOptionsValues = {
  functionGroupId: "",
  quality: String(DEFAULT_CONFIRMATION_QUALITY),
  quantity: String(DEFAULT_CONFIRMATION_QUANTITY),
  notes: "",
  derivedFrom: new Set(),
};

/** Adding a Mode by hand: name, EW Group and Source, its line (RF, PRI, PW),
 * and the rarely-changed options folded away. Problems show by the field they
 * belong to; "Add & next" keeps the group, Source, PRI type and margins and
 * suggests the next name, for entering several in a row. */
export function ModeForm({
  emitterId,
  ewGroups,
  sources,
  functionGroups,
  defaultEwGroupId,
  defaultSourceId,
  fixedDerivedFromTestRecordId,
  fixedDerivedFromInterceptEntryId,
  onStage,
  observedValueOptions,
  prefillOnOpen = false,
  duplicateFrom,
  onClose,
}: {
  emitterId: string;
  ewGroups: EwGroup[];
  sources: Source[];
  functionGroups?: FunctionGroup[];
  defaultEwGroupId?: string;
  /** The Source to start on, when it's one of `sources` (else the first). */
  defaultSourceId?: string | null;
  /** When set, this Mode is always linked as derived from this one Test
   * Record — the usual "is this test-derived?" toggle/picker is hidden. */
  fixedDerivedFromTestRecordId?: string;
  /** When set, this Mode is always linked as derived from this one Intercept
   * Entry — same effect as fixedDerivedFromTestRecordId, for the "Create
   * Mode from this Entry" action on an Intercept's detail page. */
  fixedDerivedFromInterceptEntryId?: string;
  /** When set, submitting doesn't POST immediately — it hands the built
   * payload (plus the chosen EW Group, a call param separate from
   * ModeCreateInput) up to the caller to create later, e.g. once a Test
   * Record this Mode should be derived from actually exists in the DB.
   * Also hides the derived-from picker, same as fixedDerivedFromTestRecordId
   * — a staged Mode is inherently going to be test-derived once attached. */
  onStage?: (ewGroupId: string, input: ModeCreateInput) => void;
  /** Logged sets of intercepted parameters, one pickable option each, offered
   * as a one-click pre-fill. A mean fills both min and max; a set with a PRI
   * type also switches the form to it and fills its PRI values (PRI and
   * jitter for Fixed, sequence and frame time for Stagger). Deltas are never
   * pre-filled. */
  observedValueOptions?: ObservedValueOption[];
  /** Apply the first observed-values option as soon as the form opens —
   * for a form opened from one specific set (e.g. an Intercept entry). */
  prefillOnOpen?: boolean;
  /** Pre-fills every field from an existing Mode's line; the name is the next
   * free one after the original's. Submitting still creates a new Mode. */
  duplicateFrom?: Mode;
  onClose?: () => void;
}) {
  const [ewGroupId, setEwGroupId] = useState(defaultEwGroupId || ewGroups[0]?.id || "");
  const [sourceIds, setSourceIds] = useState<string[]>(() => {
    const first = defaultSourceId && sources.some((s) => s.id === defaultSourceId) ? defaultSourceId : sources[0]?.id;
    return first ? [first] : [];
  });
  const [name, setName] = useState("");
  // Until someone types a name, the form keeps suggesting one.
  const [nameTyped, setNameTyped] = useState(false);
  // The suggestion follows this name ("Search 3" → "Search 4"), else the EW Group's.
  const [suggestAfter, setSuggestAfter] = useState<string | null>(duplicateFrom?.name ?? null);
  // Added here already, though the Mode list may not have caught up yet.
  const [addedNames, setAddedNames] = useState<string[]>([]);
  const [options, setOptions] = useState<MoreOptionsValues>(DEFAULT_OPTIONS);
  const [startFrom, setStartFrom] = useState("");
  const [preFillFrom, setPreFillFrom] = useState(observedValueOptions?.[0]?.key ?? "");
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<{ name?: string; ewGroup?: string; source?: string }>({});
  const [optionsForced, setOptionsForced] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const line = useModeLine(BLANK_LINE);
  const { load: loadLine, setMany: setLine, loadFrameTime } = line;
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const createMode = useCreateMode(ewGroupId, emitterId);
  const { data: emitterModes } = useEmitterModes(emitterId);
  const groupNames = useMemo(
    () => [...(emitterModes ?? []).filter((m) => m.ew_group_id === ewGroupId).map((m) => m.name), ...addedNames],
    [emitterModes, ewGroupId, addedNames],
  );
  const groupName = ewGroups.find((g) => g.id === ewGroupId)?.name ?? "Mode";
  const clash = name.trim() !== "" && groupNames.includes(name.trim());
  const fixedOrigin = !!fixedDerivedFromTestRecordId || !!fixedDerivedFromInterceptEntryId;

  // Suggest a name until one is typed: the next free "<group> n", or the next
  // after the Mode this one follows on from.
  useEffect(() => {
    if (nameTyped) return;
    setName(suggestAfter ? nameAfter(suggestAfter, groupNames) : nextFreeName(groupName, groupNames));
  }, [nameTyped, suggestAfter, groupName, groupNames]);

  function copyFrom(mode: Mode) {
    setSuggestAfter(mode.name);
    setEwGroupId(mode.ew_group_id);
    setSourceIds(modeSourceIds(mode).filter((id) => sources.some((s) => s.id === id)));
    loadLine(lineValuesFrom(mode.pri_type, mode.line), mode.line?.explicit_frame_time_us);
    // Provenance isn't copied — a copy wasn't itself derived from that test.
    setOptions({
      functionGroupId: mode.function_group_id ?? "",
      quality: String(mode.confirmation_quality),
      quantity: String(mode.confirmation_quantity),
      notes: mode.notes ?? "",
      derivedFrom: new Set(),
    });
  }

  useEffect(() => {
    if (duplicateFrom) copyFrom(duplicateFrom);
    // Once per Mode being copied.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duplicateFrom]);

  useEffect(() => {
    if (!observedValueOptions?.length) return;
    if (!observedValueOptions.some((o) => o.key === preFillFrom)) setPreFillFrom(observedValueOptions[0].key);
  }, [observedValueOptions, preFillFrom]);

  function applyPreFill(key = preFillFrom) {
    const values = observedValueOptions?.find((o) => o.key === key)?.values;
    if (!values) return;
    // A logged mean fills both min and max; older sets carry min/max directly.
    const pair = (mean?: number, min?: number, max?: number) => {
      const lo = min ?? mean;
      const hi = max ?? mean;
      return lo == null ? {} : { min: String(lo), max: hi == null || hi === lo ? "" : String(hi) };
    };
    const rf = pair(values.rf_mean_mhz, values.rf_min_mhz, values.rf_max_mhz);
    const pw = pair(values.pw_mean_us, values.pw_min_us, values.pw_max_us);
    const next: Parameters<typeof setLine>[0] = {};
    if (rf.min != null) Object.assign(next, { rfMin: rf.min, rfMax: rf.max });
    if (pw.min != null) Object.assign(next, { pwMin: pw.min, pwMax: pw.max });
    // The chosen set's PRI type wins — its PRI values only make sense under it.
    if (values.pri_type) {
      next.priType = values.pri_type;
      if (values.pri_type === "fixed") {
        const pri = pair(values.pri_mean_us, values.pri_min_us, values.pri_max_us);
        const jit = pair(values.jitter_mean_us, values.jitter_min_us, values.jitter_max_us);
        if (pri.min != null) Object.assign(next, { priMin: pri.min, priMax: pri.max });
        if (jit.min != null) Object.assign(next, { jitterMin: jit.min, jitterMax: jit.max || jit.min });
      } else if (values.pri_type === "stagger" && values.pri_stagger_values_us?.length) {
        next.stagger = values.pri_stagger_values_us.join(", ");
        loadFrameTime(values.frame_time_us);
      }
    }
    setLine(next);
  }

  const prefilledOnOpen = useRef(false);
  useEffect(() => {
    if (!prefillOnOpen || prefilledOnOpen.current || !observedValueOptions?.length) return;
    prefilledOnOpen.current = true;
    applyPreFill(observedValueOptions[0].key);
    // Once, on open — later edits to the options shouldn't overwrite what's typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillOnOpen, observedValueOptions]);

  function focusFirstProblem() {
    // After the messages render.
    setTimeout(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0);
  }

  async function submit(next: boolean) {
    setError(null);
    setAdded(null);
    line.reveal();
    const found = {
      name: name.trim() ? undefined : "Give the Mode a name",
      ewGroup: ewGroupId ? undefined : "Pick an EW Group — add one under Groups & Sources first",
      source: sourceIds.length ? undefined : "Pick a Source — add one under Groups & Sources first",
    };
    setProblems(found);
    const optionsProblem = confirmationProblem(options.quality, options.quantity);
    setOptionsForced(!!optionsProblem);
    if (found.name || found.ewGroup || found.source || !line.valid || optionsProblem) {
      focusFirstProblem();
      return;
    }

    const payload: ModeCreateInput = {
      source_ids: sourceIds,
      name: name.trim(),
      pri_type: line.values.priType,
      notes: options.notes.trim() || undefined,
      confirmation_quality: Number(options.quality),
      confirmation_quantity: Number(options.quantity),
      line: line.payload(),
      function_group_id: options.functionGroupId || null,
    };
    if (onStage) {
      onStage(ewGroupId, payload);
      return;
    }
    try {
      await createMode.mutateAsync({
        ...payload,
        derived_from_test_record_ids: fixedDerivedFromTestRecordId
          ? [fixedDerivedFromTestRecordId]
          : [...options.derivedFrom],
        derived_from_intercept_entry_ids: fixedDerivedFromInterceptEntryId ? [fixedDerivedFromInterceptEntryId] : [],
      });
    } catch (err) {
      setError(err instanceof ApiRequestError ? friendlyServerError(err.message) : "Couldn't add the Mode");
      return;
    }
    if (!next) {
      onClose?.();
      return;
    }
    // Ready for the next one: same group, Source, PRI type, margins and range
    // flags; values cleared; the next name suggested.
    const v = line.values;
    loadLine({
      ...BLANK_LINE,
      priType: v.priType,
      rfDelta: v.rfDelta,
      priDelta: v.priDelta,
      pwDelta: v.pwDelta,
      frameTimeDelta: v.frameTimeDelta,
      jitterMin: v.jitterMin,
      jitterMax: v.jitterMax,
      rfRange: v.rfRange,
      priRange: v.priRange,
      pwRange: v.pwRange,
    });
    setAdded(name.trim());
    setAddedNames((n) => [...n, name.trim()]);
    setSuggestAfter(name.trim());
    setNameTyped(false);
    setOptions((o) => ({ ...o, notes: "", derivedFrom: new Set() }));
    setTimeout(() => nameRef.current?.select(), 0);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void submit(false);
  }

  const startFromOptions = (emitterModes ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const groupLabel = (id: string) => ewGroups.find((g) => g.id === id)?.name ?? "";

  return (
    <form className="card mode-form" onSubmit={handleSubmit} noValidate ref={formRef}>
      <div className="mode-form-head">
        <h4>{duplicateFrom ? `Copy of ${duplicateFrom.name}` : onStage ? "Stage a new Mode" : "New Mode"}</h4>
        {!duplicateFrom && startFromOptions.length > 0 && (
          <label className="inline-label" title="Fill everything in from an existing Mode, then change what differs">
            Start from
            <select
              value={startFrom}
              onChange={(e) => {
                setStartFrom(e.target.value);
                const mode = startFromOptions.find((m) => m.id === e.target.value);
                if (mode) copyFrom(mode);
                else setSuggestAfter(null);
              }}
            >
              <option value="">A blank Mode</option>
              {startFromOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({groupLabel(m.ew_group_id)})
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="mode-form-grid">
        <label className="mode-form-name">
          Name
          <input
            ref={nameRef}
            value={name}
            aria-invalid={!!problems.name || undefined}
            onChange={(e) => {
              setName(e.target.value);
              setNameTyped(true);
              setProblems((p) => ({ ...p, name: undefined }));
            }}
            onFocus={(e) => !nameTyped && e.target.select()}
          />
          {problems.name ? (
            <span className="line-row-problem">{problems.name}</span>
          ) : clash ? (
            <span className="mode-form-warning">Another Mode in {groupName} already has this name.</span>
          ) : (
            !nameTyped && <span className="hint-text">Suggested — type to change</span>
          )}
        </label>
        <label>
          EW Group
          <select value={ewGroupId} aria-invalid={!!problems.ewGroup || undefined} onChange={(e) => setEwGroupId(e.target.value)}>
            <option value="" disabled>
              Pick one…
            </option>
            {ewGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          {problems.ewGroup && <span className="line-row-problem">{problems.ewGroup}</span>}
        </label>
        <div className="mode-form-sources">
          <span className="mode-form-label">Sources</span>
          <SourcesPicker sources={sources} value={sourceIds} onChange={setSourceIds} invalid={!!problems.source} />
          {problems.source && <span className="line-row-problem">{problems.source}</span>}
        </div>
      </div>

      {observedValueOptions && observedValueOptions.length > 0 && (
        <div className="mode-form-prefill">
          <label className="inline-label">
            Pre-fill from observed values
            <select value={preFillFrom} onChange={(e) => setPreFillFrom(e.target.value)}>
              {observedValueOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="button secondary small" onClick={() => applyPreFill()}>
            Pre-fill
          </button>
        </div>
      )}

      <ModeLineFields line={line} />

      <ModeMoreOptions
        values={options}
        onChange={(part) => setOptions((o) => ({ ...o, ...part }))}
        functionGroups={functionGroups}
        emitterId={emitterId}
        showDerived={!fixedOrigin && !onStage}
        forceOpen={optionsForced}
      />

      {added && <p className="mode-form-added">✓ Added &ldquo;{added}&rdquo; — the next one goes in below.</p>}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="mode-form-actions">
        <button type="submit" disabled={!onStage && createMode.isPending}>
          {onStage ? "Stage this Mode" : createMode.isPending ? "Adding…" : "Add Mode"}
        </button>
        {!onStage && !fixedOrigin && (
          <button
            type="button"
            className="button secondary"
            disabled={createMode.isPending}
            onClick={() => void submit(true)}
            title="Add this one and start the next: same EW Group, Source, PRI type and margins"
          >
            Add &amp; next
          </button>
        )}
        {onClose && (
          <button type="button" className="button secondary" onClick={() => onClose()}>
            {added ? "Done" : "Cancel"}
          </button>
        )}
      </div>
    </form>
  );
}
