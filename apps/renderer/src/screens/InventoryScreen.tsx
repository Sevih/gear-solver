import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Character, GameData, Inventory } from "@gear-solver/core";
import { cx } from "../design/cx.js";
import { jsonWithSets, usePersistedState } from "../hooks/usePersistedState.js";
import { CharFace, EquipmentIcon, SlotIcon, StatIcon } from "../design/EquipmentIcon.js";
import {
  RARITY, SINGULARITY_GRADIENT_H, SLOTS, STAT,
  type DesignRarity, type SlotId,
} from "../design/tokens.js";
import { toUiPiece, type UiPiece } from "../design/adapter.js";
import { GameText } from "../design/GameText.js";
import { HoverHint } from "../design/HoverHint.js";

// ── quality tiers (shared between filter panel + detail panel) ─────────
// Tier type + the score→tier thresholds live in lib/quality.ts (single source
// of truth, also used by the Builder's solve-pool quality filter). QUALITY_TONE
// stays here — it's UI-only (bar color + filter pill).
import { QUALITY_COLOR, QUALITY_TIERS, qualityTierFromScore, type QualityTier } from "../lib/quality.js";
export const QUALITY_TONE: Record<QualityTier, { text: string; bar: string; label: string }> = {
  poor:      { text: "text-white",      bar: QUALITY_COLOR.poor,      label: "Poor" },
  decent:    { text: "text-sky-300",    bar: QUALITY_COLOR.decent,    label: "Decent" },
  good:      { text: "text-emerald-300",bar: QUALITY_COLOR.good,      label: "Good" },
  excellent: { text: "text-violet-300", bar: QUALITY_COLOR.excellent, label: "Excellent" },
  perfect:   { text: "text-amber-300",  bar: QUALITY_COLOR.perfect,   label: "Perfect" },
};

// Gear-rollable stat keys — everything in `STAT` minus the three set-only
// stats (lifesteal / counter / enterAp) which never appear as a piece's
// main or sub. Used to populate the Main / Sub filter pill lists and the
// "sort by sub" dropdown.
const GEAR_STATS: string[] = Object.keys(STAT).filter(
  (k) => k !== "lifesteal" && k !== "counter" && k !== "enterAp",
);

// ── filter state ────────────────────────────────────────────────────────
interface FilterState {
  slots: Set<SlotId>;
  rarities: Set<DesignRarity>;
  stars: Set<number>;
  quality: Set<QualityTier>;
  /** Selected main-stat keys — OR semantics (a piece passes if any of its
   *  mains is in the set). Mains only ever have AND-impossible single-stat
   *  semantics for gear (helmet has 1 main); talismans/EE expose multiple
   *  mains but those still read better as OR (player asks "which pieces
   *  give me HP% OR ATK%"). */
  mains: Set<string>;
  /** Selected sub-stat keys + the operator that joins them. OR matches if
   *  ANY listed sub is on the piece; AND requires ALL listed subs. */
  subs: Set<string>;
  subMode: "or" | "and";
  /** Selected armor 4-pc set IDs — OR semantics. Only matches armor pieces
   *  that belong to one of the listed sets. */
  armorSets: Set<string>;
  /** Class-restricted pieces only — pills hold display class names
   *  ("Striker", "Mage", "Ranger", "Defender", "Healer"). OR semantics.
   *  Pieces without a classLimit (the vast majority of generic gear) fail
   *  this filter the moment any chip is active. */
  classes: Set<string>;
  /** Equipped-piece visibility. `true` (default) shows them; `false` hides
   *  them — exposed in the modal as an "Exclude equipped gear" checkbox
   *  (inverted polarity to match the in-game wording). */
  showEquipped: boolean;
  singularityOnly: boolean;
  query: string;
}

function emptyFilters(): FilterState {
  return {
    slots: new Set(),
    rarities: new Set(),
    stars: new Set(),
    quality: new Set(),
    mains: new Set(),
    subs: new Set(),
    subMode: "or",
    armorSets: new Set(),
    classes: new Set(),
    showEquipped: true,
    singularityOnly: false,
    query: "",
  };
}

// Persistence codec for the inventory filter shape — wraps the Set<>-typed
// fields so they survive a JSON round-trip via localStorage. The deserializer
// overlays stored values on top of `emptyFilters()` so older sessions missing
// newer non-Set fields (e.g. `subMode`) get the current defaults instead of
// undefined.
const _setCodec = jsonWithSets<FilterState>(["slots", "rarities", "stars", "quality", "mains", "subs", "armorSets", "classes"]);
const FILTER_CODEC = {
  serialize: _setCodec.serialize,
  deserialize: (raw: string): FilterState => {
    const parsed = _setCodec.deserialize!(raw) as Partial<FilterState>;
    // Drop undefined entries so spread doesn't reintroduce them and unset
    // the default for fields the storage simply didn't have at the time.
    const clean = Object.fromEntries(
      Object.entries(parsed).filter(([, v]) => v !== undefined),
    ) as Partial<FilterState>;
    return { ...emptyFilters(), ...clean };
  },
};
const FILTERS_STORAGE_KEY = "gs.inv.filters.v3";

// ── tab state ──────────────────────────────────────────────────────────
// Three coarse buckets surfaced as sub-tabs above the grid. "Gear" covers
// the rolled-substat slots (the gear-solver's bread and butter); "Special
// Gear" isolates the gem-bearing slots (talisman + EE) whose detail view is
// fundamentally different (gems vs subs, no Quality score, multi-tier
// passives). "All" stays as a no-filter escape hatch.
export type InvTab = "all" | "gear" | "special";
const TAB_SLOTS: Record<InvTab, SlotId[]> = {
  all:     ["weapon", "accessory", "helmet", "armor", "gloves", "boots", "exclusive", "talisman"],
  gear:    ["weapon", "accessory", "helmet", "armor", "gloves", "boots"],
  special: ["exclusive", "talisman"],
};
function matchesTab(p: UiPiece, tab: InvTab): boolean {
  if (tab === "all") return true;
  if (!p.slot) return false;
  return TAB_SLOTS[tab].includes(p.slot);
}

function matchesFilters(p: UiPiece, f: FilterState): boolean {
  if (f.singularityOnly && !p.singularity) return false;
  if (f.slots.size > 0 && (!p.slot || !f.slots.has(p.slot))) return false;
  if (f.rarities.size > 0 && !f.rarities.has(p.rarity)) return false;
  if (f.stars.size > 0 && !f.stars.has(p.stars)) return false;
  if (f.quality.size > 0) {
    // Talisman / EE return null (no rolled subs to score) — they're
    // excluded the moment a quality chip is active, since "Excellent" is
    // meaningless for gem-bearing slots.
    const q = computeQuality(p);
    if (!q || !f.quality.has(q.tier)) return false;
  }
  if (f.mains.size > 0) {
    // OR semantics — a piece passes if ANY of its main-stat keys is in the
    // selection. Pieces with no mains (shouldn't happen for armor/weapon
    // but defensively) never match.
    if (!p.main.some((m) => f.mains.has(m.stat))) return false;
  }
  if (f.subs.size > 0) {
    const pieceSubs = new Set(p.subs.map((s) => s.stat));
    if (f.subMode === "and") {
      // AND — every selected sub must appear on the piece (talisman/EE
      // with no rolled subs always fails here, which is the right call).
      for (const s of f.subs) if (!pieceSubs.has(s)) return false;
    } else {
      // OR — at least one selected sub must appear.
      let any = false;
      for (const s of f.subs) if (pieceSubs.has(s)) { any = true; break; }
      if (!any) return false;
    }
  }
  if (f.armorSets.size > 0) {
    // Weapon / accessory / talisman / EE all return false here — armor sets
    // only apply to the four armor slots that carry an `armorSetId`.
    if (!p.armorSetId || !f.armorSets.has(p.armorSetId)) return false;
  }
  if (f.classes.size > 0) {
    // Strict semantic: piece must be EXCLUSIVE to one of the selected
    // classes. Unrestricted gear (classLimit === null) fails — keeps the
    // filter focused on "show me my class-locked pieces".
    if (!p.classLimit || !f.classes.has(p.classLimit)) return false;
  }
  // Equipped pieces hidden when the player ticked "Exclude equipped gear"
  // in the modal — useful when looking for swappable inventory.
  if (!f.showEquipped && p.status === "equipped") return false;
  // Trim before testing so a whitespace-only query is a no-op here too —
  // otherwise it filters the grid while `activeFilterCount` (which trims)
  // shows no active filter, an invisible mismatch.
  const q = f.query.trim().toLowerCase();
  if (q) {
    const hay = `${p.name} ${p.slot ?? ""} ${p.rarity} ${p.main.map((m) => m.label).join(" ")} ${p.subs.map((s) => s.stat).join(" ")}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

// ── filter pieces ───────────────────────────────────────────────────────
function FPill({
  children, active, color, className, onClick,
}: { children: React.ReactNode; active?: boolean; color?: string; className?: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-[10.5px] font-medium transition-colors",
        active ? "text-white" : "border-white/7 bg-black/25 text-white hover:bg-white/5",
        className,
      )}
      style={active ? { borderColor: (color ?? "#22d3ee") + "66", background: (color ?? "#22d3ee") + "1f", color: color ?? "#a5f3fc" } : undefined}
    >
      {children}
    </button>
  );
}

function Checkbox({
  label, sub, checked, tone = "cyan", onChange,
}: { label: string; sub?: string; checked: boolean; tone?: "cyan" | "emerald" | "violet"; onChange: () => void }) {
  const toneClass = tone === "emerald" ? "border-emerald-400/60 bg-emerald-500/30"
                    : tone === "violet" ? "border-violet-400/60 bg-violet-500/30"
                    : "border-cyan-400/60 bg-cyan-500/30";
  return (
    <button
      onClick={onChange}
      className="flex w-full items-start gap-2 rounded px-1 py-1 text-left hover:bg-white/3"
    >
      <span
        className={cx(
          "mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] border transition-colors",
          checked ? toneClass : "border-white/15 bg-black/40",
        )}
      >
        {checked && (
          <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M2 5 L4 7 L8 3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <div className="text-[11.5px] text-white">{label}</div>
        {sub && <div className="text-[10px] text-white/60">{sub}</div>}
      </span>
    </button>
  );
}

/** Compact stat pill — icon + short label. Used by the Main / Sub filter
 *  groups, which list every gear-rollable stat from the STAT token table. */
function StatPillGrid({
  stats, selected, onToggle,
}: { stats: string[]; selected: Set<string>; onToggle: (s: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {stats.map((s) => {
        const meta = STAT[s];
        const active = selected.has(s);
        return (
          <button
            key={s}
            onClick={() => onToggle(s)}
            title={meta?.longLabel ?? s}
            className={cx(
              "inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-[10.5px] font-medium transition-colors",
              active
                ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-200"
                : "border-white/7 bg-black/25 text-white hover:bg-white/5",
            )}
          >
            <StatIcon stat={s} size={12} />
            {meta?.label ?? s.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}

/** Non-interactive "OR" badge — communicates that the selection uses OR
 *  semantics (used on the Main filter where AND would be unsemantic since
 *  each gear piece has only one main). */
function ModeBadge({ mode }: { mode: "or" | "and" }) {
  return (
    <span className="rounded border border-white/10 bg-black/30 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-white/70">
      {mode}
    </span>
  );
}

/** Two-button OR / AND toggle — used by the Sub filter group so the player
 *  can switch between "any selected sub matches" and "all selected subs
 *  must be present". */
function ModeToggle({
  mode, onChange,
}: { mode: "or" | "and"; onChange: (m: "or" | "and") => void }) {
  return (
    <div className="inline-flex rounded border border-white/10 bg-black/30 p-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider">
      {(["or", "and"] as const).map((m) => {
        const active = mode === m;
        return (
          <button
            key={m}
            onClick={() => onChange(m)}
            className={cx(
              "rounded-sm px-1.5 py-0.5 transition-colors",
              active ? "bg-cyan-500/20 text-cyan-200" : "text-white/70 hover:text-white",
            )}
          >
            {m}
          </button>
        );
      })}
    </div>
  );
}

/** How many filter dimensions are currently non-default — surfaced as a
 *  badge on the collapsed strip so the user knows whether collapsing hid
 *  anything load-bearing. Slots are NOT counted here: they live in their
 *  own always-visible SlotBar above the grid, so collapsing the filter
 *  panel never hides them. */
function activeFilterCount(f: FilterState): number {
  let n = 0;
  if (f.rarities.size > 0) n++;
  if (f.stars.size > 0) n++;
  if (f.quality.size > 0) n++;
  if (f.mains.size > 0) n++;
  if (f.subs.size > 0) n++;
  if (f.armorSets.size > 0) n++;
  if (f.classes.size > 0) n++;
  if (!f.showEquipped) n++;
  if (f.singularityOnly) n++;
  if (f.query.trim() !== "") n++;
  return n;
}

/** Top-right button that opens the game-style filter modal. Mirrors the
 *  in-game CM_Btn_Filter icon and surfaces a small badge with the active
 *  filter count so the player knows at a glance whether their view is
 *  narrowed. */
function FilterButton({
  onClick, count,
}: { onClick: () => void; count: number }) {
  return (
    <button
      onClick={onClick}
      title="Filters"
      className="relative inline-flex h-9 items-center gap-1.5 rounded-md border border-white/8 bg-white/3 px-2.5 text-[12px] font-medium text-white transition-colors hover:bg-white/6"
    >
      <img src="/img/ui/inven/CM_Btn_Filter.webp" alt="" className="h-5 w-5" />
      Filter
      {count > 0 && (
        <span className="grid h-4 min-w-4 place-items-center rounded-full bg-cyan-500/30 px-1 font-mono text-[10px] font-bold text-cyan-100">
          {count}
        </span>
      )}
    </button>
  );
}

/** Game-style filter modal — opens via the filter button, exposes every
 *  filter dimension (Rarity, Stars, Quality, Main, Sub, Set, Status,
 *  Singularity, Search) as multi-select pill groups. Draft state lives
 *  locally so Cancel discards uncommitted changes; Apply pushes the draft
 *  to the parent's FilterState and closes; Reset clears all dimensions
 *  but leaves the modal open so the player can rebuild from scratch. */
function FilterModal({
  open, onClose, current, onApply,
  availableMains, availableSubs, availableArmorSets, availableClasses,
  availableStars, availableRarities, availableQualities,
}: {
  open: boolean;
  onClose: () => void;
  current: FilterState;
  onApply: (next: FilterState) => void;
  availableMains: Set<string>;
  availableSubs: Set<string>;
  availableArmorSets: Map<string, string>;
  availableClasses: Set<string>;
  /** Chips for these dimensions stay rendered but go grayed-out + non-
   *  interactive when their value isn't present in the current scope. */
  availableStars: Set<number>;
  availableRarities: Set<DesignRarity>;
  availableQualities: Set<QualityTier>;
}) {
  const [draft, setDraft] = useState<FilterState>(current);
  // Re-seed draft from current whenever the modal transitions to open —
  // ensures Cancel + reopen shows the persisted state, not a stale draft.
  useEffect(() => { if (open) setDraft(current); }, [open, current]);
  // Close on Escape — matches the Esc behavior of the comboboxes (commit
  // a40932c). The modal already closes on backdrop click + the X button.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  const toggle = <T,>(s: Set<T>, v: T): Set<T> => {
    const n = new Set(s);
    if (n.has(v)) n.delete(v); else n.add(v);
    return n;
  };
  // Class restriction and Set Effect are mutually exclusive — a class-locked
  // piece is a weapon / accessory (no armor set bonus), and an armor 4-pc
  // piece is generic (no class lock). Whichever side has an active chip
  // disables the other so the user can't build a selection that matches
  // zero items by construction.
  const classActive = draft.classes.size > 0;
  const setsActive = draft.armorSets.size > 0;
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-white/10 bg-bg-elev-2 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── header: title + status toggles + close ── */}
        {/* Singularity-only / Exclude-equipped live up here (not as a body
            section) because they're meta toggles that the player will flip
            independently of the per-dimension filters below — keeping them
            visible at all times means the status of the current view is
            always one glance away, no scrolling. */}
        <div className="flex items-center gap-4 border-b border-white/8 px-4 py-3">
          <div className="flex items-center gap-2">
            <img src="/img/ui/inven/CM_Btn_Filter.webp" alt="" className="h-5 w-5" />
            <span className="text-[13px] font-semibold text-white">Filters</span>
          </div>
          <div className="ml-8 flex flex-1 items-center gap-4">
            <Checkbox label="Singularity only" checked={draft.singularityOnly} tone="violet" onChange={() => setDraft({ ...draft, singularityOnly: !draft.singularityOnly })} />
            <Checkbox label="Exclude equipped gear" checked={!draft.showEquipped} onChange={() => setDraft({ ...draft, showEquipped: !draft.showEquipped })} />
          </div>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-md text-white hover:bg-white/6"
            aria-label="Close"
          >
            <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
              <path d="M3 3 L11 11 M11 3 L3 11" />
            </svg>
          </button>
        </div>

        {/* ── body: scrollable sections ── */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {/* Search — matches name / slot / rarity / main / sub labels (the
              same `hay` matchesFilters builds). Reintroduced here after the
              old top-bar field was dropped: `query` still lived in the state +
              codec + matchers, so without an input a stale persisted value
              filtered the grid with no way to clear it. */}
          <ModalSection label="Search">
            <div className="relative">
              <input
                type="text"
                autoFocus
                value={draft.query}
                onChange={(e) => setDraft({ ...draft, query: e.target.value })}
                placeholder="Name, slot, rarity, stat…"
                className="w-full rounded-md border border-white/10 bg-black/30 px-2.5 py-1.5 pr-7 text-[12px] text-white placeholder:text-white/55 focus:border-cyan-400/40 focus:outline-none"
              />
              {draft.query && (
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, query: "" })}
                  aria-label="Clear search"
                  className="absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded text-white/70 hover:bg-white/8 hover:text-white"
                >
                  <svg viewBox="0 0 14 14" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
                    <path d="M3 3 L11 11 M11 3 L3 11" />
                  </svg>
                </button>
              )}
            </div>
          </ModalSection>
          {/* Star Level + Grade share a row — both are short pill lists,
              stacking them wastes vertical space the heavier sections
              (stats / sets) below could use. */}
          <div className="flex gap-3">
            <div className="flex-1">
              <ModalSection label="Star Level">
                <div className="flex flex-wrap gap-1.5">
                  <AllPill active={draft.stars.size === 0} onClick={() => setDraft({ ...draft, stars: new Set() })} />
                  {[6, 5, 4, 3, 2, 1].map((n) => {
                    const enabled = availableStars.has(n);
                    return (
                      <FPill
                        key={n}
                        active={draft.stars.has(n)}
                        color="#facc15"
                        className={cx("px-2", !enabled && "pointer-events-none opacity-30")}
                        onClick={() => setDraft({ ...draft, stars: toggle(draft.stars, n) })}
                      >
                        {n}★
                      </FPill>
                    );
                  })}
                </div>
              </ModalSection>
            </div>
            <div className="flex-1">
              <ModalSection label="Grade">
                <div className="flex flex-wrap gap-1.5">
                  <AllPill active={draft.rarities.size === 0} onClick={() => setDraft({ ...draft, rarities: new Set() })} />
                  {(Object.keys(RARITY) as DesignRarity[]).map((k) => {
                    const enabled = availableRarities.has(k);
                    return (
                      <FPill
                        key={k}
                        active={draft.rarities.has(k)}
                        color={RARITY[k].fg}
                        className={cx(!enabled && "pointer-events-none opacity-30")}
                        onClick={() => setDraft({ ...draft, rarities: toggle(draft.rarities, k) })}
                      >
                        {RARITY[k].label}
                      </FPill>
                    );
                  })}
                </div>
              </ModalSection>
            </div>
          </div>

          {/* Class restriction + Quality share a row — both are short and
              the column layout reads cleaner stacked horizontally. When no
              piece in the scope is class-locked the class column drops out
              and Quality takes the full row. */}
          <div className="flex gap-3">
            {availableClasses.size > 0 && (
              <div
                className={cx("flex-1", setsActive && "pointer-events-none opacity-40")}
                title={setsActive ? "Disabled while Set Effect is active — armor 4-pc pieces aren't class-locked." : undefined}
              >
                <ModalSection label="Class restriction" right={<ModeBadge mode="or" />}>
                  <div className="flex flex-wrap gap-1.5">
                    <AllPill active={draft.classes.size === 0} onClick={() => setDraft({ ...draft, classes: new Set() })} />
                    {[...availableClasses].map((c) => (
                      <FPill
                        key={c}
                        active={draft.classes.has(c)}
                        onClick={() => setDraft({ ...draft, classes: toggle(draft.classes, c) })}
                      >
                        <img src={`/img/ui/class/CM_Class_${c}.webp`} alt="" className="h-3.5 w-3.5" />
                        {c}
                      </FPill>
                    ))}
                  </div>
                </ModalSection>
              </div>
            )}
            <div className="flex-1">
              <ModalSection label="Quality">
                <div className="flex flex-wrap gap-1.5">
                  <AllPill active={draft.quality.size === 0} onClick={() => setDraft({ ...draft, quality: new Set() })} />
                  {QUALITY_TIERS.map((q) => {
                    const enabled = availableQualities.has(q);
                    return (
                      <FPill
                        key={q}
                        active={draft.quality.has(q)}
                        color={QUALITY_TONE[q].bar}
                        className={cx("px-2", !enabled && "pointer-events-none opacity-30")}
                        onClick={() => setDraft({ ...draft, quality: toggle(draft.quality, q) })}
                      >
                        {QUALITY_TONE[q].label}
                      </FPill>
                    );
                  })}
                </div>
              </ModalSection>
            </div>
          </div>

          {availableMains.size > 0 && (
            <ModalSection label="Primary Stat" right={<ModeBadge mode="or" />}>
              <StatPillGrid
                stats={GEAR_STATS.filter((s) => availableMains.has(s))}
                selected={draft.mains}
                onToggle={(s) => setDraft({ ...draft, mains: toggle(draft.mains, s) })}
              />
            </ModalSection>
          )}

          {availableSubs.size > 0 && (
            <ModalSection
              label="Secondary Stat"
              right={<ModeToggle mode={draft.subMode} onChange={(m) => setDraft({ ...draft, subMode: m })} />}
            >
              <StatPillGrid
                stats={GEAR_STATS.filter((s) => availableSubs.has(s))}
                selected={draft.subs}
                onToggle={(s) => setDraft({ ...draft, subs: toggle(draft.subs, s) })}
              />
            </ModalSection>
          )}

          {availableArmorSets.size > 0 && (
            <div
              className={cx(classActive && "pointer-events-none opacity-40")}
              title={classActive ? "Disabled while Class restriction is active — class-locked pieces don't carry an armor 4-pc set." : undefined}
            >
              <ModalSection label="Set Effect" right={<ModeBadge mode="or" />}>
                <div className="flex flex-wrap gap-1.5">
                  <AllPill active={draft.armorSets.size === 0} onClick={() => setDraft({ ...draft, armorSets: new Set() })} />
                  {[...availableArmorSets.entries()].map(([id, name]) => (
                    <FPill
                      key={id}
                      active={draft.armorSets.has(id)}
                      onClick={() => setDraft({ ...draft, armorSets: toggle(draft.armorSets, id) })}
                    >
                      {name}
                    </FPill>
                  ))}
                </div>
              </ModalSection>
            </div>
          )}

        </div>

        {/* ── footer: reset / cancel / apply ── */}
        <div className="flex items-center justify-between border-t border-white/8 px-4 py-3">
          <button
            onClick={() => setDraft(emptyFilters())}
            className="rounded-md border border-rose-400/40 bg-rose-500/15 px-3 py-1.5 text-[12px] font-semibold text-rose-100 hover:bg-rose-500/25"
          >
            Clear Filter
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-md border border-white/10 bg-white/3 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-white/6"
            >
              Cancel
            </button>
            <button
              onClick={() => { onApply(draft); onClose(); }}
              className="rounded-md border border-cyan-400/40 bg-cyan-500/20 px-4 py-1.5 text-[12px] font-semibold text-cyan-100 shadow-[0_0_18px_-6px_rgba(34,211,238,0.6)] hover:bg-cyan-500/30"
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Section frame used inside the FilterModal — label + optional right slot
 *  (for the per-section mode badge / toggle) above the controls. */
function ModalSection({ label, children, right }: { label: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-white/7 bg-black/20 px-3 py-2.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-white/70">{label}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

/** "All" reset pill — appears at the head of each section and clears that
 *  section's selection in one click. Active when no chip is selected. */
function AllPill({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "inline-flex h-6 items-center rounded-md border px-2 text-[10.5px] font-semibold uppercase tracking-wider transition-colors",
        active
          ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-100"
          : "border-white/10 bg-black/30 text-white hover:bg-white/5",
      )}
    >
      All
    </button>
  );
}

/** Common props for the grid card — parent passes the resolved
 *  `equippedChar` (looked up once via the `charsByUid` Map in the screen)
 *  + a stable `onSelect(id)` callback so `memo` actually skips renders
 *  when scrolling / filtering / selecting a different row. */
interface GearItemProps {
  piece: UiPiece;
  equippedChar: Character | null;
  active: boolean;
  onSelect: (id: string) => void;
}

/** Icon-only grid tile — clicking it surfaces the full detail in the left
 *  ItemDetail panel. Keeping the tile down to ~96px lets us pack ~10 columns
 *  on a 1480px window instead of ~6 with the old name+stats card.
 *  Overlays:
 *    - top-left:  "E" badge when equipped (white-on-black, replaces the
 *                 character portrait — too noisy at this density).
 *    - bottom-left, above the EquipmentIcon's own T<n> tier badge: the
 *                 in-game CT_Slot_Lock sprite, sourced from outerpedia-v2's
 *                 datamine and served at /img/ui/inven/CT_Slot_Lock.webp.
 *  Selection is conveyed by a soft cyan halo (ring + outer glow) rather
 *  than a hard border so the focus reads as ambient light, not a frame. */
const GearTile = memo(function GearTile({ piece, equippedChar, active, onSelect }: GearItemProps) {
  const onClick = useCallback(() => onSelect(piece.id), [onSelect, piece.id]);
  return (
    <button
      onClick={onClick}
      title={piece.name}
      className={cx(
        "group relative grid place-items-center rounded-lg border-2 p-0 transition-all",
        // Selection halo: thicker (2px) cyan stroke hugging the tile edge,
        // plus a two-layer glow - a tight bright inner bloom for "shine"
        // and a wider soft aura around it. Lateral whitespace between
        // ring and art is removed by sizing the icon to fit the grid
        // column (see size below).
        active
          ? "border-cyan-300 bg-cyan-500/10 shadow-[0_0_8px_0_rgba(34,211,238,0.9),0_0_22px_4px_rgba(34,211,238,0.5)]"
          : "border-white/5 bg-white/[0.012] hover:border-white/15 hover:bg-white/3",
      )}
      // CSS-native virtualization - skip layout/paint for off-screen tiles.
      style={{ contentVisibility: "auto", containIntrinsicSize: "0 96px" }}
    >
      {/* Icon size tuned to grid column min (96px) minus the 4px border so
          the cyan stroke sits right on the icon's visual edge with no
          leftover lateral whitespace. */}
      <EquipmentIcon piece={piece.iconPiece} size={92} />
      {/* "E" sits well inside the icon's top-left art area (not on the tile
          frame) so it reads as an overlay on the gear, not a tile chrome. */}
      {equippedChar && (
        <span
          title={`Equipped on ${equippedChar.name ?? `#${equippedChar.charId}`}`}
          className="absolute left-2.75 top-1 grid h-4 w-4 place-items-center bg-black/85 font-mono text-[9px] font-bold text-white"
        >
          E
        </span>
      )}
      {/* Lock sits noticeably above the EquipmentIcon's own T<n> tier badge
          (the tier text in an 84px icon lives near bottom 20-34px). Bumped
          to bottom-12 + h-5 to read as a clear "locked" stamp rather than a
          tiny corner indicator. */}
      {piece.locked && (
        <img
          src="/img/ui/inven/CT_Slot_Lock.webp"
          alt="Locked"
          className="pointer-events-none absolute left-2.5 bottom-10.5 h-4.5 w-4.5"
        />
      )}
    </button>
  );
});

// ── virtualized grid ────────────────────────────────────────────────────
/** Row-virtualized tile grid built on @tanstack/react-virtual. Columns are
 *  derived from the live container width (ResizeObserver) so the grid
 *  reflows when the side panels open/close or the window resizes. Only the
 *  visible rows + a small overscan window are mounted as React subtrees,
 *  which keeps DOM/JS footprint flat regardless of inventory size — the
 *  legacy non-virtualized grid mounted every GearTile up-front, which
 *  ballooned past 2k mounted components on heavy inventories. */
const TILE_SIZE = 96;
const TILE_GAP = 4;
function VirtualGearGrid({
  items, selectedId, onSelect, charsByUid,
}: {
  items: UiPiece[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  charsByUid: Map<string, Character>;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  // ResizeObserver keeps `width` synced to the scroll container. We can't
  // rely on a one-shot measurement because layout shifts (filter modal
  // open/close, devtools dock toggle, …) all change available space.
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const obs = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Column math: same packing logic as the old `repeat(auto-fill, minmax(96px, 1fr))`.
  // Min 1 column so the math doesn't blow up before the first ResizeObserver
  // callback fires (width=0 at first paint).
  const cols = Math.max(1, Math.floor((width + TILE_GAP) / (TILE_SIZE + TILE_GAP)));
  const rowCount = Math.ceil(items.length / cols);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => TILE_SIZE + TILE_GAP,
    overscan: 4,
  });

  return (
    <div ref={parentRef} className="mt-2 flex-1 min-h-0 overflow-y-auto pr-1">
      {items.length === 0 ? (
        <div className="rounded-lg border border-white/5 bg-white/[0.012] px-6 py-12 text-center text-[13px] text-white">
          No piece matches the current filters.
        </div>
      ) : (
        <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative", width: "100%" }}>
          {virtualizer.getVirtualItems().map((vrow) => {
            const start = vrow.index * cols;
            const rowItems = items.slice(start, start + cols);
            return (
              <div
                key={vrow.key}
                style={{
                  position: "absolute",
                  top: vrow.start,
                  left: 0,
                  width: "100%",
                  height: vrow.size,
                  display: "grid",
                  gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                  gap: `${TILE_GAP}px`,
                }}
              >
                {rowItems.map((p) => {
                  const ec = p.equippedBy ? charsByUid.get(p.equippedBy) ?? null : null;
                  return (
                    <GearTile
                      key={p.id}
                      piece={p}
                      equippedChar={ec}
                      active={p.id === selectedId}
                      onSelect={onSelect}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── sort header ─────────────────────────────────────────────────────────
// SortKey is a "fixed key" union for the three hardcoded buttons, plus a
// template string for per-sub-stat sorts (`sub:critRate`, `sub:spd`, …).
// The template covers any stat in the STAT token table — adding a new stat
// type doesn't need a SortHeader change.
type FixedSortKey = "stars" | "enhance" | "bt";
type SortKey = FixedSortKey | `sub:${string}`;

function SortHeader({
  sort, dir, total, onSort, onSubSort, availableSubs,
}: {
  sort: SortKey; dir: "asc" | "desc"; total: number;
  onSort: (k: FixedSortKey) => void;
  /** Pass a stat key to switch to `sub:${stat}` sort, or null to clear it
   *  (reverts to the default `enhance` cascade). */
  onSubSort: (stat: string | null) => void;
  /** Stats that appear on at least one sub in the current tab + slot
   *  scope — narrows the dropdown so the user only picks actionable
   *  sorts. */
  availableSubs: Set<string>;
}) {
  const isSubSort = sort.startsWith("sub:");
  const activeSubStat = isSubSort ? sort.slice(4) : "";
  const Th = ({ k, label }: { k: FixedSortKey; label: string }) => (
    <button
      onClick={() => onSort(k)}
      className={cx(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] transition-colors",
        sort === k ? "text-cyan-200" : "text-white hover:text-cyan-100",
      )}
    >
      {label}
      {sort === k && <span className="text-[9px]">{dir === "desc" ? "▼" : "▲"}</span>}
    </button>
  );
  return (
    <div className="flex items-center justify-between border-b border-white/6 px-1 pb-2">
      <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white">
        Sort by
        <Th k="stars" label="★" />
        <Th k="enhance" label="Enhance" />
        <Th k="bt" label="Brk" />
        <span className={cx("ml-2 inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11px]", isSubSort && "text-cyan-200")}>
          Sub
          <select
            value={activeSubStat}
            onChange={(e) => onSubSort(e.target.value || null)}
            className="rounded border border-white/7 bg-black/30 px-1.5 py-0.5 font-mono text-[10.5px] text-white outline-none"
          >
            <option value="">—</option>
            {GEAR_STATS.filter((s) => availableSubs.has(s)).map((s) => <option key={s} value={s}>{STAT[s]?.label ?? s}</option>)}
          </select>
          {isSubSort && <span className="text-[9px]">{dir === "desc" ? "▼" : "▲"}</span>}
        </span>
      </div>
      <span className="font-mono text-[11.5px] text-white">{total} pieces</span>
    </div>
  );
}

// ── tab + slot bar ──────────────────────────────────────────────────────
/** Primary navigation strip — All / Gear / Special Gear. Counts come from
 *  the raw inventory (NOT filtered) so the user can see how big each bucket
 *  is before drilling in. Active tab gets the cyan underline familiar from
 *  the rest of the app's surface. */
function SubTabBar({
  tab, setTab, counts,
}: { tab: InvTab; setTab: (t: InvTab) => void; counts: Record<InvTab, number> }) {
  const TABS: { id: InvTab; label: string }[] = [
    { id: "all",     label: "All" },
    { id: "gear",    label: "Gear" },
    { id: "special", label: "Special Gear" },
  ];
  return (
    <div className="flex items-center gap-1 border-b border-white/6">
      {TABS.map((t) => {
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cx(
              "relative px-3 py-2 text-[12px] font-semibold transition-colors",
              active ? "text-cyan-200" : "text-white hover:text-cyan-100",
            )}
          >
            {t.label}
            <span
              className={cx(
                "ml-1.5 rounded-sm px-1.5 py-0.5 font-mono text-[10px]",
                active ? "bg-cyan-500/15 text-cyan-200" : "bg-white/10 text-white",
              )}
            >
              {counts[t.id]}
            </span>
            {active && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-cyan-400" />}
          </button>
        );
      })}
    </div>
  );
}

/** Sub-bar of slot chips — only renders the slots that belong to the
 *  currently-active tab (e.g. Special Gear shows only Talisman + EE).
 *  Clicking a chip toggles `f.slots`; the slot membership is pruned by the
 *  parent when the tab changes so a stale chip can never persist. */
function SlotBar({
  tab, selected, onToggle,
}: { tab: InvTab; selected: Set<SlotId>; onToggle: (s: SlotId) => void }) {
  const slots = SLOTS.filter((s) => TAB_SLOTS[tab].includes(s.id));
  return (
    <div className="flex flex-wrap items-center gap-1 py-2">
      {slots.map((s) => {
        const active = selected.has(s.id);
        return (
          <button
            key={s.id}
            onClick={() => onToggle(s.id)}
            className={cx(
              "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium transition-colors",
              active
                ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-200"
                : "border-white/7 bg-black/25 text-white hover:bg-white/10",
            )}
          >
            <SlotIcon slot={s.id} size={14} />
            {s.short}
          </button>
        );
      })}
    </div>
  );
}

// ── detail ──────────────────────────────────────────────────────────────
/** Long-form label for a stat — falls back to the engine key uppercased
 *  when STAT doesn't know the type (talisman / EE mains that didn't make
 *  it into the table get a readable placeholder). */
function statLong(key: string): string {
  const meta = STAT[key];
  if (!meta) return key.toUpperCase();
  // atk/atkPct, hp/hpPct, def/defPct share the same `longLabel` ("Attack",
  // "HP", "Defense"), which is ambiguous in dense substat rows ("Attack
  // +16%" reads identically whether the underlying stat is flat or
  // percent). Append `%` to the percent variants so the label disambiguates
  // at a glance — same convention as the short labels (ATK vs ATK%).
  if (key.endsWith("Pct")) return `${meta.longLabel}%`;
  return meta.longLabel;
}

/** "Quality" score for an item — sum of every substat's total ticks
 *  (initial roll + reforge procs), benchmarked against the cap for the
 *  item's CURRENT investment state (not the theoretical max it could
 *  ever reach):
 *
 *    - Base cap is 14 (initial-roll spread cap = 4+4+3+3 across 4 subs).
 *    - Each reforge proc the user has actually spent raises the cap by
 *      1 tick (a reforged sub can land anywhere from +1 to whatever the
 *      pool allows; reflecting CONSUMED reforges keeps the score honest
 *      for fresh items vs heavily-invested ones).
 *
 *  So:
 *    - A pristine 6★ with no reforges → cap 14 (1/1/1/3 ≈ 6 → 42% Poor).
 *    - A non-ascended 6★ fully reforged (6 procs) → cap 20.
 *    - An ascended 6★ fully reforged (6 + 3 = 9 procs) → cap 23.
 *
 *  Tier (poor / decent / good / excellent / perfect) drives the bar
 *  color so the user gets a glance read. */
function computeQuality(piece: UiPiece): {
  current: number; max: number; pct: number; tier: QualityTier;
} | null {
  // Talisman + Exclusive Equipment don't use rolled substats (talisman has
  // IOT_BUFF mains, EE has fixed conditional stats + gem-style slots that
  // can be swapped in/out). The "Quality" score is only meaningful for the
  // gear slots with rollable + reforgable subs.
  if (piece.slot === "talisman" || piece.slot === "exclusive") return null;
  if (piece.subs.length === 0 || piece.stars <= 0) return null;
  const current = piece.subs.reduce((sum, s) => sum + s.lv, 0);
  // `reforge.n` is the count of reforge attempts the user has spent.
  // Each one bumps the achievable tick pool by 1.
  const max = 14 + piece.reforge.n;
  const pct = Math.min(100, Math.round((current / max) * 100));
  // Thresholds shared with the Builder's quality filter (lib/quality.ts).
  const tier = qualityTierFromScore(current, max);
  return { current, max, pct, tier };
}

/** Render a single substat row in the detail panel - matches the mockup
 *  layout: "LV {n}  [icon]  {long label}              {value}".
 *  When the sub has received any reforge proc the label expands to
 *  "LV {n} (base + {reforges})" so the user sees the breakdown. When the
 *  sub has reached its star-tier max (e.g. Lv 6 on a 6-star piece — all
 *  possible reforge procs landed here) the whole row tints gold. */
function SubstatRow({ s, stars }: { s: UiPiece["subs"][number]; stars: number }) {
  const isMax = stars > 0 && s.lv >= stars;
  const sign = s.value.startsWith("-") ? "" : "+";
  return (
    <div
      className={cx(
        "flex items-center gap-2 font-mono text-[12px] tabular-nums",
        isMax ? "text-amber-300" : "text-white",
      )}
    >
      {/* Fixed-width LV column so rows with reforges ("LV 6 (3 + 3)") and
          rows without ("LV 3") stay vertically aligned at the stat icon.
          88px fits the widest legitimate format at font-mono 12px. */}
      <span className={cx("w-22 shrink-0", isMax ? "text-amber-300" : "text-white")}>
        LV {s.lv}
        {s.reforges > 0 && (
          <span className={cx("ml-1", isMax ? "text-amber-400/80" : "text-white/70")}>
            ({s.lv - s.reforges} + {s.reforges})
          </span>
        )}
      </span>
      <StatIcon stat={s.stat} size={16} className="shrink-0" />
      <span className="flex-1">{statLong(s.stat)}</span>
      <span className={cx("font-semibold", isMax ? "text-amber-200" : "text-white")}>
        {sign}{s.value}
      </span>
    </div>
  );
}

/** Pull the set-effect entry that matches the piece's star tier. Set bonuses
 *  scale with star level in Outerplane — a 5-star piece grants the level-5
 *  p2/p4 effect, a 6-star piece the level-6 one. */
/** Pick which tier of a set's effect strings to display, driven by the
 *  piece's breakthrough — set effects upgrade at max breakthrough (T4),
 *  mirroring the in-game tooltip. Mapping:
 *    bt === 4  → set level 2 (outerpedia `_4` strings — 6★ wording)
 *    bt < 4    → set level 1 (outerpedia `_1` strings — 4★ wording)
 *  Falls back to whichever level is actually emitted when only one exists. */
function pickSetLevel(game: GameData, setId: string, bt: number) {
  const def = game.sets?.[setId];
  if (!def) return null;
  const wrap = (level: SetLevelEntry) => ({ name: def.name ?? null, desc: def.desc ?? null, level });
  const targetLevel = bt >= 4 ? 2 : 1;
  const exact = def.levels.find((l) => l.level === targetLevel);
  if (exact) return wrap(exact);
  // Only one tier emitted — use it as-is rather than show nothing.
  const sorted = [...def.levels].sort((a, b) => b.level - a.level);
  return sorted[0] ? wrap(sorted[0]) : null;
}
type SetLevelEntry = NonNullable<GameData["sets"][string]>["levels"][number];

/** Talisman / EE gem panel — vertical list of the 5 slot positions, one
 *  row each, laid out as:  [icon] Lv N · stat label · value
 *  Empty slot → muted placeholder (lock icon for the 5th slot when locked). */
function GemPanel({ slots }: { slots: NonNullable<UiPiece["gemSlots"]> }) {
  return (
    <div className="space-y-1">
      {slots.map((s, i) => {
        if (s.gem) {
          const sign = s.gem.value < 0 ? "-" : "+";
          const valueLabel = `${sign}${Math.abs(s.gem.value)}${s.gem.percent ? "%" : ""}`;
          return (
            <div
              key={i}
              className="flex items-center gap-2 font-mono text-[12px] tabular-nums"
              title={`Gem Lv ${s.gem.level} · ${statLong(s.gem.stat)} ${valueLabel}`}
            >
              <img
                src={`/img/items/TI_GEM_${s.gem.type}_${s.gem.level}.webp`}
                alt=""
                className="h-5 w-5 shrink-0 object-contain"
              />
              <span className="shrink-0 text-white/75">Lv {s.gem.level}</span>
              <span className="flex-1 text-white">{statLong(s.gem.stat)}</span>
              <span className="shrink-0 text-white">{valueLabel}</span>
            </div>
          );
        }
        return (
          <div
            key={i}
            className="flex items-center gap-2 text-[12px] text-white/65"
            title={s.unlocked ? "Empty gem slot" : "Locked — unlocks at enhance +5"}
          >
            <div className="grid h-5 w-5 shrink-0 place-items-center rounded-sm border border-dashed border-white/10 bg-white/2">
              {!s.unlocked && (
                <svg viewBox="0 0 14 14" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={1.4}>
                  <rect x="3" y="6" width="8" height="6" rx="1" />
                  <path d="M5 6 V4.5 a2 2 0 0 1 4 0 V6" />
                </svg>
              )}
            </div>
            <span className="flex-1 italic">
              {s.unlocked ? "Empty" : "Locked"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Render one piece of the 2-pc / 4-pc effect block. The label column is
 *  always shown (user wants the structural 2pc/4pc rows visible regardless
 *  of the set). The value column shows the canonical in-game prose pulled
 *  from outerpedia-v2's curated `sets.json` ("Attack +30%" for stat sets,
 *  "Increases damage dealt against targets inflicted with Break by 35%"
 *  for effect sets). Falls back to an em dash for tiers that don't have an
 *  effect at this piece-count (e.g. Revenge's 2-pc, Augmentation's 4-pc). */
function SetEffectRow({ tag, desc }: { tag: "2-pc" | "4-pc"; desc: string | null | undefined }) {
  return (
    <div className="flex items-start gap-2 text-[11px]">
      <span className="w-12 shrink-0 font-mono text-white/70">{tag}</span>
      {desc
        ? <span className="flex-1 text-white"><GameText text={desc} /></span>
        : <span className="flex-1 text-white/70">—</span>}
    </div>
  );
}

/** Left-side detail panel — visible at all times. Renders an empty
 *  placeholder when nothing is selected so the layout stays stable (the
 *  grid in the middle doesn't reflow when the user clicks a piece). The
 *  populated state shows the full main / sub / equipped char / set / brk
 *  breakdown that used to live in the right-side `GearDrawer`. */
function ItemDetail({
  piece, equippedChar, game,
}: { piece: UiPiece | null; equippedChar: Character | null; game: GameData | null }) {
  if (!piece) {
    return (
      <aside className="flex h-full w-80 shrink-0 flex-col items-center justify-center rounded-xl border border-dashed border-white/6 bg-white/[0.012] px-6 py-8 text-center">
        <div className="grid h-10 w-10 place-items-center rounded-md border border-white/6 bg-black/30 text-white/70">
          <svg viewBox="0 0 14 14" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.4}>
            <rect x="2" y="2" width="10" height="10" rx="1.5" />
            <path d="M5 7 H9 M7 5 V9" strokeLinecap="round" />
          </svg>
        </div>
        <div className="mt-3 text-[12px] font-medium text-white">No item selected</div>
        <div className="mt-1 text-[11px] leading-snug text-white/70">Click a tile in the grid to inspect its main / substats / equipped character.</div>
      </aside>
    );
  }

  const slot = piece.slot ? SLOTS.find((s) => s.id === piece.slot) : null;
  const rarity = RARITY[piece.rarity];
  // 2-pc / 4-pc set bonuses ONLY exist on armor pieces (helmet/armor/gloves/
  // boots) — they carry the set ID in `armorSetId`. Weapons + accessories
  // expose a `setId` too but it's the UniqueOptionID (the per-item passive's
  // group, e.g. "5" on a weapon ≠ Effectiveness Set), NOT a 2-pc/4-pc group.
  // Don't fall back to `setId` here — it falsely matched armor-set IDs whose
  // numeric range collided with UniqueOptionIDs.
  const setEntry = game && piece.armorSetId ? pickSetLevel(game, piece.armorSetId, piece.bt) : null;
  // Class info line: "<Rarity> <Slot>[ <Class> Exclusive]".
  const classLine = piece.classLimit ? `${slot?.label ?? "Item"}    ${piece.classLimit} Exclusive` : slot?.label ?? "Item";

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col overflow-hidden rounded-xl border border-white/8 bg-bg-elev-1">
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">

        {/* ── header row: lock + name (singularity gradient if ascended) ── */}
        <div className="flex items-center gap-1.5">
          {piece.locked && (
            <img
              src="/img/ui/inven/CT_Slot_Lock.webp"
              alt="Locked"
              title="Locked in-game"
              className="h-4 w-4 shrink-0"
            />
          )}
          <span
            className="truncate font-display text-[15px] font-semibold"
            style={piece.singularity
              ? { background: SINGULARITY_GRADIENT_H, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }
              : { color: rarity?.fg ?? "#f4f4f5" }
            }
          >
            {piece.name}{piece.singularity ? " - [Singularity]" : ""}
          </span>
        </div>

        {/* ── icon + rarity/class line + equipped char ── */}
        <div className="flex items-start gap-3">
          <EquipmentIcon piece={piece.iconPiece} size={80} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-col text-[11px] leading-tight">
              <span style={{ color: rarity?.fg ?? "#e4e4e7" }} className="font-semibold">
                {rarity?.label ?? piece.rarity}
              </span>
              <span className="text-white">{classLine}</span>
            </div>
          </div>
          {equippedChar && (
            <CharFace
              charId={equippedChar.charId}
              name={equippedChar.name ?? `#${equippedChar.charId}`}
              size={36}
            />
          )}
        </div>

        {/* ── main stats ── */}
        {/* Prefer the in-game narrative label (e.g. "DMG Increase vs Water"
            for EE conditional mains) over the synthesized short label when
            the build pipeline resolved one — falls back to statLong for
            regular gear mains where no narrative exists. */}
        {piece.main.length > 0 && (
          <div className="space-y-1.5">
            {piece.main.map((m, i) => (
              <div key={i} className="flex items-center gap-2 font-mono text-[13px] tabular-nums">
                <StatIcon stat={m.stat} size={18} className="shrink-0" />
                <span className="flex-1 text-white">{m.name ?? statLong(m.stat)}</span>
                <span className="font-semibold text-white">{m.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── substats (gear) or gems (talisman / EE) ── */}
        {piece.gemSlots ? (
          <GemPanel slots={piece.gemSlots} />
        ) : piece.subs.length > 0 ? (
          <div className="space-y-1">
            {piece.subs.map((s, i) => <SubstatRow key={i} s={s} stars={piece.stars} />)}
          </div>
        ) : null}

        {/* ── quality score (sum of substat ticks / state-aware cap) ── */}
        {(() => {
          const q = computeQuality(piece);
          if (!q) return null;
          const tone = QUALITY_TONE[q.tier];
          return (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <HoverHint
                  className="font-semibold uppercase tracking-wider text-white"
                  name="Quality"
                  text="Sum of every substat tick (initial roll + reforge procs) vs the cap for the item's CURRENT investment: base 14 (4+4+3+3) plus 1 per reforge already spent. Singularity adds up to 3 extra reforges. So a pristine 6★ caps at 14; fully reforged 20; ascended + fully reforged 23."
                />
                <span className="font-mono tabular-nums">
                  <span className={cx("font-bold", tone.text)}>{q.current}</span>
                  <span className="text-white/60"> / {q.max}</span>
                  <span className={cx("ml-2", tone.text)}>{tone.label}</span>
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full rounded-full transition-[width]"
                  style={{ width: `${q.pct}%`, background: tone.bar }}
                />
              </div>
            </div>
          );
        })()}

        {/* ── multi-tier passive (talisman / EE) ── */}
        {/* The +10 entry can be one of two patterns:
              - ADDITIONAL (`isAdd=true`):  a SECOND effect that stacks on top
                of the base.
              - UPGRADE    (`isAdd=false` at unlockLevel > 1): REPLACES the
                base (same conceptual effect, stronger value).
            Visibility rule (talismans + EE both):
              - When NOT YET unlocked (lv < unlockLevel) — ALWAYS show both
                rows regardless of pattern, with the +10 row greyed out. The
                player needs to know what's coming, even for upgrade-style
                items.
              - When unlocked (lv ≥ unlockLevel) — additional keeps both
                visible (they stack); upgrade hides the base (it's been
                superseded by the +10 row, in-game tooltip behaves the same). */}
        {piece.multiTierPassive && (() => {
          const tiers = piece.multiTierPassive.tiers;
          const upgrade = tiers.find((t, i) => i > 0 && !t.isAdd);
          const visible = tiers.filter((_t, i) => {
            if (!upgrade) return true;
            // Only hide the base, and only once the upgrade is actually live.
            if (i === 0 && upgrade.active) return false;
            return true;
          });
          return (
            <div className="pt-1">
              <div className="mb-2 flex items-center gap-2">
                {piece.effectIcon && (
                  <img src={`/img/ui/effect/${piece.effectIcon}.webp`} alt="" className="h-5 w-5 shrink-0" />
                )}
                <span className="font-mono text-[12px] font-semibold text-white">
                  {piece.multiTierPassive!.name ?? "Passive"}
                </span>
              </div>
              <div className="space-y-2">
                {visible.map((t, i) => {
                  const eyebrow = t.unlockLevel <= 1
                    ? "Base"
                    : `+${t.unlockLevel} · ${t.isAdd ? "additional" : "upgraded"}`;
                  return (
                    <div
                      key={i}
                      className={cx(
                        "rounded-md border border-white/6 bg-black/25 px-3 py-2 transition-opacity",
                        !t.active && "opacity-40",
                      )}
                    >
                      <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-white/70">
                        {eyebrow}
                      </div>
                      <GameText text={t.desc} className="text-[11px] leading-snug text-white" />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* ── unique-option passive (weapons / accessories) ── */}
        {/* The "Destruction" / "Aurora" / … effect that scales per breakthrough
            tier. Resolved at build time via TextSkill + BuffTemplet — `text`
            already has the per-tier values substituted. */}
        {piece.passive && (
          <div className="pt-1">
            <div className="mb-2 flex items-center gap-2">
              {piece.effectIcon && (
                <img src={`/img/ui/effect/${piece.effectIcon}.webp`} alt="" className="h-5 w-5 shrink-0" />
              )}
              <span className="font-mono text-[12px] font-semibold text-white">
                {piece.passive.name ?? "Passive"}
              </span>
              <span className="ml-auto rounded-sm border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white">
                T{piece.bt}
              </span>
            </div>
            <p className="rounded-md border border-white/6 bg-black/25 px-3 py-2 text-[11px] leading-snug text-white">
              <GameText text={piece.passive.text} />
            </p>
          </div>
        )}

        {/* ── set effect (armor 4-piece or matching set group) ── */}
        {/* Mirrors outerpedia-v2's SetCard layout: icon + name, then the
            2-pc / 4-pc curated effect strings. Tier suffix is driven by
            the piece's breakthrough (`bt === 4` → outerpedia `_4` wording,
            else `_1`) — that's how the in-game tooltip upgrades when you
            fully break a piece through. */}
        {setEntry && (
          <div className="pt-1">
            <div className="mb-2 flex items-center gap-2">
              {piece.setIcon
                ? <img src={`/img/ui/effect/${piece.setIcon}.webp`} alt="" className="h-5 w-5 shrink-0" />
                : piece.effectIcon
                  ? <img src={`/img/ui/effect/${piece.effectIcon}.webp`} alt="" className="h-5 w-5 shrink-0" />
                  : null}
              <span className="font-mono text-[12px] font-semibold text-white">
                {setEntry.name ?? "Set"}
              </span>
            </div>
            <div className="space-y-1 rounded-md border border-white/6 bg-black/25 px-3 py-2">
              <SetEffectRow tag="2-pc" desc={setEntry.level.p2_desc} />
              <SetEffectRow tag="4-pc" desc={setEntry.level.p4_desc} />
            </div>
          </div>
        )}

        {/* ── Singularity active effect (ascended pieces only) ── */}
        {/* Two rendering layers, in preference order:
            1. `desc` — full in-game sentence (with grade-color + value
               already baked in) rendered through GameText. No standalone
               "S" badge — the grade letter is already in the desc.
            2. `name` + resolved value — used only when desc is missing
               (e.g. TextSkill unavailable at build time). */}
        {piece.singularity && piece.effects.length > 0 && (
          <div className="pt-1">
            <div className="mb-2 text-[11px] font-semibold text-amber-200">
              Active Effect at +15 Enhancement
            </div>
            <div className="space-y-1.5 text-[11px] leading-snug text-white">
              {piece.effects.map((e, i) => {
                if (e.desc) return <GameText key={i} text={e.desc} className="block wrap-break-word" />;
                const sign = e.value.startsWith("-") ? "" : "+";
                const label = e.name ?? statLong(e.stat);
                return (
                  <div key={i} className="flex items-start gap-2 wrap-break-word">
                    <span className="min-w-0 flex-1">{label}</span>
                    <span className="shrink-0 text-white">{sign}{e.value}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

// ── screen ──────────────────────────────────────────────────────────────
export interface InventoryScreenProps {
  inventory: Inventory | null;
  game: GameData | null;
}

export function InventoryScreen({ inventory, game }: InventoryScreenProps) {
  // Persist filters / sort / view so the page survives a reload (or tab swap).
  // `selectedId` stays ephemeral — re-opening the drawer to a random item after
  // a reload would be more annoying than useful.
  const [f, setF] = usePersistedState<FilterState>(FILTERS_STORAGE_KEY, emptyFilters, FILTER_CODEC);
  const [tab, setTabState] = usePersistedState<InvTab>("gs.inv.tab", "all");
  const [sort, setSort] = usePersistedState<SortKey>("gs.inv.sort", "enhance");
  const [dir, setDir] = usePersistedState<"asc" | "desc">("gs.inv.dir", "desc");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterModalOpen, setFilterModalOpen] = useState(false);

  const ui = useMemo<UiPiece[]>(() => (inventory ? inventory.gear.map((g) => toUiPiece(g, game)) : []), [inventory, game]);

  // Tab buckets — counted off the raw inventory so the badge stays meaningful
  // when the user has narrowed the view with other filters.
  const tabCounts = useMemo<Record<InvTab, number>>(() => ({
    all:     ui.length,
    gear:    ui.filter((p) => matchesTab(p, "gear")).length,
    special: ui.filter((p) => matchesTab(p, "special")).length,
  }), [ui]);

  // Switching tab prunes any slot chip that doesn't belong to the new tab —
  // otherwise a "weapon" chip selected on Gear would silently zero out the
  // grid when the user switches to Special Gear.
  const setTab = useCallback((next: InvTab) => {
    setTabState(next);
    setF((prev) => {
      const allowed = new Set(TAB_SLOTS[next]);
      const pruned = new Set([...prev.slots].filter((s) => allowed.has(s)));
      if (pruned.size === prev.slots.size) return prev;
      return { ...prev, slots: pruned };
    });
  }, [setTabState, setF]);

  const toggleSlot = useCallback((s: SlotId) => {
    setF((prev) => {
      const next = new Set(prev.slots);
      if (next.has(s)) next.delete(s); else next.add(s);
      return { ...prev, slots: next };
    });
  }, [setF]);

  // Index characters by uid once — every gear row resolves its `equippedBy`
  // against this map (was a linear `.find` per row × 100+ rows × every
  // selection/filter change).
  const charsByUid = useMemo(() => {
    const m = new Map<string, Character>();
    for (const c of inventory?.characters ?? []) m.set(c.uid, c);
    return m;
  }, [inventory]);

  const filtered = useMemo(() => ui.filter((p) => matchesTab(p, tab) && matchesFilters(p, f)), [ui, tab, f]);

  // Pieces matching the CURRENT tab + slot filter, ignoring the main/sub
  // filter — used to compute which stat pills should appear in the Main /
  // Sub filter groups + the Sub-sort dropdown. We deliberately scope BEFORE
  // mains/subs so toggling a chip never makes the rest of the chips
  // disappear (only the higher-level navigation does).
  const scopedForStats = useMemo(() => ui.filter((p) => {
    if (!matchesTab(p, tab)) return false;
    if (f.slots.size > 0 && (!p.slot || !f.slots.has(p.slot))) return false;
    return true;
  }), [ui, tab, f.slots]);

  const availableMains = useMemo(() => {
    const s = new Set<string>();
    for (const p of scopedForStats) for (const m of p.main) s.add(m.stat);
    return s;
  }, [scopedForStats]);
  const availableSubs = useMemo(() => {
    const s = new Set<string>();
    for (const p of scopedForStats) for (const sub of p.subs) s.add(sub.stat);
    return s;
  }, [scopedForStats]);
  // Armor 4-pc set IDs present in the scope, paired with their localized name
  // (pulled from game.sets) for the pill labels.
  const availableArmorSets = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of scopedForStats) {
      if (!p.armorSetId) continue;
      if (m.has(p.armorSetId)) continue;
      const def = game?.sets?.[p.armorSetId];
      m.set(p.armorSetId, def?.name ?? `Set #${p.armorSetId}`);
    }
    return m;
  }, [scopedForStats, game]);
  // Class-restricted pieces in the scope — class name set (no metadata
  // needed, the FilterModal's class section already maps name → icon).
  const availableClasses = useMemo(() => {
    const s = new Set<string>();
    for (const p of scopedForStats) {
      if (p.classLimit) s.add(p.classLimit);
    }
    return s;
  }, [scopedForStats]);
  // Star / Grade / Quality availability — pills outside this set render
  // disabled in the modal so the player never picks a chip that's
  // guaranteed to zero out the grid.
  const availableStars = useMemo(() => {
    const s = new Set<number>();
    for (const p of scopedForStats) s.add(p.stars);
    return s;
  }, [scopedForStats]);
  const availableRarities = useMemo(() => {
    const s = new Set<DesignRarity>();
    for (const p of scopedForStats) s.add(p.rarity);
    return s;
  }, [scopedForStats]);
  const availableQualities = useMemo(() => {
    const s = new Set<QualityTier>();
    for (const p of scopedForStats) {
      const q = computeQuality(p);
      if (q) s.add(q.tier);
    }
    return s;
  }, [scopedForStats]);

  // Auto-prune any selection that becomes unavailable when the scope
  // narrows, so a chip the user can no longer see can't silently zero out
  // the grid. Runs whenever any availability set changes (tab / slot
  // toggle, or the inventory itself when capture updates).
  useEffect(() => {
    setF((prev) => {
      const nextMains = new Set([...prev.mains].filter((s) => availableMains.has(s)));
      const nextSubs = new Set([...prev.subs].filter((s) => availableSubs.has(s)));
      const nextArmorSets = new Set([...prev.armorSets].filter((id) => availableArmorSets.has(id)));
      const nextClasses = new Set([...prev.classes].filter((c) => availableClasses.has(c)));
      const nextStars = new Set([...prev.stars].filter((n) => availableStars.has(n)));
      const nextRarities = new Set([...prev.rarities].filter((r) => availableRarities.has(r)));
      const nextQuality = new Set([...prev.quality].filter((q) => availableQualities.has(q)));
      if (nextMains.size === prev.mains.size
        && nextSubs.size === prev.subs.size
        && nextArmorSets.size === prev.armorSets.size
        && nextClasses.size === prev.classes.size
        && nextStars.size === prev.stars.size
        && nextRarities.size === prev.rarities.size
        && nextQuality.size === prev.quality.size) return prev;
      return {
        ...prev,
        mains: nextMains, subs: nextSubs, armorSets: nextArmorSets, classes: nextClasses,
        stars: nextStars, rarities: nextRarities, quality: nextQuality,
      };
    });
  }, [availableMains, availableSubs, availableArmorSets, availableClasses, availableStars, availableRarities, availableQualities, setF]);

  const sorted = useMemo(() => {
    const out = [...filtered];
    // Pre-parse the sub-sort target so we don't slice the string on every
    // comparator call (sort runs O(n log n) times).
    const subSortStat = sort.startsWith("sub:") ? sort.slice(4) : null;
    const subValue = (p: UiPiece) => {
      const s = p.subs.find((x) => x.stat === subSortStat);
      // Pieces without the requested sub get a 0 floor so they sink to the
      // bottom in desc (highest first) and float to the top in asc — same
      // behaviour as a missing stat being "least invested".
      return s ? parseFloat(s.value.replace(/%$/, "")) : 0;
    };
    out.sort((a, b) => {
      let cmp = 0;
      if (subSortStat) {
        cmp = subValue(a) - subValue(b);
      } else switch (sort) {
        case "stars": cmp = a.stars - b.stars; break;
        // Default sort cascade: enhance (+N) → reforge (x/9) → tier (x/4) —
        // mirrors how the user mentally ranks an item (how much invested
        // first, then how well-rolled, then how broken-through).
        case "enhance":
          cmp = a.enhance - b.enhance;
          if (cmp === 0) cmp = a.reforge.n - b.reforge.n;
          if (cmp === 0) cmp = a.bt - b.bt;
          break;
        case "bt": cmp = a.bt - b.bt; break;
      }
      // Final tiebreak: ascended first (purple > gold).
      if (cmp === 0) cmp = Number(a.singularity) - Number(b.singularity);
      return dir === "desc" ? -cmp : cmp;
    });
    return out;
  }, [filtered, sort, dir]);

  // Derive from `ui` (the full list), NOT `sorted` — a filter that hides the
  // selected piece shouldn't silently blank its detail panel while
  // `selectedId` is still active. The memoized uid→piece map also drops the
  // per-render O(n) `.find`.
  const uiById = useMemo(() => {
    const m = new Map<string, UiPiece>();
    for (const p of ui) m.set(p.id, p);
    return m;
  }, [ui]);
  const selected = selectedId ? uiById.get(selectedId) ?? null : null;

  // Stable click handler — toggles the selection so a second click clears
  // the detail panel. Stays referentially stable across renders so memoized
  // `GearTile`s skip re-renders when other tiles change.
  const onSelect = useCallback((id: string) => {
    setSelectedId((cur) => (cur === id ? null : id));
  }, []);

  function toggleSort(k: FixedSortKey) {
    if (sort === k) setDir(dir === "desc" ? "asc" : "desc");
    else { setSort(k); setDir("desc"); }
  }

  /** Sub-stat picker handler — empty value reverts to the default sort.
   *  Picking a new stat starts at desc (highest tick value first), which
   *  matches the dominant "show me my best-rolled X pieces" use case. */
  function onSubSort(stat: string | null) {
    if (!stat) {
      setSort("enhance");
      setDir("desc");
      return;
    }
    const next: SortKey = `sub:${stat}`;
    if (sort === next) setDir(dir === "desc" ? "asc" : "desc");
    else { setSort(next); setDir("desc"); }
  }

  if (!inventory || ui.length === 0) {
    return <InventoryEmpty />;
  }

  // 2-column layout: [ItemDetail (always shown, empty placeholder if no
  // selection)] | [tabs + slot bar + sort header + grid]. The old right-
  // side FilterPanel was replaced by a game-style modal triggered from the
  // SubTabBar's right slot — same source of truth (`f` + `setF`), just a
  // different surface.
  return (
    <div className="flex h-full min-h-0 flex-1 gap-3 px-4 py-3">
      <ItemDetail
        piece={selected}
        equippedChar={selected?.equippedBy ? charsByUid.get(selected.equippedBy) ?? null : null}
        game={game}
      />
      <div className="min-w-0 flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between">
          <SubTabBar tab={tab} setTab={setTab} counts={tabCounts} />
          <FilterButton onClick={() => setFilterModalOpen(true)} count={activeFilterCount(f)} />
        </div>
        <SlotBar tab={tab} selected={f.slots} onToggle={toggleSlot} />
        <SortHeader
          sort={sort} dir={dir} total={sorted.length}
          onSort={toggleSort} onSubSort={onSubSort}
          availableSubs={availableSubs}
        />
        <VirtualGearGrid
          items={sorted}
          selectedId={selectedId}
          onSelect={onSelect}
          charsByUid={charsByUid}
        />
      </div>
      <FilterModal
        open={filterModalOpen}
        onClose={() => setFilterModalOpen(false)}
        current={f}
        onApply={setF}
        availableMains={availableMains}
        availableSubs={availableSubs}
        availableArmorSets={availableArmorSets}
        availableClasses={availableClasses}
        availableStars={availableStars}
        availableRarities={availableRarities}
        availableQualities={availableQualities}
      />
    </div>
  );
}

function InventoryEmpty() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-24 text-center">
      <div
        className="grid h-16 w-16 place-items-center rounded-2xl"
        style={{ background: "linear-gradient(135deg, #16EBF1, #9D51FF 60%, #E02BCD)", boxShadow: "0 0 32px rgba(157,81,255,0.45)" }}
      >
        <svg viewBox="0 0 24 24" className="h-7 w-7 text-white" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 7 V17 L12 21 L20 17 V7 L12 3 Z M4 7 L12 11 L20 7 M12 11 V21" />
        </svg>
      </div>
      <h2 className="font-display text-[18px] font-semibold text-white">No capture yet</h2>
      <p className="max-w-sm text-[12.5px] leading-relaxed text-white/85">
        Run the capture pipeline to import your gear and heroes from the Outerplane client. The Arm capture button up top arms mitmproxy and waits for the game to send <span className="font-mono text-white">/user/item</span>.
      </p>
    </div>
  );
}
