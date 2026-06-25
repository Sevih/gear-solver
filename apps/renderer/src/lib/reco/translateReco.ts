/**
 * Reco → solver-filter translator. Turns one outerpedia recommendation build
 * (the structured shape served by `GET /api/reco/:id`) into a patch the
 * Builder reducer can overlay onto its current filter state ("Get preset").
 *
 * The API already emits engine-canonical identifiers (itemId = GearPiece.itemId,
 * setId = armorSetId, stat keys = engine keys), so there is NO name/heuristic
 * matching here — only structural mapping. Any unresolved id (itemId/setId null)
 * or unknown stat key is skipped and reported in `warnings`, never silently
 * dropped (per the contract note).
 *
 * Effect picks key on the EFFECT IDENTITY (`EquipmentDef.setId` = UniqueOptionID),
 * not the reco's `effectIcon` — distinct effects share icons. The caller passes a
 * `resolveEffectKey(itemId)` that maps the recommended item to its setId via the
 * loaded game data; an item that can't be resolved is skipped + warned.
 *
 * Pure / dependency-light so it unit-tests in isolation.
 */
import { STAT_TO_PRIORITY } from "../solver/ratings.js";
import type { SetPlan } from "../solver/types.js";

/** One recommended weapon / amulet. `mainStat` is an OR-list of acceptable
 *  engine main-stat keys for that piece (e.g. `["pen","critDmg"]`). */
export interface RecoGearStat {
  name: string;
  itemId: number | null;
  effectIcon: string | null;
  mainStat: string[];
}

/** One set condition inside a combo: `count` pieces of `setId`. */
export interface RecoSetStat {
  name: string;
  setId: string | null;
  count: number;
}

/** A single named build of a reco (e.g. "Speed", "Burst"). `Set` is an OR-list
 *  of combos, each combo an AND of conds. `SubstatPrio` is an ordered list of
 *  tiers (each tier a list of tied engine stat keys). */
export interface StructuredRecoBuild {
  Weapon?: RecoGearStat[];
  Amulet?: RecoGearStat[];
  Set?: RecoSetStat[][];
  SubstatPrio?: string[][];
}

export interface StructuredCharacterReco {
  id: string;
  builds: Record<string, StructuredRecoBuild>;
}

/** The subset of SolverFilters a reco can pre-fill. Overlaid onto current
 *  state by the reducer's `mergePreset` (options / exclusions / stat bands are
 *  left untouched). */
export interface RecoFilterPatch {
  /** design-slot → OR-list of acceptable main stat engine keys. */
  mainPicks: Record<string, Record<string, boolean>>;
  weaponEffectPicks: Record<string, "required">;
  accessoryEffectPicks: Record<string, "required">;
  setPlans: SetPlan[];
  priority: Record<string, number>;
}

export interface RecoTranslation {
  patch: RecoFilterPatch;
  /** Human-readable notes about anything skipped (unresolved id / unknown key)
   *  — surfaced to the user instead of pretending the import was complete. */
  warnings: string[];
}

/** Tier rank → priority weight on the solver's -1..3 scale: best tier 3, then
 *  2, then 1 for everything deeper. Clamped at the low end (a long prio list
 *  doesn't push later tiers below 1). */
function tierWeight(tierIndex: number): number {
  if (tierIndex <= 0) return 3;
  if (tierIndex === 1) return 2;
  return 1;
}

/** Collect the OR-union of main-stat keys across a slot's recommended pieces
 *  (alternatives) into a `{key: true}` map. Empty → omit the slot (any main). */
function mainPicksForSlot(refs: RecoGearStat[] | undefined): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const ref of refs ?? []) {
    for (const key of ref.mainStat) out[key] = true;
  }
  return out;
}

/** Resolve a recommended item to its unique effect key (`setId`) via the loaded
 *  game data. Null when the item id is missing or has no unique-option effect. */
export type ResolveEffectKey = (itemId: number | null) => string | null;

/** Required effect keys for a slot (OR-list), resolved from each piece's
 *  itemId → setId. Unresolvable pieces are skipped + warned. */
function effectPicks(
  refs: RecoGearStat[] | undefined,
  slot: string,
  warnings: string[],
  resolveEffectKey: ResolveEffectKey,
): Record<string, "required"> {
  const out: Record<string, "required"> = {};
  for (const ref of refs ?? []) {
    const key = resolveEffectKey(ref.itemId);
    if (key) out[key] = "required";
    else warnings.push(`${slot}: "${ref.name}" — couldn't resolve its effect — skipped its effect filter.`);
  }
  return out;
}

/**
 * Translate one named build into a filter patch + warnings.
 *
 * Sets: each combo maps 1:1 to a plan. A combo with ANY unresolved `setId` is
 * dropped whole (a partial plan would silently weaken the constraint) and
 * warned — never reduced to its resolvable conds.
 */
export function translateRecoBuild(build: StructuredRecoBuild, resolveEffectKey: ResolveEffectKey): RecoTranslation {
  const warnings: string[] = [];

  const mainPicks: Record<string, Record<string, boolean>> = {};
  const weaponMains = mainPicksForSlot(build.Weapon);
  const accessoryMains = mainPicksForSlot(build.Amulet);
  if (Object.keys(weaponMains).length > 0) mainPicks.weapon = weaponMains;
  if (Object.keys(accessoryMains).length > 0) mainPicks.accessory = accessoryMains;

  const weaponEffectPicks = effectPicks(build.Weapon, "Weapon", warnings, resolveEffectKey);
  const accessoryEffectPicks = effectPicks(build.Amulet, "Amulet", warnings, resolveEffectKey);

  const setPlans: SetPlan[] = [];
  for (const combo of build.Set ?? []) {
    const conds = combo.map((c) => ({ setId: c.setId, count: c.count }));
    const unresolved = conds.find((c) => c.setId == null);
    if (unresolved) {
      const label = combo.map((c) => c.name).join(" + ");
      warnings.push(`Set combo "${label}" has an unresolved set — skipped the whole alternative.`);
      continue;
    }
    setPlans.push(conds.map((c) => ({ setId: c.setId as string, count: c.count })));
  }

  const priority: Record<string, number> = {};
  (build.SubstatPrio ?? []).forEach((tier, tierIndex) => {
    const weight = tierWeight(tierIndex);
    for (const engineKey of tier) {
      const prioKey = STAT_TO_PRIORITY[engineKey];
      if (!prioKey) {
        warnings.push(`SubstatPrio: unknown stat "${engineKey}" — skipped.`);
        continue;
      }
      // First (best) tier wins — later tiers map a lower weight onto the same
      // bucket (e.g. atk in tier 0 + atkPct in tier 2 both → "atk").
      if (priority[prioKey] == null) priority[prioKey] = weight;
    }
  });

  return { patch: { mainPicks, weaponEffectPicks, accessoryEffectPicks, setPlans, priority }, warnings };
}
