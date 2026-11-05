import { useCallback, useEffect, useMemo, useState, type SetStateAction } from "react";
import type { Character, GameData, Inventory } from "@gear-solver/core";
import { jsonStringSet, useSessionState } from "../../hooks/usePersistedState.js";
import type { DesignRarity, SlotId } from "../../design/tokens.js";
import { toUiPiece, type UiPiece } from "../../design/adapter.js";
import type { QualityTier } from "../../lib/quality.js";
import { emptyFilters, FILTER_CODEC, FILTERS_STORAGE_KEY, TAB_SLOTS, matchesTab, matchesFilters, activeFilterCount, reachableTier, type FilterState, type InvTab } from "./filters.js";
import { SortHeader, type FixedSortKey, type SortKey } from "./SortHeader.js";
import { ItemDetail } from "./ItemDetail.js";
import { SubTabBar, SlotBar } from "./InventoryTabs.js";
import { FilterButton, FilterModal } from "./FilterModal.js";
import { VirtualGearGrid } from "./VirtualGearGrid.js";
import { ScrapCard } from "./ScrapCard.js";
import { hasScrapFields, scrapValue } from "../../lib/inventory/scrapValue.js";
import { addAll, materialRows, pruneSelection, pruneShown, scrapScope, toggleSelection } from "../../lib/inventory/scrapCard.js";
import { scrapDefaultPresets } from "../../lib/storage/inventoryFilterPresets.js";
import { RULES_CODEC, addRule, clampRuleIndex, matchesAnyRule, removeRule, ruleLabel, setRule, type ScrapRules } from "../../lib/inventory/scrapRules.js";
import { passiveOfUiPiece } from "../../lib/singularityPassives.js";
import { cx } from "../../design/cx.js";

// The Scrap value card's selection, kept for the session as a list of uids.
const SELECTION_CODEC = jsonStringSet();

/** The rules Gear › Scrap opens on (session key empty) and its link puts
 *  back: one per Scrap default set (`gs.gear.scrap.default`, the built-in
 *  "Scrap candidates" unless the user picked sets with Use for Scrap). */
export function scrapDefaultFilters(): ScrapRules {
  return scrapDefaultPresets().map((p) => p.filters);
}

// ── screen ──────────────────────────────────────────────────────────────

/** A drill-down request from Gear › Overview — clicking a quality tier /
 *  slot / armor set there opens Gear › Pieces pre-filtered to exactly that
 *  facet (filters reset first, so the result is the clean subset the number
 *  represented). One facet at a time. Or, from the Worklist, `pieceUid`: show
 *  that piece in the detail panel — the view is left as it is when the piece
 *  is visible in it, reset to the defaults (All, no filter) when the current
 *  tab or filters hide it. */
export interface InventoryDrill {
  quality?: QualityTier;
  slot?: SlotId;
  armorSet?: string;
  pieceUid?: string;
}

export interface InventoryScreenProps {
  inventory: Inventory | null;
  game: GameData | null;
  /** Pending drill from Gear › Overview — consumed once on change (filters replaced with
   *  the facet, tab reset to "all"), then `onDrillConsumed` clears it so a
   *  later plain visit doesn't re-apply a stale filter. */
  drill?: InventoryDrill | null;
  onDrillConsumed?: () => void;
  /** Account-global solver exclusions (App-owned) + a STABLE toggle handler
   *  (useCallback) so the memoized `GearTile`s don't re-render on every change. */
  excludedPieces?: Set<string>;
  onToggleExclude?: (uid: string) => void;
  /** Open the Builder on the shown piece's wearer (the card's portrait and
   *  "Optimize wearer →"). */
  onOptimizeWearer?: (heroUid: string) => void;
  /** Gear › Pieces (default) or Gear › Scrap: Scrap keeps its own filter
   *  rules (`gs.gear.scrap.filters`, the Scrap default's when empty; a piece
   *  shows when it matches any rule, the active one in `gs.gear.scrap.rule`
   *  is the one the Filter modal and the SlotBar edit)
   *  and select mode (`gs.gear.scrap.selectMode`, on by default), and always
   *  shows the Scrap value card. Sub-tab, sort, piece shown and selection are
   *  shared by both. Estimates only: nothing here acts on the game. */
  mode?: "pieces" | "scrap";
}

export function InventoryScreen({ inventory, game, drill = null, onDrillConsumed, excludedPieces, onToggleExclude, onOptimizeWearer, mode = "pieces" }: InventoryScreenProps) {
  const scrapMode = mode === "scrap";
  // Session-scoped view state — filters / sort / sub-tab survive remounting on
  // a tab swap (sessionStorage) but reset to their defaults on the next app
  // launch, so each session starts from a clean inventory view rather than last
  // session's leftover sort+filters. The piece shown (`selectedId`) and the
  // Scrap value card's selection (+ its mode) too: the pieces no longer in the
  // inventory are dropped on the first render (below).
  // Pieces and Scrap each keep their filters and select mode; the view's
  // pair is the one in use.
  const [piecesF, setPiecesF] = useSessionState<FilterState>(FILTERS_STORAGE_KEY, emptyFilters, FILTER_CODEC);
  // Scrap holds a list of rules; `f` / `setF` there are the active rule, so
  // everything below edits one FilterState on both views.
  const [scrapRules, setScrapRules] = useSessionState<ScrapRules>("gs.gear.scrap.filters", scrapDefaultFilters, RULES_CODEC);
  const [storedRuleIdx, setRuleIdx] = useSessionState<number>("gs.gear.scrap.rule", 0);
  const ruleIdx = clampRuleIndex(storedRuleIdx, scrapRules.length);
  const scrapF = scrapRules[ruleIdx]!;
  const setScrapF = useCallback((next: SetStateAction<FilterState>) => {
    setScrapRules((prev) => {
      const i = clampRuleIndex(storedRuleIdx, prev.length);
      const cur = prev[i]!;
      const value = typeof next === "function" ? next(cur) : next;
      return value === cur ? prev : setRule(prev, i, value);
    });
  }, [storedRuleIdx, setScrapRules]);
  const f = scrapMode ? scrapF : piecesF;
  const setF = scrapMode ? setScrapF : setPiecesF;
  const [tab, setTabState] = useSessionState<InvTab>("gs.inv.tab", "all");
  const [sort, setSort] = useSessionState<SortKey>("gs.inv.sort", "enhance");
  const [dir, setDir] = useSessionState<"asc" | "desc">("gs.inv.dir", "desc");
  const [selectedId, setSelectedId] = useSessionState<string | null>("gs.inv.selected", null);
  const [selection, setSelection] = useSessionState<Set<string>>("gs.inv.selection", () => new Set(), SELECTION_CODEC);
  const [piecesSelectMode, setPiecesSelectMode] = useSessionState("gs.inv.selectMode", false);
  const [scrapSelectMode, setScrapSelectMode] = useSessionState("gs.gear.scrap.selectMode", true);
  // Scrap without the tables' scrap fields has no card to select for: a click
  // just shows the piece.
  const selectMode = scrapMode ? scrapSelectMode && !!game && hasScrapFields(game.equipment) : piecesSelectMode;
  const setSelectMode = scrapMode ? setScrapSelectMode : setPiecesSelectMode;
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  // The slot bar's link names the Scrap default sets, re-read when the filter
  // modal (where they are set) opens or closes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const scrapDefaults = useMemo(() => (scrapMode ? scrapDefaultPresets() : null), [scrapMode, filterModalOpen]);

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

  // Consume an Overview drill-down: replace the filters with the single requested
  // facet (so the grid shows exactly the subset the clicked number counted),
  // reset to the "all" tab, drop any selection, then clear the request. A
  // piece drill (Worklist) shows the piece instead, touching the view only
  // when it hides the piece; an unknown uid (no inventory yet, piece gone)
  // changes nothing.
  useEffect(() => {
    if (!drill) return;
    if (drill.pieceUid) {
      const p = ui.find((x) => x.id === drill.pieceUid);
      if (p) {
        if (!(matchesTab(p, tab) && matchesFilters(p, f))) {
          setF(emptyFilters());
          setTabState("all");
        }
        setSelectedId(p.id);
      }
      onDrillConsumed?.();
      return;
    }
    const next = emptyFilters();
    if (drill.quality) next.quality = new Set([drill.quality]);
    if (drill.slot) next.slots = new Set([drill.slot]);
    if (drill.armorSet) next.armorSets = new Set([drill.armorSet]);
    setF(next);
    setTabState("all");
    setSelectedId(null);
    onDrillConsumed?.();
  }, [drill, ui, tab, f, setF, setTabState, setSelectedId, onDrillConsumed]);

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

  // Scrap shows the union of its rules.
  const filtered = useMemo(
    () => ui.filter((p) => matchesTab(p, tab) && (scrapMode ? matchesAnyRule(p, scrapRules) : matchesFilters(p, f))),
    [ui, tab, f, scrapMode, scrapRules],
  );

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
    availableStars, availableRarities, availableQualities, availableReachable, availablePassives,
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
    // +15 passive families (Singularity option names) carried in the scope.
    const passives = new Set<string>();
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
      const passive = passiveOfUiPiece(p);
      if (passive) passives.add(passive.family);
    }
    return {
      availableMains: mains, availableSubs: subs, availableArmorSets: armorSets,
      availableClasses: classes, availableStars: stars,
      availableRarities: rarities, availableQualities: qualities,
      availableReachable: reachable, availablePassives: passives,
    };
  }, [scopedForStats, game]);

  // Auto-prune any selection that becomes unavailable when the scope
  // narrows, so a chip the user can no longer see can't silently zero out
  // the grid. Runs whenever any availability set changes (tab / slot
  // toggle, or the inventory itself when capture updates). Skipped while an
  // Overview drill is pending: on mount both effects run in the same commit and
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

  // The card's selection and the piece shown lose the pieces that left the
  // inventory (sold, dissolved, new capture), like the filters' auto-prune —
  // adjusted during render when the inventory changes rather than in an
  // effect, so the card never prices a stale id for one frame. Also on the
  // first render with an inventory: what the session kept from the last visit
  // may name pieces sold since.
  const [prunedFor, setPrunedFor] = useState<Map<string, UiPiece> | null>(null);
  if (inventory && prunedFor !== uiById) {
    setPrunedFor(uiById);
    setSelection((prev) => pruneSelection(prev, uiById));
    setSelectedId((cur) => pruneShown(cur, uiById));
  }

  const filterCount = activeFilterCount(f);
  const scrapReady = !!game && hasScrapFields(game.equipment);
  const showScrap = scrapReady && (scrapMode || filterCount > 0 || selection.size > 0 || selectMode);

  // Scrap value card — the selection when it isn't empty (even the pieces
  // outside the view), the filtered view otherwise. Always shown on Scrap,
  // on Pieces once a filter or a selection exists. Older tables without the
  // scrap fields: no card (Scrap says why above the grid).
  const scrapCard = useMemo(() => {
    if (!showScrap || !game) return null;
    const scope = scrapScope(selection, filtered, uiById);
    const scrap = scrapValue(scope.pieces, game.equipment, game.items);
    return { scrap, label: scope.label, materials: materialRows(scrap, game.items) };
  }, [showScrap, game, selection, filtered, uiById]);

  // Stable handlers — referentially stable across selection changes (the
  // click handler changes with the mode only) so memoized `GearTile`s skip
  // re-renders when other tiles change.
  // A click shows the piece in the detail panel (a second click clears it);
  // in selection mode it also toggles the piece's selection and keeps it shown.
  const onSelect = useCallback((id: string) => {
    if (selectMode) {
      setSelection((prev) => toggleSelection(prev, id));
      setSelectedId(id);
    } else {
      setSelectedId((cur) => (cur === id ? null : id));
    }
  }, [selectMode, setSelection, setSelectedId]);
  const onToggleSelect = useCallback((id: string) => {
    setSelection((prev) => toggleSelection(prev, id));
  }, [setSelection]);
  const onSelectShown = useCallback(() => {
    setSelection((prev) => addAll(prev, filtered.map((p) => p.id)));
  }, [filtered, setSelection]);
  const onSelectExcluded = useCallback(() => {
    if (!excludedPieces) return;
    setSelection((prev) => addAll(prev, [...excludedPieces].filter((id) => uiById.has(id))));
  }, [excludedPieces, uiById, setSelection]);

  // Scrap's rule chips: pick the active rule, remove one, add an empty one
  // (made active, the modal opened on it). Back to the Scrap default: its
  // rules, the first active.
  const addScrapRule = () => {
    setScrapRules((prev) => addRule(prev, emptyFilters()));
    setRuleIdx(scrapRules.length);
    setFilterModalOpen(true);
  };
  const removeScrapRule = (i: number) => {
    setScrapRules((prev) => removeRule(prev, i));
    if (i < ruleIdx) setRuleIdx(ruleIdx - 1);
    else if (i === ruleIdx) setRuleIdx(Math.max(0, i - 1));
  };
  const resetScrapRules = () => {
    const next = scrapDefaultFilters();
    setScrapRules(next);
    setRuleIdx(0);
    if (next.some((r) => [...r.slots].some((s) => !TAB_SLOTS[tab].includes(s)))) setTabState("all");
  };

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

  // GearScreen shows the first-capture steps while nothing is captured.
  if (!inventory) return null;

  // 2-column layout: [ItemDetail (always shown, empty placeholder if no
  // selection) + Scrap value card] | [tabs + slot bar + sort header + grid]. The old right-
  // side FilterPanel was replaced by a game-style modal triggered from the
  // SubTabBar's right slot — same source of truth (`f` + `setF`), just a
  // different surface.
  return (
    <div className="flex h-full min-h-0 flex-1 gap-3 px-4 py-3">
      <div className="flex w-80 shrink-0 flex-col gap-3 min-h-0">
        <div className="flex min-h-0 flex-1">
          <ItemDetail
            piece={selected}
            equippedChar={selected?.equippedBy ? charsByUid.get(selected.equippedBy) ?? null : null}
            game={game}
            excluded={selected ? (excludedPieces?.has(selected.id) ?? false) : false}
            onToggleExclude={onToggleExclude}
            onOptimizeWearer={onOptimizeWearer}
          />
        </div>
        {scrapCard && (
          <ScrapCard
            scrap={scrapCard.scrap}
            label={scrapCard.label}
            materials={scrapCard.materials}
            selectMode={selectMode}
            selectedCount={selection.size}
            onToggleMode={() => setSelectMode((m) => !m)}
            onSelectShown={onSelectShown}
            onSelectExcluded={excludedPieces ? onSelectExcluded : undefined}
            onClear={() => setSelection(new Set())}
          />
        )}
      </div>
      <div className="min-w-0 flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between">
          <SubTabBar tab={tab} setTab={setTab} counts={tabCounts} />
          <FilterButton onClick={() => setFilterModalOpen(true)} count={filterCount} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <SlotBar tab={tab} selected={f.slots} onToggle={toggleSlot} />
          {scrapDefaults && (
            <button
              type="button"
              onClick={resetScrapRules}
              title={`Back to the filters Gear › Scrap opens on${scrapDefaults.map((d) => (d.title ? ` — ${d.title}` : "")).join("")}`}
              className="shrink-0 text-[11px] text-cyan-300 underline-offset-2 hover:underline"
            >
              {scrapDefaults.map((d) => d.name).join(" + ")}
            </button>
          )}
        </div>
        {scrapMode && (
          <div className="flex flex-wrap items-center gap-1 pb-2">
            {scrapRules.map((r, i) => (
              <span
                key={i}
                className={cx(
                  "inline-flex h-7 items-center rounded-md border text-[11px] font-medium transition-colors",
                  i === ruleIdx
                    ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-200"
                    : "border-white/7 bg-black/25 text-white hover:bg-white/10",
                )}
              >
                <button type="button" onClick={() => setRuleIdx(i)} className="h-full px-2">
                  {`${i + 1} · ${ruleLabel(r)}`}
                </button>
                {scrapRules.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeScrapRule(i)}
                    title="Remove this rule"
                    aria-label="Remove this rule"
                    className="h-full pr-2 pl-0.5 text-white/60 hover:text-white"
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
            <button
              type="button"
              onClick={addScrapRule}
              title="Add a rule: the grid shows the pieces matching any rule"
              className="inline-flex h-7 items-center rounded-md border border-white/7 bg-black/25 px-2 text-[11px] font-medium text-white transition-colors hover:bg-white/10"
            >
              + Rule
            </button>
            {scrapRules.length > 1 && (
              <span className="ml-2 text-[11px] text-white/60">Pieces matching any rule</span>
            )}
          </div>
        )}
        {scrapMode && !scrapReady && (
          <p className="pb-2 text-[11.5px] text-amber-200">
            The loaded game tables carry no scrap prices — sync game data in Settings › Data &amp; updates.
          </p>
        )}
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
          selection={scrapReady ? selection : undefined}
          onToggleSelect={scrapReady ? onToggleSelect : undefined}
        />
      </div>
      <FilterModal
        open={filterModalOpen}
        onClose={() => setFilterModalOpen(false)}
        current={f}
        onApply={applyFilters}
        scrapMode={scrapMode}
        availableMains={availableMains}
        availableSubs={availableSubs}
        availableArmorSets={availableArmorSets}
        availableClasses={availableClasses}
        availableStars={availableStars}
        availableRarities={availableRarities}
        availableQualities={availableQualities}
        availableReachable={availableReachable}
        availablePassives={availablePassives}
        armorSetName={(id) => game?.sets?.[id]?.name ?? `Set #${id}`}
        game={game}
      />
    </div>
  );
}
