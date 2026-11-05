/**
 * Gear › Scrap's filter rules: a list of `FilterState`s, never empty. A piece
 * is shown when it passes at least one rule (OR between rules, AND inside a
 * rule as on Pieces); one rule is exactly the single-filter behaviour. The
 * list lives in the session key `gs.gear.scrap.filters` through
 * `RULES_CODEC`; every update returns a new array so React sees the change.
 */
import type { UiPiece } from "../../design/adapter.js";
import { RARITY, STAT, type DesignRarity } from "../../design/tokens.js";
import { QUALITY_LABEL, QUALITY_TIERS } from "../quality.js";
import { FILTER_CODEC, emptyFilters, matchesFilters, type BaseRollsOp, type FilterState } from "../../screens/inventory/filters.js";
import { scrapDefaultPresets } from "../storage/inventoryFilterPresets.js";
import { passiveLabel } from "../singularityPassives.js";

/** Never empty. */
export type ScrapRules = FilterState[];

export function matchesAnyRule(p: UiPiece, rules: readonly FilterState[]): boolean {
  return rules.some((f) => matchesFilters(p, f));
}

/** The rules Gear › Scrap opens on: one per Scrap default filter set. */
function defaultRules(): ScrapRules {
  return scrapDefaultPresets().map((p) => p.filters);
}

/** Session codec: a JSON array of `FILTER_CODEC` objects. Reads an array, or
 *  a single object (the one-filter format, one rule); an empty or unreadable
 *  value, or an array holding no object, reads the default rules. */
export const RULES_CODEC = {
  serialize: (rules: ScrapRules): string => `[${rules.map((f) => FILTER_CODEC.serialize!(f)).join(",")}]`,
  deserialize: (raw: string): ScrapRules => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return defaultRules();
    }
    const isObject = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
    const entries = Array.isArray(parsed) ? parsed.filter(isObject) : isObject(parsed) ? [parsed] : [];
    if (entries.length === 0) return defaultRules();
    return entries.map((e) => FILTER_CODEC.deserialize(JSON.stringify(e)));
  },
};

const OP_SYMBOL: Record<BaseRollsOp, string> = { gte: "≥", gt: ">", eq: "=", lte: "≤", lt: "<" };

function statsLabel(stats: Set<string>, noun: string): string {
  if (stats.size === 1) {
    const [k] = stats;
    return STAT[k!]?.label ?? k!;
  }
  return `${stats.size} ${noun}`;
}

/** Short, stable label of a rule for its chip: only what is active, in a
 *  fixed order, joined by ` · ` (slots are left out: the SlotBar shows them).
 *  Nothing active → `All pieces`. */
export function ruleLabel(f: FilterState): string {
  const parts: string[] = [];
  if (f.stars.size > 0) parts.push([...f.stars].sort((a, b) => a - b).map((n) => `${n}★`).join(" "));
  if (f.rarities.size > 0) {
    parts.push((Object.keys(RARITY) as DesignRarity[]).filter((r) => f.rarities.has(r)).map((r) => RARITY[r].label).join(" "));
  }
  if (f.quality.size > 0) parts.push(`Q: ${QUALITY_TIERS.filter((t) => f.quality.has(t)).map((t) => QUALITY_LABEL[t]).join(" ")}`);
  if (f.reachable.size > 0) parts.push(`Reachable: ${QUALITY_TIERS.filter((t) => f.reachable.has(t)).map((t) => QUALITY_LABEL[t]).join(" ")}`);
  if (f.mains.size > 0) parts.push(statsLabel(f.mains, "mains"));
  if (f.subs.size > 0) parts.push(statsLabel(f.subs, "subs"));
  if (f.armorSets.size > 0) parts.push(`${f.armorSets.size} ${f.armorSets.size === 1 ? "set" : "sets"}`);
  if (f.classes.size > 0) parts.push([...f.classes].sort().join(" "));
  const b = f.baseRolls;
  if (b.lines.some((v) => v !== null)) {
    parts.push(`${b.not ? "not " : ""}${OP_SYMBOL[b.op]} ${b.lines.map((v) => (v === null ? "X" : String(v))).join("/")}`);
  }
  if (f.passives.size > 0) {
    // The families' short labels, then the minimum grade once (C = any, left out).
    const labels = [...f.passives].map(passiveLabel).sort().join(" / ");
    parts.push(f.passiveMinGrade !== "C" ? `${labels} ≥ ${f.passiveMinGrade}` : labels);
  }
  if (!f.showEquipped) parts.push("unequipped");
  if (f.enhanceZero) parts.push("+0");
  if (f.breakthroughZero) parts.push("T0");
  if (f.notReforged) parts.push("not reforged");
  if (f.singularityOnly) parts.push("singularity");
  const q = f.query.trim();
  if (q) parts.push(`"${q}"`);
  return parts.length > 0 ? parts.join(" · ") : "All pieces";
}

/** Rule `i` replaced by `f` (the same array when `i` is out of range). */
export function setRule(rules: ScrapRules, i: number, f: FilterState): ScrapRules {
  if (i < 0 || i >= rules.length) return rules;
  return rules.map((r, j) => (j === i ? f : r));
}

export function addRule(rules: ScrapRules, f: FilterState): ScrapRules {
  return [...rules, f];
}

/** Rule `i` removed; removing the last one leaves one empty rule. */
export function removeRule(rules: ScrapRules, i: number): ScrapRules {
  if (i < 0 || i >= rules.length) return rules;
  const next = rules.filter((_, j) => j !== i);
  return next.length > 0 ? next : [emptyFilters()];
}

/** The active rule's index, held within the list (0 for anything unreadable). */
export function clampRuleIndex(i: unknown, length: number): number {
  const n = typeof i === "number" && Number.isInteger(i) ? i : 0;
  return Math.min(Math.max(n, 0), Math.max(length - 1, 0));
}
