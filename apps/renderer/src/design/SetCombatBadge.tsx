/**
 * Small "combat" pill shown after a set tier's prose when the tier carries
 * combat effects (`SetLevel.combatEffects`): its tooltip says they apply in
 * battle only, then lists them (`combatEffectLines`). Renders nothing for a
 * tier without one, so those rows stay exactly as before.
 *
 * `expanded` writes the tooltip body under the pill instead — for a pill that
 * already sits inside a hover popover (the Builder's Effects card), where a
 * nested tooltip could never be hovered.
 */
import type { SetCombatEffect } from "@gear-solver/core";
import { COMBAT_EFFECT_NOTE, combatEffectLines } from "../lib/setCombatEffects.js";
import { HoverCard } from "./HoverCard.js";

const PILL = "rounded border border-white/12 px-1 py-px font-mono text-[9px] text-white/55";

function CombatEffectBody({ effects }: { effects: readonly SetCombatEffect[] }) {
  return (
    <>
      <div className="text-white/60">{COMBAT_EFFECT_NOTE}</div>
      {combatEffectLines(effects).map((line, i) => <div key={i}>{line}</div>)}
    </>
  );
}

export function SetCombatBadge({ effects, expanded = false }: {
  effects: readonly SetCombatEffect[] | null | undefined;
  expanded?: boolean;
}) {
  if (!effects || effects.length === 0) return null;
  if (expanded) {
    return (
      <span className="mt-0.5 block">
        <span className={PILL}>combat</span>
        <span className="mt-0.5 block text-[10.5px] leading-snug"><CombatEffectBody effects={effects} /></span>
      </span>
    );
  }
  return (
    <HoverCard content={<CombatEffectBody effects={effects} />} className="ml-1 inline-block align-middle">
      <span className={PILL}>combat</span>
    </HoverCard>
  );
}
