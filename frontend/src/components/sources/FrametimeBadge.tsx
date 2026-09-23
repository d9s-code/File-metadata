import { frameTimeUs } from "../common/frameTime";

export function FrametimeBadge({ staggerValues }: { staggerValues: number[] }) {
  const frametime = frameTimeUs(staggerValues);
  return <span className="frametime-badge">Frametime: {frametime} µs</span>;
}
