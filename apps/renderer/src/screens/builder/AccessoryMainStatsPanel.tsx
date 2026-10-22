/**
 * Builder main stats panel — per-slot OR-list of acceptable main stats, plus
 * the main stats ruled out of the slot.
 */
import type { Dispatch } from "react";
import { StatIcon } from "../../design/EquipmentIcon.js";
import { cx } from "../../design/cx.js";
import type { SolverAction } from "../../lib/solver/builderFilters.js";
import type { MainStatEntry } from "./catalogs.js";
import { Panel } from "./Panel.js";
import { MAIN_STAT_SLOTS, statIconKeyFor } from "./statColumns.js";

/* ─────────────────────────────────────────────────────────────────────────
 * Accessory main stats panel — per-slot OR-list of acceptable mains, and
 * excluded mains (a piece carrying one never enters the pool)
 * ───────────────────────────────────────────────────────────────────────── */
type MainChipState = "off" | "allowed" | "excluded";

export function AccessoryMainStatsPanel({
  catalogs, picks, excludes, dispatch,
}: {
  catalogs: Record<string, MainStatEntry[]>;
  picks: Record<string, Record<string, boolean>>;
  excludes: Record<string, Record<string, boolean>>;
  dispatch: Dispatch<SolverAction>;
}) {
  return (
    <Panel
      title="Main stats"
      hint="Click a main stat to cycle off → allowed → excluded. Allowed = acceptable mains per slot (OR); excluded = a piece with that main never enters the pool — e.g. rule out ATK talismans when a teammate already brings one (talisman mains are shared by the team and don't stack). Only options you own at least one piece for are shown — allowing an option the inventory has zero of would block every result."
      width="w-48"
    >
      <div className="space-y-1.5">
        {MAIN_STAT_SLOTS.map((row) => (
          <MainStatRow
            key={row.slot}
            label={row.label}
            entries={catalogs[row.slot] ?? []}
            picks={picks[row.slot] ?? {}}
            excludes={excludes[row.slot] ?? {}}
            // off → allowed (accept), allowed → excluded (the exclude toggle
            // clears the acceptance), excluded → off.
            onCycle={(statKey, state) => dispatch(state === "off"
              ? { type: "toggleMainPick", slot: row.slot, stat: statKey }
              : { type: "toggleMainExclude", slot: row.slot, stat: statKey })}
          />
        ))}
      </div>
    </Panel>
  );
}

function MainStatRow({
  label, entries, picks, excludes, onCycle,
}: {
  label: string;
  entries: ReadonlyArray<MainStatEntry>;
  picks: Record<string, boolean>;
  excludes: Record<string, boolean>;
  onCycle: (statKey: string, state: MainChipState) => void;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-white/70">{label}</div>
      <div className="mt-0.5 flex flex-wrap gap-1">
        {entries.length === 0 ? (
          <span className="text-[10.5px] italic text-white/55">none owned</span>
        ) : (
          entries.map((e) => {
            const state: MainChipState = excludes[e.key] ? "excluded" : picks[e.key] ? "allowed" : "off";
            return <MainStatChip key={e.key} entry={e} state={state} onClick={() => onCycle(e.key, state)} />;
          })
        )}
      </div>
    </div>
  );
}

/** Square icon chip for a main stat. Click cycles off → allowed → excluded
 *  (same tones as the effect chips: cyan allowed, rose with a ✕ excluded).
 *  Percent variants overlay a tiny `%` badge so ATK% reads distinctly from
 *  the flat ATK option. */
function MainStatChip({ entry, state, onClick }: { entry: MainStatEntry; state: MainChipState; onClick: () => void }) {
  const iconKey = statIconKeyFor(entry.key);
  const isPercent = entry.key.endsWith("Pct");
  const stateLabel =
    state === "off" ? "click to allow"
    : state === "allowed" ? "allowed (click to exclude)"
    : "excluded (click to clear)";
  return (
    <button
      type="button"
      title={`${entry.label} — ${entry.owned} owned · ${stateLabel}`}
      onClick={onClick}
      className={cx(
        "relative grid h-7 w-7 place-items-center rounded-md border transition-colors",
        state === "allowed"
          ? "border-cyan-400/40 bg-cyan-500/10 hover:bg-cyan-500/20"
          : state === "excluded"
            ? "border-rose-400/40 bg-rose-500/15 hover:bg-rose-500/25 opacity-90"
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
      {state === "excluded" && (
        <span className="pointer-events-none absolute -bottom-0.5 -right-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-zinc-900 font-mono text-[9px] font-bold text-rose-300">
          ✕
        </span>
      )}
    </button>
  );
}
