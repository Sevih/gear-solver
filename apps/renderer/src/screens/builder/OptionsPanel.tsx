/**
 * Builder options panel — pool / steal toggles and the exclude-heroes picker.
 */
import { useMemo, useState, type Dispatch } from "react";
import type { GameData, Inventory } from "@gear-solver/core";
import { effectiveCharacter } from "@gear-solver/core";
import { cx } from "../../design/cx.js";
import { HoverHint } from "../../design/HoverHint.js";
import type { EquippedScope } from "../../lib/solver/types.js";
import type { SolverAction, SolverOptions } from "../../lib/solver/builderFilters.js";
import { QUALITY_TIERS, QUALITY_LABEL, type QualityTier } from "../../lib/quality.js";
import { Panel } from "./Panel.js";
import { useClickOutside } from "./useClickOutside.js";
import { displayNameOf, heroSearchHaystack } from "./heroName.js";

/** UI metadata for the Options "Equipped items" scope (see `EquippedScope`). */
const EQUIPPED_SCOPES: ReadonlyArray<{ value: EquippedScope; label: string; hint: string }> = [
  { value: "none",  label: "None",    hint: "Only the selected hero's own gear + free (unequipped) gear." },
  { value: "lower", label: "≤ Lower", hint: "Also gear on heroes ranked strictly lower than this one in Builds (unranked = lowest). Never strips an equal/higher-priority hero." },
  { value: "all",   label: "All",     hint: "Any equipped gear, regardless of which hero wears it (legacy)." },
];

/* ─────────────────────────────────────────────────────────────────────────
 * Options panel — pool / steal toggles + exclude-heroes multi-pill
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
    <Panel title="Options" hint="Pool toggles. Equipped items + Exclude equipped together drive what gear the solver may touch. (Reforged / Maxed-only live as quick toggles in the toolbar.)" width="w-52">
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
        <ExcludeHeroesPicker
          excluded={excludedHeroes}
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

/** Combobox-style multi-select for "Exclude equipped" — drops all gear
 *  currently equipped on the listed heroes from the solver's pool. Closed
 *  state shows count + clear ✕; open state is a searchable list of heroes
 *  with checkboxes. Reuses the Hero picker haystack (display name +
 *  nickname + charId + 'core fusion' tag). */
function ExcludeHeroesPicker({
  excluded, heroes, game, onToggle, onClear,
}: {
  excluded: ReadonlySet<string>;
  heroes: Inventory["characters"];
  game: GameData | null;
  onToggle: (uid: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useClickOutside<HTMLDivElement>(open, () => setOpen(false));
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return heroes;
    return heroes.filter((c) => heroSearchHaystack(c, game).includes(q));
  }, [heroes, game, query]);
  return (
    // Two sibling buttons inside a flex wrapper instead of a nested
    // <span role="button"> inside the toggle <button> — the previous shape
    // was invalid HTML and not keyboard-reachable for the clear action.
    <div
      ref={wrapRef}
      className="relative flex w-full items-center gap-0 rounded-md border border-white/8 bg-black/30 text-[11px] text-white/70 hover:bg-white/6"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex flex-1 items-center justify-between gap-1.5 px-2 py-1 text-left focus:outline-none"
        title="Drop gear currently equipped on these heroes from the solver's candidate pool."
      >
        <span className="truncate">
          {excluded.size === 0 ? "Exclude equipped" : `Excluded: ${excluded.size}`}
        </span>
        <span className="text-white/55">▾</span>
      </button>
      {excluded.size > 0 && (
        <button
          type="button"
          onClick={() => onClear()}
          className="px-1.5 py-1 text-white/65 hover:text-rose-300 focus:outline-none"
          title="Clear all"
          aria-label="Clear all excluded heroes"
        >✕</button>
      )}
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 flex max-h-72 flex-col overflow-hidden rounded-md border border-white/10 bg-zinc-900 shadow-lg">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
            autoFocus
            placeholder="Search hero…"
            className="shrink-0 border-b border-white/8 bg-black/30 px-2 py-1 text-[11px] text-white placeholder:text-white/55 focus:outline-none"
          />
          <ul className="min-h-0 flex-1 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-2 py-2 text-[11px] italic text-white/65">No hero matches</li>
            ) : filtered.map((c) => {
              const meta = effectiveCharacter(c, game?.characters).def;
              const checked = excluded.has(c.uid);
              return (
                <li key={c.uid}>
                  <label className="flex cursor-pointer items-center gap-2 px-2 py-1 hover:bg-white/6">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(c.uid)}
                      className="h-3.5 w-3.5 shrink-0 accent-cyan-400"
                    />
                    <span className="truncate text-[11.5px] text-white">{displayNameOf(c, meta)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
