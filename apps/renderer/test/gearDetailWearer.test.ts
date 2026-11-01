// The piece card's link to the wearer's Builder: the portrait in
// `GearCardBody` becomes an "Optimize ‹hero› →" button when the card gets
// `onOptimizeWearer` (never inside a tooltip), and the Inventory's
// `ItemDetail` adds "Optimize wearer →" next to "Never use", greyed out on a
// free piece. Rendered server-side, the equipment icon mocked to a marker.
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Character } from "@gear-solver/core";
import type { UiPiece } from "../src/design/adapter.js";

vi.mock("../src/design/EquipmentIcon.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/design/EquipmentIcon.js")>()),
  EquipmentIcon: () => createElement("i", { "data-equipment-icon": "" }),
}));

const { GearCardBody } = await import("../src/design/GearCard.js");
const { ItemDetail } = await import("../src/screens/inventory/ItemDetail.js");

const piece = {
  id: "p1", itemId: 1, slot: "weapon", setId: null, armorSetId: null, rarity: "legendary", classLimit: null,
  stars: 6, enhance: 15, bt: 2, singularity: false, name: "Blade",
  main: [{ label: "ATK 500", stat: "atk", value: "500", percent: false, name: null }],
  subs: [], effects: [], passive: null, multiTierPassive: null, gemSlots: null,
  reforge: { n: 0, max: 6 }, quality: null,
  searchText: "", status: "equipped", locked: false, equippedBy: "h9",
  image: null, effectIcon: null, setIcon: null, class: null,
  iconPiece: { slot: "weapon", rarity: "legendary", stars: 6, enhance: 15, bt: 2, singularity: false },
} as unknown as UiPiece;
const ame = { uid: "h9", charId: 7, name: "Ame" } as unknown as Character;

const body = (props: { equippedChar?: Character | null; inTooltip?: boolean; onOptimizeWearer?: (uid: string) => void }) =>
  renderToStaticMarkup(createElement(GearCardBody, { piece, game: null, effects: "card", ...props })).replace(/&#x27;/g, "'");
const detail = (equippedChar: Character | null, onOptimizeWearer?: (uid: string) => void) =>
  renderToStaticMarkup(createElement(ItemDetail, { piece, equippedChar, game: null, onToggleExclude: () => {}, onOptimizeWearer }));

describe("GearCardBody — wearer portrait", () => {
  it("is a button with the link", () => {
    expect(body({ equippedChar: ame, onOptimizeWearer: () => {} }))
      .toMatch(/<button type="button" aria-label="Optimize Ame →"[^>]*><img src="\/img\/characters\/faceicon\/FI_7.webp"/);
  });

  it("stays a plain portrait without the link, and in a tooltip", () => {
    for (const html of [body({ equippedChar: ame }), body({ equippedChar: ame, inTooltip: true, onOptimizeWearer: () => {} })]) {
      expect(html).toContain("FI_7.webp");
      expect(html).not.toContain("<button");
    }
  });

  it("no wearer, no portrait nor button", () => {
    const html = body({ equippedChar: null, onOptimizeWearer: () => {} });
    expect(html).not.toContain("faceicon");
    expect(html).not.toContain("<button");
  });
});

describe("ItemDetail — Optimize wearer →", () => {
  it("sits next to Never use, live on a worn piece", () => {
    const html = detail(ame, () => {});
    expect(html).toContain("Never use");
    expect(html).toMatch(/<button type="button" aria-label="Optimize wearer → \(Ame\)"[^>]*>Optimize wearer →<\/button>/);
  });

  it("greyed out on a free piece", () => {
    expect(detail(null, () => {})).toMatch(/<button type="button" disabled="" aria-label="Optimize wearer →"[^>]*>Optimize wearer →<\/button>/);
  });

  it("absent without the link", () => {
    const html = detail(ame);
    expect(html).toContain("Never use");
    expect(html).not.toContain("Optimize");
  });
});
