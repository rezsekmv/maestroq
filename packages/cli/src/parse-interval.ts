// Parse the --interval value (seconds, as a string) used by `maestroq status --watch`.
// Returns ms. Falls back to the 2s default for missing / invalid / non-positive input.
// Floors at 500ms to keep the refresh loop sane.
export function parseWatchInterval(raw: string | undefined): number {
  if (!raw) return 2_000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 2_000;
  return Math.max(500, Math.floor(n * 1000));
}
