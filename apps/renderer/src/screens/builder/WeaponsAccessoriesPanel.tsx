/**
 * Builder weapons, accessories & talismans panel — effect-icon pick lists.
 */
import type { Dispatch } from "react";
import type { ChipState, SolverAction } from "../../lib/solver/builderFilters.js";
import type { EffectEntry } from "./catalogs.js";
import { Panel } from "./Panel.js";
import { EffectIconChip } from "./IconChips.js";

/* ─────────────────────────────────────────────────────────────────────────
 * Weapons, accessories & talismans panel — effect-icon-based pick lists. Each
 * chip is the in-game effect icon (e.g. ATK%, CHC) that identifies the piece.
 * The solver keeps only pieces whose effect is among the picked icons; a
 * talisman a recommendation advised is "preferred" (kept only if owned).
 * ───────────────────────────────────────────────────────────────────────── */
export function WeaponsAccessoriesPanel({
  weapons, accessories, talismans, weaponPicks, accPicks, talismanPicks, dispatch,
}: {
  weapons: EffectEntry[];
  accessories: EffectEntry[];
  talismans: EffectEntry[];
  weaponPicks: Record<string, ChipState>;
  accPicks: Record<string, ChipState>;
  talismanPicks: Record<string, ChipState>;
  dispatch: Dispatch<SolverAction>;
}) {
  return (
    <Panel
      title="Weapons, accessories & talismans"
      hint="Click an effect to cycle off → required → excluded. A talisman advised by Get preset starts preferred: used if you own it, otherwise any talisman. Empty = solver may use every effect."
      width="w-60"
    >
      <div className="space-y-2">
        <EffectGroup
          title="Weapons"
          effects={weapons}
          picks={weaponPicks}
          onCycle={(key) => dispatch({ type: "cycleEffectPick", group: "weapon", key })}
        />
        <EffectGroup
          title="Accessories"
          effects={accessories}
          picks={accPicks}
          onCycle={(key) => dispatch({ type: "cycleEffectPick", group: "accessory", key })}
        />
        <EffectGroup
          title="Talismans"
          effects={talismans}
          picks={talismanPicks}
          onCycle={(key) => dispatch({ type: "cycleEffectPick", group: "talisman", key })}
        />
      </div>
    </Panel>
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
