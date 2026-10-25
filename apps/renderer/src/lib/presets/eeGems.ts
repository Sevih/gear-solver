/**
 * EE gems per hero of a preset — the outfit is worn as-is (Talisman and its
 * gems included, they are part of the preset), so what a hero can still tune
 * is the gems of their OWN EE. `bestEeGemsFor` picks them like the solver
 * does (`buildGemPool` → `scoreGemPool` → `allocateGemsCapped`), with the
 * pieces fixed: the hero's priority, only the EE's slots to fill.
 *
 * The gems on offer are the hero's own EE ones plus those sitting on a
 * Talisman / EE nobody wears — never the preset's Talisman (shared with every
 * hero of the preset), a piece another hero wears, nor a free piece the
 * worklist reserves for another hero (`ctx.worklistClaims`, like the Builder).
 *
 * Pure: the screen feeds it the same context as `evaluatePresetFor`.
 */
import type { GearPiece } from "@gear-solver/core";
import { gameRulesOf } from "@gear-solver/core";
import { computeFinalStats } from "../composeBuild.js";
import { gemDmgGains } from "../solver/engine.js";
import { allocateGemsCapped, buildGemPool, gemSlotsOf, scoreGemPool } from "../solver/gems.js";
import { eeGemOverride, eeOf, evaluatePresetFor, type PresetEvalContext } from "./evaluate.js";

export interface EeGems {
  /** OptionIDs per EE socket, 0 = empty — the `gemAllocation.ee` of a worklist entry. */
  ee: number[];
}

/** The EE gems that give `heroUid` their best score wearing `presetPieces`.
 *  Null when nothing beats the gems as socketed: no priority, no EE or no gem
 *  slot, no gem worth picking, or a pick that scores no higher. */
export function bestEeGemsFor(heroUid: string, presetPieces: readonly GearPiece[], ctx: PresetEvalContext): EeGems | null {
  const hero = ctx.heroes.get(heroUid);
  const game = ctx.game;
  const ee = eeOf(heroUid, ctx);
  if (!hero?.priority || !game || !ee) return null;
  const slots = gemSlotsOf(ee, gameRulesOf(game));
  if (slots === 0) return null;

  // The gem pool sees the hero's EE and the free gem-bearing pieces only: the
  // preset's pieces are fixed, every worn piece of another hero is off limits,
  // and the hero's own Talisman comes off when the preset goes on. A free
  // piece reserved for another hero by the worklist counts as theirs.
  const presetUids = new Set(presetPieces.map((p) => p.uid));
  const pool = buildGemPool(
    { ...ctx.inventory, gear: ctx.inventory.gear.filter((g) => g.uid === ee.uid || (!g.equippedBy && !presetUids.has(g.uid))) },
    { heroUid, equippedScope: "none", heroPriority: {}, excludedHeroes: new Set(), worklistClaims: ctx.worklistClaims },
  );
  if (pool.size === 0) return null;

  // The outfit the gems are weighed on — preset pieces + the hero's EE, in
  // inventory order like `evaluatePresetFor`.
  const outfitUids = new Set([...presetUids, ee.uid]);
  const outfit = ctx.inventory.gear.filter((g) => outfitUids.has(g.uid));
  const scored = scoreGemPool(pool, hero.priority, game, {
    fillGain: gemDmgGains(hero.baseline, hero.scaling, outfit, game, hero.dmgStat, hero.dmgSec, hero.noCrit),
  });
  // CHC before the EE gems — a crit gem past the cap is wasted (score caps at 100).
  const bare = computeFinalStats(hero.baseline, hero.scaling, outfit, game, eeGemOverride(outfit, [], game));
  const { alloc, delta } = allocateGemsCapped(scored, 0, slots, bare.critRateUncapped ?? bare.critRate);
  if (!delta) return null;

  const socketed = ee.gemSlots ?? [];
  const proposal = alignToSockets(alloc.ee, socketed);
  if (proposal.every((id, i) => id === (socketed[i] ?? 0))) return null;
  const asSocketed = evaluatePresetFor(heroUid, presetPieces, ctx)?.score;
  const withGems = evaluatePresetFor(heroUid, presetPieces, ctx, proposal)?.score;
  if (asSocketed == null || withGems == null || !(withGems > asSocketed + 1e-9)) return null;
  return { ee: proposal };
}

/** `wanted` reordered so a gem already in a socket stays there (the fewest
 *  worklist lines), the others filling the remaining sockets in pick order. A
 *  socket the pick leaves empty keeps what it holds — the game never removes a
 *  gem by itself, and the worklist doesn't queue a removal. */
export function alignToSockets(wanted: readonly number[], socketed: readonly number[]): number[] {
  const left = new Map<number, number>();
  for (const id of wanted) if (id) left.set(id, (left.get(id) ?? 0) + 1);
  const out = wanted.map(() => 0);
  out.forEach((_, i) => {
    const s = socketed[i] ?? 0;
    const n = s ? left.get(s) ?? 0 : 0;
    if (n > 0) {
      out[i] = s;
      left.set(s, n - 1);
    }
  });
  const rest = wanted.filter((id) => {
    const n = id ? left.get(id) ?? 0 : 0;
    if (n > 0) left.set(id, n - 1);
    return n > 0;
  });
  return out.map((id, i) => id || rest.shift() || (socketed[i] ?? 0));
}
