/**
 * Builder stat / rating tables — the columns, labels, icons and tooltips the
 * filter panels and the results table share.
 */
import type { SlotId } from "../../design/tokens.js";
import type { DmgSkillInfo } from "../../lib/dmgSkill.js";

/** Compact main-stat-axis labels rendered in the Stats / Stat filters /
 *  Substat priority panels (and across as table columns). Ordered to match
 *  the Builds tab's StatBlock column reading so muscle memory transfers. */
// Labels are the in-game stat abbreviations (as in outerpedia's
// `src/lib/stats.ts`) — used as the column-header tooltips and any
// text fallback. The table headers themselves render the stat icon, not the
// text, so a long label like "CDMG RED%" never crowds the column.
export const SOLVER_STATS: ReadonlyArray<{ key: string; iconKey: string; label: string; unit: string }> = [
  { key: "atk",           iconKey: "atk",           label: "ATK",       unit: "" },
  { key: "def",           iconKey: "def",           label: "DEF",       unit: "" },
  { key: "hp",            iconKey: "hp",            label: "HP",        unit: "" },
  { key: "spd",           iconKey: "spd",           label: "SPD",       unit: "" },
  { key: "critRate",      iconKey: "critRate",      label: "CHC",       unit: "%" },
  { key: "critDmg",       iconKey: "critDmg",       label: "CHD",       unit: "%" },
  { key: "critDmgReduce", iconKey: "critDmgReduce", label: "CDMG RED%", unit: "%" },
  { key: "pen",           iconKey: "pen",           label: "PEN%",      unit: "%" },
  { key: "dmgUp",         iconKey: "dmgUp",         label: "DMG UP%",   unit: "%" },
  { key: "dmgReduce",     iconKey: "dmgReduce",     label: "DMG RED%",  unit: "%" },
  { key: "eff",           iconKey: "eff",           label: "EFF",       unit: "" },
  { key: "effRes",        iconKey: "effRes",        label: "RES",       unit: "" },
];

/** Calculated ratings — visible only in the Rating filters panel and as
 *  result-table columns. Formulas mirror the Fribbels E7 model; final
 *  Outerplane tuning may differ (e.g. EHP defense scaling uses the in-game
 *  HD formula). Score and Upg are derived in the solver (not from the
 *  composed stats), and can be bounded here like the others.
 *
 *  `hideInTable` flags a rating that's still useful as a filter axis but
 *  rarely needed in the per-row table (avoids cluttering 20+ columns).
 *  Filters panel always shows everything. */
export const SOLVER_RATINGS: ReadonlyArray<{ key: string; label: string; formula: string; desc: string; hideInTable?: boolean }> = [
  { key: "cp",   label: "Cp",   formula: "in-game CalcBattlePower",         desc: "Combat Power as shown on the unit page (skill levels included)." },
  { key: "hps",  label: "HpS",  formula: "HP × SPD",                        desc: "HP × Speed composite — fast-and-bulky proxy." },
  { key: "ehp",  label: "Ehp",  formula: "HP × (1 + DEF/1000) / max(0.3, 1 − dmgRed/100)", desc: "Effective HP — combines the in-game DEF mitigation 1000/(DEF+1000) with the build's own dmgRed (defender-side reduction)." },
  { key: "ehps", label: "EhpS", formula: "EHP × SPD",                       desc: "EHP × Speed — tanky-and-fast." },
  { key: "dmg",  label: "Dmg",  formula: "DmgStat × E[DR] × penMult(2000) × skillFactor", desc: "Expected damage of the hero's STRONGEST skill hit (S1/S2/S3 at max level, burst states included; multi-hit = sum of hits) vs DEF=2000 — scales off the hero's damage stat (ATK by default; DEF/HP for off-ATK heroes), weighting crit (1 + pCrit×(CHD/100−1)), attacker's dmgUp, and PEN, then × the skill's total factor. No buffs / chains; DoT kits are under-estimated. dmgRed doesn't reduce a build's own offensive output (defender stat)." },
  { key: "dmgs", label: "DmgS", formula: "DmgStat × E[DR] × penMult(2000) × turnFactor × SPD", desc: "DPS — damage per turn × speed: same hit model as Dmg, × the average skill factor per turn (S3/S2/S1 rotation by cooldowns — the strongest ready skill every turn; no bursts, AP or DoTs) instead of the best hit." },
  { key: "mcd",  label: "Mcd",  formula: "DmgStat × (CHD/100 + dmgMod) × penMult(2000) × skillFactor", desc: "Max crit damage of the best skill vs DEF=2000 — assumes 100% CHC (raid-buff scenario).", hideInTable: true },
  { key: "mcds", label: "McdS", formula: "DmgStat × (CHD/100 + dmgMod) × penMult(2000) × turnFactor × SPD", desc: "Max DPS — the Mcd hit × the average skill factor per turn (S3/S2/S1 rotation by cooldowns) × speed.", hideInTable: true },
  { key: "dmgh", label: "DmgH", formula: "HP × E[DR] × penMult(2000)",      desc: "Expected damage for HP-scaling kits vs DEF=2000 — fixed HP reference column at a 100% skill factor (the Dmg column already scales off the hero's actual stat and best skill).", hideInTable: true },
];

/** Ratings scaled by the hero's skill factor — their tooltips name the
 *  winning skill (or the ×1.00 fallback) via `ratingTitle`. */
export const SKILL_SCALED_RATINGS = new Set(["dmg", "dmgs", "mcd", "mcds"]);

/** The per-TURN ones among them — scaled by the cooldown rotation's average
 *  factor per turn (`dmgSkill.turn`), not the best hit. */
const TURN_SCALED_RATINGS = new Set(["dmgs", "mcds"]);

/** Tooltip for a rating column / filter row: formula (optional) + semantics,
 *  plus — for the skill-scaled ratings — which S1/S2/S3 won for the picked
 *  hero and its factor (per-hit columns) or its cooldown rotation (per-turn
 *  columns), or an explicit warning when the data is missing. */
export function ratingTitle(r: { key: string; formula: string; desc: string }, dmgSkill: DmgSkillInfo | null, withFormula = true): string {
  const base = withFormula ? `${r.formula} — ${r.desc}` : r.desc;
  if (!SKILL_SCALED_RATINGS.has(r.key)) return base;
  if (TURN_SCALED_RATINGS.has(r.key)) {
    if (!dmgSkill) return `${base} Skill factor: the picked hero's average factor per turn (S3/S2/S1 rotation by cooldowns).`;
    const t = dmgSkill.turn;
    if (!t.missing) return `${base} × average factor per turn (S3/S2/S1 rotation by cooldowns): ${t.label} ×${t.factor.toFixed(2)}${t.approx ? " (approx — a hit chain is unresolved in the data)" : ""}.`;
    if (dmgSkill.missing) return `${base} ⚠ No skill data for this hero — skill factor assumed ×1.00 (a 100% skill).`;
    return `${base} ⚠ No rotation in this data snapshot — best skill used instead: ${t.label} ×${t.factor.toFixed(2)}${t.approx ? " (hit chain unresolved in the data — approximate)" : ""}.`;
  }
  if (!dmgSkill) return `${base} Skill factor: the picked hero's best skill (S1/S2/S3 at max level).`;
  if (dmgSkill.missing) return `${base} ⚠ No skill data for this hero — skill factor assumed ×1.00 (a 100% skill).`;
  return `${base} Best skill: ${dmgSkill.label} ×${dmgSkill.factor.toFixed(2)}${dmgSkill.approx ? " (hit chain unresolved in the data — approximate)" : ""}.`;
}

/** Ratings actually rendered in the results table — filters out the
 *  `hideInTable` ones so the row stays scannable. */
export const TABLE_RATINGS = SOLVER_RATINGS.filter((r) => !r.hideInTable);

/** Slots whose in-game main is user-selectable — Weapon, Accessory, Talisman.
 *  Helmet / Armor / Gloves / Boots all have a fixed in-game main stat and
 *  don't need a filter. The actual stat options per slot are derived from
 *  the user's inventory (see `mainStatCatalogFromInventory`); the only
 *  hardcoded part is which rows show up. */
export const MAIN_STAT_SLOTS: ReadonlyArray<{ slot: SlotId; label: string }> = [
  { slot: "weapon",    label: "Weapon" },
  { slot: "accessory", label: "Accessory" },
  { slot: "talisman",  label: "Talisman" },
];

/** Canonical display order for main-stat chips — all engine stat keys we
 *  expect to ever encounter on a rolled main, ordered so the user sees the
 *  same column layout regardless of which slot they're looking at. Unknown
 *  keys (future game updates, exotic talisman / EE buffs) sort last but
 *  still render (with a fallback label). */
export const STAT_DISPLAY_ORDER: ReadonlyArray<string> = [
  "atk", "atkPct",
  "def", "defPct",
  "hp",  "hpPct",
  "spd",
  "critRate", "critDmg", "critDmgReduce",
  "pen", "dmgUp", "dmgReduce",
  "eff", "effRes",
  "hitAp", "killAp",
  "lifesteal", "counter", "enterAp",
  "avoid",
];

/** Engine stat key → short user-facing label rendered on the chip tooltip.
 *  Falls back to the upper-cased key when unmapped. Percent variants share
 *  the flat label and get a `%` overlay on the chip. */
const STAT_LABEL: Record<string, string> = {
  atk: "ATK", atkPct: "ATK%",
  def: "DEF", defPct: "DEF%",
  hp:  "HP",  hpPct:  "HP%",
  spd: "SPD",
  critRate: "CHC",
  critDmg:  "CHD",
  critDmgReduce: "CDMG RED%",
  pen:    "PEN%",
  dmgUp:  "DMG UP%",
  dmgReduce: "DMG RED%",
  eff:    "EFF",
  effRes: "RES",
  hitAp:  "HitAP",
  killAp: "KillAP",
  lifesteal: "LIFE",
  counter:   "CTR",
  enterAp:   "AP+",
  avoid:     "ACC",
};

export function statLabelFor(key: string): string {
  return STAT_LABEL[key] ?? key.toUpperCase();
}

/** Engine key → STAT-token icon key. `*Pct` rolls share the icon of their
 *  flat counterpart (the chip overlays a `%` badge to distinguish them). */
export function statIconKeyFor(key: string): string {
  if (key.endsWith("Pct")) return key.slice(0, -3);
  return key;
}

/** Full name + in-game definition per result-table stat, for the column-header
 *  tooltip (so a hover explains the stat instead of just repeating the icon).
 *  Definitions are condensed from the game's `TextSystem` (`SYS_DESC_*` /
 *  `SYS_STAT_DESC_*` keys) — the same source the in-game stat info panel uses. */
const STAT_TOOLTIP: Record<string, { full: string; desc: string }> = {
  atk:        { full: "Attack",                desc: "The higher your Attack, the more damage you deal to enemies." },
  def:        { full: "Defense",               desc: "The higher your Defense, the less damage you take from enemies." },
  hp:         { full: "Health",                desc: "You're defeated once your Health falls to zero." },
  spd:        { full: "Speed",                 desc: "The higher your Speed, the more often you can act." },
  critRate:   { full: "Crit Chance",           desc: "Chance for an attack to land a critical hit (dealing Crit Damage)." },
  critDmg:    { full: "Crit Damage",           desc: "Increases damage dealt on critical hits." },
  critDmgReduce: { full: "Crit Damage Reduction", desc: "Reduces crit damage taken when hit (caps at 70% combined with Damage Reduction)." },
  pen:        { full: "Penetration",           desc: "Ignores a portion of the target's Defense when attacking." },
  dmgUp:      { full: "Damage Increase",       desc: "Increases damage dealt when attacking." },
  dmgReduce:  { full: "Damage Reduction",      desc: "Reduces damage taken when hit." },
  eff:        { full: "Effectiveness",         desc: "The higher it is, the lower the target's chance to resist your debuffs." },
  effRes:     { full: "Resilience",            desc: "The higher it is, the higher your chance to resist debuffs." },
};

/** Column-header tooltip text: "Full Name — definition", falling back to the
 *  abbreviation when a stat has no curated entry. */
export function statHeaderTooltip(key: string, label: string): string {
  const t = STAT_TOOLTIP[key];
  return t ? `${t.full} — ${t.desc}` : label;
}
