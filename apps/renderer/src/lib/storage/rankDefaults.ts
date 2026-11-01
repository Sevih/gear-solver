/**
 * Default ranks — the one recipe that gives every hero and preset never offered
 * a rank one (below the ranked ones, in its default order), applied by `App` on
 * each imported inventory (`hooks/useRankDefaults.ts`) so the Builder reads
 * ranked heroes and presets without the Builds or Presets tab ever being opened.
 *
 * Pure: the caller loads and persists the `seen` lists (`heroPriority` /
 * `presetPriority`) and pushes the ranks.
 */
import type { GameData, GearPiece, Inventory, UserGeasLevels } from "@gear-solver/core";
import { composeCharStats, effectiveCharacter, expToLevel, gameRulesOf } from "@gear-solver/core";
import { computeFinalStats } from "../composeBuild.js";
import { calcBattlePower } from "../solver/cp.js";
import { presetGameOrder } from "../presets/presetHolds.js";
import { fillUnrankedByOrder, type PriorityRank } from "./rankPriority.js";

export interface RankDefaults {
  rank: PriorityRank;
  seen: ReadonlySet<string>;
  /** False when no key of `ordered` is new: `rank` and `seen` are then the
   *  input objects, untouched (no write, no render). */
  changed: boolean;
}

/** Every key of `ordered` absent from `seen` gets a rank below the ranked ones,
 *  in the given order (`fillUnrankedByOrder`), and joins `seen`. A key already
 *  in `seen` with no rank was cleared on purpose and stays unranked. */
export function rankDefaults({ rank, seen, ordered }: { rank: PriorityRank; seen: ReadonlySet<string>; ordered: readonly string[] }): RankDefaults {
  if (!ordered.some((k) => !seen.has(k))) return { rank, seen, changed: false };
  return {
    rank: fillUnrankedByOrder(rank, [...ordered], seen) ?? rank,
    seen: new Set([...seen, ...ordered]),
    changed: true,
  };
}

/** Hero uids by in-game CP, highest first — the hero default rank order. The
 *  same CP as the Builds cards (compose, equipped gear, `calcBattlePower`); a
 *  hero with no resolved CP (missing game data / TransStar row) sinks. */
export function heroRankOrder(inventory: Inventory, game: GameData | null, userGeasLevels: UserGeasLevels | null, userCodexLevel: number | null): string[] {
  const rawByChar = new Map<string, GearPiece[]>();
  for (const g of inventory.gear) {
    if (!g.equippedBy || !g.slot) continue;
    let raws = rawByChar.get(g.equippedBy);
    if (!raws) { raws = []; rawByChar.set(g.equippedBy, raws); }
    raws.push(g);
  }
  const byCp = inventory.characters.map((c) => {
    const { def: meta } = effectiveCharacter(c, game?.characters);
    const raws = rawByChar.get(c.uid) ?? [];
    const level = game?.expCharacter ? expToLevel(game.expCharacter, c.exp) : 100;
    const lbKey = meta?.star != null && c.levelMaxStep > 0 ? `${meta.star}|${c.levelMaxStep}` : null;
    const levelMaxModifier = lbKey ? (game?.charLevelMax[lbKey]?.statModifierAfter100 ?? 0) : 0;
    const composed = (meta?.ingredients && game?.codexCurve)
      ? composeCharStats(meta.ingredients, game.codexCurve, {
          transStar: c.stars,
          fusionLevel: c.fusionLevel,
          level,
          levelMaxModifier,
          levelMaxStep: c.levelMaxStep,
          evoUnlockLevel: gameRulesOf(game).evoUnlockLevel,
          userGeasLevels,
          userSkillLevels: { first: c.skills.first, second: c.skills.second, ultimate: c.skills.ultimate },
          ...(userCodexLevel != null ? { codexLevel: userCodexLevel } : {}),
        })
      : null;
    const stats = composed ? computeFinalStats(composed.noGearStats, composed.scaling, raws, game) : null;
    const transRow = meta?.ingredients?.transcendByStar?.[String(c.stars)] ?? null;
    const bp = stats && transRow
      ? calcBattlePower({
          stats,
          showUIStar: transRow.showUIStar ?? 0,
          starPlus: transRow.starPlus ?? 0,
          skills: c.skills,
          ee: raws.find((p) => p.slot === "exclusive") ?? null,
          ooparts: raws.find((p) => p.slot === "ooparts") ?? null,
          fused: c.fusionCharId !== 0,
        })
      : null;
    return { uid: c.uid, bp };
  });
  return byCp.sort((a, b) => (b.bp ?? -Infinity) - (a.bp ?? -Infinity)).map((e) => e.uid);
}

/** Preset keys (num as a string) in the in-game order — the preset default
 *  rank order. */
export function presetRankOrder(inventory: Inventory): string[] {
  return presetGameOrder(inventory.presets);
}
