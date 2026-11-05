/**
 * Builder Weapons, Accessories and Talismans panels — one effect pick list
 * each, behind its own toolbar button.
 */
import type { Dispatch } from "react";
import type { ChipState, SolverAction } from "../../lib/solver/builderFilters.js";
import type { EffectEntry } from "./catalogs.js";
import { Panel } from "./Panel.js";
import { EffectIconChip } from "./IconChips.js";

export type EffectGroup = "weapon" | "accessory" | "talisman";

/** Per group: the panel title, its hint and the chip's icon — the effect
 *  icon for weapons and accessories, the item art for talismans (their
 *  effect icons look alike). */
const EFFECT_PANELS: Record<EffectGroup, { title: string; hint: string; iconKind: "effect" | "item" }> = {
  weapon: {
    title: "Weapons",
    hint: "Click an effect to cycle off → required → excluded. Empty = solver may use every weapon effect.",
    iconKind: "effect",
  },
  accessory: {
    title: "Accessories",
    hint: "Click an effect to cycle off → required → excluded. Empty = solver may use every accessory effect.",
    iconKind: "effect",
  },
  talisman: {
    title: "Talismans",
    hint: "Click a talisman to cycle off → required → excluded. A talisman advised by Load reco starts preferred: used if you own it, otherwise any talisman. Empty = solver may use every talisman.",
    iconKind: "item",
  },
};

/* ─────────────────────────────────────────────────────────────────────────
 * Effect pick list of one group. Each chip identifies the piece by its
 * in-game effect (e.g. ATK%, CHC) — for a talisman by its own art. The
 * solver keeps only pieces whose effect is among the picked ones; a
 * talisman a recommendation advised is "preferred" (kept only if owned).
 * ───────────────────────────────────────────────────────────────────────── */
export function EffectPanel({ group, effects, picks, dispatch }: {
  group: EffectGroup;
  effects: EffectEntry[];
  picks: Record<string, ChipState>;
  dispatch: Dispatch<SolverAction>;
}) {
  const { title, hint, iconKind } = EFFECT_PANELS[group];
  return (
    <Panel title={title} hint={hint} width="w-60">
      {effects.length === 0 ? (
        <div className="text-[10.5px] italic text-white/65">none</div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {effects.map((e) => (
            <EffectIconChip
              key={e.key}
              effect={e}
              state={picks[e.key] ?? "off"}
              iconKind={iconKind}
              onClick={() => dispatch({ type: "cycleEffectPick", group, key: e.key })}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}
