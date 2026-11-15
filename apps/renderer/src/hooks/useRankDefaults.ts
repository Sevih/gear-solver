/**
 * useRankDefaults — `App` gives the heroes and presets never offered a rank
 * their default one (heroes by CP, presets in the in-game order) on each
 * imported inventory, so the Builder's "≤ Lower" scope and the preset holds
 * read ranked keys without Builds or Presets ever being opened. The recipe is
 * `lib/storage/rankDefaults.ts`; this hook only loads/persists `seen` and
 * pushes the ranks.
 */
import { useEffect, useMemo } from "react";
import type { GameData, Inventory, UserGeasLevels } from "@gear-solver/core";
import { loadSeenHeroes, persistSeenHeroes, type HeroPriority } from "../lib/storage/heroPriority.js";
import { loadSeenPresets, persistSeenPresets, type PresetRank } from "../lib/storage/presetPriority.js";
import { heroRankDefaults, heroRankOrder, presetRankOrder, rankDefaults } from "../lib/storage/rankDefaults.js";

export function useRankDefaults({ inventory, game, userGeasLevels, userCodexLevel, heroPriority, onHeroPriorityChange, presetRank, onPresetRankChange }: {
  inventory: Inventory | null;
  game: GameData | null;
  userGeasLevels: UserGeasLevels | null;
  userCodexLevel: number | null;
  heroPriority: HeroPriority;
  onHeroPriorityChange: (next: HeroPriority) => void;
  presetRank: PresetRank;
  onPresetRankChange: (next: PresetRank) => void;
}): void {
  // The hero order composes the stats and CP of the whole roster: only done
  // when a hero was never seen (`heroRankDefaults`), not on every import or
  // rank edit once the roster is known.
  useEffect(() => {
    if (!inventory) return;
    const r = heroRankDefaults({
      rank: heroPriority,
      seen: loadSeenHeroes(),
      inventory,
      order: () => heroRankOrder(inventory, game, userGeasLevels, userCodexLevel),
    });
    if (!r.changed) return;
    persistSeenHeroes(r.seen);
    onHeroPriorityChange(r.rank);
  }, [inventory, game, userGeasLevels, userCodexLevel, heroPriority, onHeroPriorityChange]);
  // The preset order follows the inventory; a rank edit only re-runs the
  // cheap `rankDefaults`, a no-op once every key is seen.
  const presetOrder = useMemo(() => (inventory ? presetRankOrder(inventory) : []), [inventory]);
  useEffect(() => {
    const r = rankDefaults({ rank: presetRank, seen: loadSeenPresets(), ordered: presetOrder });
    if (!r.changed) return;
    persistSeenPresets(r.seen);
    onPresetRankChange(r.rank);
  }, [presetOrder, presetRank, onPresetRankChange]);
}
