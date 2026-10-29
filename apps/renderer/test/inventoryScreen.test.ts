// InventoryScreen's effects (drill from Home, auto-prune of the pills) and its
// Apply handler, run through a minimal hooks runtime: Vitest runs in the
// `node` environment (no DOM), so `react` is mocked with state / memo / effect
// slots, the component is called as a plain function and the effects of a
// render run in declaration order after it, like a React commit. The returned
// tree is only read for the props handed to SlotBar and FilterModal.
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

function seedSession(tab: string, f: FilterState) {
  session.set("gs.inv.tab", JSON.stringify(tab));
  session.set(FILTERS_STORAGE_KEY, FILTER_CODEC.serialize!(f));
}

describe("InventoryScreen — drill from Home", () => {
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
