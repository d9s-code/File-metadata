import type { Allegiance, Platform, SpeedUnit } from "../../api/platforms";
import { MenuButton } from "../common/MenuButton";

export const ALLEGIANCES: { key: Allegiance; label: string }[] = [
  { key: "hostile", label: "Hostile" },
  { key: "neutral", label: "Neutral" },
  { key: "friendly", label: "Friendly" },
];

export const SPEED_UNITS: { key: SpeedUnit; label: string }[] = [
  { key: "kmh", label: "km/h" },
  { key: "knots", label: "knots" },
];

/** 1 knot = 1.852 km/h. */
export const KMH_PER_KNOT = 1.852;

export function allegianceLabel(a: Allegiance | null | undefined): string {
  return ALLEGIANCES.find((x) => x.key === a)?.label ?? "Unknown";
}

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

/** The allegiance as a chip — red hostile, green neutral, blue friendly,
 * grey unknown — that an Editor clicks to change. */
export function AllegianceChip({
  allegiance,
  onChange,
  disabled,
}: {
  allegiance: Allegiance | null | undefined;
  /** Leave out for a chip that only shows it. */
  onChange?: (a: Allegiance | null) => void;
  disabled?: boolean;
}) {
  const cls = `allegiance-chip allegiance-${allegiance ?? "unknown"}`;
  const text = allegiance ? allegianceLabel(allegiance) : "Allegiance unknown";
  if (!onChange) return <span className={cls}>{text}</span>;
  return (
    <MenuButton
      label={<>{text} ▾</>}
      className={cls}
      align="start"
      disabled={disabled}
      title="Hostile, neutral or friendly — written to the PRS XML (Hostility) once a version is saved"
      items={[
        ...ALLEGIANCES.map((a) => ({ label: a.label, onSelect: () => onChange(a.key), disabled: a.key === allegiance })),
        { label: "Unknown", onSelect: () => onChange(null), disabled: !allegiance },
      ]}
    />
  );
}
