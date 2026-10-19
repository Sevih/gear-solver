import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameData, Inventory, RawUserItem } from "@gear-solver/core";
import { equipAssignments } from "../src/equip.js";
import { changeState, planWorklist } from "../src/lib/worklist/plan.js";
import {
  equippedByHero,
  reconcileWorklist,
  remainingChangeCount,
  worklistClaims,
  type WorklistChange,
  type WorklistEntry,
} from "../src/lib/storage/worklist.js";

// --- Minimal fixtures. The planner only reads `gear[].uid` / `gear[].equippedBy`
//     and the entries' (heroUid, changes[{slot,toUid,fromUid}]) — everything else
//     on the real types is irrelevant here, so we build trimmed shapes. ---
function inv(pieces: Array<{ uid: string; owner?: string }>): Inventory {
  return { gear: pieces.map((p) => ({ uid: p.uid, equippedBy: p.owner })) } as unknown as Inventory;
}

function change(slot: string, toUid: string, fromUid: string | null = null): WorklistChange {
  return { slot, toUid, toName: toUid, fromUid, fromName: fromUid, done: false };
}

function entry(id: string, heroUid: string, changes: WorklistChange[], createdAt = 0): WorklistEntry {
  return { id, heroUid, heroName: heroUid, charId: 0, mode: "cp", cp: null, upg: 0, changes, createdAt };
}

describe("planWorklist — transaction planning", () => {
  it("returns an empty, non-applicable plan with no inventory or no entries", () => {
    expect(planWorklist([], inv([])).applicable).toBe(false);
    expect(planWorklist([entry("a", "h1", [change("weapon", "P")])], null).assignments).toEqual([]);
  });

  it("independent entries: no deps, no positions, applicable", () => {
    // Two heroes, each grabbing a free bag piece — nothing depends on anything.
    const list = [
      entry("a", "h1", [change("weapon", "P")]),
      entry("b", "h2", [change("helmet", "Q")]),
    ];
    const plan = planWorklist(list, inv([{ uid: "P" }, { uid: "Q" }]));
    expect(plan.hasDeps).toBe(false);
    expect(plan.position.size).toBe(0);
    expect(plan.applicable).toBe(true);
    expect(plan.heroes).toBe(2);
    expect(plan.assignments).toHaveLength(2);
    expect(plan.cyclic.size).toBe(0);
  });

  it("free-before-use: the entry that frees a piece is ordered first", () => {
    // h1 wants P (currently on h2). h2's build frees P (swaps it out for Q).
    // So h2 must be applied before h1 → order [b, a], 1-based positions.
    const list = [
      entry("a", "h1", [change("weapon", "P", "X")]), // h1: X → P  (P is on h2)
      entry("b", "h2", [change("weapon", "Q", "P")]), // h2: P → Q  (Q from bag) — frees P
    ];
    const plan = planWorklist(list, inv([{ uid: "P", owner: "h2" }, { uid: "X", owner: "h1" }, { uid: "Q" }]));
    expect(plan.hasDeps).toBe(true);
    expect(plan.order).toEqual(["b", "a"]);
    expect(plan.position.get("b")).toBe(1);
    expect(plan.position.get("a")).toBe(2);
    expect(plan.cyclic.size).toBe(0);
    expect(plan.applicable).toBe(true);
    // Assignments follow the order: h2's move first, then h1's.
    expect(plan.assignments.map((m) => m.entryId)).toEqual(["b", "a"]);
  });

  it("contention: one copy wanted by two heroes is flagged, not ordered away", () => {
    const list = [
      entry("a", "h1", [change("weapon", "P")]),
      entry("b", "h2", [change("weapon", "P")]),
    ];
    const plan = planWorklist(list, inv([{ uid: "P" }]));
    expect(plan.applicable).toBe(false);
    expect([...plan.contended.keys()]).toEqual(["P"]);
    expect(plan.contended.get("P")!.sort()).toEqual(["a", "b"]);
  });

  it("same hero wanting a piece twice is NOT contention (one hero, one copy)", () => {
    // Two entries for the SAME hero both target P — redundant, but a single
    // hero wearing its own copy isn't a two-heroes-one-copy conflict.
    const list = [
      entry("a", "h1", [change("weapon", "P")]),
      entry("b", "h1", [change("weapon", "P")]),
    ];
    const plan = planWorklist(list, inv([{ uid: "P" }]));
    expect(plan.applicable).toBe(true);
    expect(plan.contended.size).toBe(0);
  });

  it("cycle: mutual free/need pairs are marked cyclic, still applicable atomically", () => {
    // h1 wants P (on h2) and frees Q; h2 wants Q (on h1) and frees P.
    const list = [
      entry("a", "h1", [change("weapon", "P", "Q")]), // h1: Q → P
      entry("b", "h2", [change("weapon", "Q", "P")]), // h2: P → Q
    ];
    const plan = planWorklist(list, inv([{ uid: "P", owner: "h2" }, { uid: "Q", owner: "h1" }]));
    expect(plan.cyclic.has("a")).toBe(true);
    expect(plan.cyclic.has("b")).toBe(true);
    expect(plan.applicable).toBe(true);       // atomic apply resolves it
    expect(plan.assignments).toHaveLength(2);
  });

  it("excludes applied (already on hero) and stale (gone from inventory) changes", () => {
    const list = [
      entry("a", "h1", [
        change("weapon", "P"),   // P already on h1 → applied, skip
        change("helmet", "G"),   // G not in inventory → stale, skip
        change("gloves", "R"),   // R in bag → actionable
      ]),
    ];
    const plan = planWorklist(list, inv([{ uid: "P", owner: "h1" }, { uid: "R" }]));
    expect(plan.assignments.map((m) => m.uid)).toEqual(["R"]);
    expect(plan.heroes).toBe(1);
  });
});

describe("planWorklist — same hero, same slot: the newest build wins", () => {
  afterEach(() => vi.unstubAllGlobals());

  // The review case: hero H wears W0; "old" (W1) then "new" (W2) were queued on
  // the weapon, stored newest-first as App does.
  const list = [
    entry("new", "H", [change("weapon", "W2", "W0")], 2),
    entry("old", "H", [change("weapon", "W1", "W0")], 1),
  ];
  const i = inv([{ uid: "W0", owner: "H" }, { uid: "W1" }, { uid: "W2" }]);

  it("only the newest entry's change is assigned, the older one is marked superseded", () => {
    const plan = planWorklist(list, i);
    expect(plan.assignments.map((m) => [m.entryId, m.uid])).toEqual([["new", "W2"]]);
    expect(plan.superseded.get("old")).toEqual(new Set(["weapon"]));
    expect(plan.superseded.has("new")).toBe(false);
    expect(plan.applicable).toBe(true);
    expect(plan.contended.size).toBe(0);
    expect(plan.heroes).toBe(1);
    expect(plan.order).toEqual(["new"]); // fully superseded entry leaves the plan
  });

  it("recency reads createdAt before the list order", () => {
    // Same entries, list order reversed: createdAt still makes "new" win.
    const plan = planWorklist([...list].reverse(), i);
    expect(plan.assignments.map((m) => m.uid)).toEqual(["W2"]);
    expect(plan.superseded.get("old")).toEqual(new Set(["weapon"]));
  });

  it("an older entry keeps the slots the newer one doesn't touch", () => {
    const l = [
      entry("new", "H", [change("weapon", "W2", "W0")], 2),
      entry("old", "H", [change("weapon", "W1", "W0"), change("helmet", "H1")], 1),
    ];
    const plan = planWorklist(l, inv([{ uid: "W0", owner: "H" }, { uid: "W1" }, { uid: "W2" }, { uid: "H1" }]));
    expect(plan.assignments.map((m) => [m.entryId, m.slot, m.uid])).toEqual([
      ["new", "weapon", "W2"],
      ["old", "helmet", "H1"],
    ]);
    expect(plan.superseded.get("old")).toEqual(new Set(["weapon"]));
    expect(plan.heroes).toBe(1);
  });

  it("two heroes on one piece: contention unchanged", () => {
    const l = [
      entry("a", "h1", [change("weapon", "P")], 2),
      entry("b", "h2", [change("weapon", "P")], 1),
    ];
    const plan = planWorklist(l, inv([{ uid: "P" }]));
    expect(plan.applicable).toBe(false);
    expect(plan.contended.get("P")!.sort()).toEqual(["a", "b"]);
    expect(plan.superseded.size).toBe(0);
  });

  it("equipAssignments over the plan's assignments gives W2 to the hero", async () => {
    const raw = {
      ItemList: [
        { ItemUID: "W0", ItemID: 30, CharUID: "H" },
        { ItemUID: "W1", ItemID: 30, CharUID: "0" },
        { ItemUID: "W2", ItemID: 30, CharUID: "0" },
      ],
    } as unknown as RawUserItem;
    const game = { equipment: { 30: { slot: "weapon" } } } as unknown as GameData;
    let written: RawUserItem | null = null;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { body?: string }) => {
      if (url === "/captured/user_item.json") return new Response(JSON.stringify(raw));
      written = JSON.parse(init!.body!) as RawUserItem;
      return new Response("{}");
    }));
    expect(await equipAssignments(game, planWorklist(list, i).assignments)).toBe(true);
    const owner = (u: string) => written!.ItemList.find((it) => it.ItemUID === u)?.CharUID;
    expect([owner("W0"), owner("W1"), owner("W2")]).toEqual(["0", "0", "H"]);
  });

  it("the card reads the superseded slot, and never calls it a conflict", () => {
    const plan = planWorklist(list, i);
    const st = changeState(list[1]!.changes[0]!, {
      equippedOnHero: new Set(["W0"]),
      invUids: new Set(["W0", "W1", "W2"]),
      contended: plan.contended,
      supersededSlots: plan.superseded.get("old"),
    });
    expect(st).toEqual({ applied: false, stale: false, conflict: false, superseded: true });
  });
});

describe("worklistClaims — solver reservations", () => {
  it("maps each unapplied change's target to its claiming hero", () => {
    const list = [
      entry("a", "h1", [change("weapon", "P"), change("helmet", "Q")]),
      entry("b", "h2", [change("gloves", "R")]),
    ];
    const claims = worklistClaims(list, inv([{ uid: "P" }, { uid: "Q" }, { uid: "R" }]));
    expect(claims).toEqual({ P: "h1", Q: "h1", R: "h2" });
  });

  it("skips changes already applied (target on the hero) — real equippedBy covers those", () => {
    const list = [entry("a", "h1", [change("weapon", "P"), change("helmet", "Q")])];
    const claims = worklistClaims(list, inv([{ uid: "P", owner: "h1" }, { uid: "Q" }]));
    expect(claims).toEqual({ Q: "h1" }); // P applied → no claim
  });

  it("newest entry wins a double-claim (list is newest-first)", () => {
    const list = [
      entry("new", "h2", [change("weapon", "P")]),
      entry("old", "h1", [change("weapon", "P")]),
    ];
    const claims = worklistClaims(list, inv([{ uid: "P" }]));
    expect(claims).toEqual({ P: "h2" });
  });

  it("returns an empty map with no inventory", () => {
    expect(worklistClaims([entry("a", "h1", [change("weapon", "P")])], null)).toEqual({ P: "h1" });
    expect(worklistClaims([], inv([]))).toEqual({});
  });
});

describe("worklist helpers — shared equippedByHero map", () => {
  // The App builds the map once per inventory and passes it in; omitting it
  // (tests, other callers) rebuilds it — both must agree.
  const list = [
    entry("new", "h2", [change("weapon", "P"), change("helmet", "S")]),
    entry("mid", "h1", [change("weapon", "P"), change("helmet", "Q")]),
    entry("old", "h3", [change("gloves", "R")]),
  ];
  const inventories: Array<Inventory | null> = [
    inv([{ uid: "P" }, { uid: "Q", owner: "h1" }, { uid: "R", owner: "h3" }, { uid: "S", owner: "h1" }]),
    inv([]),
    null,
  ];

  it.each(inventories.map((i) => [i]))("same results with and without the map (%#)", (inventory) => {
    const equipped = equippedByHero(inventory);
    expect(reconcileWorklist(list, inventory, equipped)).toEqual(reconcileWorklist(list, inventory));
    expect(worklistClaims(list, inventory, equipped)).toEqual(worklistClaims(list, inventory));
    expect(remainingChangeCount(list, inventory, equipped)).toBe(remainingChangeCount(list, inventory));
  });

  it("reads the passed map rather than rebuilding it", () => {
    const inventory = inventories[0]!;
    const equipped = equippedByHero(inventory);
    // Q on h1 → the "mid" entry keeps only P; R on h3 → "old" is dropped.
    expect(reconcileWorklist(list, inventory, equipped).next.map((e) => [e.id, e.changes.map((c) => c.toUid)]))
      .toEqual([["new", ["P", "S"]], ["mid", ["P"]]]);
    expect(worklistClaims(list, inventory, equipped)).toEqual({ P: "h2", S: "h2" });
    expect(remainingChangeCount(list, inventory, equipped)).toBe(3);
    // An empty map means "nothing equipped": every change counts again.
    expect(remainingChangeCount(list, inventory, new Map())).toBe(5);
  });
});

describe("changeState — the card's conflict matches the plan's contention", () => {
  const ctxFor = (list: WorklistEntry[], inventory: Inventory) => ({
    equippedOnHero: null,
    invUids: new Set(inventory.gear.map((g) => g.uid)),
    contended: planWorklist(list, inventory).contended,
  });

  it("one hero queuing the same piece in two builds is not a conflict", () => {
    const list = [
      entry("a", "h1", [change("weapon", "P")]),
      entry("b", "h1", [change("weapon", "P")]),
    ];
    const i = inv([{ uid: "P" }]);
    const plan = planWorklist(list, i);
    // Header: "No cross-build dependencies — order doesn't matter."
    expect(plan.applicable).toBe(true);
    for (const e of list) expect(changeState(e.changes[0]!, ctxFor(list, i)).conflict).toBe(false);
  });

  it("two heroes wanting one copy is a conflict on both cards", () => {
    const list = [
      entry("a", "h1", [change("weapon", "P")]),
      entry("b", "h2", [change("weapon", "P")]),
    ];
    const i = inv([{ uid: "P" }]);
    for (const e of list) expect(changeState(e.changes[0]!, ctxFor(list, i)).conflict).toBe(true);
  });

  it("an applied change never reads as a conflict", () => {
    const list = [
      entry("a", "h1", [change("weapon", "P")]),
      entry("b", "h2", [change("weapon", "P")]),
    ];
    const i = inv([{ uid: "P", owner: "h1" }]);
    const st = changeState(list[0]!.changes[0]!, { ...ctxFor(list, i), equippedOnHero: new Set(["P"]) });
    expect(st).toEqual({ applied: true, stale: false, conflict: false, superseded: false });
  });
});
