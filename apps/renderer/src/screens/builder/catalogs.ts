/**
 * Builder catalogs — inventory-driven armor-set, effect and main-stat lists
 * the toolbar panels render.
 */
import type { GameData, Inventory } from "@gear-solver/core";
import { toDesignSlot, type SlotId } from "../../design/tokens.js";
import { STAT_DISPLAY_ORDER, statLabelFor } from "./statColumns.js";

/* ─────────────────────────────────────────────────────────────────────────
 * Game-data extraction — turns the raw equipment / sets tables into the
 * compact {name, icon} lists the Sets and Weapons/Accessories panels render.
 * ───────────────────────────────────────────────────────────────────────── */
export interface ArmorSetEntry {
  id: string;
  name: string;
  icon: string;
  /** Whether the set's T4 row (`level === 2`) defines a 2-piece effect. */
  has2pc: boolean;
  /** Whether the set's T4 row defines a 4-piece effect. Some sets carry
   *  only one of (2pc, 4pc) — the chip cycle skips the missing one. */
  has4pc: boolean;
  /** Whether the inventory can actually form a 2-piece bonus: ≥ 2 owned
   *  pieces spread across ≥ 2 distinct armor slots. A single slot with 2+
   *  duplicates doesn't trigger the in-game 2pc bonus. */
  canForm2pc: boolean;
  /** Whether the inventory can form a 4-piece bonus: ≥ 4 owned pieces
   *  spread across 4 distinct armor slots (helmet + armor + gloves + boots). */
  canForm4pc: boolean;
  /** Number of owned armor pieces belonging to this set. */
  owned: number;
  /** Localized T4 effect descriptions (`SetLevel.p2_desc / p4_desc`).
   *  Null when no curated string exists — chip tooltip falls back to
   *  the bare "no description" marker. */
  desc2pc: string | null;
  desc4pc: string | null;
}
export interface EffectEntry {
  /** Unique effect identity = `EquipmentDef.setId` (the game's UniqueOptionID).
   *  This is the filter/dedup key — NOT the icon. Several distinct effects
   *  (e.g. the five Recklessness variants) share one icon, so keying on the
   *  icon collapsed them into one chip and the filter matched all five. */
  key: string;
  /** Icon filename for display only — `/img/ui/effect/<icon>.webp`. May be
   *  shared across different effects; never used as an identity. Null when the
   *  effect has no curated icon (→ the chip shows a text placeholder). */
  icon: string | null;
  /** Effect display name — pulled from `game.equipmentPassives[itemId].name`
   *  (the canonical effect title like "Destruction"), with a fallback to
   *  the equipment item name and finally the effect key. */
  name: string;
  /** Localized T4 effect description (`textByTier[4]`). Same passive applies
   *  to every item sharing this `key` (same UniqueOptionID), so any sample is
   *  canonical. Null when no passive is resolved (data gap). */
  descT4: string | null;
  /** Number of owned weapons / accessories rolling this effect (≥ 1). */
  owned: number;
}
export interface MainStatEntry {
  /** Engine stat key from `RolledStat.stat` (e.g. "atkPct", "eff"). Stable
   *  identity for `picks` keying. */
  key: string;
  /** User-facing short label ("ATK%", "EFF", …) — `statLabelFor(key)`. */
  label: string;
  /** Number of owned pieces in this slot whose main matches `key`. */
  owned: number;
}

/** Build the armor-set palette — keep only sets whose currently-owned
 *  pieces can ACTUALLY trigger at least one of the set's T4 bonuses. A
 *  set is dropped when:
 *   - it grants only a 4pc bonus and the inventory has < 4 pieces across
 *     4 distinct slots, OR
 *   - it grants only a 2pc bonus and the inventory has < 2 pieces across
 *     2 distinct slots, OR
 *   - it grants both and neither threshold is reachable.
 *  Icons resolve via the first equipment template carrying each `armorSetId`
 *  (same map the Inventory tab uses). T4 = `setLevel === 2` in the schema. */
export function armorSetCatalogFromInventory(inventory: Inventory | null, game: GameData | null): ArmorSetEntry[] {
  if (!game || !inventory) return [];
  const iconBySet = new Map<string, string>();
  for (const e of Object.values(game.equipment)) {
    if (!e.armorSetId || !e.armorSetIcon) continue;
    if (!iconBySet.has(e.armorSetId)) iconBySet.set(e.armorSetId, e.armorSetIcon);
  }
  // Per-set: total owned pieces + distinct armor slots represented. The
  // distinct-slot count is what gates 2pc / 4pc viability (two pieces in
  // the same slot don't trigger 2pc in-game).
  const slotsBySet = new Map<string, Set<string>>();
  const ownedCounts = new Map<string, number>();
  for (const g of inventory.gear) {
    if (!g.armorSetId || !g.slot) continue;
    ownedCounts.set(g.armorSetId, (ownedCounts.get(g.armorSetId) ?? 0) + 1);
    let slots = slotsBySet.get(g.armorSetId);
    if (!slots) { slots = new Set(); slotsBySet.set(g.armorSetId, slots); }
    slots.add(g.slot);
  }
  const out: ArmorSetEntry[] = [];
  for (const [id, def] of Object.entries(game.sets)) {
    const owned = ownedCounts.get(id) ?? 0;
    if (owned === 0) continue;
    const icon = iconBySet.get(id);
    if (!icon) continue;
    const t4 = def.levels.find((l) => l.level === 2);
    // A bonus "exists" when it has a flat-stat entry OR a description. Some sets'
    // bonuses are conditional combat effects with NO stat entry (Revenge "ATK
    // proportional to missing HP", Patience, Fortification, Swiftness, Immunity's
    // 2pc) — p2/p4 is null / ST_NONE but pX_desc carries the real in-game bonus.
    // Gating on the stat alone dropped those sets from the palette entirely, so
    // a player owning Revenge pieces couldn't require the set. Desc presence
    // mirrors the game's actual bonus tiers (Revenge: p2_desc null / p4_desc set
    // = "requires at least 4 pieces"). Such a requirement constrains the search
    // without moving stats/CP — correct, the effect is combat-conditional.
    const has2pc = !!(t4?.p2 && t4.p2.st !== "ST_NONE" && t4.p2.v != null) || t4?.p2_desc != null;
    const has4pc = !!(t4?.p4 && t4.p4.st !== "ST_NONE" && t4.p4.v != null) || t4?.p4_desc != null;
    const distinctSlots = slotsBySet.get(id)?.size ?? 0;
    const canForm2pc = owned >= 2 && distinctSlots >= 2;
    const canForm4pc = owned >= 4 && distinctSlots >= 4;
    // Drop sets where no achievable bonus exists.
    const usable2pc = has2pc && canForm2pc;
    const usable4pc = has4pc && canForm4pc;
    if (!usable2pc && !usable4pc) continue;
    out.push({
      id, name: def.name ?? `Set ${id}`, icon,
      has2pc, has4pc, canForm2pc, canForm4pc, owned,
      desc2pc: t4?.p2_desc ?? null,
      desc4pc: t4?.p4_desc ?? null,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Build the per-slot effect palette — only effects the player actually
 *  owns a piece for, gated by the picked hero's class restriction. The
 *  chip's identity is the effect (`setId` = UniqueOptionID); it shows the
 *  effect icon, the one the gear renderer overlays on equipped pieces. */
export function effectCatalogFromInventory(
  inventory: Inventory | null,
  game: GameData | null,
  slot: "weapon" | "accessory" | "talisman",
  heroClass: string | null,
): EffectEntry[] {
  if (!game || !inventory) return [];
  // Key on the effect IDENTITY (`setId` = UniqueOptionID), not the icon — the
  // icon is shared across distinct effects (the Recklessness family), so icon-
  // keying collapsed five effects into one chip. Store the icon for display.
  const map = new Map<string, { icon: string | null; name: string; descT4: string | null; owned: number }>();
  for (const g of inventory.gear) {
    // Use the design SlotId so the comparison is symmetric with the rest
    // of the panels (weapon/accessory happen to match the engine name 1:1
    // but going through `toDesignSlot` is the cheapest insurance against
    // future slot renames).
    if (toDesignSlot(g.slot) !== slot) continue;
    if (heroClass && g.classLimit && g.classLimit !== heroClass) continue;
    const def = game.equipment[String(g.itemId)];
    if (!def?.setId) continue; // no unique-option effect → not filterable
    const existing = map.get(def.setId);
    if (existing) { existing.owned++; continue; }
    // First-seen effect: snapshot its title + T4 text from this item's passive.
    // Items sharing a `setId` (UniqueOptionID) carry the same passive, so a
    // single sample is canonical. textByTier[4] = T4 (build pipeline already
    // substituted Value/Rate/Turn placeholders).
    const passive = game.equipmentPassives[String(g.itemId)];
    const name = passive?.name ?? def.name ?? def.setId;
    const descT4 = passive?.textByTier?.[4] ?? null;
    map.set(def.setId, { icon: def.effectIcon ?? null, name, descT4, owned: 1 });
  }
  return Array.from(map.entries())
    .map(([key, { icon, name, descT4, owned }]) => ({ key, icon, name, descT4, owned }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Per-slot main-stat catalog — scan owned pieces in `slot`, collect every
 *  distinct main-stat engine key with an owned count, render in the global
 *  `STAT_DISPLAY_ORDER` for stable column alignment across slots. Anything
 *  unrecognized (future exotic talisman / EE buffs) lands at the end with a
 *  fallback label so we don't drop data we don't know about yet.
 *
 *  Two heuristics keep the palette useful:
 *  1. Only count mains tagged `source: "option"` — the real main slot.
 *     `singularity` rolls (ascension extras like "+DMG up" on a weapon) and
 *     `eePassive` rolls are effects, not main-stat configurations the user
 *     picks when crafting, so they don't belong here.
 *  2. Drop stats present on **every** owned piece in the slot — flat ATK on
 *     weapons, for instance: filtering by it would do nothing (every piece
 *     matches), so the chip is just visual noise. */
export function mainStatCatalogFromInventory(
  inventory: Inventory | null,
  slot: SlotId,
  heroClass: string | null,
): MainStatEntry[] {
  if (!inventory) return [];
  const counts = new Map<string, number>();
  let total = 0;
  for (const g of inventory.gear) {
    // GearPiece.slot is the engine GearSlot (e.g. "ooparts"); the design
    // SlotId we filter on uses friendlier names ("talisman"). Convert via
    // toDesignSlot so the comparison lines up.
    if (toDesignSlot(g.slot) !== slot) continue;
    if (heroClass && g.classLimit && g.classLimit !== heroClass) continue;
    total++;
    // Dedup per piece — a single piece can list the same stat multiple times
    // across its main rolls (e.g. weapons that buff ATK% twice). Counts here
    // measure "how many pieces have this stat", not "how many rolls".
    const seenInPiece = new Set<string>();
    for (const m of g.main) {
      if (m.combatOnly) continue;
      const src = m.source ?? "option";
      if (src !== "option") continue;
      if (seenInPiece.has(m.stat)) continue;
      seenInPiece.add(m.stat);
      counts.set(m.stat, (counts.get(m.stat) ?? 0) + 1);
    }
  }
  const seen = new Set<string>();
  const out: MainStatEntry[] = [];
  // 1) Known keys in canonical order — drop ubiquitous stats (every piece
  //    has them → filtering useless).
  for (const key of STAT_DISPLAY_ORDER) {
    const owned = counts.get(key);
    if (!owned || owned >= total) continue;
    seen.add(key);
    out.push({ key, label: statLabelFor(key), owned });
  }
  // 2) Anything not in STAT_DISPLAY_ORDER (defensive — surfaces unknowns
  //    instead of silently dropping them).
  for (const [key, owned] of counts) {
    if (seen.has(key)) continue;
    if (owned >= total) continue;
    out.push({ key, label: statLabelFor(key), owned });
  }
  return out;
}
