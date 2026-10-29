import { useCallback, useEffect, useMemo, useState } from "react";
import type { Character, GameData, Inventory } from "@gear-solver/core";
import { useSessionState } from "../../hooks/usePersistedState.js";
import type { DesignRarity, SlotId } from "../../design/tokens.js";
import { toUiPiece, type UiPiece } from "../../design/adapter.js";
import type { QualityTier } from "../../lib/quality.js";
import { emptyFilters, FILTER_CODEC, FILTERS_STORAGE_KEY, TAB_SLOTS, matchesTab, matchesFilters, activeFilterCount, reachableTier, type FilterState, type InvTab } from "./filters.js";
import { SortHeader, type FixedSortKey, type SortKey } from "./SortHeader.js";
import { ItemDetail } from "./ItemDetail.js";
import { SubTabBar, SlotBar } from "./InventoryTabs.js";
import { FilterButton, FilterModal } from "./FilterModal.js";
import { VirtualGearGrid } from "./VirtualGearGrid.js";

// ── screen ──────────────────────────────────────────────────────────────

/** A drill-down request from the Home dashboard — clicking a quality tier /
 *  slot / armor set there opens the Inventory pre-filtered to exactly that
 *  facet (filters reset first, so the result is the clean subset the number
 *  represented). One facet at a time. */
export interface InventoryDrill {
  quality?: QualityTier;
  slot?: SlotId;
  armorSet?: string;
}

export interface InventoryScreenProps {
  inventory: Inventory | null;
  game: GameData | null;
  /** Pending drill from Home — consumed once on change (filters replaced with
   *  the facet, tab reset to "all"), then `onDrillConsumed` clears it so a
   *  later plain visit doesn't re-apply a stale filter. */
  drill?: InventoryDrill | null;
  onDrillConsumed?: () => void;
  /** Account-global solver exclusions (App-owned) + a STABLE toggle handler
   *  (useCallback) so the memoized `GearTile`s don't re-render on every change. */
  excludedPieces?: Set<string>;
  onToggleExclude?: (uid: string) => void;
}

export function InventoryScreen({ inventory, game, drill = null, onDrillConsumed, excludedPieces, onToggleExclude }: InventoryScreenProps) {
  // Session-scoped view state — filters / sort / sub-tab survive remounting on
  // a tab swap (sessionStorage) but reset to their defaults on the next app
  // launch, so each session starts from a clean inventory view rather than last
  // session's leftover sort+filters. `selectedId` stays fully ephemeral.
  const [f, setF] = useSessionState<FilterState>(FILTERS_STORAGE_KEY, emptyFilters, FILTER_CODEC);
  const [tab, setTabState] = useSessionState<InvTab>("gs.inv.tab", "all");
  const [sort, setSort] = useSessionState<SortKey>("gs.inv.sort", "enhance");
  const [dir, setDir] = useSessionState<"asc" | "desc">("gs.inv.dir", "desc");
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

  // Consume a Home drill-down: replace the filters with the single requested
  // facet (so the grid shows exactly the subset the clicked number counted),
  // reset to the "all" tab, drop any selection, then clear the request.
  useEffect(() => {
    if (!drill) return;
    const next = emptyFilters();
    if (drill.quality) next.quality = new Set([drill.quality]);
    if (drill.slot) next.slots = new Set([drill.slot]);
    if (drill.armorSet) next.armorSets = new Set([drill.armorSet]);
    setF(next);
    setTabState("all");
    setSelectedId(null);
    onDrillConsumed?.();
  }, [drill, setF, setTabState, onDrillConsumed]);

  // Apply from the filter modal. A loaded filter preset may carry a slot the
  // current tab doesn't show (saved on another tab): the view switches to
  // All, so the SlotBar shows that chip instead of a grid emptied by an
  // invisible criterion.
  const applyFilters = useCallback((next: FilterState) => {
    setF(next);
    if ([...next.slots].some((s) => !TAB_SLOTS[tab].includes(s))) setTabState("all");
  }, [tab, setF, setTabState]);

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

  // Filter-pill availability — which chips can possibly match in the current
  // scope, so the modal disables (or omits) chips that would zero out the grid.
  // Computed in ONE pass over `scopedForStats` (was 7 separate useMemos each
  // re-walking the same list; the quality one in particular ran a whole pass
  // on its own). Destructured below so every downstream consumer keeps its
  // individual `availableX` binding unchanged.
  const {
    availableMains, availableSubs, availableArmorSets, availableClasses,
    availableStars, availableRarities, availableQualities, availableReachable,
  } = useMemo(() => {
    const mains = new Set<string>();
    const subs = new Set<string>();
    // Armor 4-pc set IDs present in the scope, paired with their localized
    // name (from game.sets) for the pill labels.
    const armorSets = new Map<string, string>();
    // Class-restricted pieces — class name set (the modal maps name → icon).
    const classes = new Set<string>();
    // Star / Grade / Quality — pills outside these render disabled so the
    // player never picks a chip guaranteed to zero out the grid.
    const stars = new Set<number>();
    const rarities = new Set<DesignRarity>();
    const qualities = new Set<QualityTier>();
    const reachable = new Set<QualityTier>();
    for (const p of scopedForStats) {
      for (const m of p.main) mains.add(m.stat);
      for (const sub of p.subs) subs.add(sub.stat);
      if (p.armorSetId && !armorSets.has(p.armorSetId)) {
        const def = game?.sets?.[p.armorSetId];
        armorSets.set(p.armorSetId, def?.name ?? `Set #${p.armorSetId}`);
      }
      if (p.classLimit) classes.add(p.classLimit);
      stars.add(p.stars);
      rarities.add(p.rarity);
      if (p.quality) qualities.add(p.quality.tier);
      const rt = reachableTier(p);
      if (rt) reachable.add(rt);
    }
    return {
      availableMains: mains, availableSubs: subs, availableArmorSets: armorSets,
      availableClasses: classes, availableStars: stars,
      availableRarities: rarities, availableQualities: qualities,
      availableReachable: reachable,
    };
  }, [scopedForStats, game]);

  // Auto-prune any selection that becomes unavailable when the scope
  // narrows, so a chip the user can no longer see can't silently zero out
  // the grid. Runs whenever any availability set changes (tab / slot
  // toggle, or the inventory itself when capture updates). Skipped while a
  // Home drill is pending: on mount both effects run in the same commit and
  // the availabilities here are still those of the tab and slots the drill
  // replaces — the prune runs on the next render, in the drill's own scope.
  useEffect(() => {
    if (drill) return;
    setF((prev) => {
      const nextMains = new Set([...prev.mains].filter((s) => availableMains.has(s)));
      const nextSubs = new Set([...prev.subs].filter((s) => availableSubs.has(s)));
      const nextArmorSets = new Set([...prev.armorSets].filter((id) => availableArmorSets.has(id)));
      const nextClasses = new Set([...prev.classes].filter((c) => availableClasses.has(c)));
      const nextStars = new Set([...prev.stars].filter((n) => availableStars.has(n)));
      const nextRarities = new Set([...prev.rarities].filter((r) => availableRarities.has(r)));
      const nextQuality = new Set([...prev.quality].filter((q) => availableQualities.has(q)));
      const nextReachable = new Set([...prev.reachable].filter((q) => availableReachable.has(q)));
      if (nextMains.size === prev.mains.size
        && nextSubs.size === prev.subs.size
        && nextArmorSets.size === prev.armorSets.size
        && nextClasses.size === prev.classes.size
        && nextStars.size === prev.stars.size
        && nextRarities.size === prev.rarities.size
        && nextQuality.size === prev.quality.size
        && nextReachable.size === prev.reachable.size) return prev;
      return {
        ...prev,
        mains: nextMains, subs: nextSubs, armorSets: nextArmorSets, classes: nextClasses,
        stars: nextStars, rarities: nextRarities, quality: nextQuality,
        reachable: nextReachable,
      };
    });
  }, [drill, availableMains, availableSubs, availableArmorSets, availableClasses, availableStars, availableRarities, availableQualities, availableReachable, setF]);

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
        excluded={selected ? (excludedPieces?.has(selected.id) ?? false) : false}
        onToggleExclude={onToggleExclude}
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
          excludedPieces={excludedPieces}
          onToggleExclude={onToggleExclude}
        />
      </div>
      <FilterModal
        open={filterModalOpen}
        onClose={() => setFilterModalOpen(false)}
        current={f}
        onApply={applyFilters}
        availableMains={availableMains}
        availableSubs={availableSubs}
        availableArmorSets={availableArmorSets}
        availableClasses={availableClasses}
        availableStars={availableStars}
        availableRarities={availableRarities}
        availableQualities={availableQualities}
        availableReachable={availableReachable}
        armorSetName={(id) => game?.sets?.[id]?.name ?? `Set #${id}`}
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
        Install the capture plugin (Setup, top right), then play OUTERPLANE on Steam: your gear and heroes import as soon as the lobby loads <span className="font-mono text-white">/user/item</span>. No Steam? Import your snapshot files by hand below.
      </p>
    </div>
  );
}
