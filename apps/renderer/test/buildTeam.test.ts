/**
 * "Build team" (G140, lib/teams/buildTeam.ts): every member rebuilt in team
 * order with a fake solve injected — the solves' order, the cumulative
 * exclusion (member 3 gets neither member 1's nor member 2's pieces just
 * retained), a member without a result who takes nothing, a Cancel during
 * member 2 (1 and 2 retained, 3 and 4 as they were), each member's mode, the
 * reco rule of SOLVE, the toast and the greyed-out button's reason; then the
 * Teams card rendered during a pass (the member being solved, Cancel) and
 * after it (a member without a build, with the reason).
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Character, GameData, GearPiece, Inventory } from "@gear-solver/core";
import { filterDefaults, type SolverFilters } from "../src/lib/solver/builderFilters.js";
import type { SolveBuild } from "../src/lib/solver/types.js";
import { addMember, clearBuild, createTeam, retainBuild, type Team, type TeamBuild } from "../src/lib/teams/teams.js";
import {
  buildTeamBlockedReason, runTeamBuild, teamBuildNotice, type MemberBuilt, type MemberSolveOutcome, type MemberSolveRequest,
} from "../src/lib/teams/buildTeam.js";
import { deadSlotsReason, emptySolveReason } from "../src/lib/solver/emptyReason.js";
import { TeamsScreen } from "../src/screens/teams/TeamsScreen.js";

const blank = (): SolverFilters => filterDefaults("classic", false);
const withPriority = (p: Record<string, number>): SolverFilters => ({ ...blank(), priority: p });
const result = (pieces: string[], cp = 1000): SolveBuild => ({
  pieceUids: [...pieces, ...Array(8 - pieces.length).fill("")], gemAllocation: { talisman: [], ee: [] },
  finalStats: {} as SolveBuild["finalStats"], ratings: {} as SolveBuild["ratings"], score: cp, cp, upg: 0,
});
const retained = (pieces: string[], mode: TeamBuild["mode"] = "score"): TeamBuild => ({
  pieceUids: [...pieces, ...Array(8 - pieces.length).fill("")], mode, cp: 1, at: 1,
});

/** GR PCU Ep1: Akarie, Maxie, Roxie, Vlada — each with a priority unless
 *  `filters` says otherwise. */
function team(filters: Partial<Record<string, SolverFilters>> = {}): Team {
  let t = createTeam("GR PCU Ep1", "t1", 0)!;
  for (const uid of ["ak", "ma", "ro", "vl"]) t = addMember(t, uid, filters[uid] ?? withPriority({ atk: 1 }))!;
  return t;
}

/** A fake solve: each hero's candidate builds best-first; it returns the
 *  first whose pieces avoid the exclusion (none → no build). */
function fakeSolve(candidates: Record<string, string[][]>, onCall?: (req: MemberSolveRequest) => void) {
  const calls: MemberSolveRequest[] = [];
  const solve = async (req: MemberSolveRequest): Promise<MemberSolveOutcome> => {
    calls.push(req);
    onCall?.(req);
    const pick = (candidates[req.heroUid] ?? []).find((c) => c.every((u) => !req.exclusion.has(u)));
    return pick ? { build: result(pick), reason: null } : { build: null, reason: "Weapon: 0 pieces after filters" };
  };
  return { solve, calls };
}

async function run(t: Team, solve: (req: MemberSolveRequest) => Promise<MemberSolveOutcome>, opts: { excluded?: string[]; stop?: () => boolean; reco?: (uid: string) => Promise<Record<string, number> | null> } = {}) {
  const done: MemberBuilt[] = [];
  const started: string[] = [];
  // Apply each outcome as App does, to check what the live team ends as.
  let live = t;
  const summary = await runTeamBuild({
    team: t,
    excludedPieces: new Set(opts.excluded ?? []),
    solve,
    ...(opts.reco ? { recoPriority: opts.reco } : {}),
    shouldStop: opts.stop ?? (() => false),
    now: () => 42,
    onMemberStart: (uid) => started.push(uid),
    onMemberDone: (d) => {
      done.push(d);
      live = d.build ? retainBuild(live, d.heroUid, d.build) : clearBuild(live, d.heroUid);
    },
  });
  return { summary, done, started, live };
}

describe("runTeamBuild", () => {
  it("solves each member in team order, the best result retained for each", async () => {
    const { solve, calls } = fakeSolve({ ak: [["w1", "h1"]], ma: [["w2", "h2"]], ro: [["w3"]], vl: [["w4"]] });
    const { summary, started, live } = await run(team(), solve);
    expect(calls.map((c) => c.heroUid)).toEqual(["ak", "ma", "ro", "vl"]);
    expect(started).toEqual(["ak", "ma", "ro", "vl"]);
    expect(live.members.map((m) => m.build?.pieceUids[0])).toEqual(["w1", "w2", "w3", "w4"]);
    expect(live.members[0]!.build).toMatchObject({ mode: "score", cp: 1000, at: 42 });
    expect(summary).toMatchObject({ teamName: "GR PCU Ep1", size: 4, built: ["ak", "ma", "ro", "vl"], noBuild: [], notReached: [] });
  });

  it("cumulative exclusion: each member leaves out the never-use pieces and the builds this pass just retained before them", async () => {
    // Everyone's favourite is w1 + h1; Roxie's old build (w9) must not count.
    let t = team();
    t = retainBuild(t, "ak", retained(["w8"]));
    t = retainBuild(t, "ro", retained(["w9"]));
    const fav = [["w1", "h1"], ["w2", "h2"], ["w3", "h3"], ["w4", "h4"], ["w9"]];
    const { solve, calls } = fakeSolve({ ak: fav, ma: fav, ro: fav, vl: fav });
    const { live } = await run(t, solve, { excluded: ["x1"] });
    expect([...calls[0]!.exclusion].sort()).toEqual(["x1"]);
    expect([...calls[1]!.exclusion].sort()).toEqual(["h1", "w1", "x1"]);
    // Member 3: neither member 1's nor member 2's pieces just retained (not
    // Akarie's old w8, not their own old w9).
    expect([...calls[2]!.exclusion].sort()).toEqual(["h1", "h2", "w1", "w2", "x1"]);
    expect([...calls[3]!.exclusion].sort()).toEqual(["h1", "h2", "h3", "w1", "w2", "w3", "x1"]);
    expect(live.members.map((m) => m.build?.pieceUids.slice(0, 2))).toEqual([["w1", "h1"], ["w2", "h2"], ["w3", "h3"], ["w4", "h4"]]);
  });

  it("a member without a result keeps no build, says why, and takes nothing from the next ones", async () => {
    let t = team();
    t = retainBuild(t, "ma", retained(["w7"]));
    const { solve, calls } = fakeSolve({ ak: [["w1"]], ma: [], ro: [["w7"], ["w3"]], vl: [["w4"]] });
    const { summary, done, live } = await run(t, solve);
    expect(done[1]).toMatchObject({ heroUid: "ma", build: null, reason: "Weapon: 0 pieces after filters" });
    expect(live.members[1]!.build).toBeNull();
    // Roxie's exclusion is Akarie's build only: Maxie took nothing (her old w7 is free).
    expect([...calls[2]!.exclusion]).toEqual(["w1"]);
    expect(live.members[2]!.build?.pieceUids[0]).toBe("w7");
    expect(calls.map((c) => c.heroUid)).toEqual(["ak", "ma", "ro", "vl"]);
    expect(summary.built).toEqual(["ak", "ro", "vl"]);
    expect(summary.noBuild).toEqual([{ heroUid: "ma", reason: "Weapon: 0 pieces after filters" }]);
  });

  it("Cancel during member 2: 1 and 2 retained, 3 and 4 keep their previous build", async () => {
    let t = team();
    t = retainBuild(t, "ro", retained(["w2"]));
    t = retainBuild(t, "vl", retained(["w9"]));
    let stop = false;
    const { solve, calls } = fakeSolve({ ak: [["w1"]], ma: [["w2"]], ro: [["w3"]], vl: [["w4"]] }, (req) => { if (req.heroUid === "ma") stop = true; });
    const { summary, live } = await run(t, solve, { stop: () => stop });
    expect(calls.map((c) => c.heroUid)).toEqual(["ak", "ma"]);
    expect(live.members.map((m) => m.build?.pieceUids[0])).toEqual(["w1", "w2", "w2", "w9"]);
    expect(live.members[2]!.build).toBe(t.members[2]!.build);
    expect(live.members[3]!.build).toBe(t.members[3]!.build);
    expect(summary.built).toEqual(["ak", "ma"]);
    expect(summary.notReached).toEqual(["ro", "vl"]);
  });

  it("each member's mode: the one of their retained build, Score without one", async () => {
    let t = team();
    t = retainBuild(t, "ma", retained(["w5"], "cp"));
    t = retainBuild(t, "ro", retained(["w6"], "score"));
    const { solve, calls } = fakeSolve({ ak: [["w1"]], ma: [["w2"]], ro: [["w3"]], vl: [["w4"]] });
    const { live } = await run(t, solve);
    expect(calls.map((c) => c.mode)).toEqual(["score", "cp", "score", "score"]);
    expect(live.members.map((m) => m.build?.mode)).toEqual(["score", "cp", "score", "score"]);
    // Each solve runs on the member's own filters.
    expect(calls.map((c) => c.filters)).toEqual(t.members.map((m) => m.filters));
  });

  it("SOLVE's rule without a priority: the reco's weights become the member's priority, else Combat Power this once", async () => {
    const t = team({ ak: blank(), ma: blank() });
    const { solve, calls } = fakeSolve({ ak: [["w1"]], ma: [["w2"]], ro: [["w3"]], vl: [["w4"]] });
    const asked: string[] = [];
    const { summary, done, live } = await run(t, solve, { reco: async (uid) => { asked.push(uid); return uid === "ak" ? { atk: 3, critRate: 2 } : null; } });
    // Only the members in Score without a priority look the reco up.
    expect(asked).toEqual(["ak", "ma"]);
    expect(calls[0]).toMatchObject({ mode: "score" });
    expect(calls[0]!.filters.priority).toEqual({ atk: 3, critRate: 2 });
    expect(done[0]!.filters?.priority).toEqual({ atk: 3, critRate: 2 });
    expect(calls[1]).toMatchObject({ mode: "cp" });
    expect(done[1]).toMatchObject({ cpFallback: true });
    expect(done[1]!.filters).toBeUndefined();
    expect(live.members[1]!.build?.mode).toBe("cp");
    expect(summary.cpFallback).toEqual(["ma"]);
  });
});

describe("teamBuildNotice", () => {
  const nameOf = (uid: string) => ({ ak: "Akarie", ma: "Maxie", ro: "Roxie", vl: "Vlada" })[uid] ?? uid;
  it("n/4 members, then the members without a build", () => {
    expect(teamBuildNotice({ teamName: "GR PCU Ep1", size: 4, built: ["ak", "ma", "ro", "vl"], noBuild: [], cpFallback: [], notReached: [] }, nameOf))
      .toBe("GR PCU Ep1 built — 4/4 members");
    expect(teamBuildNotice({ teamName: "GR PCU Ep1", size: 4, built: ["ak", "ro", "vl"], noBuild: [{ heroUid: "ma", reason: "x" }], cpFallback: ["vl"], notReached: [] }, nameOf))
      .toBe("GR PCU Ep1 built — 3/4 members · no build: Maxie · solved by Combat Power (no priority, no reco): Vlada");
    expect(teamBuildNotice({ teamName: "GR PCU Ep1", size: 4, built: ["ak", "ma"], noBuild: [], cpFallback: [], notReached: ["ro", "vl"] }, nameOf))
      .toBe("GR PCU Ep1 built — 2/4 members · cancelled before Roxie, Vlada (previous builds kept)");
  });
});

describe("buildTeamBlockedReason", () => {
  const t = team();
  it("one pass at a time, none while the Optimizer solves", () => {
    expect(buildTeamBlockedReason(t, { passTeam: null, optimizerSolving: false, ready: true })).toBeNull();
    expect(buildTeamBlockedReason(t, { passTeam: { id: "t2", name: "WB" }, optimizerSolving: false, ready: true })).toBe("WB is being built — one team at a time");
    expect(buildTeamBlockedReason(t, { passTeam: null, optimizerSolving: true, ready: true })).toMatch(/Optimizer/);
    expect(buildTeamBlockedReason(t, { passTeam: null, optimizerSolving: false, ready: false })).toMatch(/loading/);
    expect(buildTeamBlockedReason(createTeam("Empty", "t3", 0)!, { passTeam: null, optimizerSolving: false, ready: true })).toBe("Add a hero first");
  });
});

describe("empty solve reason", () => {
  it("an emptied slot first, then the broken-sets rule, else the bands", () => {
    const ps = { weapon: { hit: 0, of: 5, mainExcluded: 2 }, helmet: { hit: 3, of: 3 }, exclusive: { hit: 0, of: 0 } };
    expect(deadSlotsReason(ps)).toBe("Weapon: 0 pieces after filters (2 dropped: main stat excluded)");
    expect(emptySolveReason(ps, null)).toBe("A slot has no pieces left after filtering — Weapon: 0 pieces after filters (2 dropped: main stat excluded)");
    expect(emptySolveReason({ helmet: { hit: 3, of: 3 } }, "brokenSets")).toMatch(/Allow broken sets/);
    expect(emptySolveReason(null, null)).toBe("No build passes the filters");
  });
});

describe("TeamsScreen during and after a pass", () => {
  const piece = (slot: GearPiece["slot"], uid: string): GearPiece => ({
    uid, itemId: 1, slot, setId: null, armorSetId: null, rarity: "unique", star: 6, name: uid, classLimit: null,
    breakthrough: 0, reforgeCount: 0, enhanceLevel: 10, singularityLevel: 0, ascended: false, locked: false,
    equippedBy: undefined, main: [], subs: [],
  } as unknown as GearPiece);
  const hero = (uid: string, name: string) => ({ uid, charId: 1, fusionCharId: 0, name }) as unknown as Character;
  const inventory = {
    gear: [piece("weapon", "w1"), piece("weapon", "w2")],
    characters: [hero("ak", "Akarie"), hero("ma", "Maxie"), hero("ro", "Roxie"), hero("vl", "Vlada")],
    presets: [],
  } as unknown as Inventory;
  const game = { characters: {}, equipment: {}, sets: {} } as unknown as GameData;
  const render = (t: Team, extra: Record<string, unknown>) => renderToStaticMarkup(createElement(TeamsScreen, {
    inventory, game, teams: [t], onTeamsChange: () => {}, heroPriority: {}, defaultReforgeMode: "classic", defaultRerollPotential: false,
    onOptimizeMember: () => {}, onAddToWorklist: () => {}, onBuildTeam: () => {}, onCancelTeamBuild: () => {}, ...extra,
  }));

  it("idle: Build team offered", () => {
    const html = render(team(), {});
    expect(html).toContain(">Build team<");
    expect(html).not.toContain("Solving…");
  });

  it("during a pass: the member being solved says Solving…, Cancel instead of Build team", () => {
    const t = retainBuild(team(), "ak", retained(["w1"]));
    const html = render(t, { teamBuild: { teamId: "t1", teamName: "GR PCU Ep1", heroUid: "ma", stopping: false } });
    expect(html.match(/Solving…/g)).toHaveLength(1);
    // On Maxie's line (after her name, before Roxie's).
    const at = html.indexOf("Solving…");
    expect(at).toBeGreaterThan(html.indexOf(">Maxie<"));
    expect(at).toBeLessThan(html.indexOf(">Roxie<"));
    expect(html).toContain(">Cancel<");
    expect(html).not.toContain(">Build team<");
    const stopping = render(t, { teamBuild: { teamId: "t1", teamName: "GR PCU Ep1", heroUid: "ma", stopping: true } });
    expect(stopping).toContain("Stopping after this member…");
  });

  it("greyed out with the reason while the Optimizer solves or another team is built", () => {
    const busy = render(team(), { optimizerSolving: true });
    expect(busy).toMatch(/<button[^>]*disabled=""[^>]*title="A solve is running in the Optimizer[^"]*"[^>]*>Build team</);
    const other = render(team(), { teamBuild: { teamId: "t2", teamName: "WB", heroUid: "x", stopping: false } });
    expect(other).toMatch(/<button[^>]*disabled=""[^>]*title="WB is being built — one team at a time"[^>]*>Build team</);
  });

  it("after a pass: a member without a build says why", () => {
    const t = retainBuild(team(), "ak", retained(["w1"]));
    const html = render(t, { teamBuildReasons: { t1: { ma: "A slot has no pieces left after filtering — Weapon: 0 pieces after filters" } } });
    expect(html).toContain("No build</b> — A slot has no pieces left after filtering — Weapon: 0 pieces after filters");
    // The two other members without a build keep the usual hint.
    expect(html.match(/No build yet/g)).toHaveLength(2);
    expect(html).toContain(">Build team<");
  });
});
