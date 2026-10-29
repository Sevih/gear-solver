/**
 * Inventory filter modal — the toolbar's Filter button and the modal with its
 * pill / checkbox / mode controls.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cx } from "../../design/cx.js";
import { StatIcon } from "../../design/EquipmentIcon.js";
import { RARITY, STAT, type DesignRarity } from "../../design/tokens.js";
import { QUALITY_REACHABLE_HELP, QUALITY_TIERS, type QualityTier } from "../../lib/quality.js";
import { QUALITY_TONE } from "../../design/GearDetail.js";
import { GEAR_STATS, emptyFilters, type BaseRollsFilter, type FilterState } from "./filters.js";
import {
  PRESET_NAME_MAX, SCRAP_CANDIDATES, deleteInventoryFilterPreset, loadInventoryFilterPresets,
  saveInventoryFilterPreset, validPresetName, type InventoryFilterPreset,
} from "../../lib/storage/inventoryFilterPresets.js";

// ── filter pieces ───────────────────────────────────────────────────────
function FPill({
  children, active, color, className, title, onClick,
}: { children: React.ReactNode; active?: boolean; color?: string; className?: string; title?: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      title={title}
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
 *  groups, which list every gear-rollable stat from the STAT token table.
 *  A stat in `unavailable` (selected, no piece in the view) renders marked. */
function StatPillGrid({
  stats, selected, unavailable, onToggle,
}: { stats: string[]; selected: Set<string>; unavailable: Set<string>; onToggle: (s: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {stats.map((s) => {
        const meta = STAT[s];
        const active = selected.has(s);
        const missing = unavailable.has(s);
        return (
          <button
            key={s}
            onClick={() => onToggle(s)}
            title={missing ? UNAVAILABLE_TITLE : meta?.longLabel ?? s}
            className={cx(
              "inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-[10.5px] font-medium transition-colors",
              active
                ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-200"
                : "border-white/7 bg-black/25 text-white hover:bg-white/5",
              missing && UNAVAILABLE_CLASS,
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

/** A value selected in the draft (a loaded filter preset) that no piece of
 *  the current view carries: still rendered, dimmed, and clickable so the
 *  criterion never filters the grid without a visible pill to remove. */
const UNAVAILABLE_TITLE = "No piece in the current view";
const UNAVAILABLE_CLASS = "opacity-50";

/** Class for a fixed-list pill (Star / Grade / Quality / Reachable): an
 *  available value is plain, an unavailable selected one is marked, an
 *  unavailable unselected one is disabled. */
function pillAvailability(enabled: boolean, active: boolean): { className?: string; title?: string } {
  if (enabled) return {};
  return active ? { className: UNAVAILABLE_CLASS, title: UNAVAILABLE_TITLE } : { className: "pointer-events-none opacity-30" };
}

/** The selected values missing from `available`. */
function missingFrom<T>(selected: Set<T>, available: { has: (v: T) => boolean }): Set<T> {
  return new Set([...selected].filter((v) => !available.has(v)));
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

const BASE_ROLLS_OPS: [BaseRollsFilter["op"], string][] = [
  ["gte", "at least"], ["gt", "more than"], ["eq", "exactly"], ["lte", "at most"], ["lt", "less than"],
];
const SELECT_CLASS = "rounded-md border border-white/10 bg-black/30 px-1.5 py-0.5 text-[12px] text-white focus:border-cyan-400/40 focus:outline-none";

/** Operator selector then four X / 0–4 selectors (X = any) for the sorted
 *  base-stage pattern, read "<op> a / b / c / d", best line first, and the
 *  `not` box that inverts it. */
function BaseRollsInputs({
  value, onChange,
}: { value: BaseRollsFilter; onChange: (next: BaseRollsFilter) => void }) {
  const opLabel = BASE_ROLLS_OPS.find(([op]) => op === value.op)?.[1] ?? value.op;
  return (
    <div className="flex items-center gap-1.5 font-mono text-[12px] text-white">
      <select
        value={value.op}
        aria-label="Base rolls operator"
        title={`Every line of the piece, best first, must be ${opLabel} the chosen tier; X = any.`}
        onChange={(e) => onChange({ ...value, op: e.target.value as BaseRollsFilter["op"] })}
        className={SELECT_CLASS}
      >
        {BASE_ROLLS_OPS.map(([op, label]) => (
          <option key={op} value={op}>{label}</option>
        ))}
      </select>
      {value.lines.map((v, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-white/40">/</span>}
          <select
            value={v === null ? "x" : String(v)}
            aria-label={`Line ${i + 1} base tier`}
            onChange={(e) => {
              const lines = [...value.lines] as BaseRollsFilter["lines"];
              lines[i] = e.target.value === "x" ? null : Number(e.target.value);
              onChange({ ...value, lines });
            }}
            className={SELECT_CLASS}
          >
            <option value="x">X</option>
            {[0, 1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </span>
      ))}
      <span className="ml-2 font-sans">
        <Checkbox label="not" checked={value.not} onChange={() => onChange({ ...value, not: !value.not })} />
      </span>
    </div>
  );
}

const PRESET_BTN_CLASS = "rounded-md border border-white/10 bg-white/3 px-2 py-0.5 text-[11.5px] font-semibold text-white hover:bg-white/6 disabled:pointer-events-none disabled:opacity-40";

/** Presets row under the modal title: pick a preset ("—", the built-in, then
 *  the user's), Load it into the draft (the user adjusts, then Apply), Save
 *  the draft under a name (inline field), Delete a user preset. Presets are
 *  read from storage each time the modal opens. */
function PresetsRow({
  draft, onLoad,
}: { draft: FilterState; onLoad: (next: FilterState) => void }) {
  const [presets, setPresets] = useState<InventoryFilterPreset[]>(loadInventoryFilterPresets);
  const [selected, setSelected] = useState("");
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const builtin = selected === SCRAP_CANDIDATES.id;
  const userPreset = presets.find((p) => p.id === selected);
  const validName = validPresetName(name);
  const overwrites = validName !== null && presets.some((p) => p.name === validName);
  // A preset carries no search: the one in the draft stays in place.
  const load = () => {
    if (builtin) onLoad({ ...SCRAP_CANDIDATES.filters(), query: draft.query });
    else if (userPreset) onLoad({ ...userPreset.filters, query: draft.query });
  };
  const save = () => {
    const saved = saveInventoryFilterPreset(name, draft);
    if (!saved) return;
    setPresets(loadInventoryFilterPresets());
    setSelected(saved.id);
    setNaming(false);
    setName("");
  };
  const remove = () => {
    if (!userPreset) return;
    deleteInventoryFilterPreset(userPreset.id);
    setPresets(loadInventoryFilterPresets());
    setSelected("");
  };
  return (
    <div className="flex items-center gap-2 border-b border-white/8 px-4 py-2">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-white/70">Presets</span>
      <select
        value={selected}
        aria-label="Filter preset"
        title={builtin ? SCRAP_CANDIDATES.title : undefined}
        onChange={(e) => setSelected(e.target.value)}
        className={cx(SELECT_CLASS, "max-w-[14rem]")}
      >
        <option value="">—</option>
        <option value={SCRAP_CANDIDATES.id} title={SCRAP_CANDIDATES.title}>{SCRAP_CANDIDATES.name}</option>
        {presets.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <button onClick={load} disabled={!builtin && !userPreset} className={PRESET_BTN_CLASS}>Load</button>
      {naming ? (
        <span className="flex items-center gap-1.5">
          <input
            type="text"
            autoFocus
            value={name}
            maxLength={PRESET_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              // Escape leaves the name field, not the modal.
              if (e.key === "Escape") { e.stopPropagation(); setNaming(false); setName(""); }
            }}
            placeholder="Preset name"
            aria-label="Preset name"
            className="w-36 rounded-md border border-white/10 bg-black/30 px-1.5 py-0.5 text-[12px] text-white placeholder:text-white/55 focus:border-cyan-400/40 focus:outline-none"
          />
          <button
            onClick={save}
            disabled={!validName}
            title={overwrites ? "Overwrites the preset of the same name." : undefined}
            className={PRESET_BTN_CLASS}
          >
            Save
          </button>
          <button onClick={() => { setNaming(false); setName(""); }} className={PRESET_BTN_CLASS}>Cancel</button>
        </span>
      ) : (
        <button onClick={() => setNaming(true)} className={PRESET_BTN_CLASS}>Save as…</button>
      )}
      <button
        onClick={remove}
        disabled={!userPreset}
        className="ml-auto rounded-md border border-rose-400/30 bg-rose-500/10 px-2 py-0.5 text-[11.5px] font-semibold text-rose-100 hover:bg-rose-500/20 disabled:pointer-events-none disabled:opacity-40"
      >
        Delete
      </button>
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
 *  filter dimension (Rarity, Stars, Quality, Reachable quality, Main, Sub, Base rolls, Set, Status,
 *  Singularity, Search) as multi-select pill groups. Draft state lives
 *  locally so Cancel discards uncommitted changes; Apply pushes the draft
 *  to the parent's FilterState and closes; Reset clears all dimensions
 *  but leaves the modal open so the player can rebuild from scratch. */
export function FilterModal({
  open, onClose, current, onApply,
  availableMains, availableSubs, availableArmorSets, availableClasses,
  availableStars, availableRarities, availableQualities, availableReachable, armorSetName,
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
   *  interactive when their value isn't present in the current scope —
   *  unless selected, then marked unavailable and still clickable. */
  availableStars: Set<number>;
  availableRarities: Set<DesignRarity>;
  availableQualities: Set<QualityTier>;
  availableReachable: Set<QualityTier>;
  /** Label of an armor set selected in the draft but absent from the view. */
  armorSetName: (id: string) => string;
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
  // Selected values the view doesn't carry are listed after the available ones.
  const missingMains = missingFrom(draft.mains, availableMains);
  const missingSubs = missingFrom(draft.subs, availableSubs);
  const missingClasses = missingFrom(draft.classes, availableClasses);
  const missingSets = missingFrom(draft.armorSets, availableArmorSets);
  const mainStats = GEAR_STATS.filter((s) => availableMains.has(s) || missingMains.has(s));
  const subStats = GEAR_STATS.filter((s) => availableSubs.has(s) || missingSubs.has(s));
  const classPills = [...availableClasses, ...missingClasses];
  const setPills: [string, string][] = [...availableArmorSets.entries(), ...[...missingSets].map((id): [string, string] => [id, armorSetName(id)])];
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-white/10 bg-bg-elev-2 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── header: title + status toggles + close ── */}
        {/* Singularity-only / Exclude-equipped / +0 / T0 / Not reforged live up here (not as a body
            section) because they're meta toggles that the player will flip
            independently of the per-dimension filters below — keeping them
            visible at all times means the status of the current view is
            always one glance away, no scrolling. */}
        <div className="flex items-center gap-4 border-b border-white/8 px-4 py-3">
          <div className="flex items-center gap-2">
            <img src="/img/ui/inven/CM_Btn_Filter.webp" alt="" className="h-5 w-5" />
            <span className="text-[13px] font-semibold text-white">Filters</span>
          </div>
          <div className="ml-8 grid flex-1 grid-cols-3 items-center gap-x-4">
            <Checkbox label="Singularity only" checked={draft.singularityOnly} tone="violet" onChange={() => setDraft({ ...draft, singularityOnly: !draft.singularityOnly })} />
            <Checkbox label="Exclude equipped gear" checked={!draft.showEquipped} onChange={() => setDraft({ ...draft, showEquipped: !draft.showEquipped })} />
            <Checkbox label="+0 only" checked={draft.enhanceZero} onChange={() => setDraft({ ...draft, enhanceZero: !draft.enhanceZero })} />
            <Checkbox label="T0 only" checked={draft.breakthroughZero} onChange={() => setDraft({ ...draft, breakthroughZero: !draft.breakthroughZero })} />
            <Checkbox label="Not reforged" checked={draft.notReforged} onChange={() => setDraft({ ...draft, notReforged: !draft.notReforged })} />
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

        {/* ── presets: load / save the draft under a name ── */}
        <PresetsRow draft={draft} onLoad={setDraft} />

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
                    const active = draft.stars.has(n);
                    const { className, title } = pillAvailability(availableStars.has(n), active);
                    return (
                      <FPill
                        key={n}
                        active={active}
                        color="#facc15"
                        className={cx("px-2", className)}
                        title={title}
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
                    const active = draft.rarities.has(k);
                    const { className, title } = pillAvailability(availableRarities.has(k), active);
                    return (
                      <FPill
                        key={k}
                        active={active}
                        color={RARITY[k].fg}
                        className={className}
                        title={title}
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
            {classPills.length > 0 && (
              <div
                className={cx("flex-1", setsActive && "pointer-events-none opacity-40")}
                title={setsActive ? "Disabled while Set Effect is active — armor 4-pc pieces aren't class-locked." : undefined}
              >
                <ModalSection label="Class restriction" right={<ModeBadge mode="or" />}>
                  <div className="flex flex-wrap gap-1.5">
                    <AllPill active={draft.classes.size === 0} onClick={() => setDraft({ ...draft, classes: new Set() })} />
                    {classPills.map((c) => (
                      <FPill
                        key={c}
                        active={draft.classes.has(c)}
                        className={cx(missingClasses.has(c) && UNAVAILABLE_CLASS)}
                        title={missingClasses.has(c) ? UNAVAILABLE_TITLE : undefined}
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
                    const active = draft.quality.has(q);
                    const { className, title } = pillAvailability(availableQualities.has(q), active);
                    return (
                      <FPill
                        key={q}
                        active={active}
                        color={QUALITY_TONE[q].bar}
                        className={cx("px-2", className)}
                        title={title}
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

          <div title={QUALITY_REACHABLE_HELP}>
            <ModalSection label="Reachable quality">
              <div className="flex flex-wrap gap-1.5">
                <AllPill active={draft.reachable.size === 0} onClick={() => setDraft({ ...draft, reachable: new Set() })} />
                {QUALITY_TIERS.map((q) => {
                  const active = draft.reachable.has(q);
                  const { className, title } = pillAvailability(availableReachable.has(q), active);
                  return (
                    <FPill
                      key={q}
                      active={active}
                      color={QUALITY_TONE[q].bar}
                      className={cx("px-2", className)}
                      title={title}
                      onClick={() => setDraft({ ...draft, reachable: toggle(draft.reachable, q) })}
                    >
                      {QUALITY_TONE[q].label}
                    </FPill>
                  );
                })}
              </div>
            </ModalSection>
          </div>

          {mainStats.length > 0 && (
            <ModalSection label="Primary Stat" right={<ModeBadge mode="or" />}>
              <StatPillGrid
                stats={mainStats}
                selected={draft.mains}
                unavailable={missingMains}
                onToggle={(s) => setDraft({ ...draft, mains: toggle(draft.mains, s) })}
              />
            </ModalSection>
          )}

          {subStats.length > 0 && (
            <ModalSection
              label="Secondary Stat"
              right={<ModeToggle mode={draft.subMode} onChange={(m) => setDraft({ ...draft, subMode: m })} />}
            >
              <StatPillGrid
                stats={subStats}
                selected={draft.subs}
                unavailable={missingSubs}
                onToggle={(s) => setDraft({ ...draft, subs: toggle(draft.subs, s) })}
              />
            </ModalSection>
          )}

          <ModalSection label="Base rolls">
            <BaseRollsInputs value={draft.baseRolls} onChange={(baseRolls) => setDraft({ ...draft, baseRolls })} />
            <div className="mt-1.5 text-[10px] text-white/60">
              Initial tiers of the sub-stats, best line first, before reforge and enhancement. Every line must match; X = any. Not inverts the pattern. Talismans and EE never pass.
            </div>
          </ModalSection>

          {setPills.length > 0 && (
            <div
              className={cx(classActive && "pointer-events-none opacity-40")}
              title={classActive ? "Disabled while Class restriction is active — class-locked pieces don't carry an armor 4-pc set." : undefined}
            >
              <ModalSection label="Set Effect" right={<ModeBadge mode="or" />}>
                <div className="flex flex-wrap gap-1.5">
                  <AllPill active={draft.armorSets.size === 0} onClick={() => setDraft({ ...draft, armorSets: new Set() })} />
                  {setPills.map(([id, name]) => (
                    <FPill
                      key={id}
                      active={draft.armorSets.has(id)}
                      className={cx(missingSets.has(id) && UNAVAILABLE_CLASS)}
                      title={missingSets.has(id) ? UNAVAILABLE_TITLE : undefined}
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
