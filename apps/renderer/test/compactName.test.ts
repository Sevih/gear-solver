/**
 * Compact Builder cards (Settings › Solver › Compact result cards): the
 * header name is "EE", the set name for armor, the item name otherwise —
 * never with the "- [Singularity]" suffix.
 */
import { describe, expect, it } from "vitest";
import type { GameData } from "@gear-solver/core";
import type { UiPiece } from "../src/design/adapter.js";
import { compactName } from "../src/design/ResultGearDetail.js";

const game = { sets: { "1": { name: "Attack Set", desc: null, levels: [] } } } as unknown as GameData;

const piece = (over: Partial<UiPiece>): UiPiece =>
  ({ name: "Item", slot: "weapon", armorSetId: null, singularity: false, ...over }) as UiPiece;

describe("compactName", () => {
  it("EE → \"EE\"", () => {
    expect(compactName(piece({ name: "Blade of Dawn", slot: "exclusive" }), game)).toBe("EE");
  });

  it("armor with a known set → the set name", () => {
    for (const slot of ["helmet", "armor", "gloves", "boots"] as const) {
      expect(compactName(piece({ name: "Heroic Helmet", slot, armorSetId: "1" }), game)).toBe("Attack Set");
    }
  });

  it("armor whose set is unknown → its own name", () => {
    expect(compactName(piece({ name: "Heroic Gloves", slot: "gloves", armorSetId: "999" }), game)).toBe("Heroic Gloves");
    expect(compactName(piece({ name: "Heroic Gloves", slot: "gloves", armorSetId: null }), game)).toBe("Heroic Gloves");
    expect(compactName(piece({ name: "Heroic Gloves", slot: "gloves", armorSetId: "1" }), null)).toBe("Heroic Gloves");
  });

  it("weapon / accessory / talisman keep their name", () => {
    expect(compactName(piece({ name: "Sword", slot: "weapon" }), game)).toBe("Sword");
    expect(compactName(piece({ name: "Ring", slot: "accessory" }), game)).toBe("Ring");
    expect(compactName(piece({ name: "Charm", slot: "talisman" }), game)).toBe("Charm");
  });

  it("drops the Singularity suffix but leaves the piece's flag (the gradient) alone", () => {
    const p = piece({ name: "Sword", slot: "weapon", singularity: true });
    expect(compactName(p, game)).toBe("Sword");
    expect(compactName(piece({ name: "Heroic Boots", slot: "boots", armorSetId: "1", singularity: true }), game)).toBe("Attack Set");
    expect(p.singularity).toBe(true);
  });
});
