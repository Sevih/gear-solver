/**
 * Inventory filter modal — the toolbar's Filter button and the modal with its
 * pill / checkbox / mode controls.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cx } from "../../design/cx.js";
import { StatIcon } from "../../design/EquipmentIcon.js";
import { RARITY, STAT, type DesignRarity } from "../../design/tokens.js";
import { QUALITY_TIERS, type QualityTier } from "../../lib/quality.js";
import { QUALITY_TONE } from "../../design/GearDetail.js";
import { GEAR_STATS, emptyFilters, type FilterState } from "./filters.js";

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

/** Top-right button that opens the game-style filter modal. Mirrors the
 *  in-game CM_Btn_Filter icon and surfaces a small badge with the active
 *  filter count so the player knows at a glance whether their view is
 *  narrowed. */
export function FilterButton({
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
export function FilterModal({
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
                        <img src={`/img/ui/class/IG_Turn_Class_${c}.webp`} alt="" className="h-3.5 w-3.5" />
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
