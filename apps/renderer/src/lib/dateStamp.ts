/**
 * Date stamp of an exported file name (backup, roster export).
 */

/** `YYYY-MM-DD` of `ms` in the user's LOCAL calendar. `toISOString()` gives
 *  the UTC day: a file exported between midnight and the UTC offset was named
 *  after the day before. */
export function localDateStamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
