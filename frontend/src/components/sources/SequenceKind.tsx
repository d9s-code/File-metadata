import { SEQUENCE_KIND_LABEL, type SequenceKind } from "../../types/domain";

const GUESSED_TITLE =
  "Guessed from the steps (only PRI: a stagger; RF changing between steps or a dwell time: a dwell & switch) — pick one to set it";

/** A sequence's kind as a small tag; a guessed one is dashed and says so. */
export function SequenceKindTag({ kind, guessed }: { kind: SequenceKind; guessed: boolean }) {
  return (
    <span
      className={guessed ? "seq-kind-tag guessed" : "seq-kind-tag"}
      title={guessed ? GUESSED_TITLE : `Set as a ${SEQUENCE_KIND_LABEL[kind].toLowerCase()}`}
    >
      {SEQUENCE_KIND_LABEL[kind]}
      {guessed && <span className="seq-kind-guessed"> · guessed</span>}
    </span>
  );
}

/** Stagger | Dwell & switch, for one sequence. While nobody has set it the
 * guess is outlined and marked "guessed"; picking either (the guess too) sets
 * it. A sequence without PRI can't be a stagger. */
export function SequenceKindControl({
  kind,
  guessedKind,
  hasPri,
  disabled,
  onChange,
}: {
  kind: SequenceKind | null;
  guessedKind: SequenceKind;
  hasPri: boolean;
  disabled?: boolean;
  onChange: (kind: SequenceKind) => void;
}) {
  const current = kind ?? guessedKind;
  const guessed = kind == null;
  return (
    <span className="seq-kind">
      <span className="seg-toggle seq-kind-toggle" role="radiogroup" aria-label="Kind of sequence">
        {(["stagger", "dwell_switch"] as const).map((k) => {
          const noPri = k === "stagger" && !hasPri;
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={current === k}
              className={current === k ? (guessed ? "guessed" : "on") : undefined}
              disabled={disabled || noPri}
              title={
                noPri
                  ? "No PRI steps, so it can't be a stagger"
                  : k === "stagger"
                    ? "Its PRI steps, in order, are one stagger train — one Stagger Mode"
                    : "Each step is a Fixed Mode of its own"
              }
              onClick={() => onChange(k)}
            >
              {SEQUENCE_KIND_LABEL[k]}
            </button>
          );
        })}
      </span>
      {guessed && (
        <span className="seq-kind-guessed" title={GUESSED_TITLE}>
          guessed
        </span>
      )}
    </span>
  );
}
