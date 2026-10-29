/**
 * Inventory filter + tab state — the filter shape, its session codec, the
 * sub-tab slot groups and the matching predicates.
 */
import { jsonWithSets } from "../../hooks/usePersistedState.js";
import { STAT, type DesignRarity, type SlotId } from "../../design/tokens.js";
import type { UiPiece } from "../../design/adapter.js";
import { qualityTierFromScore, type QualityTier } from "../../lib/quality.js";
import { baseStage } from "../../lib/solver/reroll.js";

// Gear-rollable stat keys — everything in `STAT` minus the three set-only
// stats (lifesteal / counter / enterAp) which never appear as a piece's
// main or sub, and the combat-only EE main `avoid` (never a main filter nor
// a sub sort). Used to populate the Main / Sub filter pill lists and the
// "sort by sub" dropdown.
export const GEAR_STATS: string[] = Object.keys(STAT).filter(
  (k) => k !== "lifesteal" && k !== "counter" && k !== "enterAp" && k !== "avoid",
);

// ── filter state ────────────────────────────────────────────────────────
export interface FilterState {
  slots: Set<SlotId>;
  rarities: Set<DesignRarity>;
  stars: Set<number>;
  quality: Set<QualityTier>;
  /** Reachable quality tiers — OR semantics on `reachableTier` (the tier with
   *  the Transistone potential, the current one without). */
  reachable: Set<QualityTier>;
  /** Selected main-stat keys — OR semantics (a piece passes if any of its
   *  mains is in the set). Mains only ever have AND-impossible single-stat
   *  semantics for gear (helmet has 1 main); talismans/EE expose multiple
   *  mains but those still read better as OR (player asks "which pieces
   *  give me HP% OR ATK%"). */
  mains: Set<string>;
  /** Selected sub-stat keys + the operator that joins them. OR matches if
   *  ANY listed sub is on the piece; AND requires ALL listed subs. */
  subs: Set<string>;
  subMode: "or" | "and";
  /** Selected armor 4-pc set IDs — OR semantics. Only matches armor pieces
   *  that belong to one of the listed sets. */
  armorSets: Set<string>;
  /** Class-restricted pieces only — pills hold display class names
   *  ("Striker", "Mage", "Ranger", "Defender", "Healer"). OR semantics.
   *  Pieces without a classLimit (the vast majority of generic gear) fail
   *  this filter the moment any chip is active. */
  classes: Set<string>;
  /** Equipped-piece visibility. `true` (default) shows them; `false` hides
   *  them — exposed in the modal as an "Exclude equipped gear" checkbox
   *  (inverted polarity to match the in-game wording). */
  showEquipped: boolean;
  /** "+0 only" — enhance level 0. */
  enhanceZero: boolean;
  /** "T0 only" — no breakthrough (`bt === 0`). */
  breakthroughZero: boolean;
  /** "Not reforged" — no reforge proc spent (`reforge.n === 0`). */
  notReforged: boolean;
  /** Base rolls pattern — the base stages of the piece's sub lines sorted
   *  best first, padded with 0 to 4 lines, compared line by line to `lines`
   *  with `op`: every line must satisfy `stage <op> value`, a `null` line
   *  (X) is free, `not` inverts the result. Four `null` lines = inactive.
   *  Talisman / EE (no rolled subs) fail an active pattern, inverted or not. */
  baseRolls: BaseRollsFilter;
  singularityOnly: boolean;
  query: string;
}

export type BaseRollsOp = "gte" | "gt" | "eq" | "lte" | "lt";
/** A base tier 0..4, or `null` = X (any). */
export type BaseRollsLine = number | null;
export interface BaseRollsFilter {
  op: BaseRollsOp;
  lines: [BaseRollsLine, BaseRollsLine, BaseRollsLine, BaseRollsLine];
  /** Inverts the pattern: the piece passes when it does NOT match it. */
  not: boolean;
}

export function emptyFilters(): FilterState {
  return {
    slots: new Set(),
    rarities: new Set(),
    stars: new Set(),
    quality: new Set(),
    reachable: new Set(),
    mains: new Set(),
    subs: new Set(),
    subMode: "or",
    armorSets: new Set(),
    classes: new Set(),
    showEquipped: true,
    enhanceZero: false,
    breakthroughZero: false,
    notReforged: false,
    baseRolls: { op: "gte", lines: [null, null, null, null], not: false },
    singularityOnly: false,
    query: "",
  };
}

// Persistence codec for the inventory filter shape — wraps the Set<>-typed
// fields so they survive a JSON round-trip via sessionStorage
// (`useSessionState`). The deserializer overlays stored values on top of
// `emptyFilters()` so older sessions missing newer non-Set fields (e.g.
// `subMode`) get the current defaults instead of undefined.
const _setCodec = jsonWithSets<FilterState>(["slots", "rarities", "stars", "quality", "reachable", "mains", "subs", "armorSets", "classes"]);
export const FILTER_CODEC = {
  serialize: _setCodec.serialize,
  deserialize: (raw: string): FilterState => {
    const parsed = _setCodec.deserialize!(raw) as Partial<FilterState>;
    // Drop undefined entries so spread doesn't reintroduce them and unset
    // the default for fields the storage simply didn't have at the time.
    const clean = Object.fromEntries(
      Object.entries(parsed).filter(([, v]) => v !== undefined),
    ) as Partial<FilterState>;
    const out = { ...emptyFilters(), ...clean };
    out.baseRolls = readBaseRolls(clean.baseRolls);
    return out;
  },
};

/** The stored Base rolls filter, current shape or G62's `{ min, mode }`
 *  (`atLeast` → `gte`, `below` → `lt`, a 0 minimum → X). A missing `not`
 *  reads false. Anything else reads the inactive default. */
function readBaseRolls(raw: unknown): BaseRollsFilter {
  const fallback = emptyFilters().baseRolls;
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as { op?: unknown; lines?: unknown; not?: unknown; min?: unknown; mode?: unknown };
  const ops: BaseRollsOp[] = ["gte", "gt", "eq", "lte", "lt"];
  const tier = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 4;
  if (typeof r.op === "string" && ops.includes(r.op as BaseRollsOp) && Array.isArray(r.lines) && r.lines.length === 4) {
    return {
      op: r.op as BaseRollsOp,
      lines: r.lines.map((v) => (tier(v) ? v : null)) as BaseRollsFilter["lines"],
      not: r.not === true,
    };
  }
  if ((r.mode === "atLeast" || r.mode === "below") && Array.isArray(r.min) && r.min.length === 4) {
    return {
      op: r.mode === "atLeast" ? "gte" : "lt",
      lines: r.min.map((v) => (tier(v) && v > 0 ? v : null)) as BaseRollsFilter["lines"],
      not: false,
    };
  }
  return fallback;
}
export const FILTERS_STORAGE_KEY = "gs.inv.filters.v3";

// ── tab state ──────────────────────────────────────────────────────────
// Three coarse buckets surfaced as sub-tabs above the grid. "Gear" covers
// the rolled-substat slots (the gear-solver's bread and butter); "Special
// Gear" isolates the gem-bearing slots (talisman + EE) whose detail view is
// fundamentally different (gems vs subs, no Quality score, multi-tier
// passives). "All" stays as a no-filter escape hatch.
export type InvTab = "all" | "gear" | "special";
export const TAB_SLOTS: Record<InvTab, SlotId[]> = {
  all:     ["weapon", "accessory", "helmet", "armor", "gloves", "boots", "exclusive", "talisman"],
  gear:    ["weapon", "accessory", "helmet", "armor", "gloves", "boots"],
  special: ["exclusive", "talisman"],
};
export function matchesTab(p: UiPiece, tab: InvTab): boolean {
  if (tab === "all") return true;
  if (!p.slot) return false;
  return TAB_SLOTS[tab].includes(p.slot);
}

/** Base stages of the piece's sub lines, best first, padded with 0 to 4
 *  lines — before reforge (`baseStage`, the Transistone's notion) and
 *  enhancement. Talisman / EE carry gems, no rolled subs: 0/0/0/0. */
export function baseRollPattern(p: UiPiece): number[] {
  const stages = p.subs.map((s) => baseStage({ ticks: s.lv, reforgeTicks: s.reforges })).sort((a, b) => b - a).slice(0, 4);
  while (stages.length < 4) stages.push(0);
  return stages;
}

/** The tier the piece would reach if its best line went up to stage 4 with a
 *  Transistone (`QualityScore.reachable`) — its current tier when it has no
 *  such potential, null when it has no quality score (Talisman / EE, un-rolled). */
export function reachableTier(p: UiPiece): QualityTier | null {
  const q = p.quality;
  return q ? qualityTierFromScore(q.reachable ?? q.current, q.max) : null;
}

/** No rolled sub line to compare — the same test that makes the Quality
 *  score null (`qualityScore`): a Talisman / EE slot, or no subs at all. */
function hasNoRolledSubs(p: UiPiece): boolean {
  return p.slot === "talisman" || p.slot === "exclusive" || p.subs.length === 0;
}

function baseRollsActive(b: BaseRollsFilter): boolean {
  return b.lines.some((v) => v !== null);
}

function compareStage(op: BaseRollsOp, stage: number, v: number): boolean {
  switch (op) {
    case "gte": return stage >= v;
    case "gt":  return stage > v;
    case "eq":  return stage === v;
    case "lte": return stage <= v;
    case "lt":  return stage < v;
  }
}

export function matchesFilters(p: UiPiece, f: FilterState): boolean {
  if (f.singularityOnly && !p.singularity) return false;
  if (f.slots.size > 0 && (!p.slot || !f.slots.has(p.slot))) return false;
  if (f.rarities.size > 0 && !f.rarities.has(p.rarity)) return false;
  if (f.stars.size > 0 && !f.stars.has(p.stars)) return false;
  if (f.quality.size > 0) {
    // Talisman / EE return null (no rolled subs to score) — they're
    // excluded the moment a quality chip is active, since "Excellent" is
    // meaningless for gem-bearing slots.
    if (!p.quality || !f.quality.has(p.quality.tier)) return false;
  }
  if (f.reachable.size > 0) {
    // Same exclusion as Quality: no score, no reachable tier.
    const t = reachableTier(p);
    if (!t || !f.reachable.has(t)) return false;
  }
  if (f.mains.size > 0) {
    // OR semantics — a piece passes if ANY of its main-stat keys is in the
    // selection. Pieces with no mains (shouldn't happen for armor/weapon
    // but defensively) never match.
    if (!p.main.some((m) => f.mains.has(m.stat))) return false;
  }
  if (f.subs.size > 0) {
    const pieceSubs = new Set(p.subs.map((s) => s.stat));
    if (f.subMode === "and") {
      // AND — every selected sub must appear on the piece (talisman/EE
      // with no rolled subs always fails here, which is the right call).
      for (const s of f.subs) if (!pieceSubs.has(s)) return false;
    } else {
      // OR — at least one selected sub must appear.
      let any = false;
      for (const s of f.subs) if (pieceSubs.has(s)) { any = true; break; }
      if (!any) return false;
    }
  }
  if (f.armorSets.size > 0) {
    // Weapon / accessory / talisman / EE all return false here — armor sets
    // only apply to the four armor slots that carry an `armorSetId`.
    if (!p.armorSetId || !f.armorSets.has(p.armorSetId)) return false;
  }
  if (f.classes.size > 0) {
    // Strict semantic: piece must be EXCLUSIVE to one of the selected
    // classes. Unrestricted gear (classLimit === null) fails — keeps the
    // filter focused on "show me my class-locked pieces".
    if (!p.classLimit || !f.classes.has(p.classLimit)) return false;
  }
  // Equipped pieces hidden when the player ticked "Exclude equipped gear"
  // in the modal — useful when looking for swappable inventory.
  if (!f.showEquipped && p.status === "equipped") return false;
  if (f.enhanceZero && p.enhance !== 0) return false;
  if (f.breakthroughZero && p.bt !== 0) return false;
  if (f.notReforged && p.reforge.n !== 0) return false;
  if (baseRollsActive(f.baseRolls)) {
    // Gem-bearing pieces have no pattern to read (0/0/0/0 would pass a
    // "less than") — they fail before the inversion, like Quality.
    if (hasNoRolledSubs(p)) return false;
    const stages = baseRollPattern(p);
    const { op, lines, not } = f.baseRolls;
    const match = lines.every((v, i) => v === null || compareStage(op, stages[i] ?? 0, v));
    if (match === not) return false;
  }
  // Trim before testing so a whitespace-only query is a no-op here too —
  // otherwise it filters the grid while `activeFilterCount` (which trims)
  // shows no active filter, an invisible mismatch.
  const q = f.query.trim().toLowerCase();
  if (q && !p.searchText.includes(q)) return false;
  return true;
}

/** How many filter dimensions are currently non-default — surfaced as a
 *  badge on the collapsed strip so the user knows whether collapsing hid
 *  anything load-bearing. Slots are NOT counted here: they live in their
 *  own always-visible SlotBar above the grid, so collapsing the filter
 *  panel never hides them. */
export function activeFilterCount(f: FilterState): number {
  let n = 0;
  if (f.rarities.size > 0) n++;
  if (f.stars.size > 0) n++;
  if (f.quality.size > 0) n++;
  if (f.reachable.size > 0) n++;
  if (f.mains.size > 0) n++;
  if (f.subs.size > 0) n++;
  if (f.armorSets.size > 0) n++;
  if (f.classes.size > 0) n++;
  if (!f.showEquipped) n++;
  if (f.enhanceZero) n++;
  if (f.breakthroughZero) n++;
  if (f.notReforged) n++;
  if (baseRollsActive(f.baseRolls)) n++;
  if (f.singularityOnly) n++;
  if (f.query.trim() !== "") n++;
  return n;
}
