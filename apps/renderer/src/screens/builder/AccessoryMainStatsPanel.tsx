/**
 * Builder main stats panel — per-slot OR-list of acceptable main stats.
 */
import type { Dispatch } from "react";
import { StatIcon } from "../../design/EquipmentIcon.js";
import { cx } from "../../design/cx.js";
import type { SolverAction } from "../../lib/solver/builderFilters.js";
import type { MainStatEntry } from "./catalogs.js";
import { Panel } from "./Panel.js";
import { MAIN_STAT_SLOTS, statIconKeyFor } from "./statColumns.js";

/* ─────────────────────────────────────────────────────────────────────────
 * Accessory main stats panel — per-slot OR-list of acceptable mains
 * ───────────────────────────────────────────────────────────────────────── */
export function AccessoryMainStatsPanel({
  catalogs, picks, dispatch,
}: {
  catalogs: Record<string, MainStatEntry[]>;
  picks: Record<string, Record<string, boolean>>;
  dispatch: Dispatch<SolverAction>;
}) {
  return (
    <Panel
      title="Main stats"
      hint="Acceptable main stats per slot (OR). Only options you own at least one piece for are shown — picking an option the inventory has zero of would block every result."
      width="w-48"
    >
      <div className="space-y-1.5">
        {MAIN_STAT_SLOTS.map((row) => (
          <MainStatRow
            key={row.slot}
            label={row.label}
            entries={catalogs[row.slot] ?? []}
            picks={picks[row.slot] ?? {}}
            onToggle={(statKey) => dispatch({ type: "toggleMainPick", slot: row.slot, stat: statKey })}
          />
        ))}
      </div>
    </Panel>
  );
}

function MainStatRow({
  label, entries, picks, onToggle,
}: {
  label: string;
  entries: ReadonlyArray<MainStatEntry>;
  picks: Record<string, boolean>;
  onToggle: (statKey: string) => void;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-white/70">{label}</div>
      <div className="mt-0.5 flex flex-wrap gap-1">
        {entries.length === 0 ? (
          <span className="text-[10.5px] italic text-white/55">none owned</span>
        ) : (
          entries.map((e) => (
            <MainStatChip key={e.key} entry={e} picked={!!picks[e.key]} onClick={() => onToggle(e.key)} />
          ))
        )}
      </div>
    </div>
  );
}

/** Square icon chip for a main-stat OR-pick. Click toggles selection.
 *  Percent variants overlay a tiny `%` badge so ATK% reads distinctly from
 *  the flat ATK option. */
function MainStatChip({ entry, picked, onClick }: { entry: MainStatEntry; picked: boolean; onClick: () => void }) {
  const iconKey = statIconKeyFor(entry.key);
  const isPercent = entry.key.endsWith("Pct");
  return (
    <button
      type="button"
      title={`${entry.label} — ${entry.owned} owned · ${picked ? "selected (click to clear)" : "click to allow"}`}
      onClick={onClick}
      className={cx(
        "relative grid h-7 w-7 place-items-center rounded-md border transition-colors",
        picked
          ? "border-cyan-400/40 bg-cyan-500/10 hover:bg-cyan-500/20"
          : "border-white/10 bg-white/2 opacity-55 hover:opacity-100 hover:bg-white/6",
      )}
    >
      {/* `pointer-events-none` keeps the inner img / span from capturing
       *  the hover — otherwise StatIcon's own `title={meta.label}` would
       *  shadow this button's rich "{stat} — N owned" tooltip on icons
       *  that resolved to a real image (the text fallback span has no
       *  title so it doesn't shadow). */}
      <StatIcon stat={iconKey} size={16} className="pointer-events-none" />
      {isPercent && (
        <span className="pointer-events-none absolute -bottom-0.5 -left-0.5 grid h-3 w-3 place-items-center rounded-full bg-zinc-900 font-mono text-[8px] font-bold text-white">
          %
        </span>
      )}
    </button>
  );
}
