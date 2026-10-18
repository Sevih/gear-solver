/** Armor-set level rule — which `sets.json` row a worn set's 2-pc and 4-pc
 *  bonuses read. outerpedia is the source: the rule and its data come from the
 *  contract (`levels[].breakLimitCounts`, `levels[].ignoreLowSet`, header of
 *  outerpedia's `datagen/generators/solver.ts`); the client functions are
 *  `CStatValue.SetSetItemValue`, `CCharacterData.CreateBuffSetItem` and
 *  `CItem.SetOptionLevel`.
 *   - a piece's level = the row whose `breakLimitCounts` holds its breakthrough
 *     (today level 1 = BT0-3, level 2 = BT4);
 *   - with N pieces of the set, the 2-pc (N ≥ 2) reads the row of the MINIMUM
 *     level of the 2 best pieces, the 4-pc (N ≥ 4) the row of the minimum of
 *     the 4 best — two rows that can differ;
 *   - the 2-pc is dropped when the 4-pc row has `ignoreLowSet` and carries the
 *     same stat (the client compares stat by stat), or, for a combat effect
 *     without a stat, when that row's 4-pc is a combat effect too
 *     (`CreateBuffSetItem`; read on `combatEffects.p4`, `p4_desc` for a cache
 *     without it). E.g. Speed BT [4,4,3,3]: the level-2 2-pc (13 %)
 *     is dropped by the level-1 4-pc (25 %, `ignoreLowSet`) → 25 %, not 38 %. */
import type { SetDef, SetLevel } from "./gamedata.js";

/** Rows a worn set reads. `row2` is null under 2 pieces, `row4` under 4. */
export interface WornSetRows {
  row2: SetLevel | null;
  row4: SetLevel | null;
  /** The 2-pc is cancelled by the 4-pc row's `ignoreLowSet` (see the header). */
  drop2: boolean;
}

/** True when every row carries the per-piece fields (contract from outerpedia
 *  C20 on). A cache synced before that has neither. */
function hasPerPieceLevels(def: SetDef): boolean {
  return def.levels.length > 0
    && def.levels.every((l) => Array.isArray(l.breakLimitCounts) && typeof l.ignoreLowSet === "boolean");
}

function rowAt(def: SetDef, level: number): SetLevel | null {
  for (const l of def.levels) if (l.level === level) return l;
  return null;
}

/** Contract row level for one breakthrough, or null when the row fields are
 *  missing or no row lists it. */
function contractLevel(def: SetDef, breakthrough: number): number | null {
  for (const l of def.levels) if (l.breakLimitCounts?.includes(breakthrough)) return l.level;
  return null;
}

/** Level of one piece in its set. Without the contract fields (or for a
 *  breakthrough no row lists), the pre-C20 tier: level 2 at BT4, else 1. */
export function pieceSetLevel(def: SetDef | null | undefined, breakthrough: number): number {
  const lv = def && hasPerPieceLevels(def) ? contractLevel(def, breakthrough) : null;
  return lv ?? (breakthrough >= 4 ? 2 : 1);
}

/** Rows read by a set worn on pieces at these breakthroughs. */
export function wornSetRows(def: SetDef, breakthroughs: readonly number[]): WornSetRows {
  const n = breakthroughs.length;
  const levels = hasPerPieceLevels(def) ? breakthroughs.map((bt) => contractLevel(def, bt)) : null;
  if (!levels || levels.some((l) => l == null)) {
    // Fallback for a contract without `breakLimitCounts` / `ignoreLowSet` (cache
    // synced before outerpedia C20), or a breakthrough no row lists: the former
    // rule exactly — level 2 only when EVERY piece is BT4, for both the 2-pc and
    // the 4-pc, no `ignoreLowSet`. Never the per-piece rule without
    // `ignoreLowSet`: Speed / Penetration / Bursting would gain their level-2
    // 2-pc on top of the level-1 4-pc (Speed [4,4,3,3] → 38 % instead of 25 %).
    const row = rowAt(def, breakthroughs.every((bt) => bt >= 4) ? 2 : 1);
    return { row2: n >= 2 ? row : null, row4: n >= 4 ? row : null, drop2: false };
  }
  const sorted = (levels as number[]).slice().sort((a, b) => b - a);
  // Sorted descending: the minimum of the k best is the k-th entry.
  const row2 = n >= 2 ? rowAt(def, sorted[1]!) : null;
  const row4 = n >= 4 ? rowAt(def, sorted[3]!) : null;
  let drop2 = false;
  if (row2 && row4?.ignoreLowSet) {
    const p2 = row2.p2, p4 = row4.p4;
    drop2 = p2 && p2.st !== "ST_NONE"
      ? p4?.st === p2.st
      : !(p4 && p4.st !== "ST_NONE") && (row4.combatEffects
        ? row4.combatEffects.p4 != null
        // Cache synced before outerpedia B53 (no `combatEffects`): the prose
        // stands in for the combat-effect 4-pc.
        : row4.p4_desc != null);
  }
  return { row2, row4, drop2 };
}
