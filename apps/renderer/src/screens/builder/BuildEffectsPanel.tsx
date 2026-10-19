/**
 * Builder effects panel — weapon / accessory passives and active armor sets of
 * the selected build.
 */
import { useMemo, type ReactNode } from "react";
import type { GameData, GearPiece, SetCombatEffect } from "@gear-solver/core";
import { wornSetRows } from "@gear-solver/core";
import { HoverCard } from "../../design/HoverCard.js";
import { SetCombatBadge } from "../../design/SetCombatBadge.js";
import { GameText } from "../../design/GameText.js";
import { toUiPiece } from "../../design/adapter.js";
import type { SolveBuild } from "../../lib/solver/types.js";
import { Panel } from "./Panel.js";

/** Aggregated build effects shown under the stats panel: the weapon's and the
 *  accessory's unique-option passive (icon + name, description on hover) and
 *  each ACTIVE armor set (icon + name + active 2/4-pc description on hover).
 *  These were moved off the individual gear cards into this single card. */
export function BuildEffectsPanel({ build, pieceByUid, game }: {
  build: SolveBuild | null;
  pieceByUid: Map<string, GearPiece>;
  game: GameData | null;
}) {
  const effects = useMemo(() => {
    if (!build || !game) return null;
    const pieces = build.pieceUids.map((u) => pieceByUid.get(u)).filter((p): p is GearPiece => !!p);

    // Weapon / accessory unique-option passive (via the same UiPiece adapter).
    const passiveOf = (slot: string) => {
      const p = pieces.find((x) => x.slot === slot);
      if (!p) return null;
      const ui = toUiPiece(p, game);
      return ui.passive ? { icon: ui.effectIcon, name: ui.passive.name ?? "Passive", text: ui.passive.text } : null;
    };
    const weapon = passiveOf("weapon");
    const accessory = passiveOf("accessory");

    // Active armor sets: group pieces per armorSetId (active at ≥2). The rows
    // come from core's `wornSetRows`, like composeBuild's computeSetBonuses:
    // the 2-pc text from the row of the 2-pc level, the 4-pc text from the row
    // of the 4-pc level, and a 2-pc cancelled by `ignoreLowSet` is not shown.
    const groups = new Map<string, { bts: number[]; sample: GearPiece }>();
    for (const p of pieces) {
      if (!p.armorSetId) continue;
      const e = groups.get(p.armorSetId);
      if (e) e.bts.push(p.breakthrough);
      else groups.set(p.armorSetId, { bts: [p.breakthrough], sample: p });
    }
    const sets: Array<{ id: string; name: string; icon: string | null; pc: number; descs: Array<{ tag: string; desc: string | null; combat: SetCombatEffect[] | null }> }> = [];
    for (const [setId, { bts, sample }] of groups) {
      const count = bts.length;
      if (count < 2) continue;
      const def = game.sets?.[setId];
      if (!def) continue;
      const { row2, row4, drop2 } = wornSetRows(def, bts);
      // Combat effects (display only) ride on the same rows; a tier with
      // effects but no prose still gets its line, the pill alone.
      const descs: Array<{ tag: string; desc: string | null; combat: SetCombatEffect[] | null }> = [];
      const combat2 = row2?.combatEffects?.p2 ?? null, combat4 = row4?.combatEffects?.p4 ?? null;
      if (!drop2 && (row2?.p2_desc || combat2)) descs.push({ tag: "2-pc", desc: row2?.p2_desc ?? null, combat: combat2 });
      if (row4?.p4_desc || combat4) descs.push({ tag: "4-pc", desc: row4?.p4_desc ?? null, combat: combat4 });
      if (descs.length === 0) continue;
      sets.push({ id: setId, name: def.name ?? "Set", icon: toUiPiece(sample, game).setIcon, pc: count >= 4 ? 4 : 2, descs });
    }

    if (!weapon && !accessory && sets.length === 0) return null;
    return { weapon, accessory, sets };
  }, [build, pieceByUid, game]);

  if (!effects) return null;
  return (
    <Panel title="Effects" width="w-full">
      <div className="space-y-1">
        {effects.weapon && <EffectRow icon={effects.weapon.icon} name={effects.weapon.name} content={<GameText text={effects.weapon.text} />} />}
        {effects.accessory && <EffectRow icon={effects.accessory.icon} name={effects.accessory.name} content={<GameText text={effects.accessory.text} />} />}
        {effects.sets.map((s) => (
          <EffectRow
            key={s.id}
            icon={s.icon}
            name={s.name}
            badge={`${s.pc}pc`}
            content={
              <div className="space-y-1.5">
                {s.descs.map((d) => (
                  <div key={d.tag}>
                    <span className="mr-1 font-mono text-[10px] font-semibold text-white/60">{d.tag}</span>
                    {d.desc && <GameText text={d.desc} />}
                    <SetCombatBadge effects={d.combat} expanded />
                  </div>
                ))}
              </div>
            }
          />
        ))}
      </div>
    </Panel>
  );
}

/** One row of the Effects card: icon + name (+ optional pc badge); the
 *  description surfaces in a popover on hover/focus. */
function EffectRow({ icon, name, content, badge }: {
  icon: string | null;
  name: string;
  content: ReactNode;
  badge?: string;
}) {
  return (
    <HoverCard content={content}>
      <div className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-white/5">
        {icon
          ? <img src={`/img/ui/effect/${icon}.webp`} alt="" className="h-5 w-5 shrink-0" />
          : <span className="h-5 w-5 shrink-0" />}
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-white">{name}</span>
        {badge && <span className="shrink-0 rounded border border-white/12 px-1 py-px font-mono text-[9px] text-white/55">{badge}</span>}
      </div>
    </HoverCard>
  );
}
