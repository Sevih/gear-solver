/**
 * Builder weapons, accessories & talismans panel — effect-icon pick lists.
 */
import type { Dispatch } from "react";
import type { ChipState, PassivePick, PassivePicks, SolverAction } from "../../lib/solver/builderFilters.js";
import { passiveLabel, type PassiveGroup } from "../../lib/singularityPassives.js";
import type { EffectEntry, PassiveEntry } from "./catalogs.js";
import { Panel } from "./Panel.js";
import { EffectIconChip, PassiveChip } from "./IconChips.js";

/* ─────────────────────────────────────────────────────────────────────────
 * Weapons, accessories & talismans panel — effect-icon-based pick lists. Each
 * chip is the in-game effect icon (e.g. ATK%, CHC) that identifies the piece.
 * The solver keeps only pieces whose effect is among the picked icons; a
 * talisman a recommendation advised is "preferred" (kept only if owned).
 * Weapons, accessories and armor also get a "+15 passive" line: one text chip
 * per Singularity family, required at a minimum grade or excluded.
 * ───────────────────────────────────────────────────────────────────────── */
export function WeaponsAccessoriesPanel({
  weapons, accessories, talismans, weaponPicks, accPicks, talismanPicks,
  passives = { weapon: [], accessory: [], armor: [] }, passivePicks, dispatch,
}: {
  weapons: EffectEntry[];
  accessories: EffectEntry[];
  talismans: EffectEntry[];
  weaponPicks: Record<string, ChipState>;
  accPicks: Record<string, ChipState>;
  talismanPicks: Record<string, ChipState>;
  /** +15 passive families the inventory carries, per group. */
  passives?: Record<PassiveGroup, PassiveEntry[]>;
  passivePicks?: PassivePicks;
  dispatch: Dispatch<SolverAction>;
}) {
  const passiveRow = (group: PassiveGroup) => (
    <PassiveRow
      entries={passives[group]}
      picks={passivePicks?.[group] ?? {}}
      onCycle={(family) => dispatch({ type: "cyclePassivePick", group, family })}
      onGrade={(family, grade) => dispatch({ type: "setPassiveMinGrade", group, family, grade })}
    />
  );
  return (
    <Panel
      title="Weapons, accessories & talismans"
      hint="Click an effect to cycle off → required → excluded. A talisman advised by Load reco starts preferred: used if you own it, otherwise any talisman. Empty = solver may use every effect. +15 passive: the Singularity option a piece already carries (none below +15); a required one keeps only the pieces carrying it at the chosen grade or better (several = any of them), so a piece without a passive is dropped; an excluded one drops it at any grade."
      width="w-60"
    >
      <div className="space-y-2">
        <EffectGroup
          title="Weapons"
          effects={weapons}
          picks={weaponPicks}
          onCycle={(key) => dispatch({ type: "cycleEffectPick", group: "weapon", key })}
        />
        {passiveRow("weapon")}
        <EffectGroup
          title="Accessories"
          effects={accessories}
          picks={accPicks}
          onCycle={(key) => dispatch({ type: "cycleEffectPick", group: "accessory", key })}
        />
        {passiveRow("accessory")}
        <EffectGroup
          title="Talismans"
          effects={talismans}
          picks={talismanPicks}
          onCycle={(key) => dispatch({ type: "cycleEffectPick", group: "talisman", key })}
        />
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-white/70">Armor</div>
          {passiveRow("armor")}
          {passives.armor.length === 0 && Object.keys(passivePicks?.armor ?? {}).length === 0 && (
            <div className="text-[10.5px] italic text-white/65">no +15 passive</div>
          )}
        </div>
      </div>
    </Panel>
  );
}

/** "+15 passive" line of a group — one chip per family the inventory carries,
 *  plus any picked family it no longer does (so the pick stays removable).
 *  Nothing to show → no line. */
function PassiveRow({
  entries, picks, onCycle, onGrade,
}: {
  entries: PassiveEntry[];
  picks: Record<string, PassivePick>;
  onCycle: (family: string) => void;
  onGrade: (family: string, grade: PassivePick["minGrade"]) => void;
}) {
  const known = new Set(entries.map((e) => e.family));
  const all = [
    ...entries,
    ...Object.keys(picks).filter((f) => !known.has(f)).map((family) => ({ family, label: passiveLabel(family), owned: 0 })),
  ];
  if (all.length === 0) return null;
  return (
    <div>
      <div className="mb-1 text-[9.5px] uppercase tracking-wider text-white/55">+15 passive</div>
      <div className="flex flex-wrap gap-1">
        {all.map((e) => (
          <PassiveChip
            key={e.family}
            entry={e}
            pick={picks[e.family]}
            onCycle={() => onCycle(e.family)}
            onGrade={(grade) => onGrade(e.family, grade)}
          />
        ))}
      </div>
    </div>
  );
}

function EffectGroup({
  title, effects, picks, onCycle,
}: {
  title: string;
  effects: EffectEntry[];
  picks: Record<string, ChipState>;
  onCycle: (key: string) => void;
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-white/70">{title}</div>
      {effects.length === 0 ? (
        <div className="text-[10.5px] italic text-white/65">none</div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {effects.map((e) => (
            <EffectIconChip
              key={e.key}
              effect={e}
              state={picks[e.key] ?? "off"}
              onClick={() => onCycle(e.key)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
