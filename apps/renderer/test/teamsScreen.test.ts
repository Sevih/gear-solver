/**
 * Teams tab (G139, screens/teams/TeamsScreen.tsx) rendered server-side: the
 * empty state saying what the tab is for, then a team of 4 in order with one
 * member whose build is stale (a piece retained by the member before them) —
 * its "stale" mark and reason, the team full (no "+ Add hero" picker), and
 * "+ Worklist" counting only the fresh builds and saying whom it leaves out;
 * a member stale by its Talisman main stat (G143); and the "+ Add hero" picker
 * listing the team's heroes greyed out.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Character, GearPiece, Inventory } from "@gear-solver/core";
import { TeamsScreen } from "../src/screens/teams/TeamsScreen.js";
import { filterDefaults } from "../src/lib/solver/builderFilters.js";
import { addMember, createTeam, retainBuild, type Team, type TeamBuild } from "../src/lib/teams/teams.js";
import { HeroPicker } from "../src/design/HeroPicker.js";

const piece = (slot: GearPiece["slot"], uid: string): GearPiece => ({
  uid, itemId: 1, slot, setId: null, armorSetId: null, rarity: "unique", star: 6, name: uid, classLimit: null,
  breakthrough: 0, reforgeCount: 0, enhanceLevel: 10, singularityLevel: 0, ascended: false, locked: false,
  equippedBy: undefined, main: [], subs: [],
} as unknown as GearPiece);
const hero = (uid: string, name: string) => ({ uid, charId: 1, fusionCharId: 0, name }) as unknown as Character;
const inventory = {
  gear: [piece("weapon", "w1"), piece("weapon", "w2"), piece("helmet", "h1"), piece("weapon", "w4")],
  characters: [hero("ak", "Akarie"), hero("ma", "Maxie"), hero("ro", "Roxie"), hero("vl", "Vlada"), hero("xx", "Other")],
  presets: [],
} as unknown as Inventory;
/** A build (engine order: weapon, helmet, …). */
const build = (weapon: string, helmet = ""): TeamBuild => ({ pieceUids: [weapon, helmet, "", "", "", "", "", ""], mode: "cp", cp: 123456, at: 1 });

function render(teams: Team[]) {
  return renderToStaticMarkup(createElement(TeamsScreen, {
    inventory, game: null, teams, onTeamsChange: () => {}, heroPriority: {},
    defaultReforgeMode: "classic", defaultRerollPotential: false, onOptimizeMember: () => {}, onAddToWorklist: () => {},
  }));
}

describe("TeamsScreen", () => {
  it("empty: says what the tab is for, offers + New team", () => {
    const html = render([]);
    expect(html).toContain("No team yet");
    expect(html).toContain("one fight");
    expect(html).toContain("+ New team");
    expect(html).toContain('placeholder="Team 1"');
  });

  it("no capture: the capture hint, no team list", () => {
    const html = renderToStaticMarkup(createElement(TeamsScreen, {
      inventory: null, game: null, teams: [], onTeamsChange: () => {}, heroPriority: {},
      defaultReforgeMode: "classic", defaultRerollPotential: false, onOptimizeMember: () => {},
    }));
    expect(html).toContain("No capture yet");
    expect(html).not.toContain("+ New team");
  });

  it("a team of 4, in order, one stale member: its mark and reason, + Worklist on the fresh builds only", () => {
    let t = createTeam("GR PCU Ep1", "t1", 0)!;
    for (const uid of ["ak", "ma", "ro", "vl"]) t = addMember(t, uid, filterDefaults("classic", false))!;
    t = retainBuild(t, "ak", build("w1", "h1"));
    // Maxie's build shares h1 with Akarie, member 1: stale.
    t = retainBuild(t, "ma", build("w2", "h1"));
    t = retainBuild(t, "ro", build("w4"));
    const html = render([t]);
    expect(html).toContain("GR PCU Ep1");
    expect(html).toContain("4/4");
    const order = ["Akarie", "Maxie", "Roxie", "Vlada"].map((n) => html.indexOf(`>${n}<`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html.match(/>Stale</g)).toHaveLength(1);
    expect(html).toContain("1 piece taken by Akarie (member 1)");
    expect(html).toContain("No build yet");
    expect(html).toContain("123,456 CP");
    expect(html).toContain("Team full (4 heroes)");
    expect(html).not.toContain('role="combobox"');
    expect(html).toContain("+ Worklist (2)");
    expect(html).toContain("Leaves out 1 stale (Maxie) · 1 without a build (Vlada)");
    expect(html.match(/>Optimize →</g)).toHaveLength(4);
    expect(html.match(/>Remove</g)).toHaveLength(4);
    expect(html).toContain(">Delete team<");
  });

  it("a member stale by its Talisman main stat (G143): the reason, the Talisman ringed, left out of + Worklist", () => {
    const talisman = (uid: string, stat: string): GearPiece => ({
      ...piece("ooparts", uid), main: [{ stat, value: 12, percent: true, fromBuff: true, source: "option" }],
    } as unknown as GearPiece);
    const inv = { ...inventory, gear: [...inventory.gear, talisman("tA1", "atkPct"), talisman("tA2", "atkPct")] } as unknown as Inventory;
    // Engine order: weapon, helmet, armor, gloves, boots, accessory, Talisman, EE.
    const withTalisman = (weapon: string, t: string): TeamBuild => ({ ...build(weapon), pieceUids: [weapon, "", "", "", "", "", t, ""] });
    let t = createTeam("WB", "t3", 0)!;
    for (const uid of ["ak", "ma"]) t = addMember(t, uid, filterDefaults("classic", false))!;
    t = retainBuild(t, "ak", withTalisman("w1", "tA1"));
    t = retainBuild(t, "ma", withTalisman("w2", "tA2"));
    const html = renderToStaticMarkup(createElement(TeamsScreen, {
      inventory: inv, game: null, teams: [t], onTeamsChange: () => {}, heroPriority: {},
      defaultReforgeMode: "classic", defaultRerollPotential: false, onOptimizeMember: () => {}, onAddToWorklist: () => {},
    }));
    expect(html.match(/>Stale</g)).toHaveLength(1);
    expect(html).toContain("same talisman main stat as Akarie (member 1)");
    expect(html.match(/title="Same main stat as Akarie&#x27;s Talisman/g)).toHaveLength(1);
    expect(html).toContain("+ Worklist (1)");
    expect(html).toContain("Leaves out 1 stale (Maxie)");
  });

  it("a team with room: the + Add hero picker", () => {
    const t = addMember(createTeam("Solo", "t2", 0)!, "ak", filterDefaults("classic", false))!;
    const html = render([t]);
    expect(html).toContain("1/4");
    expect(html).toContain('role="combobox"');
    expect(html).toContain("+ Worklist<");
  });

  it("+ Add hero lists the team's heroes greyed out, not pickable", () => {
    const html = renderToStaticMarkup(createElement(HeroPicker, {
      mode: "single", heroes: inventory.characters, game: null, value: null, onChange: () => {},
      disabledUids: new Set(["ak"]), disabledTitle: "Already in this team", defaultOpen: true,
    }));
    const rows = html.split("<li").slice(1);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toContain('aria-disabled="true"');
    expect(rows[0]).toContain('title="Already in this team"');
    expect(rows[0]).toMatch(/<button[^>]*disabled=""/);
    expect(rows[1]).not.toContain("aria-disabled");
  });
});
