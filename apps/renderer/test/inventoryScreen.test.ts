// InventoryScreen's effects (drill from Gear › Overview or from the Worklist, auto-prune of the pills), its
// Apply handler and its session-kept selection, run through a minimal hooks runtime: Vitest runs in the
// `node` environment (no DOM), so `react` is mocked with state / memo / effect
// slots, the component is called as a plain function and the effects of a
// render run in declaration order after it, like a React commit. The returned
// tree is only read for the props handed to SlotBar, FilterModal and
// ItemDetail.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { GearPiece, GearSlot, Inventory } from "@gear-solver/core";
import { toUiPiece } from "../src/design/adapter.js";
import { emptyFilters, FILTER_CODEC, FILTERS_STORAGE_KEY, type FilterState } from "../src/screens/inventory/filters.js";
import { saveInventoryFilterPreset } from "../src/lib/storage/inventoryFilterPresets.js";

const runtime = vi.hoisted(() => {
  type Slot = { value?: unknown; deps?: unknown[]; set?: (next: unknown) => void };
  const instances = new Map<string, Slot[]>();
  let slots: Slot[] = [];
  let cursor = 0;
  let pending: Array<() => void> = [];
  let dirty = false;
  const changed = (prev: unknown[] | undefined, next: unknown[] | undefined) =>
    !prev || !next || prev.length !== next.length || prev.some((v, i) => !Object.is(v, next[i]));
  const slot = (): Slot => (slots[cursor++] ??= {});
  return {
    reset() { instances.clear(); },
    /** Render, run the effects, re-render while state changed. `key` names
     *  the component instance whose hook slots are used. */
    render<T>(component: () => T, key = "screen"): T {
      if (!instances.has(key)) instances.set(key, []);
      for (let pass = 0; pass < 20; pass++) {
        slots = instances.get(key)!;
        cursor = 0;
        pending = [];
        dirty = false;
        const out = component();
        for (const effect of pending) effect();
        if (!dirty) return out;
      }
      throw new Error("render loop");
    },
    hooks: {
      useState(initial: unknown) {
        const s = slot();
        if (!s.set) {
          s.value = typeof initial === "function" ? (initial as () => unknown)() : initial;
          s.set = (next) => {
            const v = typeof next === "function" ? (next as (p: unknown) => unknown)(s.value) : next;
            if (!Object.is(v, s.value)) { s.value = v; dirty = true; }
          };
        }
        return [s.value, s.set];
      },
      useMemo(factory: () => unknown, deps?: unknown[]) {
        const s = slot();
        if (changed(s.deps, deps)) { s.value = factory(); s.deps = deps; }
        return s.value;
      },
      useCallback(fn: unknown, deps?: unknown[]) {
        const s = slot();
        if (changed(s.deps, deps)) { s.value = fn; s.deps = deps; }
        return s.value;
      },
      useRef(initial: unknown) {
        const s = slot();
        s.value ??= { current: initial };
        return s.value;
      },
      useEffect(effect: () => void, deps?: unknown[]) {
        const s = slot();
        if (changed(s.deps, deps)) { s.deps = deps; pending.push(effect); }
      },
    },
  };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...runtime.hooks }));
vi.mock("react-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  createPortal: (children: unknown) => children,
}));
(globalThis as { document?: unknown }).document ??= { body: null, addEventListener: () => {}, removeEventListener: () => {} };

const { InventoryScreen } = await import("../src/screens/inventory/InventoryScreen.js");
const { SlotBar } = await import("../src/screens/inventory/InventoryTabs.js");
const { FilterModal } = await import("../src/screens/inventory/FilterModal.js");
const { ItemDetail } = await import("../src/screens/inventory/ItemDetail.js");

// Map-backed Storage stubs — the screen's view state lives in sessionStorage,
// the filter presets in localStorage.
const stub = (m: Map<string, string>) => ({
  getItem: (k: string) => m.get(k) ?? null,
  setItem: (k: string, v: string) => void m.set(k, String(v)),
  removeItem: (k: string) => void m.delete(k),
  clear: () => m.clear(),
  key: () => null,
  get length() { return m.size; },
}) as Storage;
const session = new Map<string, string>();
const local = new Map<string, string>();
beforeEach(() => {
  runtime.reset();
  session.clear();
  local.clear();
  (globalThis as { sessionStorage?: Storage }).sessionStorage = stub(session);
  (globalThis as { localStorage?: Storage }).localStorage = stub(local);
});

const piece = (uid: string, slot: GearSlot, ticks: number[]): GearPiece => ({
  uid, itemId: 1, slot, setId: null, armorSetId: null, rarity: "unique", star: 6, name: "", classLimit: null,
  breakthrough: 0, reforgeCount: 0, enhanceLevel: 10, singularityLevel: 0, ascended: false, locked: false,
  equippedBy: null, main: [],
  subs: ticks.map((t) => ({ stat: "atkPct", value: 4 * t, percent: true, ticks: t, reforgeTicks: 0 })),
});
const helmet = piece("1", "helmet", [4, 4, 3, 3]);
const talisman = piece("2", "ooparts", []);
const inventory = { gear: [helmet, talisman], characters: [] } as unknown as Inventory;
const helmetTier = toUiPiece(helmet).quality!.tier;

/** Every element of the tree, depth first. */
function* walk(node: unknown): Generator<ReactElement> {
  if (Array.isArray(node)) { for (const n of node) yield* walk(n); return; }
  if (!node || typeof node !== "object" || !("props" in node)) return;
  const el = node as ReactElement<{ children?: unknown }>;
  yield el;
  yield* walk(el.props.children);
}
const find = <P>(tree: unknown, type: unknown) => {
  for (const el of walk(tree)) if (el.type === type) return el as ReactElement<P>;
  throw new Error("element not found");
};
type SlotBarProps = Parameters<typeof SlotBar>[0];
type ModalProps = Parameters<typeof FilterModal>[0];
type DetailProps = Parameters<typeof ItemDetail>[0];

function seedSession(tab: string, f: FilterState) {
  session.set("gs.inv.tab", JSON.stringify(tab));
  session.set(FILTERS_STORAGE_KEY, FILTER_CODEC.serialize!(f));
}

describe("InventoryScreen — drill from Gear › Overview", () => {
  it("a quality drill left on Special keeps its tier on the All tab", () => {
    expect(helmetTier).toBeTruthy();
    seedSession("special", { ...emptyFilters(), slots: new Set(["talisman"]) });
    let drill: { quality: typeof helmetTier } | null = { quality: helmetTier };
    const tree = runtime.render(() => InventoryScreen({ inventory, game: null, drill, onDrillConsumed: () => { drill = null; } }));
    expect(drill).toBeNull();
    expect(find<SlotBarProps>(tree, SlotBar).props.tab).toBe("all");
    const current = find<ModalProps>(tree, FilterModal).props.current;
    expect(current.quality).toEqual(new Set([helmetTier]));
    expect(current.slots.size).toBe(0);
  });
});

describe("InventoryScreen — piece drill from the Worklist", () => {
  const drillTo = (uid: string) => {
    let drill: { pieceUid: string } | null = { pieceUid: uid };
    const tree = runtime.render(() => InventoryScreen({ inventory, game: null, drill, onDrillConsumed: () => { drill = null; } }));
    expect(drill).toBeNull();
    return tree;
  };

  it("a visible piece is shown, the tab and filters left alone", () => {
    seedSession("gear", { ...emptyFilters(), slots: new Set(["helmet"]) });
    const tree = drillTo("1");
    expect(find<DetailProps>(tree, ItemDetail).props.piece?.id).toBe("1");
    expect(find<SlotBarProps>(tree, SlotBar).props.tab).toBe("gear");
    expect(find<ModalProps>(tree, FilterModal).props.current.slots).toEqual(new Set(["helmet"]));
    expect(session.get("gs.inv.selected")).toBe(JSON.stringify("1"));
  });

  it("a piece the view hides resets the view to its defaults", () => {
    seedSession("gear", { ...emptyFilters(), slots: new Set(["helmet"]) });
    const tree = drillTo("2");
    expect(find<DetailProps>(tree, ItemDetail).props.piece?.id).toBe("2");
    expect(find<SlotBarProps>(tree, SlotBar).props.tab).toBe("all");
    expect(find<ModalProps>(tree, FilterModal).props.current.slots.size).toBe(0);
  });

  it("an unknown piece is consumed without touching the view", () => {
    seedSession("gear", { ...emptyFilters(), slots: new Set(["helmet"]) });
    const tree = drillTo("gone");
    expect(find<DetailProps>(tree, ItemDetail).props.piece).toBeNull();
    expect(find<SlotBarProps>(tree, SlotBar).props.tab).toBe("gear");
    expect(find<ModalProps>(tree, FilterModal).props.current.slots).toEqual(new Set(["helmet"]));
  });

  it("hands the wearer link to the piece card", () => {
    const onOptimizeWearer = () => {};
    const tree = runtime.render(() => InventoryScreen({ inventory, game: null, onOptimizeWearer }));
    expect(find<DetailProps>(tree, ItemDetail).props.onOptimizeWearer).toBe(onOptimizeWearer);
  });
});

describe("InventoryScreen — filter preset outside the tab", () => {
  it("applying a talisman preset on Gear switches to All and shows the chip", () => {
    seedSession("gear", emptyFilters());
    const screen = () => InventoryScreen({ inventory, game: null });
    let tree = runtime.render(screen);
    expect(find<SlotBarProps>(tree, SlotBar).props.tab).toBe("gear");
    const onApply = find<ModalProps>(tree, FilterModal).props.onApply;
    onApply({ ...emptyFilters(), slots: new Set(["talisman"]) });
    tree = runtime.render(screen);
    const bar = find<SlotBarProps>(tree, SlotBar).props;
    expect(bar.tab).toBe("all");
    expect(bar.selected).toEqual(new Set(["talisman"]));
  });

  it("a preset whose slots fit the tab leaves the tab alone", () => {
    seedSession("gear", emptyFilters());
    const screen = () => InventoryScreen({ inventory, game: null });
    let tree = runtime.render(screen);
    find<ModalProps>(tree, FilterModal).props.onApply({ ...emptyFilters(), slots: new Set(["helmet"]) });
    tree = runtime.render(screen);
    expect(find<SlotBarProps>(tree, SlotBar).props.tab).toBe("gear");
  });
});

describe("InventoryScreen — selection kept for the session", () => {
  it("reads the piece shown, the selection and its mode back, without the pieces sold since", () => {
    session.set("gs.inv.selected", JSON.stringify("gone"));
    session.set("gs.inv.selection", JSON.stringify(["1", "gone"]));
    session.set("gs.inv.selectMode", "true");
    const tree = runtime.render(() => InventoryScreen({ inventory, game: null }));
    expect(find<DetailProps>(tree, ItemDetail).props.piece).toBeNull();
    expect(session.get("gs.inv.selected")).toBe("null");
    expect(JSON.parse(session.get("gs.inv.selection")!)).toEqual(["1"]);
    expect(session.get("gs.inv.selectMode")).toBe("true");
  });

  it("a piece still in the inventory stays shown", () => {
    session.set("gs.inv.selected", JSON.stringify("1"));
    const tree = runtime.render(() => InventoryScreen({ inventory, game: null }));
    expect(find<DetailProps>(tree, ItemDetail).props.piece?.id).toBe("1");
  });

  it("a stored selection that isn't a list reads as empty", () => {
    session.set("gs.inv.selection", JSON.stringify({ 1: true }));
    runtime.render(() => InventoryScreen({ inventory, game: null }));
    expect(session.get("gs.inv.selection")).toBe("[]");
  });
});

/** The amber line above the grid counting the greyed filter values, or null. */
const unavailableNotice = (tree: unknown): string | null => {
  for (const el of walk(tree)) {
    if (el.type !== "p") continue;
    const text = [el.props.children].flat().join("");
    if (text.includes("without an available piece")) return text;
  }
  return null;
};

describe("InventoryScreen — auto-prune waits for the inventory", () => {
  const kept = () => ({ ...emptyFilters(), subs: new Set(["atkPct", "eff"]) });

  it("no inventory yet: the chips kept for the session stay", () => {
    seedSession("all", kept());
    const tree = runtime.render(() => InventoryScreen({ inventory: null, game: null }));
    expect(FILTER_CODEC.deserialize!(session.get(FILTERS_STORAGE_KEY)!).subs).toEqual(new Set(["atkPct", "eff"]));
    expect(unavailableNotice(tree)).toBeNull();
  });

  it("an empty inventory, loaded, prunes them", () => {
    seedSession("all", kept());
    const empty = { gear: [], characters: [] } as unknown as Inventory;
    const tree = runtime.render(() => InventoryScreen({ inventory: empty, game: null }));
    expect(find<ModalProps>(tree, FilterModal).props.current.subs.size).toBe(0);
  });

  it("a loaded inventory prunes the unavailable chips only, also when it arrives after the mount", () => {
    seedSession("all", kept());
    let inv: Inventory | null = null;
    const screen = () => InventoryScreen({ inventory: inv, game: null });
    runtime.render(screen);
    inv = inventory;
    const tree = runtime.render(screen);
    expect(find<ModalProps>(tree, FilterModal).props.current.subs).toEqual(new Set(["atkPct"]));
  });
});

describe("InventoryScreen — filter preset applied on another scope", () => {
  // EFF only on boots: available on Gear with no slot, absent from the helmets.
  const boots: GearPiece = { ...piece("3", "boots", []), subs: [{ stat: "eff", value: 8, percent: true, ticks: 2, reforgeTicks: 0 }] };
  const withBoots = { gear: [helmet, talisman, boots], characters: [] } as unknown as Inventory;
  const screen = () => InventoryScreen({ inventory: withBoots, game: null });

  it("Helmet + sub EFF: EFF stays, greyed in the modal, and the line counts it", () => {
    seedSession("gear", emptyFilters());
    let tree = runtime.render(screen);
    expect(unavailableNotice(tree)).toBeNull();
    find<ModalProps>(tree, FilterModal).props.onApply({ ...emptyFilters(), slots: new Set(["helmet"]), subs: new Set(["eff", "atkPct"]) });
    tree = runtime.render(screen);
    const modal = find<ModalProps>(tree, FilterModal).props;
    expect(modal.current.subs).toEqual(new Set(["eff", "atkPct"]));
    expect(modal.availableSubs.has("eff")).toBe(false);
    expect(unavailableNotice(tree)).toBe("1 filter without an available piece");
  });

  it("removing the greyed value with a click clears the line", () => {
    seedSession("gear", emptyFilters());
    let tree = runtime.render(screen);
    find<ModalProps>(tree, FilterModal).props.onApply({ ...emptyFilters(), slots: new Set(["helmet"]), subs: new Set(["eff"]) });
    tree = runtime.render(screen);
    find<ModalProps>(tree, FilterModal).props.onApply({ ...emptyFilters(), slots: new Set(["helmet"]) });
    tree = runtime.render(screen);
    expect(find<ModalProps>(tree, FilterModal).props.current.subs.size).toBe(0);
    expect(unavailableNotice(tree)).toBeNull();
  });

  it("same scope: unchanged, the value stays greyed and counted", () => {
    seedSession("gear", { ...emptyFilters(), slots: new Set(["helmet"]) });
    let tree = runtime.render(screen);
    find<ModalProps>(tree, FilterModal).props.onApply({ ...emptyFilters(), slots: new Set(["helmet"]), subs: new Set(["eff"]) });
    tree = runtime.render(screen);
    expect(find<ModalProps>(tree, FilterModal).props.current.subs).toEqual(new Set(["eff"]));
    expect(unavailableNotice(tree)).toBe("1 filter without an available piece");
  });

  it("a slot chip toggled by hand afterwards still prunes", () => {
    seedSession("gear", emptyFilters());
    let tree = runtime.render(screen);
    find<ModalProps>(tree, FilterModal).props.onApply({ ...emptyFilters(), slots: new Set(["helmet"]), subs: new Set(["eff"]) });
    tree = runtime.render(screen);
    find<SlotBarProps>(tree, SlotBar).props.onToggle("talisman");
    tree = runtime.render(screen);
    expect(find<ModalProps>(tree, FilterModal).props.current.subs.size).toBe(0);
  });
});

describe("FilterModal — Load of a filter preset", () => {
  it("keeps the search typed in the draft", () => {
    const saved = saveInventoryFilterPreset("Talismans", { ...emptyFilters(), slots: new Set(["talisman"]) })!;
    const modal = runtime.render(() => FilterModal({
      open: true, onClose: () => {}, current: { ...emptyFilters(), query: "boots" }, onApply: () => {},
      availableMains: new Set(), availableSubs: new Set(), availableArmorSets: new Map(), availableClasses: new Set(),
      availableStars: new Set(), availableRarities: new Set(), availableQualities: new Set(), availableReachable: new Set(),
      armorSetName: (id: string) => id,
    }), "modal");
    const row = [...walk(modal)].find((el) => typeof el.type === "function" && el.type.name === "PresetsRow")!;
    const PresetsRow = row.type as (p: typeof row.props) => unknown;
    let loaded: FilterState | null = null;
    const props = { ...(row.props as object), onLoad: (f: FilterState) => { loaded = f; } };
    let tree = runtime.render(() => PresetsRow(props), "row");
    find<{ onChange: (e: unknown) => void }>(tree, "select").props.onChange({ target: { value: saved.id } });
    tree = runtime.render(() => PresetsRow(props), "row");
    const load = [...walk(tree)].find((el) => el.type === "button" && (el.props as { children?: unknown }).children === "Load")!;
    (load.props as { onClick: () => void }).onClick();
    expect(loaded!.slots).toEqual(new Set(["talisman"]));
    expect(loaded!.query).toBe("boots");
  });
});
