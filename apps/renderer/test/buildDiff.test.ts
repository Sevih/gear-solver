import { describe, expect, it } from "vitest";
import type { GearPiece } from "@gear-solver/core";
import { diffBuildVsLoadout } from "../src/lib/buildDiff.js";

function piece(slot: string, uid: string, equippedBy: string | null = null): GearPiece {
  return {
    uid, itemId: 1, slot, setId: null, armorSetId: null,
    rarity: "epic", star: 6, name: uid, classLimit: null,
    breakthrough: 0, reforgeCount: 0, enhanceLevel: 15, singularityLevel: 0,
    ascended: false, locked: false, equippedBy,
    main: [], subs: [],
  } as unknown as GearPiece;
}

const byUid = (pieces: GearPiece[]) => new Map(pieces.map((p) => [p.uid, p]));

/** The engine's `upg` (`finalizeBuilds`): build uids not equipped on the hero. */
const engineUpg = (uids: string[], hero: string, m: Map<string, GearPiece>) =>
  uids.filter((u) => m.get(u)?.equippedBy !== hero).length;

describe("diffBuildVsLoadout — one 'slot changed' rule for Equip, Worklist and the gear band", () => {
  it("a piece already on the hero is unchanged, its worn side is itself", () => {
    const w = piece("weapon", "w1", "hero");
    const [d] = diffBuildVsLoadout(["w1"], "hero", byUid([w]));
    expect(d).toEqual({ slot: "weapon", proposed: w, worn: w, changed: false });
  });

  it("a piece worn by another hero changes the slot and names what it replaces", () => {
    const mine = piece("helmet", "h-mine", "hero");
    const theirs = piece("helmet", "h-theirs", "other");
    const [d] = diffBuildVsLoadout(["h-theirs"], "hero", byUid([mine, theirs]));
    expect(d).toMatchObject({ slot: "helmet", worn: mine, changed: true });
    expect(d!.proposed.equippedBy).toBe("other"); // Equip counts it as stolen
  });

  it("an empty slot on the hero: changed, nothing worn", () => {
    const free = piece("boots", "b1");
    const [d] = diffBuildVsLoadout(["b1"], "hero", byUid([free]));
    expect(d).toMatchObject({ slot: "boots", worn: null, changed: true });
  });

  it("talisman and EE are diffed like any slot, keyed on their engine slot", () => {
    const ee = piece("exclusive", "ee1", "hero");
    const tali = piece("ooparts", "t-new");
    const taliWorn = piece("ooparts", "t-old", "hero");
    const out = diffBuildVsLoadout(["ee1", "t-new"], "hero", byUid([ee, tali, taliWorn]));
    expect(out.map((d) => [d.slot, d.changed, d.worn?.uid ?? null])).toEqual([
      ["exclusive", false, "ee1"],
      ["ooparts", true, "t-old"],
    ]);
  });

  it("changed count matches the engine's upg on a full build", () => {
    const pieces = [
      piece("weapon", "w", "hero"), piece("helmet", "h", "other"), piece("armor", "a"),
      piece("gloves", "g", "hero"), piece("boots", "b", "other"), piece("accessory", "x"),
      piece("exclusive", "e", "hero"), piece("ooparts", "t"),
    ];
    const uids = pieces.map((p) => p.uid);
    const m = byUid(pieces);
    const out = diffBuildVsLoadout(uids, "hero", m);
    expect(out).toHaveLength(8);
    expect(out.filter((d) => d.changed).length).toBe(engineUpg(uids, "hero", m));
  });

  it("recounted on the re-imported inventory: after Equip the build changes 0 slots (Builder header)", () => {
    // The header reads `changed` off the live inventory, not the solve-time
    // `upg` (2 here) which stays on the build after Equip.
    const before = [piece("weapon", "w-new", "other"), piece("helmet", "h-new"), piece("weapon", "w-old", "hero")];
    expect(diffBuildVsLoadout(["w-new", "h-new"], "hero", byUid(before)).filter((d) => d.changed)).toHaveLength(2);
    const after = [piece("weapon", "w-new", "hero"), piece("helmet", "h-new", "hero"), piece("weapon", "w-old")];
    expect(diffBuildVsLoadout(["w-new", "h-new"], "hero", byUid(after)).filter((d) => d.changed)).toHaveLength(0);
  });

  it("skips a uid missing from the inventory (saved build after the piece left)", () => {
    const w = piece("weapon", "w1", "hero");
    expect(diffBuildVsLoadout(["gone", "w1"], "hero", byUid([w])).map((d) => d.proposed.uid)).toEqual(["w1"]);
  });
});
