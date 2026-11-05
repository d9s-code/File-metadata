import { MenuButton } from "../common/MenuButton";

/** "On 2 Platforms · 1 behind": where the Emitter is pinned, and which of
 * those Platforms pin an older version than its latest saved one. Each
 * opens the Platform, where Repin moves it (a minor Platform version). */
export function EmitterPinsChip({
  platforms,
  latestVersion,
}: {
  platforms: { id: string; name: string; pinned_version_number?: number | null }[];
  latestVersion: number | null;
}) {
  if (platforms.length === 0) return null;
  const isBehind = (p: (typeof platforms)[number]) =>
    latestVersion != null && p.pinned_version_number != null && p.pinned_version_number < latestVersion;
  const behind = platforms.filter(isBehind).length;
  const n = platforms.length;
  return (
    <MenuButton
      label={
        <>
          On {n} Platform{n === 1 ? "" : "s"}
          {behind > 0 && <span className="pins-behind"> · {behind} behind</span>}
        </>
      }
      className={behind > 0 ? "status-badge emitter-pins-chip behind" : "status-badge emitter-pins-chip"}
      ariaLabel={`Pinned on ${n} Platform${n === 1 ? "" : "s"}${behind ? `, ${behind} at an older version` : ""}`}
      title={behind > 0 ? "Some Platforms pin an older version — open one to repin it" : "The Platforms this Emitter is pinned on"}
      align="start"
      items={platforms.map((p) => ({
        label: `${p.name} — pins v${p.pinned_version_number ?? "?"}${isBehind(p) ? ` · v${latestVersion} saved, repin there` : ""}`,
        to: `/platforms/${p.id}`,
      }))}
    />
  );
}
