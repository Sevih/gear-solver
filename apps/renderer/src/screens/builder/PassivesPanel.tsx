/**
 * Builder +15 passives panel — the Singularity option a piece already
 * carries, per group (Weapon / Accessory / Armor).
 */
import type { Dispatch } from "react";
import type { GameData } from "@gear-solver/core";
import type { PassivePick, PassivePicks, SolverAction } from "../../lib/solver/builderFilters.js";
import { passiveLabel, PASSIVE_GROUPS, type PassiveGroup } from "../../lib/singularityPassives.js";
import type { PassiveEntry } from "./catalogs.js";
import { Panel } from "./Panel.js";
import { PassiveChip } from "./IconChips.js";

const GROUP_TITLES: Record<PassiveGroup, string> = { weapon: "Weapon", accessory: "Accessory", armor: "Armor" };

/* ─────────────────────────────────────────────────────────────────────────
 * One text chip per Singularity family a piece of the group carries,
 * required at a minimum grade (the colored letters beside it) or excluded.
 * ───────────────────────────────────────────────────────────────────────── */
export function PassivesPanel({
  passives = { weapon: [], accessory: [], armor: [] }, passivePicks, game, dispatch,
}: {
  /** +15 passive families the inventory carries, per group. */
  passives?: Record<PassiveGroup, PassiveEntry[]>;
  passivePicks?: PassivePicks;
  /** Colors of the grade letters (`singularityOptions`). */
  game?: Pick<GameData, "singularityOptions"> | null;
  dispatch: Dispatch<SolverAction>;
}) {
  return (
    <Panel
      title="+15 passives"
      hint="The Singularity option a piece already carries (none below +15). Click a passive to cycle off → required → excluded. A required one keeps only the pieces carrying it at the chosen grade or better (several in a group = any of them), so a piece without a passive is dropped; an excluded one drops it at any grade."
      width="w-64"
    >
      <div className="space-y-2">
        {PASSIVE_GROUPS.map((group) => (
          <div key={group}>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-white/70">{GROUP_TITLES[group]}</div>
            <PassiveRow
              entries={passives[group]}
              picks={passivePicks?.[group] ?? {}}
              game={game}
              onCycle={(family) => dispatch({ type: "cyclePassivePick", group, family })}
              onGrade={(family, grade) => dispatch({ type: "setPassiveMinGrade", group, family, grade })}
            />
          </div>
        ))}
      </div>
    </Panel>
  );
}

/** Chips of a group — one per family the inventory carries, plus any picked
 *  family it no longer does (so the pick stays removable). Nothing to show →
 *  "no +15 passive". */
function PassiveRow({
  entries, picks, game, onCycle, onGrade,
}: {
  entries: PassiveEntry[];
  picks: Record<string, PassivePick>;
  game?: Pick<GameData, "singularityOptions"> | null;
  onCycle: (family: string) => void;
  onGrade: (family: string, grade: PassivePick["minGrade"]) => void;
}) {
  const known = new Set(entries.map((e) => e.family));
  const all = [
    ...entries,
    ...Object.keys(picks).filter((f) => !known.has(f)).map((family) => ({ family, label: passiveLabel(family), owned: 0 })),
  ];
  if (all.length === 0) return <div className="text-[10.5px] italic text-white/65">no +15 passive</div>;
  return (
    <div className="flex flex-wrap gap-1">
      {all.map((e) => (
        <PassiveChip
          key={e.family}
          entry={e}
          pick={picks[e.family]}
          game={game}
          onCycle={() => onCycle(e.family)}
          onGrade={(grade) => onGrade(e.family, grade)}
        />
      ))}
    </div>
  );
}
