/**
 * App journal — one bounded list of lines shown in Settings › Advanced: the
 * plugin install stream (prefixed by the backend) plus every status message,
 * stamped with the wall-clock time. Pure helpers; App owns the state.
 */

/** Lines kept in the journal — older ones fall off the top. */
export const APP_LOG_MAX = 500;

const pad2 = (n: number) => String(n).padStart(2, "0");

/** `[HH:MM:SS] message`, local time. */
export function stampLine(message: string, at: Date): string {
  return `[${pad2(at.getHours())}:${pad2(at.getMinutes())}:${pad2(at.getSeconds())}] ${message}`;
}

/** `lines` followed by `batch`, keeping only the last `max`. An empty batch
 *  returns `lines` itself, so a no-op flush re-renders nothing. */
export function appendBounded(lines: readonly string[], batch: readonly string[], max: number): string[] {
  if (batch.length === 0) return lines as string[];
  const next = lines.concat(batch);
  return next.length > max ? next.slice(next.length - max) : next;
}
