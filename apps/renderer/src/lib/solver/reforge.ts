/**
 * Reforge modes — the context a result set was solved with (mode + priority),
 * the one migration of the legacy `useReforged` boolean (saved builds and
 * filter presets both go through `legacyReforgeMode`) and the mode list the
 * Optimizer toolbar and Settings › Solver show.
 */
import type { ReforgeMode, ReforgeTickWeights } from "./engine.js";

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

/** The reforge mode of a stored shape that may predate the modes: its
 *  `reforgeMode`, else the legacy `useReforged` boolean — true → "classic"
 *  (the only projection that existed then), false/absent → "disable". */
export function legacyReforgeMode(o: { reforgeMode?: ReforgeMode; useReforged?: boolean }): ReforgeMode {
  return o.reforgeMode ?? (o.useReforged ? "classic" : "disable");
}

/** Migrate a persisted reforge context (saved builds) to the current shape
 *  (`legacyReforgeMode`). */
export function migrateReforge(r: { reforgeMode?: ReforgeMode; useReforged?: boolean; priority: Record<string, number>; tickWeights?: ReforgeTickWeights | null; rerollPotential?: boolean } | undefined): ReforgeContext {
  if (!r) return { reforgeMode: "disable", priority: {} };
  return { reforgeMode: legacyReforgeMode(r), priority: r.priority, tickWeights: r.tickWeights ?? null, rerollPotential: r.rerollPotential ?? false };
}

/** UI metadata for the reforge-mode segmented controls (Optimizer toolbar,
 *  Settings › Solver) — order = cycle order, label = chip text, hint = tooltip. */
export const REFORGE_MODES: ReadonlyArray<{ value: ReforgeMode; label: string; hint: string }> = [
  { value: "disable",    label: "Off",    hint: "Reforge preview off — score gear exactly as captured." },
  { value: "classic",    label: "+10R6",  hint: "+10, not ascended (6 reforge ticks). Main stats re-scaled, substats max-rolled by priority. Each piece stops at its own ceiling: a piece under 6★ gets only its own number of reforges." },
  { value: "ascended10", label: "+10R9",  hint: "+10, ascended for the reforges only (9 ticks). Same main stat as +10R6 — ascending just adds 3 reforges and unlocks +15. No Singularity passive (that's +15 only). The cost-conscious endgame: skips the steep +10→+15 enhancement. Each piece stops at its own ceiling: a piece under 6★, or a 6★ that isn't Unique, stays at +10 with its own number of reforges." },
  { value: "ascended",   label: "+15R9",  hint: "+15 full Singularity (9 reforge ticks). Adds the +11→+15 main-stat steps AND the unconditional Singularity passive (DMG± on weapon/acc vs armor) on top of +10R9. Each piece stops at its own ceiling: a piece under 6★, or a 6★ that isn't Unique, stays at +10 with its own number of reforges and no passive." },
];
