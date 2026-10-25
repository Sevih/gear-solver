/**
 * Transistone reroll potential — how far a substat line could still climb by
 * Transistone, for the Builder's projection ("Transistone potential") and the
 * "reachable" quality.
 *
 * The rule, read from the game client (decompiled sources + tables):
 *  - Which pieces: the Option Change tab opens only on a 5★ Rare/Unique or a
 *    6★ Magic/Rare/Unique piece with exactly 4 substat lines
 *    (`CItem.cs:902-915` `GetIsEnableOptionChange`, `m_SubOptionList.Count == 4`;
 *    gate of the tab in `CUIItemGrowth.cs:118-119` and `:223`).
 *  - Up to stage 4 only on a 6★ Legendary (Unique): in `ItemOptionChangeTemplet`
 *    only rows 24 (COT_SELECT, Transistone (Individual), item 21201) and 48
 *    (COT_ALL, Transistone (Total), item 21202) for BasicStar 6 + IG_UNIQUE
 *    carry `RewardEquipSubOptionGroupID` 4; every other star / rarity carries 0
 *    (no level group, no stage 4).
 *  - How far, how many lines: group 4 of `ItemSubOptionLevelTemplet` draws the
 *    rerolled base level 0/1/2 (rates 316666/316667/316667, MaxCount 4) or 3 =
 *    stage 4 (rate 50000 of 1 000 000 = 5 %, MaxCount 1). The tab says so:
 *    `CUIItemOptionChange.cs:229-235` formats SYS_OPTION_REPLACE_SUB_OPTION_LEVEL_MAX
 *    ("Up to {0} sub-options on Legendary 6★ gear can be applied up to Stage
 *    {1}") with `GetSubOptionTopLevelMaxCount` (`CUtilUI.cs:584-587`, MaxCount of
 *    level 3 = 1) and the group's max level + 1 = 4. So ONE line at stage 4 per
 *    piece: a piece that already has one (the native 4/4/3/3 and the 4/3/3/3
 *    drops) gains nothing.
 *  - Reforges are kept (SYS_OPTION_REPLACE_TOOLTIP_01 "Current reforge values
 *    will be maintained"): the reroll changes the line's base level
 *    (`WSSubOption.BaseLevel`), its reforge ticks stay on top. The value still
 *    caps at `OptionMaxValue` (`CItemSubOptionData.cs:19,28`), 6 × the per-tick
 *    value on every substat option, i.e. LV6 — the reforge cap.
 *  - Which line: Individual rerolls the selected line and locks the others
 *    (`CUIItemOptionChange.cs:140`, SYS_OPTION_REPLACE_SELECT_TOOLTIP_01: once a
 *    line was changed, only that line can be changed again); Total rerolls all
 *    four and lifts the lock. Any line can thus be the stage-4 one.
 *  - How many times: no counter in the client — each pass costs one Transistone
 *    and gold (`CUIItemOptionChange.cs:338` checks only those) and the player
 *    keeps or discards the result (`item/subOptionChange`, `IsSelected`).
 *
 * The draw is random (5 % per pass for stage 4, and the stat itself can
 * change), so this module models the CEILING — the best line at stage 4 — the
 * same way the reforge projection models max rolls. Pure, no React, no IO.
 */
import type { GameData, GearPiece, RolledStat } from "@gear-solver/core";
import { DEFAULT_RULES, gameRulesOf } from "@gear-solver/core";
import { ROLL_NORMS, STAT_TO_PRIORITY } from "../statRegistry.js";

/** Base stage a Transistone can bring one line to (base level 3 + 1). */
export const REROLL_TOP_STAGE = 4;

/** How the line to raise is picked: the hero's substat priority (axis keys,
 *  -1..3, the Builder's `priority`). Empty / all-zero = no priority. */
export interface RerollPick {
  priority: Record<string, number>;
}

/** The line that would climb (index in `piece.subs`) and by how many ticks. */
export interface RerollPotential {
  index: number;
  ticks: number;
}

/** Base stage of a substat line: its ticks minus the reforge ticks on top. */
function baseStage(s: RolledStat): number {
  return (s.ticks ?? 0) - (s.reforgeTicks ?? 0);
}

/** Can a Transistone bring a line of this piece to stage 4? A 6★ Legendary
 *  with 4 rolled substat lines (Talisman / EE carry gems, not substats). */
export function rerollEligible(piece: GearPiece): boolean {
  if (piece.slot === "ooparts" || piece.slot === "exclusive") return false;
  return piece.star === 6 && piece.rarity === "unique" && piece.subs.length === 4;
}

/** Ticks each line would gain at stage 4 (0 = nothing to gain: already at
 *  stage 4, or held by the LV6 value cap), or null when the piece can't climb
 *  at all (not eligible, or one line already at stage 4). */
export function rerollGains(piece: GearPiece, maxTicksPerSub: number = DEFAULT_RULES.reforge.maxTicksPerSub): number[] | null {
  if (!rerollEligible(piece)) return null;
  if (piece.subs.some((s) => baseStage(s) >= REROLL_TOP_STAGE)) return null;
  return piece.subs.map((s) => Math.max(0, Math.min(REROLL_TOP_STAGE - baseStage(s), maxTicksPerSub - (s.ticks ?? 0))));
}

/** The largest gain on any line — what the "reachable" quality adds. 0 when
 *  the piece has no potential. */
export function rerollMaxGain(piece: GearPiece, maxTicksPerSub?: number): number {
  const gains = rerollGains(piece, maxTicksPerSub);
  return gains ? Math.max(0, ...gains) : 0;
}

/** The line a Transistone would raise, and by how much, or null (piece not
 *  eligible, a line already at stage 4, no line with anything to gain).
 *  With a priority: the line whose stat weighs most for the hero — never one
 *  ranked below zero (no point spending a Transistone on it); without one, or
 *  between equal weights: the line of largest normalized value
 *  (`value / ROLL_NORMS`). */
export function rerollPotential(piece: GearPiece, game: GameData | null, pick: RerollPick): RerollPotential | null {
  const gains = rerollGains(piece, (game ? gameRulesOf(game) : DEFAULT_RULES).reforge.maxTicksPerSub);
  if (!gains) return null;
  const hasPriority = Object.values(pick.priority).some((v) => v !== 0);
  let best: RerollPotential | null = null;
  let bestW = -Infinity;
  let bestN = -Infinity;
  for (let i = 0; i < piece.subs.length; i++) {
    const s = piece.subs[i]!;
    const gain = gains[i]!;
    if (gain <= 0) continue;
    const w = hasPriority ? pick.priority[STAT_TO_PRIORITY[s.stat] ?? s.stat] ?? 0 : 0;
    if (w < 0) continue;
    const n = s.value / (ROLL_NORMS[s.stat] ?? 100);
    if (w > bestW || (w === bestW && n > bestN)) {
      best = { index: i, ticks: gain };
      bestW = w;
      bestN = n;
    }
  }
  return best;
}

/** The piece with its Transistone potential applied (`rerollPotential`): the
 *  picked line's base climbs to stage 4, its reforge ticks unchanged, its value
 *  scaled per tick. The piece itself when there is no potential. */
export function applyRerollPotential(piece: GearPiece, game: GameData | null, pick: RerollPick): GearPiece {
  const pot = rerollPotential(piece, game, pick);
  if (!pot) return piece;
  const subs = piece.subs.map((s, i) => {
    if (i !== pot.index) return s;
    const ticks = s.ticks ?? 0;
    const perTick = ticks > 0 ? s.value / ticks : s.value;
    return { ...s, ticks: ticks + pot.ticks, value: s.value + perTick * pot.ticks };
  });
  return { ...piece, subs };
}
