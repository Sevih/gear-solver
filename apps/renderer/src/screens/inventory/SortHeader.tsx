/**
 * Inventory sort header — the fixed sort buttons and the sort-by-sub dropdown.
 */
import { cx } from "../../design/cx.js";
import { STAT } from "../../design/tokens.js";
import { GEAR_STATS } from "./filters.js";

// ── sort header ─────────────────────────────────────────────────────────
// SortKey is a "fixed key" union for the three hardcoded buttons, plus a
// template string for per-sub-stat sorts (`sub:critRate`, `sub:spd`, …).
// The template covers any stat in the STAT token table — adding a new stat
// type doesn't need a SortHeader change.
export type FixedSortKey = "stars" | "enhance" | "bt";
export type SortKey = FixedSortKey | `sub:${string}`;

export function SortHeader({
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
