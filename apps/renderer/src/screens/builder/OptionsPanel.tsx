/**
 * Builder options panel — pool / steal toggles and the "Don't take from…"
 * hero picker.
 */
import type { Dispatch } from "react";
import type { GameData, Inventory } from "@gear-solver/core";
import { cx } from "../../design/cx.js";
import { HeroPicker } from "../../design/HeroPicker.js";
import { HoverHint } from "../../design/HoverHint.js";
import type { EquippedScope } from "../../lib/solver/types.js";
import type { SolverAction, SolverOptions } from "../../lib/solver/builderFilters.js";
import { QUALITY_TIERS, QUALITY_LABEL, type QualityTier } from "../../lib/quality.js";
import { Panel } from "./Panel.js";

/** UI metadata for the Options "Equipped items" scope (see `EquippedScope`). */
const EQUIPPED_SCOPES: ReadonlyArray<{ value: EquippedScope; label: string; hint: string }> = [
  { value: "none",  label: "None",    hint: "Only the selected hero's own gear + free (unequipped) gear." },
  { value: "lower", label: "≤ Lower", hint: "Also gear on heroes ranked strictly lower than this one in Builds (unranked = lowest). Never strips an equal/higher-ranked hero." },
  { value: "all",   label: "All",     hint: "Any equipped gear, regardless of which hero wears it (legacy)." },
];

/* ─────────────────────────────────────────────────────────────────────────
 * Options panel — pool / steal toggles + "Don't take from…" hero picker
 * ───────────────────────────────────────────────────────────────────────── */
export function OptionsPanel({
  options, minQuality, excludedHeroes, heroes, game, dispatch,
}: {
  options: SolverOptions;
  minQuality: QualityTier | null;
  excludedHeroes: ReadonlySet<string>;
  heroes: Inventory["characters"];
  game: GameData | null;
  dispatch: Dispatch<SolverAction>;
}) {
  const set = (key: Exclude<keyof SolverOptions, "reforgeMode" | "equippedScope">) => (v: boolean) => dispatch({ type: "setOption", key, value: v });
  return (
    <Panel title="Options" hint="Pool toggles. Equipped items + Don't take from… together drive what gear the solver may touch. (The reforge mode, Maxed only and Transistone potential sit in the toolbar.)" width="w-52">
      <div className="space-y-0.5">
        <div className="flex items-center justify-between gap-2 py-0.5">
          <HoverHint className="text-[11px] text-white/80" name="Equipped items" text="Which gear equipped on OTHER heroes the solver may pull in (your own hero's gear is always in). None = own + free only · ≤ Lower = also heroes ranked below this one in Builds (never strips an equal/higher hero) · All = any equipped gear." />
          <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-white/10 bg-white/4 p-0.5">
            {EQUIPPED_SCOPES.map((s) => {
              const on = (options.equippedScope ?? "lower") === s.value;
              return (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => dispatch({ type: "setEquippedScope", value: s.value })}
                  aria-pressed={on}
                  title={s.hint}
                  className={cx("h-5 whitespace-nowrap rounded px-1.5 text-[10px] font-semibold transition-colors", on ? "bg-cyan-400/20 text-cyan-200" : "text-white/65 hover:text-white/85")}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>
        <ToggleRow label="Keep current" hint="Lock current pieces (only fill empty slots). Gems are still re-allocated — useful for 'keep my gear, tell me which gems to socket'." checked={options.keepCurrent} onChange={set("keepCurrent")} />
        <ToggleRow label="Allow broken sets" hint="On (default): a partial set requirement (e.g. a single 2pc) lets any gear fill the free armor slots. Off: every armor piece must complete a 2pc/4pc — the solver also prunes set-less pieces from the pool, so a fully-constrained requirement (2pc+2pc / 4pc) searches far fewer combos." checked={options.allowBrokenSets} onChange={set("allowBrokenSets")} />
      </div>
      <label className="mt-2 flex items-center justify-between gap-2" title="Drop gear below this rolled-substat quality from the pool. Talisman / EE have no quality and are always kept.">
        <span className="text-[11px] text-white/80">Min quality</span>
        <select
          value={minQuality ?? ""}
          onChange={(e) => dispatch({ type: "setMinQuality", value: (e.target.value || null) as QualityTier | null })}
          className="rounded-md border border-white/8 bg-black/30 px-1.5 py-0.5 text-[11px] text-white focus:border-cyan-400/40 focus:outline-none"
        >
          <option value="">Any</option>
          {QUALITY_TIERS.map((q) => (
            <option key={q} value={q}>{QUALITY_LABEL[q]}</option>
          ))}
        </select>
      </label>
      <div className="mt-2">
        {/* "Don't take from…" — drops all gear currently equipped on the
         *  ticked heroes from the solver's pool. */}
        <HeroPicker
          mode="multi"
          label="Don't take from…"
          title="Drop gear currently equipped on these heroes from the solver's candidate pool."
          showCount
          values={excludedHeroes}
          heroes={heroes}
          game={game}
          onToggle={(uid) => dispatch({ type: "toggleHeroExcluded", uid })}
          onClear={() => dispatch({ type: "clearExcludedHeroes" })}
        />
      </div>
    </Panel>
  );
}

function ToggleRow({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-white/4" title={hint}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 shrink-0 accent-cyan-400"
      />
      <span className="truncate text-[11px] text-white">{label}</span>
    </label>
  );
}
