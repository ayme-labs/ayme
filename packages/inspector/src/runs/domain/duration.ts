/**
 * How long a run took, as Runs and the run card show it: under a second in
 * milliseconds, "320 ms"; from a second on in seconds to one decimal,
 * "15.2 s", so a long run doesn't read as a five-digit count.
 */
export function formatDuration(durationMs: number) {
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(1)} s`;
}
