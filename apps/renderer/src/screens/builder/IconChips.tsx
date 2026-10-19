/**
 * Builder icon chips — set / effect chips, their tooltips and state badges,
 * shared by the Sets and Weapons & accessories panels.
 */
import { cx } from "../../design/cx.js";
import { GameText } from "../../design/GameText.js";
import { RichTooltip } from "../../design/RichTooltip.js";
import { ARMOR_SLOTS } from "../../lib/solver/setPlans.js";
import type { ChipState } from "../../lib/solver/builderFilters.js";
import type { ArmorSetEntry, EffectEntry } from "./catalogs.js";

/* ─────────────────────────────────────────────────────────────────────────
 * Icon chip atoms — shared by Sets and Weapons & accessories. Click cycles
 * the chip through its valid states; the surrounding panel owns the state
 * map. Two state machines:
 *  - effect chips:   off → required → excluded → off (a talisman's
 *                    `preferred`, set by a reco, goes to required)
 *  - set chips (require mode): off → req-2pc → req-4pc → off in the active plan
 *  - set chips (exclude mode): off → excluded → off (global ban list)
 *                    (each step the inventory/set can't form is skipped —
 *                    cf. `nextPlanCount` + the Sets panel hint)
 * ───────────────────────────────────────────────────────────────────────── */
export type SetChipState = "off" | "req-4pc" | "req-2pc" | "excluded";

/** State-driven chip styling — cyan for required, rose for excluded, dim
 *  for off. Reused by both chip flavors. */
function chipClasses(picked: boolean, excluded: boolean): string {
  if (picked) return "border-cyan-400/40 bg-cyan-500/10 hover:bg-cyan-500/20";
  if (excluded) return "border-rose-400/40 bg-rose-500/15 hover:bg-rose-500/25 opacity-90";
  return "border-white/10 bg-white/2 opacity-55 hover:opacity-100 hover:bg-white/6";
}

/** Armor-set chip — icon + piece-count badge (2 / 4 when required, ✕ when
 *  excluded). The cycle skips `req-2pc` for sets without a real 2pc effect,
 *  and any step that doesn't fit in the plan's remaining armor slots
 *  (`slotsFree`, own count excluded — mirrors the reducer's guard). */
export function SetIconChip({ set, state, mode, slotsFree = ARMOR_SLOTS, onClick }: { set: ArmorSetEntry; state: SetChipState; mode: "require" | "exclude"; slotsFree?: number; onClick: () => void }) {
  const picked = state === "req-2pc" || state === "req-4pc";
  const excluded = state === "excluded";
  const can2pc = set.has2pc && set.canForm2pc && slotsFree >= 2;
  const can4pc = set.has4pc && set.canForm4pc && slotsFree >= 4;
  const stateLabel =
    mode === "exclude"
      ? (state === "excluded" ? "excluded (click to clear)" : "click to exclude")
    : state === "off"
      ? (can2pc ? "click to require 2pc"
        : can4pc ? "click to require 4pc"
        : `no room left in this plan (${ARMOR_SLOTS} armor slots max) — clear a set first`)
    : state === "req-2pc" ? (can4pc ? "required 2pc (click to switch to 4pc)" : "required 2pc (click to clear)")
    : "required 4pc (click to clear)";
  return (
    <RichTooltip content={<SetTooltipBody set={set} stateLabel={stateLabel} />}>
      <button
        type="button"
        onClick={onClick}
        className={cx("relative grid h-7 w-7 place-items-center rounded-md border transition-colors", chipClasses(picked, excluded))}
      >
        <img src={`/img/ui/effect/${set.icon}.webp`} alt={set.name} className="pointer-events-none h-5 w-5 object-contain" />
        <SetBadge state={state} />
      </button>
    </RichTooltip>
  );
}

/** Three-section tooltip body (header / effects / state). Effect lines
 *  flow through `GameText` so the in-game `<color=#hex>…</color>` tags
 *  render with their original highlight colors (e.g. cyan values, red
 *  debuffs). Skips rows the set doesn't carry at T4. */
function SetTooltipBody({ set, stateLabel }: { set: ArmorSetEntry; stateLabel: string }) {
  return (
    <div className="space-y-1">
      <div className="text-[11.5px] font-semibold">
        {set.name} <span className="font-normal text-white/60">({set.owned} owned)</span>
      </div>
      <div className="border-t border-white/10" />
      {set.has2pc && (
        <div className="text-[11px] leading-snug">
          <span className="mr-1 font-mono text-white/60">2pc</span>
          <GameText text={set.desc2pc ?? "(no description)"} />
        </div>
      )}
      {set.has4pc && (
        <div className="text-[11px] leading-snug">
          <span className="mr-1 font-mono text-white/60">4pc</span>
          <GameText text={set.desc4pc ?? "(no description)"} />
        </div>
      )}
      <div className="border-t border-white/10" />
      <div className="text-[10.5px] italic text-white/70">{stateLabel}</div>
    </div>
  );
}

/** Weapon / accessory / talisman effect chip — off/required/excluded, plus a
 *  talisman's `preferred` (the required tone with a dashed border). */
export function EffectIconChip({ effect, state, onClick }: { effect: EffectEntry; state: ChipState; onClick: () => void }) {
  const stateLabel =
    state === "off" ? "click to require"
    : state === "preferred" ? "preferred by the recommendation (click to require)"
    : state === "required" ? "required (click to exclude)"
    : "excluded (click to clear)";
  return (
    <RichTooltip content={<EffectTooltipBody effect={effect} stateLabel={stateLabel} />}>
      <button
        type="button"
        onClick={onClick}
        className={cx(
          "relative grid h-7 w-7 place-items-center rounded-md border transition-colors",
          chipClasses(state === "required" || state === "preferred", state === "excluded"),
          state === "preferred" && "border-dashed",
        )}
      >
        {effect.icon ? (
          <img src={`/img/ui/effect/${effect.icon}.webp`} alt={effect.name} className="pointer-events-none h-5 w-5 object-contain" />
        ) : (
          // No curated icon — show the effect's initials so the chip is still
          // identifiable (and we don't request `/img/ui/effect/.webp` → 404).
          <span className="pointer-events-none text-[9px] font-semibold uppercase text-white/70">{effect.name.slice(0, 2)}</span>
        )}
        <EffectBadge state={state} />
      </button>
    </RichTooltip>
  );
}

/** Same three-section layout as `SetTooltipBody` — header / T4 description
 *  via `GameText` (renders the in-game `<color>` highlights) / state hint. */
function EffectTooltipBody({ effect, stateLabel }: { effect: EffectEntry; stateLabel: string }) {
  return (
    <div className="space-y-1">
      <div className="text-[11.5px] font-semibold">
        {effect.name} <span className="font-normal text-white/60">({effect.owned} owned)</span>
      </div>
      <div className="border-t border-white/10" />
      <div className="text-[11px] leading-snug">
        <GameText text={effect.descT4 ?? "(no description)"} />
      </div>
      <div className="border-t border-white/10" />
      <div className="text-[10.5px] italic text-white/70">{stateLabel}</div>
    </div>
  );
}

function SetBadge({ state }: { state: SetChipState }) {
  if (state === "off") return null;
  const label = state === "req-4pc" ? "4" : state === "req-2pc" ? "2" : "✕";
  const tone = state === "excluded" ? "text-rose-300" : "text-cyan-200";
  return (
    <span className={cx("absolute -bottom-0.5 -right-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-zinc-900 font-mono text-[9px] font-bold", tone)}>
      {label}
    </span>
  );
}

function EffectBadge({ state }: { state: ChipState }) {
  if (state === "off") return null;
  const label = state === "required" ? "✓" : state === "preferred" ? "~" : "✕";
  const tone = state === "excluded" ? "text-rose-300" : "text-cyan-200";
  return (
    <span className={cx("absolute -bottom-0.5 -right-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-zinc-900 font-mono text-[9px] font-bold", tone)}>
      {label}
    </span>
  );
}
