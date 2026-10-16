/**
 * Builder ΔCP label — the gear-band headline "is this swap worth it?".
 *
 * ΔCP is `build.cp − currentCp`: the build is scored in the results' reforge
 * mode (projected to +10R6 etc.) while `currentCp` is the equipped gear AS IT
 * IS NOW. So with a reforge mode on, a build identical to the loadout still
 * shows a positive ΔCP — the label says which base it compares against
 * rather than silently mixing the two.
 */
import type { ReforgeMode } from "./solver/engine.js";

/** Text + tooltip for the ΔCP span. `modeLabel` is the reforge mode's chip
 *  label (e.g. "+10R6"); ignored for "disable", where both sides are the
 *  captured gear and the label stays the bare `ΔCP ±X`. */
export function deltaCpLabel(
  deltaCp: number,
  reforgeMode: ReforgeMode,
  modeLabel: string,
): { text: string; title: string | null } {
  const base = `ΔCP ${deltaCp > 0 ? "+" : ""}${Math.round(deltaCp).toLocaleString()}`;
  if (reforgeMode === "disable") return { text: base, title: null };
  return {
    text: `${base} vs equipped (build at ${modeLabel})`,
    title: `The build is projected to ${modeLabel}; your equipped gear is counted as it is now.`,
  };
}
