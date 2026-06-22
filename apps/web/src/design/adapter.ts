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
  /** Pre-computed `IconPiece` projection — pin it on the UiPiece so render
   *  passes can hand a STABLE reference to memo'd `EquipmentIcon`/`SlotMini`.
   *  Computing `toIconPiece(p)` inline in JSX defeats the memo (fresh object
   *  every render), so we materialize it once when the UiPiece is built. */
  iconPiece: IconPiece;
}

function fmtStat(s: RolledStat): UiMainStat {
  const meta = STAT[s.stat] ?? { label: s.stat.toUpperCase(), color: "#cbd5e1", kind: "util" as const };
  const value = s.percent ? `${s.value}%` : `${s.value}`;
  return { label: `${meta.label} ${value}`, stat: s.stat, value };
}

export function toUiPiece(g: GearPiece, game?: GameData | null): UiPiece {
  const slot = toDesignSlot(g.slot);
  const meta = game?.equipment[String(g.itemId)];
  const rarity = toDesignRarity(g.rarity);
  const stars = g.star ?? 0;
  const enhance = g.enhanceLevel;
  const bt = g.breakthrough;
  const singularity = g.ascended;
  const image = meta?.image ?? null;
  const effectIcon = meta?.effectIcon ?? null;
  const setIcon = meta?.armorSetIcon ?? null;
  const cls = meta?.class ?? null;
  return {
    id: g.uid,
    itemId: g.itemId,
    slot,
    rarity, stars, enhance, bt, singularity,
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
    image, effectIcon, setIcon, class: cls,
    iconPiece: {
      slot: slot ?? "weapon",
      rarity, stars, enhance, bt, singularity,
      reforge: g.reforgeCount,
      image, effectIcon, setIcon, class: cls,
    },
  };
}

/** @deprecated Use `piece.iconPiece` directly — kept for the rare callers
 *  that still construct ad-hoc IconPieces. The cached `iconPiece` on UiPiece
 *  is referentially stable across renders so it activates `memo` on the
 *  consuming icon components. */
export function toIconPiece(p: UiPiece): IconPiece {
  return p.iconPiece;
}
