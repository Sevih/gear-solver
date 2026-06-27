/**
 * buildAdvice — auto-generated, high-confidence observations about a hero's
 * CURRENT equipped build, shown on the Builds-tab cards. Pure + deterministic
 * (no IO, no Date) so it lives here and is tested standalone, mirroring the
 * other lib helpers (`subValue`, `dmgValue`, `translateReco`).
 *
 * Every threshold here is a model constant, never a guess: the 100% CRC/PEN
 * caps mirror the damage model (`ratings.ts`), and the reforge budget reuses
 * the solver's `maxReforgesOf` rather than re-deriving it.
 */
import type { GameData, GearPiece } from "@gear-solver/core";
import { round1, type FinalStats } from "./composeBuild.js";
import { maxReforgesOf } from "./solver/engine.js";
import { toDesignSlot, type SlotId } from "../design/tokens.js";

/** One suggestion / observation about a build. `tone` drives the badge color
 *  (warn = orange, info = neutral, tip = cyan). */
export interface AdviceItem {
  tone: "warn" | "info" | "tip";
  text: string;
}

/** The composed-entry fields the advice rules read. Declared structurally so
 *  callers can pass a richer `ComposedEntry` without an adapter — and so the
 *  tests can build a minimal fixture. `equipped` only needs `size` + `has`,
 *  which a `Map<SlotId, …>` provides. */
export interface AdviceInput {
  equipped: ReadonlyMap<SlotId, unknown>;
  rawPieces: GearPiece[];
  stats: FinalStats | null;
}

/** Slots whose presence is required before any advice is meaningful. EE and
 *  Talisman are intentionally excluded from THIS list — they're optional
 *  bolt-ons (they still drive the gem-slot rule, just not the missing/upgrade
 *  rules). */
const ADVICE_REQUIRED_SLOTS: ReadonlyArray<SlotId> = [
  "weapon", "accessory", "helmet", "armor", "gloves", "boots",
];

/** "Missing slots" only fires as an actionable nudge when a hero is NEARLY
 *  complete (this many gaps or fewer). A hero missing more than that is a
 *  work-in-progress / bench unit — listing 4-5 empty slots is noise, not
 *  advice — so the rule stays silent (the rest is still deferred, the armor
 *  layout isn't settled). */
const MISSING_ADVICE_MAX = 2;

/** Display labels for the slots used in advice messages (design SlotId keys —
 *  resolve a core GearSlot through `toDesignSlot` first). Includes the two
 *  gem-bearing slots for the gem-slot rule. */
const ADVICE_SLOT_LABEL: Record<string, string> = {
  weapon: "Weapon", accessory: "Accessory", helmet: "Helmet",
  armor: "Armor", gloves: "Gloves", boots: "Boots",
  talisman: "Talisman", exclusive: "EE",
};

/** Auto-detect notable conditions on a build. Pure + deterministic in
 *  (`entry`, `game`). Rules are intentionally conservative: only
 *  high-confidence, data-driven observations (nothing that needs guessing
 *  intent, e.g. "off-stat main" on the variable slots).
 *
 *  Rules:
 *   1. Missing main-gear pieces — flag the empty slots on a NEARLY-complete
 *      hero (≤ MISSING_ADVICE_MAX gaps). Fully-unequipped heroes are already
 *      labeled "No gear", and a hero missing most of its gear is a WIP/bench
 *      unit whose long Missing list is noise — both stay silent. Any missing
 *      piece still stops the rest: the armor layout isn't settled, so set
 *      advice would be noise.
 *   2. Lone set piece — a single piece of an armor set grants no bonus (no
 *      1pc tier exists in-game), so it's a wasted slot.
 *   3. 3/4 of a 4pc-capable set — the 4th piece completes the 4pc bonus.
 *   4. Wasted stat caps — CRC / PEN overflow is dead weight (both hard-cap at
 *      100% in the damage model; the overflow could be reallocated). CRC keeps
 *      a +2% tolerance (warn past 102%) as an anti-crit-resist buffer; PEN
 *      warns past 100%.
 *   5. Gem slots — empty gem slots on the Talisman / EE are free stats left on
 *      the table; the 5th slot stays locked until the piece reaches +5.
 *   6. Upgrade headroom — main-gear pieces with unused reforges, 6★ pieces not
 *      yet ascended, and pieces below their enhance cap (+10, or +15 once
 *      ascended), each aggregated into one line to avoid card spam.
 *
 *  Rules 4-6 only run on a fully-main-equipped hero (rule 1 returns early
 *  otherwise) so they never fire on a half-built roster. Set tiers are read
 *  from `game.sets` (the T4 `level === 2` row, same derivation as the
 *  Builder's set catalog) — no assumed set sizes. */
export function computeAdvice(entry: AdviceInput, game: GameData | null): AdviceItem[] {
  const { equipped, rawPieces } = entry;
  // No gear at all → the card's "No gear" label covers it; stay silent.
  if (equipped.size === 0) return [];

  const out: AdviceItem[] = [];

  // Rule 1 — missing main-gear pieces. Only surface the "finish these" nudge
  // when the hero is nearly complete (≤ MISSING_ADVICE_MAX gaps); a roster
  // hero missing most of its gear is a WIP/bench unit and a long Missing list
  // is noise. Either way the rest is deferred — incomplete armor makes set/cap
  // advice meaningless.
  const missing = ADVICE_REQUIRED_SLOTS.filter((s) => !equipped.has(s));
  if (missing.length > 0) {
    if (missing.length <= MISSING_ADVICE_MAX) {
      out.push({ tone: "warn", text: `Missing: ${missing.map((s) => ADVICE_SLOT_LABEL[s] ?? s).join(", ")}` });
    }
    return out; // armor layout incomplete — defer the rest
  }

  // Rules 2 + 3 — armor-set composition. Each equipped slot holds at most one
  // piece, so the per-set count equals the distinct-slot count the in-game
  // 2pc/4pc gate uses.
  if (game?.sets) {
    const countBySet = new Map<string, number>();
    for (const p of rawPieces) {
      if (!p.armorSetId) continue;
      countBySet.set(p.armorSetId, (countBySet.get(p.armorSetId) ?? 0) + 1);
    }
    for (const [setId, n] of countBySet) {
      const def = game.sets[setId];
      const name = def?.name ?? `Set ${setId}`;
      const t4 = def?.levels.find((l) => l.level === 2);
      const has4pc = !!(t4?.p4 && t4.p4.st !== "ST_NONE" && t4.p4.v != null);
      if (n === 1) {
        out.push({ tone: "warn", text: `${name}: 1 piece — no set bonus active` });
      } else if (n === 3 && has4pc) {
        out.push({ tone: "tip", text: `${name}: 3/4 — one more piece completes 4pc` });
      }
    }
  }

  // Rule 4 — wasted stat caps. CRC and PEN both hard-cap at 100% in the damage
  // model; any overflow is dead weight that could be reallocated. Crit rate
  // keeps a +2% tolerance (warn only past 102%): players intentionally overcap
  // a couple points as a buffer against enemy crit-resist, so 100-102% isn't
  // truly wasted. PEN has no such buffer (cap 100%). Rounded waste must be > 0
  // so a float a hair over the cap doesn't print a "0% wasted" line.
  if (entry.stats) {
    const capWaste = (label: string, v: number, cap: number) => {
      const waste = round1(v - cap);
      if (waste > 0) out.push({ tone: "warn", text: `${label} ${round1(v)}% — ${waste}% wasted over the ${cap}% cap` });
    };
    capWaste("Crit rate", entry.stats.critRate, 102);
    capWaste("Penetration", entry.stats.pen, 100);
  }

  // Rule 5 — gem slots on the gem-bearing pieces (Talisman / EE). `gemSlots` is
  // always length 5 with `0` = empty; the 5th slot is gated behind enhance +5.
  // An empty usable slot is free stats left on the table.
  for (const p of rawPieces) {
    if (!p.gemSlots) continue;
    const label = ADVICE_SLOT_LABEL[toDesignSlot(p.slot) ?? ""] ?? "Piece";
    const usable = p.enhanceLevel >= 5 ? 5 : 4;
    const empty = usable - p.gemSlots.slice(0, usable).filter((g) => g !== 0).length;
    if (empty > 0) {
      out.push({ tone: "warn", text: `${label}: ${empty} empty gem slot${empty > 1 ? "s" : ""}` });
    } else if (p.enhanceLevel < 5) {
      out.push({ tone: "tip", text: `${label}: reach +5 to unlock a 5th gem slot` });
    }
  }

  // Rule 6 — upgrade headroom on the main-gear pieces, each kind aggregated
  // into one line so a roster of half-finished gear doesn't spam the card.
  // `maxReforgesOf` is the solver's own in-game budget (no duplicated formula).
  // Gem pieces are skipped — gems aren't reforged/ascended like gear.
  // The enhance cap is +10 for a normal piece, +15 once ascended (Singularity
  // extends the bar past +10), mirroring `GearPiece.enhanceLevel`'s 0..10/10..15
  // contract — so a piece below its own cap still has main-stat headroom.
  let unusedReforges = 0;
  let unascended6 = 0;
  let underEnhanced = 0;
  for (const p of rawPieces) {
    if (p.gemSlots) continue;
    const ds = toDesignSlot(p.slot);
    if (!ds || !ADVICE_REQUIRED_SLOTS.includes(ds)) continue;
    if (p.reforgeCount < maxReforgesOf(p)) unusedReforges++;
    if (p.star === 6 && !p.ascended) unascended6++;
    if (p.enhanceLevel < (p.ascended ? 15 : 10)) underEnhanced++;
  }
  if (unascended6 > 0) out.push({ tone: "info", text: `${unascended6} 6★ piece${unascended6 > 1 ? "s" : ""} not yet ascended` });
  if (underEnhanced > 0) out.push({ tone: "info", text: `${underEnhanced} piece${underEnhanced > 1 ? "s" : ""} below max enhance` });
  if (unusedReforges > 0) out.push({ tone: "info", text: `${unusedReforges} piece${unusedReforges > 1 ? "s" : ""} with unused reforges` });

  return out;
}
