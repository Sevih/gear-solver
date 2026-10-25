/**
 * Builder toolbar — hero picker, Solve split button, quick toggles and the
 * popover buttons that open the filter panels.
 */
import { useEffect, useState, type Dispatch, type ReactNode } from "react";
import type { GameData, Inventory } from "@gear-solver/core";
import { effectiveCharacter } from "@gear-solver/core";
import { CharacterPortrait } from "../../design/EquipmentIcon.js";
import { cx } from "../../design/cx.js";
import type { DmgSkillInfo } from "../../lib/dmgSkill.js";
import type { ReforgeMode } from "../../lib/solver/engine.js";
import type { SolveMode } from "../../lib/solver/types.js";
import type { SolverAction, SolverFilters } from "../../lib/solver/builderFilters.js";
import type { ArmorSetEntry, EffectEntry, MainStatEntry } from "./catalogs.js";
import { displayNameOf } from "./heroName.js";
import { HeroSelect } from "./HeroSelect.js";
import { OptionsPanel } from "./OptionsPanel.js";
import { StatFiltersPanel } from "./StatFiltersPanel.js";
import { RatingFiltersPanel } from "./RatingFiltersPanel.js";
import { SubstatPriorityPanel } from "./SubstatPriorityPanel.js";
import { AccessoryMainStatsPanel } from "./AccessoryMainStatsPanel.js";
import { SetsPanel } from "./SetsPanel.js";
import { WeaponsAccessoriesPanel } from "./WeaponsAccessoriesPanel.js";
import { useClickOutside } from "./useClickOutside.js";
import { REFORGE_MODES } from "./reforge.js";

/* ─────────────────────────────────────────────────────────────────────────
 * Builder toolbar — Direction B (toolbar + popovers). A slim top bar carries
 * the always-needed controls (hero · Solve / Solve CP · two quick toggles);
 * the heavier filters live behind labeled popovers with active-count badges,
 * so the results table below can run near edge-to-edge. Each popover reuses
 * the existing panel components verbatim — only the layout/chrome is new.
 * ───────────────────────────────────────────────────────────────────────── */
export function BuilderToolbar({
  heroes, game, selectedUid, onSelect,
  armorSets, weaponEffects, accessoryEffects, talismanEffects, mainStatCatalogs,
  filters, dispatch,
  solving, canSolve, solveMode, setSolveMode, onSolve, onCancelSolve,
  canFilter, filterActive, onFilter, onClearFilter, dmgSkill,
}: {
  heroes: Inventory["characters"];
  game: GameData | null;
  /** Picked hero's best-skill factor (Rating filters tooltips). */
  dmgSkill: DmgSkillInfo | null;
  selectedUid: string | null;
  onSelect: (uid: string | null) => void;
  armorSets: ArmorSetEntry[];
  weaponEffects: EffectEntry[];
  accessoryEffects: EffectEntry[];
  talismanEffects: EffectEntry[];
  mainStatCatalogs: Record<string, MainStatEntry[]>;
  filters: SolverFilters;
  dispatch: Dispatch<SolverAction>;
  solving: boolean;
  canSolve: boolean;
  /** Primary SOLVE mode (split button) — lifted so the parent's cartesian
   *  estimate can prepare pools for the mode that will fire. */
  solveMode: SolveMode;
  setSolveMode: (m: SolveMode) => void;
  onSolve: (mode: SolveMode) => void;
  onCancelSolve: () => void;
  /** Whether the post-solve Filter action can run (results stored + a band set). */
  canFilter: boolean;
  /** Whether a client filter is currently narrowing the stored results. */
  filterActive: boolean;
  onFilter: () => void;
  onClearFilter: () => void;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const close = () => setOpenKey(null);
  const toggle = (k: string) => setOpenKey((cur) => (cur === k ? null : k));

  // Active-count badges — how many constraints each popover currently holds,
  // so the user can see what's set without opening every one.
  const statCount = Object.keys(filters.statFilters).length;
  const ratingCount = Object.keys(filters.ratingFilters).length;
  const priorityCount = Object.keys(filters.priority).length;
  const mainCount = [...Object.values(filters.mainPicks), ...Object.values(filters.mainExcludes)]
    .reduce((n, m) => n + Object.values(m).filter(Boolean).length, 0);
  const setCount = filters.setPlans.filter((p) => p.length > 0).length + filters.excludedSets.length;
  const effectCount = Object.keys(filters.weaponEffectPicks).length + Object.keys(filters.accessoryEffectPicks).length
    + Object.keys(filters.talismanEffectPicks).length;
  // Options badge counts only the constraints that deviate from the defaults
  // (equipped scope off its "lower" baseline either way, keep-current on,
  // broken-sets disallowed, min-quality set, plus each excluded hero).
  const optionCount =
    (filters.options.equippedScope !== "lower" ? 1 : 0) +
    (filters.options.keepCurrent ? 1 : 0) +
    (filters.options.allowBrokenSets ? 0 : 1) +
    (filters.minQuality ? 1 : 0) +
    filters.excludedHeroes.size;

  const selectedHero = selectedUid ? heroes.find((c) => c.uid === selectedUid) ?? null : null;
  // Fused hero: the fusion's portrait and sheet, as on the Builds card.
  const selectedDisplay = selectedHero ? effectiveCharacter(selectedHero, game?.characters) : null;
  const selectedMeta = selectedDisplay?.def ?? null;

  return (
    <div className="relative flex shrink-0 flex-col gap-2 rounded-lg border border-white/8 bg-bg-elev-2 px-2.5 py-2">
      {/* Row 1 — selected hero (portrait + search) and the primary actions. */}
      <div className="flex items-center gap-2">
        {selectedHero ? (
          <CharacterPortrait
            charId={selectedDisplay!.charId}
            name={displayNameOf(selectedHero, selectedMeta)}
            cls={selectedMeta?.cls}
            element={selectedMeta?.element}
            size={36}
          />
        ) : (
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-dashed border-white/12 bg-black/20 text-[14px] text-white/30">?</div>
        )}
        <div className="w-52 shrink-0">
          <HeroSelect heroes={heroes} game={game} value={selectedUid} onChange={onSelect} />
        </div>
        <SolveButton solving={solving} canSolve={canSolve} mode={solveMode} setMode={setSolveMode} onSolve={onSolve} onCancelSolve={onCancelSolve} />
        {/* Post-solve client filter: re-applies the stat/rating bands to the
         *  stored results without re-solving (instant after the first solve). */}
        <button
          type="button"
          onClick={onFilter}
          disabled={!canFilter || solving}
          title="Filter the existing results by the stat/rating bands — no re-solve (instant after the first optimization)."
          className={cx(
            "h-9 shrink-0 rounded-lg border px-3.5 text-[11px] font-semibold uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-40",
            filterActive
              ? "border-amber-400/50 bg-amber-400/12 text-amber-200 hover:bg-amber-400/20"
              : "border-white/12 bg-white/4 text-white/70 hover:text-white",
          )}
        >
          Filter
        </button>
        {filterActive && (
          <button
            type="button"
            onClick={onClearFilter}
            title="Show all stored results again."
            className="h-9 shrink-0 rounded-lg px-1 text-[11px] text-white/65 hover:text-white/80"
          >
            ✕
          </button>
        )}
      </div>

      {/* Row 2 — reforge mode, the quick toggle, and the filter popovers. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <ReforgeModeControl value={filters.options.reforgeMode} dispatch={dispatch} />
        <ToolbarToggle
          label="Maxed only"
          on={filters.options.onlyMaxed}
          onClick={() => dispatch({ type: "setOption", key: "onlyMaxed", value: !filters.options.onlyMaxed })}
          title="No extrapolation — only pieces ALREADY at their own ceiling in the reforge mode (or better), scored on their real rolls. Off mode: any piece as-is · +10R6: enhance ≥10 & ≥6 reforges · +10R9: enhance ≥10 & ≥9 reforges · +15R9: +15 & ≥9 reforges. A piece that can't ascend (under 6★, or a 6★ that isn't Unique) only needs +10 and its own reforges (its star, 6 for a 6★)."
        />
        <ToolbarToggle
          label="Transistone potential"
          on={filters.options.rerollPotential ?? false}
          onClick={() => dispatch({ type: "setOption", key: "rerollPotential", value: !(filters.options.rerollPotential ?? false) })}
          title="Project the best eligible substat line up to level 4 — a 6★ Legendary without a stage-4 line can reroll one line to stage 4 by Transistone (a 5 % draw per pass; reforge ticks are kept). The line: the hero's highest-priority substat, else the largest roll. Works with or without a reforge mode; ignored under Maxed only (no extrapolation)."
        />
        <ToolbarDivider />
        <PopoverButton label="Options" count={optionCount} openKey={openKey} myKey="options" onToggle={toggle} onClose={close}>
          <OptionsPanel options={filters.options} minQuality={filters.minQuality} excludedHeroes={filters.excludedHeroes} heroes={heroes} game={game} dispatch={dispatch} />
        </PopoverButton>
        <PopoverButton label="Stat filters" count={statCount} openKey={openKey} myKey="stat" onToggle={toggle} onClose={close}>
          <StatFiltersPanel filters={filters.statFilters} dispatch={dispatch} />
        </PopoverButton>
        <PopoverButton label="Ratings" count={ratingCount} openKey={openKey} myKey="rating" onToggle={toggle} onClose={close}>
          <RatingFiltersPanel filters={filters.ratingFilters} dispatch={dispatch} dmgSkill={dmgSkill} />
        </PopoverButton>
        <PopoverButton label="Priority" count={priorityCount} accent="violet" openKey={openKey} myKey="priority" onToggle={toggle} onClose={close}>
          <SubstatPriorityPanel priority={filters.priority} topPct={filters.topPct} dispatch={dispatch} />
        </PopoverButton>
        <PopoverButton label="Mains" count={mainCount} openKey={openKey} myKey="mains" onToggle={toggle} onClose={close}>
          <AccessoryMainStatsPanel catalogs={mainStatCatalogs} picks={filters.mainPicks} excludes={filters.mainExcludes} dispatch={dispatch} />
        </PopoverButton>
        <PopoverButton label="Sets" count={setCount} accent="violet" openKey={openKey} myKey="sets" onToggle={toggle} onClose={close}>
          <SetsPanel sets={armorSets} setPlans={filters.setPlans} excludedSets={filters.excludedSets} dispatch={dispatch} />
        </PopoverButton>
        <PopoverButton label="Effects" count={effectCount} align="right" openKey={openKey} myKey="effects" onToggle={toggle} onClose={close}>
          <WeaponsAccessoriesPanel
            weapons={weaponEffects}
            accessories={accessoryEffects}
            talismans={talismanEffects}
            weaponPicks={filters.weaponEffectPicks}
            accPicks={filters.accessoryEffectPicks}
            talismanPicks={filters.talismanEffectPicks}
            dispatch={dispatch}
          />
        </PopoverButton>
        <button
          type="button"
          onClick={() => dispatch({ type: "resetAll" })}
          className="ml-auto shrink-0 text-[11px] text-white/70 underline-offset-2 hover:text-white/80 hover:underline"
        >
          reset filters
        </button>
      </div>
    </div>
  );
}

/** Split SOLVE button — one primary action that runs the current mode
 *  (Score / Combat Power), plus a ▾ that opens a small menu to switch mode
 *  (picking a mode both keeps it and runs it). The mode is NOT persisted: it
 *  lives in the screen's `solveMode` state and starts on Solve (Score) at each
 *  visit. While solving it becomes a Cancel button. */
const SOLVE_MODES: { value: SolveMode; label: string; desc: string }[] = [
  { value: "score", label: "Solve", desc: "Maximize a priority-weighted Score" },
  { value: "cp", label: "Solve CP", desc: "Maximize in-game Combat Power" },
];
function SolveButton({ solving, canSolve, mode, setMode, onSolve, onCancelSolve }: {
  solving: boolean;
  canSolve: boolean;
  mode: SolveMode;
  setMode: (m: SolveMode) => void;
  onSolve: (mode: SolveMode) => void;
  onCancelSolve: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(open, () => setOpen(false));
  if (solving) {
    return (
      <button
        type="button"
        onClick={onCancelSolve}
        className="h-9 shrink-0 rounded-lg border border-rose-400/40 bg-rose-500/10 px-5 text-[12px] font-bold uppercase tracking-wider text-rose-200 transition-colors hover:bg-rose-500/20"
      >
        Cancel
      </button>
    );
  }
  const current = SOLVE_MODES.find((m) => m.value === mode) ?? SOLVE_MODES[1]!;
  const grad = { background: "linear-gradient(180deg,#22d3ee,#0bb6d4)", boxShadow: "0 0 0 1px rgba(34,211,238,0.5),0 6px 16px -6px rgba(34,211,238,0.6)" };
  return (
    <div ref={ref} className="relative flex shrink-0">
      <button
        type="button"
        onClick={() => onSolve(mode)}
        disabled={!canSolve}
        style={grad}
        className="h-9 rounded-l-lg px-5 text-[12px] font-bold uppercase tracking-wider text-[#06262b] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {current.label}
      </button>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={!canSolve}
        aria-label="Change solve mode"
        aria-expanded={open}
        style={grad}
        className="grid h-9 w-7 place-items-center rounded-r-lg border-l border-[#06262b]/25 text-[10px] text-[#06262b] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {open ? "▴" : "▾"}
      </button>
      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-40 w-52 overflow-hidden rounded-lg border border-white/10 bg-zinc-900 shadow-2xl shadow-black/70">
          {SOLVE_MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => { setMode(m.value); setOpen(false); onSolve(m.value); }}
              className={cx("flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-white/6", m.value === mode && "bg-cyan-500/10")}
            >
              <span className="text-[12px] font-bold uppercase tracking-wider text-white">{m.label}</span>
              <span className="text-[10.5px] leading-snug text-white/60">{m.desc}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Slim divider between toolbar groups. */
function ToolbarDivider() {
  return <span className="h-6 w-px shrink-0 bg-white/10" />;
}

/** Reforge-mode segmented control — Off / +10R6 / +10R9 / +15R9. Replaces the
 *  old binary "Reforged" toggle: each chip projects pool pieces to a different
 *  endgame ceiling (see REFORGE_MODES). The active chip is highlighted; the
 *  whole strip carries a label so it reads as one control. */
function ReforgeModeControl({ value, dispatch }: { value: ReforgeMode; dispatch: Dispatch<SolverAction> }) {
  return (
    <div className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/4 pl-2.5 pr-1">
      <span className="text-[11px] text-white/70">Reforge</span>
      <div className="flex items-center gap-0.5">
        {REFORGE_MODES.map((m) => {
          const on = value === m.value;
          return (
            <button
              key={m.value}
              type="button"
              onClick={() => dispatch({ type: "setReforgeMode", value: m.value })}
              aria-pressed={on}
              title={m.hint}
              className={cx(
                "h-5 rounded px-1.5 text-[10.5px] font-semibold transition-colors",
                on ? "bg-cyan-400/20 text-cyan-200" : "text-white/70 hover:text-white/80",
              )}
            >
              {m.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Compact inline toggle pill (the two always-visible quick options). */
function ToolbarToggle({ label, on, onClick, title }: { label: string; on: boolean; onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={title}
      className={cx(
        "flex h-7 shrink-0 items-center gap-2 rounded-lg border px-2.5 text-[11px] transition-colors",
        on ? "border-cyan-400/50 bg-cyan-400/10 text-cyan-200" : "border-white/10 bg-white/4 text-white/70 hover:text-white",
      )}
    >
      <span
        className={cx(
          "relative h-4 w-7 shrink-0 rounded-full border transition-colors",
          on ? "border-cyan-400/55 bg-cyan-400/25" : "border-white/10 bg-zinc-700",
        )}
      >
        <span
          className={cx(
            "absolute top-px h-3 w-3 rounded-full transition-all",
            on ? "left-3.25 bg-cyan-300" : "left-px bg-zinc-400",
          )}
        />
      </span>
      {label}
    </button>
  );
}

/** Toolbar popover trigger — a labeled pill with an optional active-count
 *  badge that floats its children (an existing filter panel) below on click.
 *  Only one popover is open at a time (driven by the parent's `openKey`);
 *  outside-click and Escape close it. `accent` tints the active state /
 *  badge (cyan default, violet for priority/sets). `align="right"` anchors
 *  the floating panel to the trigger's right edge so right-side popovers
 *  don't overflow the viewport. */
function PopoverButton({
  label, count, accent = "cyan", align = "left", openKey, myKey, onToggle, onClose, children,
}: {
  label: string;
  count: number;
  accent?: "cyan" | "violet";
  align?: "left" | "right";
  openKey: string | null;
  myKey: string;
  onToggle: (k: string) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const open = openKey === myKey;
  const ref = useClickOutside<HTMLDivElement>(open, onClose);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const activeTone = accent === "violet"
    ? "border-violet-400/50 bg-violet-400/12 text-violet-200 shadow-[0_0_16px_-4px_rgba(157,81,255,0.5)]"
    : "border-cyan-400/50 bg-cyan-400/12 text-cyan-200 shadow-[0_0_16px_-4px_rgba(34,211,238,0.5)]";
  const badgeTone = accent === "violet" ? "bg-violet-400/25 text-violet-200" : "bg-cyan-400/20 text-cyan-200";
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => onToggle(myKey)}
        aria-expanded={open}
        className={cx(
          "flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-semibold transition-colors",
          open ? activeTone : "border-white/10 bg-white/4 text-white/70 hover:text-white",
        )}
      >
        {label}
        {count > 0 && (
          <span className={cx("rounded px-1.5 font-mono text-[9px] tabular-nums", badgeTone)}>{count}</span>
        )}
        <span className="text-[8px] text-white/65">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className={cx("absolute top-[calc(100%+8px)] z-40 rounded-lg bg-bg-elev-1 shadow-2xl shadow-black/70", align === "right" ? "right-0" : "left-0")}>
          {children}
        </div>
      )}
    </div>
  );
}
