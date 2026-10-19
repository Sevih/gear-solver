/**
 * Builder results table — virtualized, sortable result rows with the column
 * heatmap and the columns menu.
 */
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { GameData, GearPiece } from "@gear-solver/core";
import { StatIcon } from "../../design/EquipmentIcon.js";
import { Pill } from "../../design/Chips.js";
import { cx } from "../../design/cx.js";
import type { DmgSkillInfo } from "../../lib/dmgSkill.js";
import type { SolveBuild } from "../../lib/solver/types.js";
import type { MinMax } from "../../lib/solver/builderFilters.js";
import { usePersistedState } from "../../hooks/usePersistedState.js";
import { useClickOutside } from "./useClickOutside.js";
import { SOLVER_STATS, SKILL_SCALED_RATINGS, ratingTitle, TABLE_RATINGS, statHeaderTooltip } from "./statColumns.js";
import type { ArmorSetEntry } from "./catalogs.js";

/* ─────────────────────────────────────────────────────────────────────────
 * Middle area — results table + right sidebar
 * ───────────────────────────────────────────────────────────────────────── */
/** Header dropdown to show/hide result columns. Stats default to the first 8
 *  visible, ratings + Score + Upg default on; a column targeted by an active
 *  stat filter is force-shown (locked) so you can't hide what you're filtering
 *  on. Preferences persist via the parent's `colPrefs`. */
function ColumnsMenu({
  statFilters, colPrefs, onToggle, onReset, open, onOpenChange,
}: {
  statFilters: Record<string, MinMax>;
  colPrefs: Record<string, boolean>;
  onToggle: (key: string, def: boolean) => void;
  onReset: () => void;
  /** Controlled open state — lifted to the table so a right-click on any
   *  column header (not just the toolbar button) can open the menu. */
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const ref = useClickOutside<HTMLDivElement>(open, () => onOpenChange(false));
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onOpenChange(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);
  const items: Array<{ key: string; label: string; iconKey: string | null; def: boolean; forced: boolean }> = [
    { key: "wpn", label: "Weapon effect", iconKey: null, def: true, forced: false },
    { key: "acc", label: "Accessory effect", iconKey: null, def: true, forced: false },
    ...SOLVER_STATS.map((s, i) => {
      const b = statFilters[s.key];
      return { key: s.key, label: s.label, iconKey: s.iconKey, def: i < 8, forced: b != null && (b.min != null || b.max != null) };
    }),
    ...TABLE_RATINGS.map((r) => ({ key: r.key, label: r.label, iconKey: null, def: true, forced: false })),
    { key: "score", label: "Score", iconKey: null, def: true, forced: false },
    { key: "upg", label: "Upg", iconKey: null, def: true, forced: false },
  ];
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        title="Show / hide columns — also opens on right-click of any column header."
        className="flex items-center gap-1 rounded border border-white/10 bg-white/4 px-2 py-0.5 text-[9.5px] uppercase tracking-wider text-white/60 hover:text-white"
      >
        columns <span className="text-[8px]">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-30 w-44 rounded-lg border border-white/10 bg-bg-elev-1 p-2 shadow-2xl shadow-black/70">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[9px] font-semibold uppercase tracking-wider text-white/65">Visible columns</span>
            <button type="button" onClick={onReset} className="text-[10px] text-cyan-300 hover:text-cyan-200">reset</button>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {items.map((it) => {
              const checked = it.forced || (colPrefs[it.key] ?? it.def);
              return (
                <label
                  key={it.key}
                  title={it.forced ? "Forced visible — an active filter targets this column." : undefined}
                  className={cx(
                    "flex items-center gap-2 rounded px-1 py-0.5 text-[11px]",
                    it.forced ? "opacity-60" : "cursor-pointer hover:bg-white/5",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={it.forced}
                    onChange={() => onToggle(it.key, it.def)}
                    className="h-3 w-3 shrink-0 accent-cyan-400"
                  />
                  {it.iconKey && <StatIcon stat={it.iconKey} size={12} />}
                  <span className="truncate text-white/80">{it.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function ResultsTable({
  builds, selectedIdx, onSelect, solving, error, emptyReason, brokenSetsEmpty, filteredOut, statFilters, rows, onRowsChange,
  pieceByUid, armorSets, game, heatmap, dmgSkill,
}: {
  builds: SolveBuild[];
  /** Picked hero's best-skill factor — names the winning skill in the
   *  Dmg/DmgS headers (badge + tooltip), flags the ×1.00 fallback. */
  dmgSkill: DmgSkillInfo | null;
  selectedIdx: number | null;
  onSelect: (i: number | null) => void;
  solving: boolean;
  error: string | null;
  /** Why the last solve returned nothing (e.g. a slot pool collapsed to 0
   *  after filters). Null → show the generic "pick a hero" hint instead. */
  emptyReason: string | null;
  /** The last solve searched every slot but "Allow broken sets" off rejected
   *  every armor loadout (`SolveEmptyCause`) — says so instead of the hint. */
  brokenSetsEmpty: boolean;
  /** The last solve has builds but the post-solve client filter keeps none —
   *  says so instead of the "pick a hero" hint. */
  filteredOut: boolean;
  /** Active stat bands — the table always shows the first 8 stat columns;
   *  any of the remaining stats (dmgRed/eff/res) that carry a live min/max
   *  band get appended so you never filter on an invisible column. */
  statFilters: Record<string, MinMax>;
  /** Viewport height in rows (the parent caps the row's maxHeight to match);
   *  the slider in the header drives it so the bottom gear band stays visible. */
  rows: number;
  onRowsChange: (n: number) => void;
  /** Inventory uid→piece lookup — drives the per-build Set column (the build
   *  only carries piece UIDs; set composition is derived from their armor
   *  set ids). */
  pieceByUid: Map<string, GearPiece>;
  /** Owned armor sets — used as the setId→{name,icon} lookup for the Set cell. */
  armorSets: ArmorSetEntry[];
  /** Game data — resolves a build's weapon/accessory pieces to their effect
   *  (icon + name) for the Weapon/Accessory effect columns. */
  game: GameData | null;
  /** Results-table column heatmap on/off (Settings → Solver). */
  heatmap: boolean;
}) {
  // setId → display meta, for the per-build Set tags.
  const armorSetById = useMemo(() => {
    const m = new Map<string, ArmorSetEntry>();
    for (const s of armorSets) m.set(s.id, s);
    return m;
  }, [armorSets]);
  // Per-build weapon + accessory effect chips (icon + name), resolved from the
  // pieces' equipment defs. Memoized on the result set like the Set tags so the
  // virtualized rows don't recompute on hover/sort.
  const effectByBuild = useMemo(() => {
    const m = new Map<SolveBuild, { weapon: EffectChip | null; accessory: EffectChip | null }>();
    if (!game) return m;
    const resolve = (uid: string | undefined): EffectChip | null => {
      if (!uid) return null;
      const piece = pieceByUid.get(uid);
      if (!piece) return null;
      const def = game.equipment[String(piece.itemId)];
      if (!def?.setId) return null;
      const name = game.equipmentPassives[String(piece.itemId)]?.name ?? def.name ?? def.setId;
      return { icon: def.effectIcon ?? null, name };
    };
    for (const b of builds) {
      let wUid: string | undefined, aUid: string | undefined;
      for (const uid of b.pieceUids) {
        const slot = pieceByUid.get(uid)?.slot;
        if (slot === "weapon") wUid = uid;
        else if (slot === "accessory") aUid = uid;
      }
      m.set(b, { weapon: resolve(wUid), accessory: resolve(aUid) });
    }
    return m;
  }, [builds, pieceByUid, game]);
  // Per-build active set tags: tally each build's pieces by armor set id, keep
  // sets with ≥2 pieces, and render the bonus tier (4 when ≥4 pieces, else 2).
  // Memoized on the result set so 1000 rows don't recompute on every hover.
  const setTagsByBuild = useMemo(() => {
    const m = new Map<SolveBuild, SetTag[]>();
    for (const b of builds) {
      const counts = new Map<string, number>();
      for (const uid of b.pieceUids) {
        const sid = pieceByUid.get(uid)?.armorSetId;
        if (sid) counts.set(sid, (counts.get(sid) ?? 0) + 1);
      }
      const tags: SetTag[] = [];
      for (const [sid, n] of counts) {
        if (n < 2) continue;
        const meta = armorSetById.get(sid);
        if (meta) tags.push({ icon: meta.icon, name: meta.name, count: n >= 4 ? 4 : 2 });
      }
      tags.sort((a, z) => z.count - a.count); // 4pc before 2pc
      if (tags.length > 0) m.set(b, tags);
    }
    return m;
  }, [builds, pieceByUid, armorSetById]);
  // Column visibility — persisted per-key overrides (key → shown). Stats
  // default to the first 8 visible; ratings + Score + Upg default visible. A
  // stat with an active filter band is force-shown regardless so you never
  // filter on a hidden column. The "Columns" menu in the header toggles these.
  const [colPrefs, setColPrefs] = usePersistedState<Record<string, boolean>>("gs.builder.cols", {});
  // Columns menu open state lifted here so a right-click on any column header
  // opens the same menu the toolbar "columns" button does.
  const [colsMenuOpen, setColsMenuOpen] = useState(false);
  const statCols = useMemo(
    () => SOLVER_STATS.filter((s, i) => {
      const b = statFilters[s.key];
      const filtered = b != null && (b.min != null || b.max != null);
      return filtered || (colPrefs[s.key] ?? i < 8);
    }),
    [statFilters, colPrefs],
  );
  const ratingCols = useMemo(
    () => TABLE_RATINGS.filter((r) => colPrefs[r.key] ?? true),
    [colPrefs],
  );
  const showScore = colPrefs["score"] ?? true;
  const showUpg = colPrefs["upg"] ?? true;
  const showWpn = colPrefs["wpn"] ?? true;
  const showAcc = colPrefs["acc"] ?? true;
  // Per-column min/max for the heatmap — recomputed when builds (or the set
  // of visible stat columns) change. Stats and ratings computed once; reused
  // across every row. When the heatmap setting is off, empty ranges make
  // `heatStyle` return undefined for every cell (no tint), skipping the scan.
  const ranges = useMemo(
    () => (heatmap ? computeColumnRanges(builds, statCols) : EMPTY_RANGES),
    [builds, statCols, heatmap],
  );
  // Sort state — column key + direction. Default null = solver's native
  // order (Score desc in SOLVE, CP desc in SOLVE CP). Click cycles
  // null → desc → asc → null per column; clicking a different column resets.
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const cycleSort = (key: string) => {
    if (sortKey !== key) { setSortKey(key); setSortDir("desc"); return; }
    if (sortDir === "desc") { setSortDir("asc"); return; }
    setSortKey(null); // back to native order
  };
  const sortedBuilds = useMemo(() => {
    if (!sortKey) return builds;
    const get = (b: SolveBuild): number => {
      if (sortKey === "score") return b.score;
      if (sortKey === "upg") return b.upg;
      if (sortKey === "cp") return b.cp ?? -Infinity;
      const stat = (b.finalStats as unknown as Record<string, number>)[sortKey];
      if (typeof stat === "number") return stat;
      const rating = (b.ratings as unknown as Record<string, number>)[sortKey];
      if (typeof rating === "number") return rating;
      return 0;
    };
    const sign = sortDir === "desc" ? -1 : 1;
    return [...builds].sort((a, b) => sign * (get(a) - get(b)));
  }, [builds, sortKey, sortDir]);
  // Map each build to its index in the original `builds` array — used as
  // both the row key and the click payload (selectedIdx points into the
  // ORIGINAL order so it survives a re-sort). Replaces a previous
  // `builds.indexOf(b)` in the render loop that was O(n²) — ~1M ops per
  // re-render at the default topN=1000 (every hover, every sort).
  const buildIndexOf = useMemo(() => {
    const m = new Map<SolveBuild, number>();
    for (let i = 0; i < builds.length; i++) m.set(builds[i]!, i);
    return m;
  }, [builds]);
  const selectedBuildRef = selectedIdx != null ? builds[selectedIdx] : null;

  // Row virtualization — at the default topN=1000 the old table mounted ~1000
  // rows × ~20 cells (~20k DOM nodes) and re-rendered every one on hover/sort.
  // Now only the visible window (+overscan) is mounted; two spacer rows
  // reserve the scroll height so the sticky thead and scrollbar stay correct.
  // Fixed row height (forced on each ResultRow) → estimate == actual, no drift.
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: sortedBuilds.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => RESULT_ROW_H,
    overscan: 12,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  const padTop = virtualRows.length > 0 ? virtualRows[0]!.start : 0;
  const padBottom = virtualRows.length > 0 ? totalSize - virtualRows[virtualRows.length - 1]!.end : 0;
  const colSpan = 1 + (showWpn ? 1 : 0) + (showAcc ? 1 : 0) + statCols.length + ratingCols.length + (showScore ? 1 : 0) + (showUpg ? 1 : 0) + 1;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-white/8 bg-bg-elev-2">
      <div className="flex shrink-0 items-center justify-between border-b border-white/8 px-3 py-1.5">
        <div className="flex items-baseline gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/70">Results</span>
          <span className="text-[10.5px] italic text-white/65">
            {solving ? "Solving…" : error ? "Solver error — see below." : "Click a row to reveal the equipment that produced it. Click a column header to sort."}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5" title="Results table height (rows visible before scrolling) — lower it to keep the gear cards below in view">
            <span className="text-[9.5px] uppercase tracking-wider text-white/65">height</span>
            <input
              type="range"
              min={5}
              max={15}
              step={1}
              value={Math.min(rows, 15)}
              onChange={(e) => onRowsChange(Number(e.target.value))}
              className="w-20 accent-cyan-400"
            />
          </label>
          <ColumnsMenu
            statFilters={statFilters}
            colPrefs={colPrefs}
            onToggle={(key, def) => setColPrefs((p) => ({ ...p, [key]: !(p[key] ?? def) }))}
            onReset={() => setColPrefs({})}
            open={colsMenuOpen}
            onOpenChange={setColsMenuOpen}
          />
          <Pill tone={error ? "rose" : "emerald"}>{builds.length} builds</Pill>
        </div>
      </div>
      {error && (
        <div className="border-b border-rose-400/30 bg-rose-500/10 px-3 py-1.5 text-[11px] text-rose-200">{error}</div>
      )}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse font-mono text-[10.5px] tabular-nums">
          <thead className="sticky top-0 z-10 bg-bg-elev-1 text-white/70 [&_th]:bg-bg-elev-1">
            <tr
              className="border-b border-white/8"
              onContextMenu={(e) => { e.preventDefault(); setColsMenuOpen(true); }}
              title="Right-click to show / hide columns"
            >
              <th className="px-1.5 py-1 text-left text-[9.5px] font-semibold uppercase tracking-wider">sets</th>
              {showWpn && <th className="px-1.5 py-1 text-left text-[9.5px] font-semibold uppercase tracking-wider" title="Weapon effect">wpn</th>}
              {showAcc && <th className="px-1.5 py-1 text-left text-[9.5px] font-semibold uppercase tracking-wider" title="Accessory effect">acc</th>}
              {statCols.map((s) => (
                <SortHeader key={s.key} colKey={s.key} title={statHeaderTooltip(s.key, s.label)} sortKey={sortKey} sortDir={sortDir} onClick={cycleSort}>
                  <StatIcon stat={s.iconKey} size={14} title={null} className="inline-block align-middle" />
                </SortHeader>
              ))}
              {ratingCols.map((r) => (
                <SortHeader key={r.key} colKey={r.key} title={ratingTitle(r, dmgSkill, false)} sortKey={sortKey} sortDir={sortDir} onClick={cycleSort}>
                  {r.label.toLowerCase()}
                  {SKILL_SCALED_RATINGS.has(r.key) && dmgSkill && (
                    // Which skill the column is scaled by (S1/S2/S3, "B1..3" =
                    // burst state) — amber "×1" when the hero has no skill data.
                    <span className={cx("ml-0.5 text-[8px] normal-case tracking-normal", dmgSkill.missing ? "text-amber-300" : "text-white/40")}>
                      {dmgSkill.missing ? "×1" : dmgSkill.label}
                    </span>
                  )}
                </SortHeader>
              ))}
              {showScore && (
                <SortHeader colKey="score" title="Aggregate priority-weighted score" sortKey={sortKey} sortDir={sortDir} onClick={cycleSort} className="text-amber-300">
                  score
                </SortHeader>
              )}
              {showUpg && (
                <SortHeader colKey="upg" title="Number of slots that differ from the hero's current loadout" sortKey={sortKey} sortDir={sortDir} onClick={cycleSort}>
                  upg
                </SortHeader>
              )}
              <th className="px-1.5 py-1 text-right text-[9.5px] uppercase tracking-wider">actions</th>
            </tr>
          </thead>
          <tbody>
            {builds.length === 0 && !solving && !error && (
              // colSpan = 1 sets + statCols + N ratings + score + upg + actions.
              <tr><td colSpan={colSpan} className="px-3 py-12 text-center text-[11px] italic">
                {emptyReason ? (
                  <span className="text-amber-300/80">
                    No builds — a slot has no pieces left after filtering.<br />
                    <span className="not-italic font-mono text-[10.5px]">{emptyReason}</span>
                  </span>
                ) : brokenSetsEmpty ? (
                  <span className="text-amber-300/80">
                    No builds — no armor combination completes its sets with “Allow broken sets” off.<br />
                    <span className="not-italic text-[10.5px]">Turn it on, or raise Top % so more set pieces stay in the pools.</span>
                  </span>
                ) : filteredOut ? (
                  <span className="text-white/65">No build passes the current filter.</span>
                ) : (
                  <span className="text-white/65">Pick a hero and click SOLVE to populate the results.</span>
                )}
              </td></tr>
            )}
            {/* Spacer rows reserve the offscreen scroll height above/below the
                rendered window so the scrollbar + sticky thead stay accurate. */}
            {padTop > 0 && <tr style={{ height: padTop }}><td colSpan={colSpan} /></tr>}
            {virtualRows.map((vr) => {
              const b = sortedBuilds[vr.index]!;
              const idx = buildIndexOf.get(b) ?? 0;
              return (
                <ResultRow
                  key={idx}
                  build={b}
                  selected={b === selectedBuildRef}
                  ranges={ranges}
                  statCols={statCols}
                  ratingCols={ratingCols}
                  showScore={showScore}
                  showUpg={showUpg}
                  showWpn={showWpn}
                  showAcc={showAcc}
                  effects={effectByBuild.get(b)}
                  setTags={setTagsByBuild.get(b)}
                  index={idx}
                  onSelect={onSelect}
                />
              );
            })}
            {padBottom > 0 && <tr style={{ height: padBottom }}><td colSpan={colSpan} /></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Sortable column header — chevron indicates active sort + direction. */
function SortHeader({
  colKey, title, sortKey, sortDir, onClick, className, children,
}: {
  colKey: string;
  title?: string;
  sortKey: string | null;
  sortDir: "desc" | "asc";
  onClick: (key: string) => void;
  className?: string;
  children: ReactNode;
}) {
  const active = sortKey === colKey;
  const arrow = active ? (sortDir === "desc" ? "▼" : "▲") : "";
  return (
    <th
      onClick={() => onClick(colKey)}
      title={title}
      className={cx(
        "cursor-pointer select-none px-1.5 py-1 text-right text-[9.5px] uppercase tracking-wider hover:text-white",
        active && "text-cyan-300",
        className,
      )}
    >
      {children}{arrow && <span className="ml-0.5 text-[8px]">{arrow}</span>}
    </th>
  );
}

/** Per-column min/max for the heatmap shading. Pre-computed once per
 *  result set so each cell render is just a (v − min) / (max − min) lerp. */
interface ColumnRanges {
  stat: Record<string, { min: number; max: number }>;
  rating: Record<string, { min: number; max: number }>;
  score: { min: number; max: number };
}
/** Heatmap-off ranges — `score` non-finite + empty stat/rating maps make
 *  `heatStyle` bail (no tint) on every cell. */
const EMPTY_RANGES: ColumnRanges = { stat: {}, rating: {}, score: { min: Infinity, max: -Infinity } };

function computeColumnRanges(builds: SolveBuild[], statCols: ReadonlyArray<typeof SOLVER_STATS[number]>): ColumnRanges {
  const stat: ColumnRanges["stat"] = {};
  const rating: ColumnRanges["rating"] = {};
  let scoreMin = Infinity, scoreMax = -Infinity;
  for (const b of builds) {
    for (const s of statCols) {
      const v = (b.finalStats as unknown as Record<string, number>)[s.key];
      if (typeof v !== "number") continue;
      const cur = stat[s.key] ?? { min: Infinity, max: -Infinity };
      if (v < cur.min) cur.min = v;
      if (v > cur.max) cur.max = v;
      stat[s.key] = cur;
    }
    for (const r of TABLE_RATINGS) {
      const v = r.key === "cp" ? (b.cp ?? null) : (b.ratings as unknown as Record<string, number>)[r.key];
      if (v == null) continue;
      const cur = rating[r.key] ?? { min: Infinity, max: -Infinity };
      if (v < cur.min) cur.min = v;
      if (v > cur.max) cur.max = v;
      rating[r.key] = cur;
    }
    if (b.score < scoreMin) scoreMin = b.score;
    if (b.score > scoreMax) scoreMax = b.score;
  }
  return { stat, rating, score: { min: scoreMin, max: scoreMax } };
}

/** Fixed result-row height (px) — forced on each row so the virtualizer's
 *  size estimate equals the actual height (zero scroll drift). */
export const RESULT_ROW_H = 26;

/** One active armor-set bonus on a build — icon + bonus tier (2 or 4). */
interface SetTag { icon: string; name: string; count: 2 | 4 }

/** A weapon/accessory effect chip on a build — icon (may be null → initials)
 *  + effect name for the tooltip. */
interface EffectChip { icon: string | null; name: string }

/** Memoized so a hover/sort/selection change only re-renders the rows whose
 *  props actually changed. Requires stable props: `onSelect` is the parent's
 *  useState setter, `ranges` is memoized, `build` refs are stable. The click
 *  handler is bound to the stable `index` here rather than passed pre-closed. */
const ResultRow = memo(function ResultRow({
  build, selected, ranges, statCols, ratingCols, showScore, showUpg, showWpn, showAcc, effects, setTags, index, onSelect,
}: {
  build: SolveBuild;
  selected?: boolean;
  ranges: ColumnRanges;
  /** Stat columns to render — stable (memoized) reference from ResultsTable
   *  so it doesn't defeat the row memo on hover/sort. */
  statCols: ReadonlyArray<typeof SOLVER_STATS[number]>;
  /** Visible rating columns — stable (memoized) reference, same rationale. */
  ratingCols: ReadonlyArray<typeof TABLE_RATINGS[number]>;
  showScore: boolean;
  showUpg: boolean;
  showWpn: boolean;
  showAcc: boolean;
  /** This build's weapon + accessory effect chips (stable memoized ref). */
  effects: { weapon: EffectChip | null; accessory: EffectChip | null } | undefined;
  /** Active set bonuses for this build (icon + tier), or undefined for none.
   *  Stable reference (from ResultsTable's memoized map) so it doesn't defeat
   *  the row memo. */
  setTags: SetTag[] | undefined;
  index: number;
  onSelect: (i: number) => void;
}) {
  return (
    <tr
      onClick={() => onSelect(index)}
      style={{ height: RESULT_ROW_H }}
      className={cx(
        "cursor-pointer border-b border-white/4 hover:bg-white/4",
        selected && "bg-rose-900/30 hover:bg-rose-900/40",
      )}
    >
      <td className="px-1.5 py-1 text-left">
        {setTags && setTags.length > 0 ? (
          <div className="flex items-center gap-1">
            {setTags.map((t, i) => (
              <span key={i} className="inline-flex items-center gap-0.5" title={`${t.name} ·${t.count}pc`}>
                <img src={`/img/ui/effect/${t.icon}.webp`} alt={t.name} className="h-3.5 w-3.5 object-contain" />
                <span className="text-[9px] text-white/60">{t.count}</span>
              </span>
            ))}
          </div>
        ) : (
          <span className="text-white/55">—</span>
        )}
      </td>
      {showWpn && <EffectCell chip={effects?.weapon ?? null} />}
      {showAcc && <EffectCell chip={effects?.accessory ?? null} />}
      {statCols.map((s) => {
        const v = (build.finalStats as unknown as Record<string, number>)[s.key];
        return (
          <td key={s.key} style={heatStyle(v, ranges.stat[s.key])} className="px-1.5 py-1 text-right text-white">
            {fmt(v, s.unit)}
          </td>
        );
      })}
      {ratingCols.map((r) => {
        const v = r.key === "cp" ? build.cp : (build.ratings as unknown as Record<string, number>)[r.key];
        return (
          <td key={r.key} style={heatStyle(v, ranges.rating[r.key])} className="px-1.5 py-1 text-right text-white">
            {fmt(v, "")}
          </td>
        );
      })}
      {showScore && (
        <td style={heatStyle(build.score, ranges.score)} className="px-1.5 py-1 text-right font-semibold text-amber-200">
          {Math.round(build.score)}
        </td>
      )}
      {showUpg && (
        <td className="px-1.5 py-1 text-right text-white/70" title={`${build.upg} slot(s) differ from current loadout`}>
          {build.upg}
        </td>
      )}
      <td className="px-1.5 py-1 text-right text-white/70">
        {selected && <span title="Selected">★</span>}
      </td>
    </tr>
  );
});

/** Single weapon/accessory effect cell — the effect icon (or initials when the
 *  effect has no curated icon), with the effect name as the hover tooltip. */
function EffectCell({ chip }: { chip: EffectChip | null }) {
  return (
    <td className="px-1.5 py-1 text-left">
      {chip ? (
        <span className="inline-flex items-center" title={chip.name}>
          {chip.icon ? (
            <img src={`/img/ui/effect/${chip.icon}.webp`} alt={chip.name} className="h-4 w-4 object-contain" />
          ) : (
            <span className="text-[9px] font-semibold uppercase text-white/60">{chip.name.slice(0, 2)}</span>
          )}
        </span>
      ) : (
        <span className="text-white/25">—</span>
      )}
    </td>
  );
}

/** Display rounding: integer at |v| ≥ 100, else one decimal. Shared by `fmt`
 *  (the printed value) and `heatStyle` (the shade) so a cell is never tinted
 *  on a precision the user can't see — two cells printing the same number get
 *  the same colour. */
function roundDisplay(v: number): number {
  return Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
}

function fmt(v: number | null | undefined, unit: string): string {
  if (v == null) return "—";
  return `${roundDisplay(v)}${unit}`;
}

/** Continuous heatmap from rose (worst column value) through a transparent
 *  midline to emerald (best). Returns an inline `backgroundColor` rather than
 *  discrete Tailwind bands so the shade interpolates smoothly (no visible
 *  steps between adjacent rows). No style when the column is flat (min === max)
 *  or the value is missing. Shades on the *displayed* (rounded) value so
 *  identically-printed cells never differ in tint. */
const HEAT_EMERALD = [16, 185, 129] as const; // emerald-500
const HEAT_ROSE = [244, 63, 94] as const;     // rose-500
const HEAT_MAX_ALPHA = 0.22;                  // peak tint at the column extremes
function heatStyle(v: number | null | undefined, range: { min: number; max: number } | undefined): CSSProperties | undefined {
  if (v == null || !range || !isFinite(range.min) || range.min === range.max) return undefined;
  const tRaw = (roundDisplay(v) - range.min) / (range.max - range.min);
  const t = tRaw < 0 ? 0 : tRaw > 1 ? 1 : tRaw;
  const d = (t - 0.5) * 2; // -1 (worst) .. +1 (best); 0 at the midline
  const alpha = Math.abs(d) * HEAT_MAX_ALPHA;
  if (alpha < 0.01) return undefined; // mid-band → no tint (keeps the row clean)
  const [r, g, b] = d >= 0 ? HEAT_EMERALD : HEAT_ROSE;
  return { backgroundColor: `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})` };
}
