/**
 * Home dashboard stats — every number the Home tab shows, derived from the
 * loaded inventory + game data. Pure (no React); `computeStats` is covered by
 * `test/homeSets.test.ts`.
 */
import type { GameData, Inventory } from "@gear-solver/core";
import { SLOTS, STAT, toDesignSlot, type SlotId } from "../design/tokens.js";
import { gearPieceQualityTier, QUALITY_COLOR, type QualityTier } from "./quality.js";

// ── breakdown vocab (raw CET_/CCT_ enums we already get from game data) ─────
// Element colors match the design brief; class bars are a neutral gray.
const ELEMENTS: { id: string; label: string; color: string }[] = [
  { id: "CET_FIRE",  label: "Fire",  color: "#ff6b6b" },
  { id: "CET_WATER", label: "Water", color: "#4dabf7" },
  { id: "CET_EARTH", label: "Earth", color: "#51cf66" },
  { id: "CET_LIGHT", label: "Light", color: "#ffe066" },
  { id: "CET_DARK",  label: "Dark",  color: "#cc5de8" },
];
const CLASSES: { id: string; label: string }[] = [
  { id: "CCT_ATTACKER", label: "Striker" },
  { id: "CCT_RANGER",   label: "Ranger" },
  { id: "CCT_MAGE",     label: "Mage" },
  { id: "CCT_DEFENDER", label: "Defender" },
  { id: "CCT_PRIEST",   label: "Healer" },
];
// Tier colors mirror the Inventory tab's quality filter (QUALITY_COLOR) so the
// two surfaces read identically. `hint` explains each tier's threshold (rolled
// substat ticks vs the achievable max) — surfaced as a per-cell tooltip.
const TIER_META: { tier: QualityTier; label: string; color: string; hint: string }[] = [
  { tier: "poor",      label: "Poor",      color: QUALITY_COLOR.poor,      hint: "Poor — under 50% of the achievable substat rolls." },
  { tier: "decent",    label: "Decent",    color: QUALITY_COLOR.decent,    hint: "Decent — 50 to 69% of the achievable substat rolls." },
  { tier: "good",      label: "Good",      color: QUALITY_COLOR.good,      hint: "Good — 70 to 84% of the achievable substat rolls." },
  { tier: "excellent", label: "Excellent", color: QUALITY_COLOR.excellent, hint: "Excellent — 85 to 99% of the achievable substat rolls." },
  { tier: "perfect",   label: "Perfect",   color: QUALITY_COLOR.perfect,   hint: "Perfect — 100%: every possible substat roll landed." },
];
// Distinct hues cycled across the top owned armor sets (no per-set brand color
// exists, so a tasteful rotation keeps the bars readable).
const SET_COLORS = ["#ff6b6b", "#4dabf7", "#fbbf24", "#51cf66", "#c4b5fd", "#22d3ee", "#cc5de8"];
// The 9 main stats a talisman (ooparts) can roll — fixed pool from the game's
// OOPARTS main-option groups. Order: offense → crit → dmg → utility → defense.
// Each key resolves a label + icon via the STAT tokens.
const TALISMAN_STATS = ["atkPct", "hpPct", "defPct", "critRate", "critDmg", "dmgUp", "dmgReduce", "eff", "effRes"] as const;

export interface HomeStats {
  heroes: number;
  gear: number;
  totalGraded: number;
  tiers: { tier: QualityTier; label: string; color: string; hint: string; count: number; pct: string }[];
  elements: { label: string; color: string; count: number; w: string }[];
  classes: { label: string; count: number; w: string }[];
  stars: { star: number; count: number }[];
  slots: { id: SlotId; label: string; count: number }[];
  sets: { id: string; name: string; icon: string | null; color: string; count: number; w: string }[];
  /** Every armor set that exists in the game (not just owned) — for the
   *  "All sets" grid. `count` is how many owned pieces fall in that set (0 when
   *  none). Sorted by the in-game set id so the grid is stable. */
  allSets: { id: string; name: string; icon: string | null; color: string; count: number }[];
  /** Owned weapons / accessories per class, listed by their unique-option
   *  effect (icon + name + description) rather than a bare count. Both slots
   *  are class-locked in-game; the trailing row (id "universal") collects
   *  unrestricted pieces. */
  classGear: ClassGearRow[];
  /** Talisman (ooparts) cross-tab: rows = talisman types, cols = main stats,
   *  cells = owned count of that type with that main stat. */
  ooparts: {
    cols: { key: string; label: string }[];
    rows: { key: string; name: string; icon: string | null; effect: string; counts: number[]; total: number }[];
    colTotals: number[];
    total: number;
  };
  ascended: number;
  maxed: number;
  locked: number;
}

/** One owned unique-option effect, aggregated across the pieces that carry it.
 *  Reused for owned-set chips too (`color` backs the no-icon swatch). */
export interface EffectChip {
  key: string;
  icon: string | null;
  name: string;
  desc: string;
  count: number;
  color?: string;
}
export interface ClassGearRow {
  id: string;
  label: string;
  weapons: EffectChip[];
  accessories: EffectChip[];
}

/** Strip the in-game `<color=#…>…</color>` rich-text tags so the effect text
 *  reads cleanly inside a native `title` tooltip. */
function stripTags(s: string): string {
  return s.replace(/<\/?color[^>]*>/g, "");
}

/** Read by the Home screen; exported for `homeSets.test.ts` too. */
export function computeStats(inv: Inventory, game: GameData | null): HomeStats {
  const heroes = inv.characters.length;
  const gear = inv.gear.length;

  // Quality distribution — the hero stat. Talisman/EE return null (no rolled
  // subs to grade); they're left out of the graded pool.
  const tierCount = new Map<QualityTier, number>();
  let totalGraded = 0;
  for (const p of inv.gear) {
    const t = gearPieceQualityTier(p);
    if (!t) continue;
    tierCount.set(t, (tierCount.get(t) ?? 0) + 1);
    totalGraded++;
  }
  const tiers = TIER_META.map((m) => {
    const count = tierCount.get(m.tier) ?? 0;
    return { ...m, count, pct: totalGraded > 0 ? `${((count / totalGraded) * 100).toFixed(1)}%` : "—" };
  });

  // Roster — element / class / base-rarity. Resolved from game.characters via
  // the numeric charId. Without game data we can't classify, so these stay 0.
  const elCount = new Map<string, number>();
  const clCount = new Map<string, number>();
  const starCount = new Map<number, number>();
  for (const c of inv.characters) {
    const meta = game?.characters[String(c.charId)];
    if (meta?.element) elCount.set(meta.element, (elCount.get(meta.element) ?? 0) + 1);
    if (meta?.cls) clCount.set(meta.cls, (clCount.get(meta.cls) ?? 0) + 1);
    if (meta?.star != null) starCount.set(meta.star, (starCount.get(meta.star) ?? 0) + 1);
  }
  const maxEl = Math.max(1, ...ELEMENTS.map((e) => elCount.get(e.id) ?? 0));
  const elements = ELEMENTS.map((e) => {
    const count = elCount.get(e.id) ?? 0;
    return { label: e.label, color: e.color, count, w: `${Math.round((count / maxEl) * 100)}%` };
  });
  const maxCl = Math.max(1, ...CLASSES.map((c) => clCount.get(c.id) ?? 0));
  const classes = CLASSES.map((c) => {
    const count = clCount.get(c.id) ?? 0;
    return { label: c.label, count, w: `${Math.round((count / maxCl) * 100)}%` };
  });
  const stars = [...starCount.entries()].map(([star, count]) => ({ star, count })).sort((a, b) => b.star - a.star);

  // Gear — by slot (8 design slots) + owned armor sets + class-locked
  // weapon/accessory split + state counters.
  const slotCount = new Map<SlotId, number>();
  const setCount = new Map<string, number>();
  // The set badge icon lives on the equipment def (armorSetIcon), not the set
  // def — capture the first one seen per set group so the breakdown can show
  // the real in-game set icon instead of a colored swatch.
  const setIcon = new Map<string, string | null>();
  // Numeric `armorSetId` behind each set name — what the Inventory filters on.
  const setIdByName = new Map<string, string>();
  // Weapon / accessory by class, grouped by unique-option effect. We seed the
  // FULL game catalog first (every effect that exists per class/slot, count 0)
  // then overlay owned counts in the gear loop below — so unowned effects still
  // show (dimmed, count 0 in red). Only **class-restricted** weapons/accessories
  // are catalogued; unrestricted ones are skipped. `classLimit` is the raw
  // CCT_* enum (matches the CLASSES ids). Effect maps key on the passive name
  // (see resolveEffect) so identical effects aggregate into one chip.
  const clsEffects = new Map<string, { wpn: Map<string, EffectChip>; acc: Map<string, EffectChip> }>();
  const ensureBucket = (ckey: string) => {
    let b = clsEffects.get(ckey);
    if (!b) { b = { wpn: new Map(), acc: new Map() }; clsEffects.set(ckey, b); }
    return b;
  };
  // Uniqueness is keyed on the passive NAME, not the icon — icons are reused
  // across distinct effects (e.g. "Powerful Strength" borrows an accessory
  // icon), so an icon key would wrongly merge different effects into one chip.
  const resolveEffect = (itemId: number | string): EffectChip => {
    const meta = game?.equipment[String(itemId)];
    const pass = game?.equipmentPassives?.[String(itemId)];
    const icon = meta?.effectIcon ?? null;
    const name = pass?.name ?? meta?.name ?? "Effect";
    const desc = pass?.textByTier?.[0] ? stripTags(pass.textByTier[0]) : "";
    return { key: name, icon, name, desc, count: 0 };
  };
  // Seed the catalog — class-restricted unique-option effects only (need both a
  // classLimit and a real effect icon).
  if (game?.equipment) {
    for (const k in game.equipment) {
      const e = game.equipment[k];
      if (!e?.effectIcon || !e.classLimit) continue;
      const sid = e.slot === "weapon" ? "weapon" : e.slot === "accessory" ? "accessory" : null;
      if (!sid) continue;
      const bucket = ensureBucket(e.classLimit);
      const m = sid === "weapon" ? bucket.wpn : bucket.acc;
      const eff = resolveEffect(k);
      if (!m.has(eff.key)) m.set(eff.key, eff);
    }
  }

  // Talisman cross-tab counts — name → (main-stat key → owned count).
  const talStatSet = new Set<string>(TALISMAN_STATS);
  const talCount = new Map<string, Map<string, number>>();

  let ascended = 0, maxed = 0, locked = 0;
  for (const p of inv.gear) {
    const sid = toDesignSlot(p.slot);
    if (sid) slotCount.set(sid, (slotCount.get(sid) ?? 0) + 1);
    if (sid === "talisman") {
      const name = game?.equipment[String(p.itemId)]?.name ?? `#${p.itemId}`;
      const stat = p.main.find((m) => talStatSet.has(m.stat))?.stat;
      if (stat) {
        let row = talCount.get(name);
        if (!row) { row = new Map(); talCount.set(name, row); }
        row.set(stat, (row.get(stat) ?? 0) + 1);
      }
    }
    if ((sid === "weapon" || sid === "accessory") && p.classLimit) {
      const bucket = ensureBucket(p.classLimit);
      const m = sid === "weapon" ? bucket.wpn : bucket.acc;
      const eff = resolveEffect(p.itemId);
      const ex = m.get(eff.key);
      if (ex) ex.count++;
      else m.set(eff.key, { ...eff, count: 1 });
    }
    if (p.armorSetId) {
      // Key sets by NAME (uniqueness is the set name, not the id/icon).
      const sname = game?.sets?.[p.armorSetId]?.name ?? `Set ${p.armorSetId}`;
      setCount.set(sname, (setCount.get(sname) ?? 0) + 1);
      if (!setIdByName.has(sname)) setIdByName.set(sname, p.armorSetId);
      if (!setIcon.has(sname)) setIcon.set(sname, game?.equipment[String(p.itemId)]?.armorSetIcon ?? null);
    }
    if (p.ascended) ascended++;
    if (p.enhanceLevel >= 15) maxed++;
    if (p.locked) locked++;
  }
  const slots = SLOTS.map((s) => ({ id: s.id, label: s.label, count: slotCount.get(s.id) ?? 0 }));

  // Canonical armor-set catalog — every set that exists in the game (resolved
  // from the equipment table, not just owned pieces), keyed by set NAME so the
  // grid is complete and de-duped by name. `id` is the numeric `armorSetId`:
  // it orders the grid stably and is what an Inventory drill filters on. Falls back to icons seen on owned pieces when game data is absent.
  const setCatalog = new Map<string, { id: string; icon: string | null }>();
  if (game?.equipment) {
    for (const k in game.equipment) {
      const e = game.equipment[k];
      if (!e?.armorSetId) continue;
      const sname = game.sets?.[e.armorSetId]?.name ?? `Set ${e.armorSetId}`;
      if (!setCatalog.has(sname)) setCatalog.set(sname, { id: e.armorSetId, icon: e.armorSetIcon ?? null });
    }
  }
  for (const [sname] of setCount) {
    if (!setCatalog.has(sname)) setCatalog.set(sname, { id: setIdByName.get(sname)!, icon: setIcon.get(sname) ?? null });
  }

  // Overview "Top armor sets" — owned only, by piece count, top 5 with bars.
  const ownedSorted = [...setCount.entries()].sort((a, b) => b[1] - a[1]);
  const maxSet = Math.max(1, ...ownedSorted.map(([, n]) => n));
  const sets = ownedSorted.slice(0, 5).map(([sname, count], i) => ({
    id: setCatalog.get(sname)!.id,
    name: sname,
    icon: setCatalog.get(sname)?.icon ?? null,
    color: SET_COLORS[i % SET_COLORS.length]!,
    count,
    w: `${Math.round((count / maxSet) * 100)}%`,
  }));
  // All-sets grid — the full catalog, owned first (by piece count), unowned
  // last; set id breaks ties so the order is stable.
  const allSets = [...setCatalog.entries()]
    .sort((a, b) => (setCount.get(b[0]) ?? 0) - (setCount.get(a[0]) ?? 0) || Number(a[1].id) - Number(b[1].id))
    .map(([sname, info], i) => ({
      id: info.id,
      name: sname,
      icon: info.icon,
      color: SET_COLORS[i % SET_COLORS.length]!,
      count: setCount.get(sname) ?? 0,
    }));

  // Class rows — the 5 classes in fixed order (class-restricted gear only, no
  // Universal row). Chips: owned effects first (by copies owned), then unowned.
  const mkChips = (m: Map<string, EffectChip> | undefined): EffectChip[] =>
    m ? [...m.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)) : [];
  const classGear: ClassGearRow[] = CLASSES.map((c) => {
    const b = clsEffects.get(c.id);
    return { id: c.id, label: c.label, weapons: mkChips(b?.wpn), accessories: mkChips(b?.acc) };
  });

  // Talisman cross-tab. Rows = the full talisman catalog (every ooparts name in
  // the game, so unowned types still show), columns = the 9 main stats. Owned
  // counts overlaid; rows sorted by total owned, then name. Each row carries the
  // item art (`image`) + its unique-effect NAME (from multiTierPassives) for the
  // icon's hover tooltip.
  const talCatalog = new Map<string, { icon: string | null; effect: string }>();
  if (game?.equipment) {
    for (const k in game.equipment) {
      const e = game.equipment[k];
      if (e?.slot !== "ooparts" || !e.name || talCatalog.has(e.name)) continue;
      talCatalog.set(e.name, { icon: e.image ?? null, effect: game.multiTierPassives?.[k]?.name ?? "" });
    }
  }
  for (const name of talCount.keys()) if (!talCatalog.has(name)) talCatalog.set(name, { icon: null, effect: "" });
  const oopartsCols = TALISMAN_STATS.map((key) => ({ key, label: STAT[key]?.label ?? key }));
  const oopartsRows = [...talCatalog.entries()].map(([name, info]) => {
    const row = talCount.get(name);
    const counts = TALISMAN_STATS.map((s) => row?.get(s) ?? 0);
    return { key: name, name, icon: info.icon, effect: info.effect, counts, total: counts.reduce((a, b) => a + b, 0) };
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const oopartsColTotals = TALISMAN_STATS.map((_, i) => oopartsRows.reduce((a, r) => a + r.counts[i]!, 0));
  const ooparts = {
    cols: oopartsCols,
    rows: oopartsRows,
    colTotals: oopartsColTotals,
    total: oopartsColTotals.reduce((a, b) => a + b, 0),
  };

  return { heroes, gear, totalGraded, tiers, elements, classes, stars, slots, sets, allSets, classGear, ooparts, ascended, maxed, locked };
}
