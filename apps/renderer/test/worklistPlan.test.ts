import { describe, expect, it } from "vitest";
import type { Inventory } from "@gear-solver/core";
import { planWorklist } from "../src/lib/worklist/plan.js";
import type { WorklistChange, WorklistEntry } from "../src/lib/storage/worklist.js";

// --- Minimal fixtures. The planner only reads `gear[].uid` / `gear[].equippedBy`
//     and the entries' (heroUid, changes[{slot,toUid,fromUid}]) — everything else
//     on the real types is irrelevant here, so we build trimmed shapes. ---
function inv(pieces: Array<{ uid: string; owner?: string }>): Inventory {
  return { gear: pieces.map((p) => ({ uid: p.uid, equippedBy: p.owner })) } as unknown as Inventory;
}

function change(slot: string, toUid: string, fromUid: string | null = null): WorklistChange {
  return { slot, toUid, toName: toUid, fromUid, fromName: fromUid, done: false };
}

function entry(id: string, heroUid: string, changes: WorklistChange[]): WorklistEntry {
  return { id, heroUid, heroName: heroUid, charId: 0, mode: "cp", cp: null, upg: 0, changes, createdAt: 0 };
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
