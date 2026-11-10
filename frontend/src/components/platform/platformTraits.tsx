import type { Base, Hostility, Platform, SpeedUnit } from "../../api/platforms";
import { MenuButton } from "../common/MenuButton";

/** As the PRS XML writes them, in this order. */
export const HOSTILITIES: Hostility[] = ["UNKNOWN", "FRIEND", "HOSTILE", "NEUTRAL"];
export const BASES: Base[] = ["SEA", "GROUND", "SUBSURFACE", "UNKNOWN", "AIR"];

export const SPEED_UNITS: { key: SpeedUnit; label: string }[] = [
  { key: "kmh", label: "km/h" },
  { key: "knots", label: "knots" },
];

/** 1 knot = 1.852 km/h. */
export const KMH_PER_KNOT = 1.852;

export function unitLabel(u: SpeedUnit | null | undefined): string {
  return u === "knots" ? "kn" : "km/h";
}

const fmt = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 });

/** "0–30 kn", "up to 55 km/h", "from 10 kn" — or null when no speed is set. */
export function speedText(p: Pick<Platform, "speed_min" | "speed_max" | "speed_unit">): string | null {
  const { speed_min: lo, speed_max: hi } = p;
  const u = unitLabel(p.speed_unit);
  if (lo == null && hi == null) return null;
  if (lo != null && hi != null) return lo === hi ? `${fmt(lo)} ${u}` : `${fmt(lo)}–${fmt(hi)} ${u}`;
  return hi != null ? `up to ${fmt(hi)} ${u}` : `from ${fmt(lo as number)} ${u}`;
}

/** A speed in one unit, in the other: km/h ⇄ knots, to 2 decimals. */
export function convertSpeed(v: number, from: SpeedUnit, to: SpeedUnit): number {
  if (from === to) return v;
  const out = to === "knots" ? v / KMH_PER_KNOT : v * KMH_PER_KNOT;
  return Math.round(out * 100) / 100;
}

/** A value as a chip an Editor clicks to change — the hostility in its
 * usual colour (HOSTILE red, NEUTRAL green, FRIEND blue, UNKNOWN plain), the
 * base plain; always with its name. */
function TraitChip<T extends string>({
  kind,
  value,
  values,
  onChange,
  disabled,
  title,
}: {
  kind: "hostility" | "base";
  value: T;
  values: T[];
  onChange?: (v: T) => void;
  disabled?: boolean;
  title: string;
}) {
  const cls = kind === "hostility" ? `trait-chip hostility-${value.toLowerCase()}` : "trait-chip base-chip";
  const text = kind === "base" ? `BASE ${value}` : value;
  if (!onChange) return <span className={cls}>{text}</span>;
  return (
    <MenuButton
      label={<>{text} ▾</>}
      className={cls}
      align="start"
      disabled={disabled}
      title={title}
      items={values.map((v) => ({ label: v, onSelect: () => onChange(v), disabled: v === value }))}
    />
  );
}

export function HostilityChip({
  hostility,
  onChange,
  disabled,
}: {
  hostility: Hostility;
  /** Leave out for a chip that only shows it. */
  onChange?: (h: Hostility) => void;
  disabled?: boolean;
}) {
  return (
    <TraitChip
      kind="hostility"
      value={hostility ?? "UNKNOWN"}
      values={HOSTILITIES}
      onChange={onChange}
      disabled={disabled}
      title="Hostility — written to the PRS XML once a version is saved"
    />
  );
}

export function BaseChip({ base, onChange, disabled }: { base: Base; onChange?: (b: Base) => void; disabled?: boolean }) {
  return (
    <TraitChip
      kind="base"
      value={base ?? "UNKNOWN"}
      values={BASES}
      onChange={onChange}
      disabled={disabled}
      title="Base — written to the PRS XML once a version is saved"
    />
  );
}
