/**
 * Builder reforge context — the mode + priority a result set was solved with,
 * its legacy migration and the toolbar's mode list.
 */
import type { ReforgeMode, ReforgeTickWeights } from "../../lib/solver/engine.js";

/** Reforge context carried alongside a result set — the mode + priority the
 *  build was solved with, so the bottom gear band can re-project the same
 *  main/substats it was scored against. */
export interface ReforgeContext {
  reforgeMode: ReforgeMode;
  priority: Record<string, number>;
  /** No-priority tick weights the engine projected with (`reforgeTickWeights`);
   *  absent on builds saved before them → per-roll-norm fallback. */
  tickWeights?: ReforgeTickWeights | null;
  /** The Transistone potential was projected (`SolverOptions.rerollPotential`);
   *  absent on builds saved before it → off. */
  rerollPotential?: boolean;
}

/** Migrate a persisted reforge context (saved builds) to the current shape.
 *  Pre-reforge-modes builds stored a `useReforged` boolean → map true to
 *  "classic" (the only projection that existed then), false/absent to
 *  "disable". */
export function migrateReforge(r: { reforgeMode?: ReforgeMode; useReforged?: boolean; priority: Record<string, number>; tickWeights?: ReforgeTickWeights | null; rerollPotential?: boolean } | undefined): ReforgeContext {
  if (!r) return { reforgeMode: "disable", priority: {} };
  const reforgeMode = r.reforgeMode ?? (r.useReforged ? "classic" : "disable");
  return { reforgeMode, priority: r.priority, tickWeights: r.tickWeights ?? null, rerollPotential: r.rerollPotential ?? false };
}

/** UI metadata for the reforge-mode segmented control — order = cycle order,
 *  label = chip text, hint = tooltip. */
export const REFORGE_MODES: ReadonlyArray<{ value: ReforgeMode; label: string; hint: string }> = [
  { value: "disable",    label: "Off",    hint: "Reforge preview off — score gear exactly as captured." },
  { value: "classic",    label: "+10R6",  hint: "+10, not ascended (6 reforge ticks). Main stats re-scaled, substats max-rolled by priority. Each piece stops at its own ceiling: a piece under 6★ gets only its own number of reforges." },
  { value: "ascended10", label: "+10R9",  hint: "+10, ascended for the reforges only (9 ticks). Same main stat as +10R6 — ascending just adds 3 reforges and unlocks +15. No Singularity passive (that's +15 only). The cost-conscious endgame: skips the steep +10→+15 enhancement. Each piece stops at its own ceiling: a piece under 6★, or a 6★ that isn't Unique, stays at +10 with its own number of reforges." },
  { value: "ascended",   label: "+15R9",  hint: "+15 full Singularity (9 reforge ticks). Adds the +11→+15 main-stat steps AND the unconditional Singularity passive (DMG± on weapon/acc vs armor) on top of +10R9. Each piece stops at its own ceiling: a piece under 6★, or a 6★ that isn't Unique, stays at +10 with its own number of reforges and no passive." },
];
