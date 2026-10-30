/**
 * Scrap value of a set of pieces — what selling or dissolving them would
 * return in-game, from `equipment.json`'s scrap fields (outerpedia G73).
 * Information only: the Inventory's Scrap value card shows it (the selected
 * pieces, else the filtered view), nothing acts on it.
 *
 * Eligibility mirrors the client's "Item clear" screen:
 *   - sell     = `CanSell && EnchantExp == 0 && CharacterUID <= 0 && !IsLock`
 *   - dissolve = `CanDissolve && CharacterUID <= 0 && !IsLock`
 * An enhanced piece therefore never sells but still dissolves, and then also
 * refunds part of its enhancement materials — the tables don't carry that
 * refund, so it is counted (`enhancedCount`), not estimated.
 */
import type { EquipmentTable, ItemsTable } from "@gear-solver/core";
import type { UiPiece } from "../../design/adapter.js";
import { itemLabel } from "../../data.js";

/** The slice of a piece the scrap rules read. `enhance` stands in for
 *  `EnchantExp`: the captured piece carries its level, not its raw Exp. */
export type ScrapPiece = Pick<UiPiece, "itemId" | "locked" | "equippedBy" | "enhance">;

export interface ScrapRange {
  min: number;
  max: number;
}

export interface ScrapMaterial extends ScrapRange {
  /** Item id (`game.items`), or the asset type for a non-gold asset. */
  id: string;
  name: string;
}

export interface ScrapValue {
  sell: { count: number; gold: number };
  dissolve: {
    count: number;
    gold: ScrapRange;
    /** Materials by id, min and max summed separately, in first-seen order. */
    items: ScrapMaterial[];
    /** Dissolvable pieces that are enhanced: their refund is not counted. */
    enhancedCount: number;
  };
  /** Pieces whose equipment entry is missing or predates the scrap fields. */
  unknown: number;
}

const AT_GOLD = "AT_GOLD";

/** True when the synced `equipment.json` carries the scrap fields at all — a
 *  table synced before them shows no scrap line. */
export function hasScrapFields(equipment: EquipmentTable | null | undefined): boolean {
  if (!equipment) return false;
  for (const id in equipment) {
    if (typeof equipment[id]?.canSell === "boolean") return true;
  }
  return false;
}

export function scrapValue(
  pieces: readonly ScrapPiece[],
  equipment: EquipmentTable,
  items: ItemsTable | null | undefined,
): ScrapValue {
  const sell = { count: 0, gold: 0 };
  const gold: ScrapRange = { min: 0, max: 0 };
  const mats = new Map<string, ScrapMaterial>();
  let dissolveCount = 0;
  let enhancedCount = 0;
  let unknown = 0;

  const addMat = (id: string, name: string, min: number, max: number) => {
    const cur = mats.get(id);
    if (cur) { cur.min += min; cur.max += max; }
    else mats.set(id, { id, name, min, max });
  };

  for (const p of pieces) {
    const def = equipment[String(p.itemId)];
    if (!def || typeof def.canSell !== "boolean" || typeof def.canDissolve !== "boolean") {
      unknown++;
      continue;
    }
    const free = !p.equippedBy && !p.locked;
    if (!free) continue;
    if (def.canSell && p.enhance === 0) {
      sell.count++;
      sell.gold += def.sellPrice ?? 0;
    }
    if (def.canDissolve) {
      dissolveCount++;
      if (p.enhance > 0) enhancedCount++;
      for (const a of def.dissolve?.assets ?? []) {
        if (a.type === AT_GOLD) { gold.min += a.min; gold.max += a.max; }
        else addMat(a.type, a.type, a.min, a.max);
      }
      for (const it of def.dissolve?.items ?? []) {
        addMat(it.id, itemLabel(items ? { items } : null, it.id), it.min, it.max);
      }
    }
  }

  return {
    sell,
    dissolve: { count: dissolveCount, gold, items: [...mats.values()], enhancedCount },
    unknown,
  };
}

/** Thousands separated by a narrow no-break space (U+202F), no locale. */
export function formatGold(n: number): string {
  const s = String(Math.round(Math.abs(n)));
  const grouped = s.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return n < 0 ? `-${grouped}` : grouped;
}

/** `a` when min == max, `a–b` otherwise. */
export function formatRange(r: ScrapRange, fmt: (n: number) => string = formatGold): string {
  return r.min === r.max ? fmt(r.min) : `${fmt(r.min)}–${fmt(r.max)}`;
}
