/**
 * "Optimize preset →" — the Builder filters a preset's outfit asks for on its
 * reference hero: the SAME weapon / accessory / talisman effects (required),
 * and up to five priority substats merged from what the outfit already rolls
 * and outerpedia's reco for the hero.
 *
 * Mains come from the reco only (weapon + accessory, as "Get preset" sets
 * them). Sets stay open: the patch carries no plan (`mergePreset` turns it into
 * one empty plan) — "Get preset" in the Builder remains the way to the full reco.
 *
 * Pure: the screen fetches the reco and feeds the outfit.
 */
import type { GameData, GearPiece } from "@gear-solver/core";
import { STAT_TO_PRIORITY } from "../statRegistry.js";
import { translateRecoBuild, type RecoFilterPatch, type ResolveEffectKeys, type StructuredCharacterReco } from "../reco/translateReco.js";

/** Priority keys kept at most. */
export const OPTIMIZE_MAX_PRIORITY = 5;

export interface PresetOptimizeInput {
  /** The outfit pieces present in the inventory (`PresetRow.presentPieces`). */
  pieces: readonly GearPiece[];
  /** The reference hero's reco; null when there is none (404, error, offline). */
  reco: StructuredCharacterReco | null;
  game: GameData;
  /** A talisman's family keys (`talismanFamilyKeys(game.equipment)`). */
  talismanFamily: ResolveEffectKeys;
}

export interface PresetOptimize {
  patch: RecoFilterPatch;
  /** The reco build used (the first one), null without a reco. */
  build: string | null;
  /** What was left out or where things come from — shown after the status line. */
  notes: string[];
}

const EFFECT_SLOTS = [
  { slot: "weapon", label: "Weapon" },
  { slot: "accessory", label: "Accessory" },
  { slot: "ooparts", label: "Talisman" },
] as const;

/** Outfit weight of a priority key carried by `count` pieces. */
function outfitWeight(count: number): number {
  if (count >= 4) return 3;
  if (count === 3) return 2;
  if (count === 2) return 1;
  return 0;
}

export function presetOptimizePatch({ pieces, reco, game, talismanFamily }: PresetOptimizeInput): PresetOptimize {
  const notes: string[] = [];

  // Effects: the outfit's own, every one required.
  const picks: Record<"weapon" | "accessory" | "ooparts", Record<string, "required">> = { weapon: {}, accessory: {}, ooparts: {} };
  for (const { slot, label } of EFFECT_SLOTS) {
    const piece = pieces.find((p) => p.slot === slot);
    if (!piece) {
      notes.push(`${label}: not in the outfit — no effect filter.`);
      continue;
    }
    const keys = slot === "ooparts"
      ? talismanFamily(piece.itemId)
      : [game.equipment[String(piece.itemId)]?.setId].filter((k): k is string => !!k);
    if (keys.length === 0) notes.push(`${label}: no unique effect — no effect filter.`);
    for (const key of keys) picks[slot][key] = "required";
  }

  // Reco: the first build, for its mains and substat tiers.
  const names = reco ? Object.keys(reco.builds) : [];
  const build = names[0] ?? null;
  const fromReco = build && reco
    ? translateRecoBuild(reco.builds[build]!, (id) => (id != null ? game.equipment[String(id)]?.setId ?? null : null), talismanFamily)
    : null;
  if (!fromReco) notes.push("No outerpedia reco: substats from the outfit only.");
  else if (names.length > 1) notes.push(`Reco build "${build}" (first of ${names.length} — "Get preset" picks another).`);

  // Outfit: how many pieces roll each priority key (talisman and EE roll none).
  const counts = new Map<string, number>();
  for (const p of pieces) {
    if (p.slot === "ooparts" || p.slot === "exclusive") continue;
    const keys = new Set(p.subs.map((s) => STAT_TO_PRIORITY[s.stat]).filter((k): k is string => !!k));
    for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  const recoPrio = fromReco?.patch.priority ?? {};
  const ranked = [...new Set([...Object.keys(recoPrio), ...counts.keys()])]
    .map((key) => ({
      key,
      weight: Math.max(recoPrio[key] ?? 0, outfitWeight(counts.get(key) ?? 0)),
      inReco: recoPrio[key] != null,
      count: counts.get(key) ?? 0,
    }))
    .filter((e) => e.weight > 0)
    .sort((a, b) => b.weight - a.weight || Number(b.inReco) - Number(a.inReco) || b.count - a.count)
    .slice(0, OPTIMIZE_MAX_PRIORITY);
  const priority = Object.fromEntries(ranked.map((e) => [e.key, e.weight]));

  const mainPicks: RecoFilterPatch["mainPicks"] = {};
  for (const slot of ["weapon", "accessory"] as const) {
    const m = fromReco?.patch.mainPicks[slot];
    if (m) mainPicks[slot] = m;
  }

  return {
    patch: {
      mainPicks,
      weaponEffectPicks: picks.weapon,
      accessoryEffectPicks: picks.accessory,
      talismanEffectPicks: picks.ooparts,
      setPlans: [],
      priority,
    },
    build,
    notes,
  };
}

/** The Builder's status line after "Optimize preset →". */
export function presetOptimizeNote(preset: { num: number; name: string }, r: PresetOptimize): string {
  const n = Object.keys(r.patch.priority).length;
  const source = r.build ? `from the outfit + outerpedia's "${r.build}" reco` : "from the outfit";
  const head = `Optimizing preset #${preset.num} ${preset.name || "Unnamed preset"} — same weapon / accessory / talisman effects required, ${n} priority substat${n === 1 ? "" : "s"} ${source}.`;
  return [head, ...r.notes].join(" ");
}
