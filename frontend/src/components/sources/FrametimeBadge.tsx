export function FrametimeBadge({ staggerValues }: { staggerValues: number[] }) {
  const frametime = staggerValues.reduce((sum, v) => sum + v, 0);
  return <span className="frametime-badge">Frametime: {frametime} µs</span>;
}
