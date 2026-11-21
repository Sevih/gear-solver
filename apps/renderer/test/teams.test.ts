/**
 * Teams (G139): the pure model of `lib/teams/teams.ts` — 1 to 4 members, no
 * hero twice, the order, the piece rule (a member's exclusion = the never-use
 * pieces ∪ the builds of the members placed before, never those after), a
 * stale build (a piece gone, a piece retained by an earlier member after a
 * reorder), the Talisman main stats an earlier member's Talisman reserves
 * (G143: out of the member's pool, a build that carries one stale) — the team's "+ Worklist" (`lib/teams/teamWorklist.ts`: stale
 * builds and members without one left out, one entry per member, the team on
 * top of the list, one toast), the Optimizer's team context
 * (`lib/teams/teamContext.ts`), and the `gs.teams` storage (round-trip, a
 * malformed team skipped, `excludedHeroes` as a Set, the key registered and
 * backed up).
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Character, GameData, GearPiece, Inventory, RolledStat } from "@gear-solver/core";
import { filterDefaults, type SolverFilters } from "../src/lib/solver/builderFilters.js";
import {
  addMember, addTeam, buildStaleness, createTeam, defaultTeamName, memberExclusion, moveMember, removeMember, removeTeam, renameTeam,
  reservedGemPieces, reservedTalismanMains, retainBuild, setMemberFilters, teamWorklistPlan, updateTeam, validTeamName, TEAM_MAX_MEMBERS,
  type Team, type TeamBuild, type TeamPieces,
} from "../src/lib/teams/teams.js";
import { teamWorklistFor, teamWorklistNotice, upsertWorklistEntries } from "../src/lib/teams/teamWorklist.js";
import { talismanMainsNotice, teamContextOf, teamSolveScope, type SolveScope } from "../src/lib/teams/teamContext.js";
import { isReadableTeam, loadTeams, persistTeams, TEAMS_KEY } from "../src/lib/storage/teams.js";
import { BACKUP_KEYS, STORAGE_KEYS } from "../src/lib/storage/keys.js";
import type { WorklistEntry } from "../src/lib/storage/worklist.js";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    get length() { return store.size; },
  } as Storage;
});

const blank = (): SolverFilters => filterDefaults("classic", false);
/** A build of these piece uids (engine order, the rest empty). */
const build = (...uids: string[]): TeamBuild => ({
  pieceUids: [...uids, ...Array(8 - uids.length).fill("")], mode: "score", cp: 1000, at: 1,
});
/** The inventory's pieces: these uids (a weapon each), plus the Talismans
 *  given with their main stat key. */
function pieces(uids: string[], talismans: Record<string, string> = {}): TeamPieces {
  const m = new Map<string, Pick<GearPiece, "slot" | "main">>(uids.map((u) => [u, { slot: "weapon", main: [] }]));
  for (const [uid, stat] of Object.entries(talismans)) {
    m.set(uid, { slot: "ooparts", main: [{ stat: stat as RolledStat["stat"], value: 12, percent: true, fromBuff: true, source: "option" }] });
  }
  return m;
}
/** A team whose members are `heroes`, in order, with these builds. */
function team(heroes: string[], builds: Record<string, TeamBuild> = {}): Team {
  let t = createTeam("GR PCU Ep1", "t1", 0)!;
  for (const h of heroes) t = addMember(t, h, blank())!;
  for (const [h, b] of Object.entries(builds)) t = retainBuild(t, h, b);
  return t;
}

describe("teams — members", () => {
  it("names: 1 to 40 characters, trimmed", () => {
    expect(validTeamName("  GR PCU Ep1 ")).toBe("GR PCU Ep1");
    expect(validTeamName("   ")).toBeNull();
    expect(validTeamName("x".repeat(41))).toBeNull();
    expect(createTeam("", "t", 0)).toBeNull();
    const t = createTeam("A", "t", 0)!;
    expect(renameTeam(t, " B ")!.name).toBe("B");
    expect(renameTeam(t, "")).toBeNull();
    expect(renameTeam(t, "A")).toBe(t);
    expect(defaultTeamName([t, { ...t, id: "u", name: "Team 3" }])).toBe("Team 4");
  });

  it("refuses a fifth member and a hero twice", () => {
    const four = team(["a", "b", "c", "d"]);
    expect(four.members).toHaveLength(TEAM_MAX_MEMBERS);
    expect(addMember(four, "e", blank())).toBeNull();
    expect(addMember(team(["a"]), "a", blank())).toBeNull();
  });

  it("a new member starts on the filters given, with no build", () => {
    const f = blank();
    const t = addMember(createTeam("A", "t", 0)!, "a", f)!;
    expect(t.members[0]).toEqual({ heroUid: "a", filters: f, build: null });
  });

  it("reorders: up, down, clamped, unknown hero unchanged", () => {
    const t = team(["a", "b", "c", "d"]);
    expect(moveMember(t, "c", 0).members.map((m) => m.heroUid)).toEqual(["c", "a", "b", "d"]);
    expect(moveMember(t, "a", 2).members.map((m) => m.heroUid)).toEqual(["b", "c", "a", "d"]);
    expect(moveMember(t, "b", 99).members.map((m) => m.heroUid)).toEqual(["a", "c", "d", "b"]);
    expect(moveMember(t, "a", 0)).toBe(t);
    expect(moveMember(t, "zz", 1)).toBe(t);
  });

  it("removes a member and sets their filters without touching the others", () => {
    const t = team(["a", "b"]);
    expect(removeMember(t, "a").members.map((m) => m.heroUid)).toEqual(["b"]);
    expect(removeMember(t, "zz")).toBe(t);
    const f = { ...blank(), topPct: 80 };
    const next = setMemberFilters(t, "b", f);
    expect(next.members[1]!.filters).toBe(f);
    expect(next.members[0]).toBe(t.members[0]);
    expect(setMemberFilters(next, "b", f)).toBe(next);
  });

  it("the list: a new team first, delete, update (same list when refused or unknown)", () => {
    const a = createTeam("A", "a", 0)!;
    const b = createTeam("B", "b", 1)!;
    const list = addTeam(addTeam([], a), b);
    expect(list.map((t) => t.id)).toEqual(["b", "a"]);
    expect(removeTeam(list, "b").map((t) => t.id)).toEqual(["a"]);
    expect(updateTeam(list, "a", (t) => renameTeam(t, "")).at(1)).toBe(a);
    expect(updateTeam(list, "zz", (t) => t)).toBe(list);
    expect(updateTeam(list, "a", (t) => renameTeam(t, "A2"))[1]!.name).toBe("A2");
  });
});

describe("teams — the piece rule", () => {
  const t = team(["a", "b", "c"], { a: build("w1", "h1"), b: build("w2"), c: build("w3", "h3") });

  it("a member's exclusion = never-use pieces ∪ the builds of the members before, not after", () => {
    const never = new Set(["junk"]);
    expect(memberExclusion(t, "a", never)).toEqual(new Set(["junk"]));
    expect(memberExclusion(t, "b", never)).toEqual(new Set(["junk", "w1", "h1"]));
    expect(memberExclusion(t, "c", never)).toEqual(new Set(["junk", "w1", "h1", "w2"]));
  });

  it("an empty slot excludes nothing", () => {
    expect(memberExclusion(t, "b", new Set()).has("")).toBe(false);
  });

  it("a member without a build leaves the next one everything", () => {
    const u = team(["a", "b"], { b: build("w2") });
    expect(memberExclusion(u, "b", new Set())).toEqual(new Set());
  });

  it("the pieces whose gems a member leaves out: every other member's build, before or after, never their own", () => {
    expect(reservedGemPieces(t, "a")).toEqual(new Set(["w2", "w3", "h3"]));
    expect(reservedGemPieces(t, "b")).toEqual(new Set(["w1", "h1", "w3", "h3"]));
    expect(reservedGemPieces(t, "c")).toEqual(new Set(["w1", "h1", "w2"]));
  });

  it("gems: an empty slot reserves nothing, a member without a build reserves nothing", () => {
    expect(reservedGemPieces(t, "a").has("")).toBe(false);
    expect(reservedGemPieces(t, "a").has("0")).toBe(false);
    const u = team(["a", "b", "c"], { b: build("w2", "0") });
    expect(reservedGemPieces(u, "a")).toEqual(new Set(["w2"]));
    expect(reservedGemPieces(u, "b")).toEqual(new Set());
  });
});

describe("teams — stale builds", () => {
  const present = pieces(["w1", "h1", "w2", "h2"]);

  it("no build → null; a build whose pieces are all there and free → not stale", () => {
    const t = team(["a", "b"], { a: build("w1") });
    expect(buildStaleness(t, "b", present)).toBeNull();
    expect(buildStaleness(t, "a", present)).toEqual({ stale: false, missing: [], taken: [], talismanMainTaken: [] });
  });

  it("a piece gone from the inventory", () => {
    const t = team(["a"], { a: build("w1", "gone") });
    expect(buildStaleness(t, "a", present)).toEqual({ stale: true, missing: ["gone"], taken: [], talismanMainTaken: [] });
  });

  it("a piece retained by an earlier member after a reorder (not by a later one)", () => {
    // b built first with h1, then a retained it too: a is member 1 → b is stale.
    const t = team(["a", "b"], { a: build("w1", "h1"), b: build("w2", "h1") });
    expect(buildStaleness(t, "a", present)!.stale).toBe(false);
    expect(buildStaleness(t, "b", present)).toEqual({ stale: true, missing: [], taken: [{ pieceUid: "h1", byHeroUid: "a" }], talismanMainTaken: [] });
    const swapped = moveMember(t, "b", 0);
    expect(buildStaleness(swapped, "b", present)!.stale).toBe(false);
    expect(buildStaleness(swapped, "a", present)!.taken).toEqual([{ pieceUid: "h1", byHeroUid: "b" }]);
  });

  it("+ Worklist leaves out the stale builds and the members without one", () => {
    const t = team(["a", "b", "c", "d"], { a: build("w1"), b: build("w1", "h2"), d: build("gone") });
    const plan = teamWorklistPlan(t, present);
    expect(plan.ready.map((m) => m.heroUid)).toEqual(["a"]);
    expect(plan.stale).toEqual(["b", "d"]);
    expect(plan.noBuild).toEqual(["c"]);
  });
});

describe("teams — one Talisman main stat per team (G143)", () => {
  // tA, tB, tC: ATK% Talismans; tD: CHD. w*: weapons.
  const inv = pieces(["w1", "w2", "w3"], { tA: "atkPct", tB: "atkPct", tC: "atkPct", tD: "critDmg" });

  it("the mains reserved for a member: the Talismans of the members before, never after nor their own", () => {
    const t = team(["a", "b", "c"], { a: build("w1", "tA"), b: build("w2", "tD"), c: build("w3", "tC") });
    expect(reservedTalismanMains(t, "a", inv)).toEqual(new Map());
    expect(reservedTalismanMains(t, "b", inv)).toEqual(new Map([["atkPct", "a"]]));
    expect(reservedTalismanMains(t, "c", inv)).toEqual(new Map([["atkPct", "a"], ["critDmg", "b"]]));
  });

  it("the first earlier member holding a main keeps it", () => {
    const t = team(["a", "b", "c"], { a: build("w1", "tA"), b: build("w2", "tB") });
    expect(reservedTalismanMains(t, "c", inv)).toEqual(new Map([["atkPct", "a"]]));
  });

  it("no build, an empty slot, a Talisman gone from the inventory, a build without a Talisman: nothing reserved", () => {
    const t = team(["a", "b", "c", "d"], { a: build("w1", "", "0"), b: build("w2", "tGone"), c: build("w3") });
    expect(reservedTalismanMains(t, "d", inv)).toEqual(new Map());
  });

  it("stale: a Talisman of the main stat of an earlier member's Talisman, with that member", () => {
    const t = team(["a", "b"], { a: build("w1", "tA"), b: build("w2", "tB") });
    expect(buildStaleness(t, "a", inv)!.stale).toBe(false);
    expect(buildStaleness(t, "b", inv)).toEqual({ stale: true, missing: [], taken: [], talismanMainTaken: [{ stat: "atkPct", byHeroUid: "a" }] });
    // Another main: not stale.
    const u = team(["a", "b"], { a: build("w1", "tA"), b: build("w2", "tD") });
    expect(buildStaleness(u, "b", inv)!.stale).toBe(false);
  });

  it("a reorder makes the new second stale, the new first fresh", () => {
    const t = team(["a", "b", "c"], { a: build("w1", "tA"), b: build("w2", "tD"), c: build("w3", "tC") });
    expect(buildStaleness(t, "c", inv)!.talismanMainTaken).toEqual([{ stat: "atkPct", byHeroUid: "a" }]);
    const moved = moveMember(t, "c", 0);
    expect(buildStaleness(moved, "c", inv)!.stale).toBe(false);
    expect(buildStaleness(moved, "a", inv)!.talismanMainTaken).toEqual([{ stat: "atkPct", byHeroUid: "c" }]);
    expect(buildStaleness(moved, "b", inv)!.stale).toBe(false);
  });

  it("the earlier member's Talisman gone from the inventory: no main-stat reason", () => {
    const t = team(["a", "b"], { a: build("w1", "tGone"), b: build("w2", "tB") });
    expect(buildStaleness(t, "b", inv)!.stale).toBe(false);
  });

  it("the very Talisman taken by an earlier member says so once, as a taken piece", () => {
    const t = team(["a", "b"], { a: build("w1", "tA"), b: build("w2", "tA") });
    expect(buildStaleness(t, "b", inv)).toEqual({ stale: true, missing: [], taken: [{ pieceUid: "tA", byHeroUid: "a" }], talismanMainTaken: [] });
  });

  it("+ Worklist leaves out a build stale by its Talisman main", () => {
    const t = team(["a", "b"], { a: build("w1", "tA"), b: build("w2", "tB") });
    const plan = teamWorklistPlan(t, inv);
    expect(plan.ready.map((m) => m.heroUid)).toEqual(["a"]);
    expect(plan.stale).toEqual(["b"]);
  });

  it("the Optimizer context carries the reserved mains; the banner names them", () => {
    const t = team(["a", "b", "c"], { a: build("w1", "tA"), b: build("w2", "tD") });
    const ctx = teamContextOf([t], { teamId: "t1", heroUid: "c" }, new Set(), inv)!;
    expect(ctx.talismanMains).toEqual(new Map([["atkPct", "a"], ["critDmg", "b"]]));
    // The member's own filters are untouched.
    expect(ctx.filters.mainExcludes).toEqual({});
    const label = (k: string) => ({ atkPct: "ATK%", critDmg: "CHD" })[k] ?? k;
    const name = (uid: string) => uid.toUpperCase();
    expect(talismanMainsNotice(ctx.talismanMains, name, label)).toBe("Talisman main stat taken by A: ATK% · B: CHD");
    expect(talismanMainsNotice(new Map([["atkPct", "a"], ["critDmg", "a"]]), name, label)).toBe("Talisman main stat taken by A: ATK%, CHD");
    expect(talismanMainsNotice(new Map(), name, label)).toBeNull();
  });
});

describe("teams — + Worklist entries", () => {
  const hero = (uid: string, charId: number) => ({ uid, charId, fusionCharId: 0, name: uid.toUpperCase() }) as unknown as Character;
  const piece = (uid: string, slot: string, owner?: string) => ({ uid, slot, itemId: 1, name: null, main: [], equippedBy: owner }) as unknown as GearPiece;
  const inventory = {
    gear: [piece("w1", "weapon"), piece("w2", "weapon", "x"), piece("h2", "helmet", "b"), piece("w3", "weapon", "c")],
    characters: [hero("a", 1), hero("b", 2), hero("c", 3)],
  } as unknown as Inventory;
  const game = { characters: {}, equipment: {}, gems: {} } as unknown as GameData;

  it("one entry per member with a fresh build that changes something, in team order; the others said", () => {
    const t = team(["a", "b", "c"], { a: build("w1"), b: build("w2", "h2"), c: build("w3") });
    let n = 0;
    const r = teamWorklistFor(t, inventory, game, () => `e${++n}`, 42);
    expect(r.entries.map((e) => [e.id, e.heroUid, e.heroName, e.upg, e.mode, e.cp, e.createdAt])).toEqual([
      ["e1", "a", "A", 1, "score", 1000, 42],
      // b already wears h2: one line, the weapon taken off x.
      ["e2", "b", "B", 1, "score", 1000, 42],
    ]);
    expect(r.entries[1]!.changes.map((c) => c.toUid)).toEqual(["w2"]);
    expect(r.unchanged).toEqual(["c"]);
    expect(r.stale).toEqual([]);
    expect(r.noBuild).toEqual([]);
  });

  it("a hero gone from the roster is left out", () => {
    const t = team(["zz"], { zz: build("w1") });
    expect(teamWorklistFor(t, inventory, game, () => "e", 0).notInRoster).toEqual(["zz"]);
  });

  it("each entry replaces its hero's; the team lands on top, member 1 first", () => {
    const entry = (id: string, heroUid: string) => ({ id, heroUid }) as WorklistEntry;
    const list = [entry("old-c", "c"), entry("old-b", "b")];
    expect(upsertWorklistEntries(list, [entry("a1", "a"), entry("b1", "b")]).map((e) => e.id)).toEqual(["a1", "b1", "old-c"]);
  });

  it("one toast for the team", () => {
    expect(teamWorklistNotice("GR PCU Ep1", 4, 1)).toBe("Added to worklist — GR PCU Ep1 (4 heroes, 1 replaced)");
    expect(teamWorklistNotice("Solo", 1, 0)).toBe("Added to worklist — Solo (1 hero, 0 replaced)");
  });
});

describe("teams — Optimizer context", () => {
  const t = team(["a", "b"], { a: build("w1") });

  it("resolves a member: place, size, filters, exclusion; null when gone", () => {
    const ctx = teamContextOf([t], { teamId: "t1", heroUid: "b" }, new Set(["junk"]), pieces(["w1"]))!;
    expect(ctx).toMatchObject({ teamId: "t1", teamName: "GR PCU Ep1", heroUid: "b", position: 2, size: 2 });
    expect(ctx.filters).toBe(t.members[1]!.filters);
    expect(ctx.exclusion).toEqual(new Set(["junk", "w1"]));
    expect(ctx.gemReserved).toEqual(new Set(["w1"]));
    expect(ctx.talismanMains).toEqual(new Map());
    expect(teamContextOf([t], { teamId: "t1", heroUid: "a" }, new Set(), pieces([]))!.gemReserved).toEqual(new Set());
    expect(teamContextOf([t], null, new Set(), pieces([]))).toBeNull();
    expect(teamContextOf([t], { teamId: "t1", heroUid: "zz" }, new Set(), pieces([]))).toBeNull();
    expect(teamContextOf([], { teamId: "t1", heroUid: "b" }, new Set(), pieces([]))).toBeNull();
  });

  it("the solve scope: equipped scope all, the exclusion, the reserved gems, no rank / claim / hold / target; as is without a team", () => {
    const scope: SolveScope = {
      filters: blank(), heroPriority: { a: 1 }, excludedPieceUids: new Set(["junk"]),
      worklistClaims: { p: "x" }, presetHolds: { pieces: {}, rank: {}, locked: [] } as unknown as SolveScope["presetHolds"], targetPresetNum: 3,
    };
    expect(teamSolveScope(scope, null)).toBe(scope);
    const exclusion = new Set(["w1"]);
    const gemReserved = new Set(["t9"]);
    const s = teamSolveScope(scope, { exclusion, gemReserved, talismanMains: new Map([["atkPct", "a"]]) });
    expect(s.filters.options.equippedScope).toBe("all");
    expect(scope.filters.options.equippedScope).toBe("lower");
    expect(s).toMatchObject({ heroPriority: {}, excludedPieceUids: exclusion, worklistClaims: undefined, presetHolds: undefined, targetPresetNum: null });
    expect(s.gemReservedPieceUids).toBe(gemReserved);
    expect(scope.gemReservedPieceUids).toBeUndefined();
    // The Talisman mains go to the solve, never to the member's filters.
    expect(s.reservedTalismanMains).toEqual(new Set(["atkPct"]));
    expect(s.filters.mainExcludes).toEqual(scope.filters.mainExcludes);
    expect(scope.reservedTalismanMains).toBeUndefined();
  });
});

describe("teams — storage", () => {
  it("round-trips, member filters with their excludedHeroes Set", () => {
    const f = { ...blank(), excludedHeroes: new Set(["x", "y"]), topPct: 75 };
    const t = setMemberFilters(team(["a", "b"], { a: { ...build("w1"), gemAllocation: { talisman: [1, 0], ee: [] } } }), "b", f);
    persistTeams([t]);
    const raw = JSON.parse(store.get(TEAMS_KEY)!) as Array<{ members: Array<{ filters: { excludedHeroes: unknown } }> }>;
    expect(raw[0]!.members[1]!.filters.excludedHeroes).toEqual(["x", "y"]);
    const [back] = loadTeams();
    expect(back!.members[1]!.filters.excludedHeroes).toEqual(new Set(["x", "y"]));
    expect(back!.members[1]!.filters.topPct).toBe(75);
    expect(back!.members[0]!.build).toEqual({ ...build("w1"), gemAllocation: { talisman: [1, 0], ee: [] } });
    expect(back!.name).toBe("GR PCU Ep1");
  });

  it("skips a malformed team, loads the rest; inside a team, skips a malformed member and reads a bad build as none", () => {
    const member = (heroUid: string, extra: object = {}) => ({ heroUid, filters: { options: {}, excludedHeroes: [] }, build: null, ...extra });
    store.set(TEAMS_KEY, JSON.stringify([
      { id: "bad", name: "", members: [], createdAt: 0 },
      { id: "t2", name: "B", members: "nope", createdAt: 0 },
      "junk",
      {
        id: "ok", name: "Fine", createdAt: 5,
        members: [member("a", { build: { pieceUids: "w1", mode: "score", cp: 1, at: 1 } }), { heroUid: "b" }, member("a"), member("c"), member("d"), member("e"), member("f")],
      },
    ]));
    const teams = loadTeams();
    expect(teams.map((t) => t.id)).toEqual(["ok"]);
    expect(teams[0]!.members.map((m) => m.heroUid)).toEqual(["a", "c", "d", "e"]);
    expect(teams[0]!.members[0]!.build).toBeNull();
    expect(isReadableTeam({ id: "x", name: "X", members: [], createdAt: 0 })).toBe(true);
    expect(isReadableTeam({ id: "x", name: "X", createdAt: 0 })).toBe(false);
  });

  it("unreadable storage loads nothing", () => {
    store.set(TEAMS_KEY, "{not json");
    expect(loadTeams()).toEqual([]);
    store.set(TEAMS_KEY, JSON.stringify({ a: 1 }));
    expect(loadTeams()).toEqual([]);
  });

  it("gs.teams is registered, local and backed up (merged as a list by id)", () => {
    expect(STORAGE_KEYS.find((s) => s.key === TEAMS_KEY)).toMatchObject({ store: "local", backup: true, prune: false, label: "Teams", owner: "lib/storage/teams.ts" });
    const spec = BACKUP_KEYS.find((s) => s.key === TEAMS_KEY)!;
    expect(spec.merge).toMatchObject({ shape: "list", id: "id", keep: "stored" });
  });
});
