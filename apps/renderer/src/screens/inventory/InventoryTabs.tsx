/**
 * Inventory tab bars — the sub-tab bar and the per-tab slot bar.
 */
import { cx } from "../../design/cx.js";
import { SlotIcon } from "../../design/EquipmentIcon.js";
import { SLOTS, type SlotId } from "../../design/tokens.js";
import { TAB_SLOTS, type InvTab } from "./filters.js";

// ── tab + slot bar ──────────────────────────────────────────────────────
/** Primary navigation strip — All / Gear / Special Gear. Counts come from
 *  the raw inventory (NOT filtered) so the user can see how big each bucket
 *  is before drilling in. Active tab gets the cyan underline familiar from
 *  the rest of the app's surface. */
export function SubTabBar({
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
export function SlotBar({
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
