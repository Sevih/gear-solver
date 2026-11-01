/**
 * The one way to say which game data is loaded — the derived-data stamp
 * (data/derived/version.json): game version the tables were read from,
 * content hash, build date. Settings › Data and Settings › Setup show this;
 * the header's "game Y" is the live game version, not the data's.
 */
import type { DataVersion } from "../data.js";

/** "game 1.11.503 · 49a39d2e9dd6 · built <local date>", "—" without a stamp. */
export function dataVersionLabel(v: DataVersion | null): string {
  if (!v) return "—";
  const built = `built ${new Date(v.builtAt).toLocaleString()}`;
  return [v.resVersion ? `game ${v.resVersion}` : null, v.hash, built].filter(Boolean).join(" · ");
}
