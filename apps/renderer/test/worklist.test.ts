import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { GameData, GearPiece, Inventory, RawUserItem } from "@gear-solver/core";
import { createToastStore, ToastStack, TOAST_TTL_MS } from "../src/design/Toast.js";
import { EQUIP_FAILURE, equipAssignments, equipPieces } from "../src/equip.js";
import type { SlotDiff } from "../src/lib/buildDiff.js";
import { worklistChangesFor } from "../src/lib/worklist/changes.js";
import { changeState, planWorklist } from "../src/lib/worklist/plan.js";
import {
  appliedNotice,
  changeKey,
  gemSlotsByUid,
  loadWorklist,
  reconcileWorklist,
  remainingChangeCount,
  upsertWorklistEntry,
  WORKLIST_KEY,
  worklistClaims,
  type WorklistChange,
  type WorklistEntry,
  type WorklistGemChange,
} from "../src/lib/storage/worklist.js";

// --- Trimmed fixtures: the helpers only read uid / equippedBy / gemSlots on the
//     gear, and (heroUid, changes) on the entries. ---
function inv(pieces: Array<{ uid: string; owner?: string; gems?: number[] }>): Inventory {
  return { gear: pieces.map((p) => ({ uid: p.uid, equippedBy: p.owner, gemSlots: p.gems })) } as unknown as Inventory;
}

function change(slot: string, toUid: string, fromUid: string | null = null): WorklistChange {
  return { slot, toUid, toName: toUid, fromUid, fromName: fromUid, done: false };
}

function gemChange(toUid: string, gemIndex: number, id: number): WorklistGemChange {
  return {
    kind: "gem", slot: "ooparts", gemIndex, toUid, toName: toUid,
    toGem: { id, name: `gem ${id}`, stat: null }, fromGem: null, done: false,
  };
}

function entry(id: string, heroUid: string, changes: WorklistChange[], createdAt = 0): WorklistEntry {
  return { id, heroUid, heroName: `Hero ${heroUid}`, charId: 0, mode: "cp", cp: null, upg: 0, changes, createdAt };
}

const GAME = {
  equipment: { 1: { name: "Talisman of Test" }, 2: { name: "Sword" } },
  gems: {
    15001: { type: "ATK", level: 1, st: "ST_ATK", ap: "OAT_RATE", v: 3 },
    15002: { type: "Def", level: 1, st: "ST_DEF", ap: "OAT_RATE", v: 3 },
    15004: { type: "CriRate", level: 1, st: "ST_CRITICAL_RATE", ap: "OAT_ADD", v: 2 },
  },
} as unknown as GameData;

function piece(uid: string, slot: string, itemId: number, opts: { owner?: string; gems?: number[] } = {}): GearPiece {
  return { uid, slot, itemId, name: null, main: [], equippedBy: opts.owner, gemSlots: opts.gems } as unknown as GearPiece;
}

describe("upsertWorklistEntry — one entry per hero", () => {
  const list = [entry("c", "h3", []), entry("b", "h2", []), entry("a", "h1", [])];

  it("replaces the hero's entry and keeps the others in order", () => {
    const next = upsertWorklistEntry(list, entry("b2", "h2", [change("weapon", "P")]));
    expect(next.map((e) => e.id)).toEqual(["b2", "c", "a"]);
  });

  it("adds a new hero's entry at the head", () => {
    expect(upsertWorklistEntry(list, entry("d", "h4", [])).map((e) => e.id)).toEqual(["d", "c", "b", "a"]);
  });

  it("drops the old entry's ticks with it", () => {
    const old = entry("a", "h1", [{ ...change("weapon", "P"), done: true }]);
    const next = upsertWorklistEntry([old], entry("a2", "h1", [change("weapon", "Q")]));
    expect(next).toHaveLength(1);
    expect(next[0]!.changes).toEqual([change("weapon", "Q")]);
  });
});

describe("loadWorklist — stored lists", () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (value: unknown) => {
    const store = new Map([[WORKLIST_KEY, JSON.stringify(value)]]);
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: () => {} });
  };

  it("an entry stored before gem lines (no `kind`) still reads as a piece line", () => {
    stub([{ id: "a", heroUid: "h1", heroName: "A", charId: 0, mode: "cp", cp: null, upg: 1, createdAt: 0,
      changes: [{ slot: "weapon", toUid: "P", toName: "P", fromUid: null, fromName: null, done: false }] }]);
    const [e] = loadWorklist();
    expect(e!.changes[0]!.kind).toBeUndefined();
    expect(changeKey(e!.changes[0]!)).toBe("weapon");
    expect(remainingChangeCount([e!], inv([{ uid: "P", owner: "h1" }]))).toBe(0);
    expect(planWorklist([e!], inv([{ uid: "P" }])).assignments.map((m) => m.uid)).toEqual(["P"]);
  });

  it("a list stored with two entries of one hero keeps the first (newest)", () => {
    stub([entry("new", "h1", []), entry("other", "h2", []), entry("old", "h1", [])]);
    expect(loadWorklist().map((e) => e.id)).toEqual(["new", "other"]);
  });
});

describe("worklistChangesFor — gem lines", () => {
  it("a build that only changes a gem (upg 0) still queues one line", () => {
    // The talisman is already on the hero with ATK in socket 1; the build wants
    // DEF in socket 2 too. Zeros in the allocation are ignored.
    const t = piece("T", "ooparts", 1, { owner: "h1", gems: [15001, 0, 0, 0, 0] });
    const diff: SlotDiff[] = [{ slot: "ooparts", proposed: t, worn: t, changed: false }];
    const changes = worklistChangesFor(diff, { talisman: [15001, 15002, 0, 0, 0], ee: [] }, GAME);
    expect(changes).toHaveLength(1);
    const g = changes[0] as WorklistGemChange;
    expect(g).toMatchObject({ kind: "gem", slot: "ooparts", gemIndex: 1, toUid: "T", toName: "Talisman of Test", fromGem: null, done: false });
    expect(g.toGem).toEqual({ id: 15002, name: "Lv 1 Defense%", stat: { stat: "defPct", value: 0.3, percent: true } });
  });

  it("a different gem in place is the line's `fromGem`; a 0 in the build removes nothing", () => {
    const t = piece("T", "ooparts", 1, { owner: "h1", gems: [15001, 15004, 0, 0, 0] });
    const diff: SlotDiff[] = [{ slot: "ooparts", proposed: t, worn: t, changed: false }];
    const changes = worklistChangesFor(diff, { talisman: [0, 15002, 0, 0, 0], ee: [] }, GAME) as WorklistGemChange[];
    expect(changes.map((c) => [c.gemIndex, c.toGem.id, c.fromGem?.id])).toEqual([[1, 15002, 15004]]);
  });

  it("pieces first, then the gems of the build's Talisman / EE", () => {
    const sword = piece("S", "weapon", 2);
    const ee = piece("E", "exclusive", 1, { gems: [0, 0, 0, 0, 0] });
    const diff: SlotDiff[] = [
      { slot: "weapon", proposed: sword, worn: null, changed: true },
      { slot: "exclusive", proposed: ee, worn: null, changed: true },
    ];
    const changes = worklistChangesFor(diff, { talisman: [], ee: [15004] }, GAME);
    expect(changes.map((c) => [c.kind ?? "piece", c.slot, c.toUid])).toEqual([
      ["piece", "weapon", "S"], ["piece", "exclusive", "E"], ["gem", "exclusive", "E"],
    ]);
  });

  it("no change at all gives no line", () => {
    const t = piece("T", "ooparts", 1, { owner: "h1", gems: [15001] });
    expect(worklistChangesFor([{ slot: "ooparts", proposed: t, worn: t, changed: false }], { talisman: [15001], ee: [] }, GAME)).toEqual([]);
  });
});

describe("gem lines — applied, counted, never claimed", () => {
  const list = [entry("a", "h1", [change("ooparts", "T"), gemChange("T", 1, 15002)])];

  it("applied once the piece is on the hero with the right gem", () => {
    const i = inv([{ uid: "T", owner: "h1", gems: [15001, 15002] }]);
    const st = changeState(list[0]!.changes[1]!, {
      equippedOnHero: new Set(["T"]), invUids: new Set(["T"]), contended: new Map(), gemSlots: gemSlotsByUid(i),
    });
    expect(st).toEqual({ applied: true, stale: false, conflict: false });
    expect(remainingChangeCount(list, i)).toBe(0);
  });

  it("not applied while the piece is on the hero with another gem there", () => {
    const i = inv([{ uid: "T", owner: "h1", gems: [15001, 15004] }]);
    const st = changeState(list[0]!.changes[1]!, {
      equippedOnHero: new Set(["T"]), invUids: new Set(["T"]), contended: new Map(), gemSlots: gemSlotsByUid(i),
    });
    expect(st.applied).toBe(false);
    expect(remainingChangeCount(list, i)).toBe(1);
  });

  it("not applied while the piece holds the gem but isn't on the hero", () => {
    expect(remainingChangeCount(list, inv([{ uid: "T", gems: [15001, 15002] }]))).toBe(2);
  });

  it("worklistClaims ignores gem lines", () => {
    const gemsOnly = [entry("a", "h1", [gemChange("T", 0, 15001)])];
    expect(worklistClaims(gemsOnly, inv([{ uid: "T" }]))).toEqual({});
    expect(worklistClaims(list, inv([{ uid: "T" }]))).toEqual({ T: "h1" });
  });

  it("the plan leaves gem lines out of Apply all", () => {
    const plan = planWorklist([entry("a", "h1", [gemChange("T", 0, 15001)])], inv([{ uid: "T" }]));
    expect(plan.assignments).toEqual([]);
    expect(plan.heroes).toBe(0);
  });

  it("reconcileWorklist drops the piece line first, then the gem line, and reports each pass", () => {
    const moved = reconcileWorklist(list, inv([{ uid: "T", owner: "h1", gems: [15001, 0] }]));
    expect(moved.next[0]!.changes.map(changeKey)).toEqual(["ooparts:gem1"]);
    expect(moved.applied).toEqual([{ heroUid: "h1", heroName: "Hero h1", applied: 1 }]);
    const socketed = reconcileWorklist(moved.next, inv([{ uid: "T", owner: "h1", gems: [15001, 15002] }]));
    expect(socketed.next).toEqual([]);
    expect(appliedNotice(socketed.applied)).toBe("Worklist: 1 change applied — Hero h1");
  });
});

describe("appliedNotice — one toast per import", () => {
  it("sums the lines across heroes, names each hero once", () => {
    expect(appliedNotice([
      { heroUid: "h1", heroName: "Ame", applied: 2 },
      { heroUid: "h2", heroName: "Rin", applied: 1 },
    ])).toBe("Worklist: 3 changes applied — Ame, Rin");
  });

  it("nothing applied, no toast", () => {
    const list = [entry("a", "h1", [change("weapon", "P")])];
    const r = reconcileWorklist(list, inv([{ uid: "P" }]));
    expect(r.changed).toBe(false);
    expect(r.next).toBe(list);
    expect(appliedNotice(r.applied)).toBeNull();
  });
});

describe("apply failures — the message names the cause", () => {
  afterEach(() => vi.unstubAllGlobals());
  const raw = { ItemList: [{ ItemUID: "P", ItemID: 30, CharUID: "0" }] } as unknown as RawUserItem;
  const game = { equipment: { 30: { slot: "weapon" } } } as unknown as GameData;
  const serve = (read: number, write: number) => vi.stubGlobal("fetch", vi.fn(async (url: string) => (
    url === "/captured/user_item.json"
      ? new Response(read === 200 ? JSON.stringify(raw) : "", { status: read })
      : new Response("{}", { status: write })
  )));

  it.each([
    [200, 200, "ok"],
    [200, 409, "game-open"],
    [200, 500, "failed"],
    [404, 200, "no-snapshot"],
  ] as const)("read %i, write %i → %s (Apply all and Apply locally agree)", async (read, write, outcome) => {
    serve(read, write);
    expect(await equipAssignments(game, [{ uid: "P", heroUid: "h1" }])).toBe(outcome);
    expect(await equipPieces(game, ["P"], "h1")).toBe(outcome);
  });

  it("one distinct text per failure cause", () => {
    const texts = Object.values(EQUIP_FAILURE);
    expect(Object.keys(EQUIP_FAILURE).sort()).toEqual(["failed", "game-open", "no-snapshot"]);
    expect(new Set(texts).size).toBe(texts.length);
    expect(EQUIP_FAILURE["game-open"]).toMatch(/game is open/);
  });
});

describe("toasts", () => {
  afterEach(() => vi.useRealTimers());

  it("a toast shows, then goes after the TTL", () => {
    vi.useFakeTimers();
    const store = createToastStore();
    const seen = vi.fn();
    store.subscribe(seen);
    store.notify("Added to worklist — Ame");
    expect(store.get().map((t) => t.text)).toEqual(["Added to worklist — Ame"]);
    vi.advanceTimersByTime(TOAST_TTL_MS - 1);
    store.notify("Worklist: 1 change applied — Rin");
    expect(store.get()).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(store.get().map((t) => t.text)).toEqual(["Worklist: 1 change applied — Rin"]);
    vi.advanceTimersByTime(TOAST_TTL_MS);
    expect(store.get()).toEqual([]);
    expect(seen).toHaveBeenCalledTimes(4);
  });

  it("dismiss and dispose clear early, timers included", () => {
    vi.useFakeTimers();
    const store = createToastStore();
    store.notify("a");
    store.notify("b");
    store.dismiss(store.get()[0]!.id);
    expect(store.get().map((t) => t.text)).toEqual(["b"]);
    store.dispose();
    expect(store.get()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("the stack renders each text, and nothing when empty", () => {
    const html = renderToStaticMarkup(createElement(ToastStack, {
      toasts: [{ id: 1, text: "Replaced in worklist — Ame" }], onDismiss: () => {},
    }));
    expect(html).toContain("Replaced in worklist — Ame");
    expect(html).toContain("fixed");
    expect(renderToStaticMarkup(createElement(ToastStack, { toasts: [], onDismiss: () => {} }))).toBe("");
  });
});
