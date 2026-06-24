/**
 * Adapter: maps our engine domain model (@gear-solver/core types) into the
 * shape the design components expect. Keeps the design layer free of any
 * engine-specific knowledge.
 */
import { resolveOption } from "@gear-solver/core";
import type { GameData, GearPiece, RolledStat } from "@gear-solver/core";
import type { IconPiece } from "./EquipmentIcon.js";
import { type SlotId, toDesignRarity, toDesignSlot, STAT } from "./tokens.js";

/** Talisman / EE 5th gem slot unlocks once the piece's enhance level
 *  reaches this threshold (matches the in-game gating). */
const GEM_FIFTH_SLOT_UNLOCK = 5;

/** A single substat ready for `SubstatChip` (label + display value + lv). */
export interface UiSubstat {
  stat: string;
  value: string;
  /** Total ticks accumulated on this sub (initial roll + every reforge proc). */
  lv: number;
  /** Ticks that came from reforges (`Level - BaseLevel` in the captured
   *  item). 0 when the sub hasn't been touched by any reforge proc. */
  reforges: number;
}

export interface UiMainStat {
  /** Compact label like "ATK 1380" or "ATK% 69%". */
  label: string;
  /** Primary stat key (lowercase engine key). */
  stat: string;
  /** Display value as string ("1380" / "69%"). */
  value: string;
  /** True when the value is a percentage (drives the trailing "%" in the
   *  detail panel's value column). */
  percent: boolean;
  /** In-game-style narrative label resolved at build time — currently set
   *  for EE conditional mains ("DMG Increase vs Water", "Gains AP when
   *  hit", …). UI renders this instead of the synthesized `statLong`
   *  label when present. */
  name: string | null;
}

/** A resolved buff-shaped effect that lives on a gear piece - Singularity
 *  Ascension passive (weapons/accessories/armor) or EE permanent passive
 *  (exclusive equipment). The engine bakes these into `GearPiece.main`
 *  with `fromBuff: true`; the adapter pulls them out into this dedicated
 *  bucket so the detail panel can render them in their own section.
 *  `name` carries the in-game narrative label (e.g. "DMG Increase to target")
 *  when one was resolved at build time — null otherwise. `combatOnly` flags
 *  the effects that don't apply to the character sheet (the UI can show a
 *  "combat only" hint without changing the math). */
export interface UiEffect {
  stat: string;
  value: string;
  percent: boolean;
  name: string | null;
  /** Rich-text in-game description with `<color=#hex>…</color>` tags
   *  preserved — UI renders via `GameText`. Null when none is available
   *  (most non-Singularity buff-shaped rolls). */
  desc: string | null;
  combatOnly: boolean;
}

/** Base unique-option passive on a weapon / accessory ("Destruction",
 *  "Aurora", …). Resolved at build time from
 *  `equipmentPassives[itemId].textByTier[bt]` — `text` is the fully
 *  substituted English string for the piece's current breakthrough tier;
 *  `name` is the canonical effect title. Null on items without a unique
 *  passive (most armor / talismans). */
export interface UiPassive {
  name: string | null;
  text: string;
}

/** Multi-tier passive on a talisman / EE — base tier (always active when
 *  equipped) + optional `+10 unlock` upgrade. Each tier carries its
 *  own resolved description and the `active` flag (true once the piece's
 *  enhance level reaches `unlockLevel`) so the UI can grey out
 *  not-yet-unlocked tiers without recomputing. */
export interface UiMultiTierPassiveTier {
  unlockLevel: number;
  isAdd: boolean;
  desc: string;
  active: boolean;
}
export interface UiMultiTierPassive {
  name: string | null;
  tiers: UiMultiTierPassiveTier[];
}

/** One of the 5 gem slots on a talisman / EE. Slots are returned in raw
 *  in-game order (index 0..4 = slot 1..5). The 5th slot (index 4) is
 *  gated by the piece's enhance level (>= 5 in-game) — `unlocked: false`
 *  on locked slots so the UI can render a lock badge. Empty (no gem
 *  equipped) → `gem: null` regardless of unlock state. */
export interface UiGemSlot {
  unlocked: boolean;
  gem: {
    type: string;     // image fragment: /img/items/TI_GEM_<type>_<level>.webp
    level: number;    // 1..6
    stat: string;     // resolved engine key (atk, critRate, …)
    percent: boolean;
    /** Displayed value e.g. "40" or "30" — UI prepends sign + "%". */
    value: number;
  } | null;
}

/** Engine GearPiece → flat shape consumed by the design tree. */
export interface UiPiece {
  id: string;
  itemId: number;
  slot: SlotId | null;
  /** Engine setId (lookup key into `game.sets`). Used by the detail panel to
   *  resolve the set name + per-star p2/p4 effects. */
  setId: string | null;
  /** Armor 4-piece set id (helmet/armor/gloves/boots). Same lookup story. */
  armorSetId: string | null;
  rarity: ReturnType<typeof toDesignRarity>;
  /** Class restriction display name (Striker / Mage / Ranger / Defender /
   *  Healer). Resolved from the raw `CCT_*` enum on the engine's GearPiece
   *  via the equipment meta's pre-mapped `class` field — keeps the engine's
   *  raw enum off the UI. Null when the item has no class restriction. */
  classLimit: string | null;
  stars: number;
  /** Effective enhance level (0..15). */
  enhance: number;
  bt: number;
  singularity: boolean;
  name: string;
  /** Gear's own main rolls (`fromBuff: false`). Weapons / accessories have 1-2 entries,
   *  armor / talismans typically 1. The Singularity passive + EE passives are NOT
   *  here - they're in `effects` below. */
  main: UiMainStat[];
  subs: UiSubstat[];
  /** Resolved Singularity / EE passive effects (engine entries with
   *  `fromBuff: true`). Empty array on non-ascended weapons / armor / etc. */
  effects: UiEffect[];
  /** Base unique-option passive resolved for the piece's current breakthrough
   *  tier — null when the item has no unique passive (most armor pieces). */
  passive: UiPassive | null;
  /** Multi-tier passive (talisman / EE). Null when the item has no
   *  multi-tier passive (every non-talisman / non-EE slot). */
  multiTierPassive: UiMultiTierPassive | null;
  /** Talisman / EE only — always 5 entries (slot 1..5). Null on other
   *  gear (regular subs render via `subs`). */
  gemSlots: UiGemSlot[] | null;
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
  return {
    label: `${meta.label} ${value}`,
    stat: s.stat,
    value,
    percent: s.percent,
    name: s.name ?? null,
  };
}

function fmtEffect(s: RolledStat): UiEffect {
  const value = s.percent ? `${s.value}%` : `${s.value}`;
  return {
    stat: s.stat,
    value,
    percent: s.percent,
    name: s.name ?? null,
    desc: s.desc ?? null,
    combatOnly: s.combatOnly ?? false,
  };
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
  // Split `g.main` into display buckets via the `source` provenance tag
  // (set by parse.ts at each push site):
  //   - "option" / undefined → real main slot from OptionList (includes
  //     talisman/EE IOT_BUFF mains alongside regular IOT_STAT rolls)
  //   - "singularity"        → Singularity-ascension roll → effects bucket
  //   - "eePassive"          → EE level-gated stat passive → DROPPED from
  //     the UI: the narrative is already covered by `multiTierPassive`
  //     (same lv0 effect rendered twice would look like a bug). The math
  //     contribution is preserved in `g.main` for stat compose; only the
  //     display layer skips it.
  const realMain: UiMainStat[] = [];
  const effects: UiEffect[] = [];
  for (const r of g.main) {
    const src = r.source ?? "option";
    if (src === "option") realMain.push(fmtStat(r));
    else if (src === "singularity") effects.push(fmtEffect(r));
    // "eePassive" intentionally dropped — multiTierPassive owns the display.
  }
  // Resolve the per-piece unique-option passive for the current breakthrough
  // tier. `bt` (0..4) indexes directly into `textByTier` — the build pipeline
  // already substituted the placeholders per-tier. Most armor / talismans
  // have no entry and surface `passive: null`.
  const passiveDef = game?.equipmentPassives?.[String(g.itemId)];
  const passiveText = passiveDef?.textByTier?.[Math.min(bt, (passiveDef.textByTier.length || 1) - 1)] ?? null;
  const passive: UiPassive | null = passiveDef && passiveText
    ? { name: passiveDef.name, text: passiveText }
    : null;
  // Multi-tier passive (talisman / EE). Each tier is flagged `active` based
  // on the piece's enhance level vs `unlockLevel` — the UI greys out
  // not-yet-unlocked tiers without needing to recompute.
  // Gem slots — talisman / EE only. Walk the 5 raw OptionIDs (preserved at
  // slot position by parse.ts) and resolve each non-zero one via the gems
  // table. Slot 4 (5th) is locked until enhance reaches GEM_FIFTH_SLOT_UNLOCK.
  const gemSlots: UiGemSlot[] | null = g.gemSlots
    ? g.gemSlots.map((oid, i) => {
        const unlocked = i < 4 || enhance >= GEM_FIFTH_SLOT_UNLOCK;
        if (!oid || !game?.gems) return { unlocked, gem: null };
        const def = game.gems[String(oid)];
        if (!def) return { unlocked, gem: null };
        const resolved = resolveOption(def, 1);
        if (!resolved) return { unlocked, gem: null };
        return {
          unlocked,
          gem: {
            type: def.type,
            level: def.level,
            stat: resolved.stat,
            percent: resolved.percent,
            value: resolved.value,
          },
        };
      })
    : null;

  const multiTierDef = game?.multiTierPassives?.[String(g.itemId)];
  const multiTierPassive: UiMultiTierPassive | null = multiTierDef && multiTierDef.tiers.length > 0
    ? {
        name: multiTierDef.name,
        tiers: multiTierDef.tiers.map((t) => ({
          unlockLevel: t.unlockLevel,
          isAdd: t.isAdd,
          desc: t.desc,
          active: t.unlockLevel <= 1 || enhance >= t.unlockLevel,
        })),
      }
    : null;
  return {
    id: g.uid,
    itemId: g.itemId,
    slot,
    setId: g.setId,
    armorSetId: g.armorSetId,
    rarity, stars, enhance, bt, singularity,
    classLimit: g.classLimit ? cls : null,
    name: g.name?.trim() || `#${g.itemId}`,
    main: realMain,
    subs: g.subs.map((s) => {
      const value = s.percent ? `${s.value}%` : `${s.value}`;
      return {
        stat: s.stat,
        value,
        lv: s.ticks ?? 1,
        reforges: s.reforgeTicks ?? 0,
      };
    }),
    effects,
    passive,
    multiTierPassive,
    gemSlots,
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
