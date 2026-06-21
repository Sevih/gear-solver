/**
 * Adapter: maps our engine domain model (@gear-solver/core types) into the
 * shape the design components expect. Keeps the design layer free of any
 * engine-specific knowledge.
 */
import type { GameData, GearPiece, RolledStat } from "@gear-solver/core";
import type { IconPiece } from "./EquipmentIcon.js";
import { type SlotId, toDesignRarity, toDesignSlot, STAT } from "./tokens.js";

/** A single substat ready for `SubstatChip` (label + display value + lv). */
export interface UiSubstat {
  stat: string;
  value: string;
  lv: number;
}

export interface UiMainStat {
  /** Compact label like "ATK 1380" or "ATK% 69%". */
  label: string;
  /** Primary stat key (lowercase engine key). */
  stat: string;
  /** Display value as string ("1380" / "69%"). */
  value: string;
}

/** Engine GearPiece → flat shape consumed by the design tree. */
export interface UiPiece {
  id: string;
  itemId: number;
  slot: SlotId | null;
  rarity: ReturnType<typeof toDesignRarity>;
  stars: number;
  /** Effective enhance level (0..15). */
  enhance: number;
  bt: number;
  singularity: boolean;
  name: string;
  /** Concatenated main stats (gear may have 1 or 2; "ATK 1380 / ATK% 69%"). */
  main: UiMainStat[];
  subs: UiSubstat[];
  reforge: { n: number; max: number };
  status: "equipped" | "free";
  locked: boolean;
  equippedBy: string | null;
  /** Image refs threaded from equipment.json — null when the meta lookup misses. */
  image: string | null;
  effectIcon: string | null;
  /** Armor 4-piece set icon filename — set via SetOptionID for armor pieces
   *  (helmet/armor/gloves/boots). Resolved to /img/ui/effect/<setIcon>.webp.
   *  Null on weapons/accessories which use `effectIcon` instead. */
  setIcon: string | null;
  class: string | null;
}

function fmtStat(s: RolledStat): UiMainStat {
  const meta = STAT[s.stat] ?? { label: s.stat.toUpperCase(), color: "#cbd5e1", kind: "util" as const };
  const value = s.percent ? `${s.value}%` : `${s.value}`;
  return { label: `${meta.label} ${value}`, stat: s.stat, value };
}

export function toUiPiece(g: GearPiece, game?: GameData | null): UiPiece {
  const slot = toDesignSlot(g.slot);
  const meta = game?.equipment[String(g.itemId)];
  return {
    id: g.uid,
    itemId: g.itemId,
    slot,
    rarity: toDesignRarity(g.rarity),
    stars: g.star ?? 0,
    enhance: g.enhanceLevel,
    bt: g.breakthrough,
    singularity: g.ascended,
    name: g.name?.trim() || `#${g.itemId}`,
    main: g.main.map(fmtStat),
    subs: g.subs.map((s) => {
      const value = s.percent ? `${s.value}%` : `${s.value}`;
      return { stat: s.stat, value, lv: s.ticks ?? 1 };
    }),
    // Reforge max == star tier (e.g. 6× for 6★ items).
    reforge: { n: g.reforgeCount, max: g.star ?? 0 },
    status: g.equippedBy ? "equipped" : "free",
    locked: g.locked,
    equippedBy: g.equippedBy,
    image: meta?.image ?? null,
    effectIcon: meta?.effectIcon ?? null,
    setIcon: meta?.armorSetIcon ?? null,
    class: meta?.class ?? null,
  };
}

/** Lossy projection to the `IconPiece` shape used by EquipmentIcon/SlotMini. */
export function toIconPiece(p: UiPiece): IconPiece {
  return {
    slot: p.slot ?? "weapon",
    rarity: p.rarity,
    stars: p.stars,
    enhance: p.enhance,
    bt: p.bt,
    singularity: p.singularity,
    reforge: p.reforge.n,
    image: p.image,
    effectIcon: p.effectIcon,
    setIcon: p.setIcon,
    class: p.class,
  };
}
