/**
 * SOLVE's default priority from the outerpedia reco (U6) — `recoPriorityOf`
 * (first build's weights, null without any), `solveDecision` (what SOLVE runs)
 * and `samePriority` (whether the reco's weights are still the hero's). The
 * reco's route is stubbed (`fetch`): no network call.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchReco } from "../src/lib/reco/fetchReco.js";
import type { StructuredCharacterReco } from "../src/lib/reco/translateReco.js";
import { recoPriorityOf, samePriority, solveDecision } from "../src/lib/reco/recoPriority.js";

const reco = (builds: StructuredCharacterReco["builds"]): StructuredCharacterReco => ({ id: "1", builds });

describe("recoPriorityOf", () => {
  it("a one-build reco: its tiers as weights 3 / 2 / 1", () => {
    expect(recoPriorityOf(reco({ Speed: { SubstatPrio: [["spd"], ["critRate"], ["atkPct", "eff"]] } })))
      .toEqual({ spd: 3, critRate: 2, atk: 1, eff: 1 });
  });

  it("several builds: the first one", () => {
    expect(recoPriorityOf(reco({
      Burst: { SubstatPrio: [["critDmg"]] },
      Speed: { SubstatPrio: [["spd"]] },
    }))).toEqual({ critDmg: 3 });
  });

  it("only the priority: weapons, sets and talismans aren't read", () => {
    expect(recoPriorityOf(reco({
      A: {
        Weapon: [{ name: "W", itemId: 1, effectIcon: null, mainStat: ["atkPct"] }],
        Set: [[{ name: "S", setId: "s1", count: 4 }]],
        SubstatPrio: [["hpPct"]],
      },
    }))).toEqual({ hp: 3 });
  });

  it("no reco, no build, no weight: null", () => {
    expect(recoPriorityOf(null)).toBeNull();
    expect(recoPriorityOf(undefined)).toBeNull();
    expect(recoPriorityOf(reco({}))).toBeNull();
    expect(recoPriorityOf(reco({ A: {} }))).toBeNull();
    expect(recoPriorityOf(reco({ A: { SubstatPrio: [] } }))).toBeNull();
    expect(recoPriorityOf(reco({ A: { SubstatPrio: [["notAStat"]] } }))).toBeNull();
  });
});

describe("solveDecision", () => {
  const weights = { spd: 3 };

  it("Score with the hero's own priority: Score, the reco isn't used", () => {
    expect(solveDecision({ mode: "score", hasPriority: true, recoPriority: null })).toBe("score");
    expect(solveDecision({ mode: "score", hasPriority: true, recoPriority: weights })).toBe("score");
  });

  it("Score without a priority, the reco has weights: Score with them", () => {
    expect(solveDecision({ mode: "score", hasPriority: false, recoPriority: weights })).toBe("score-with-reco");
  });

  it("Score without a priority nor reco weights: CP this once", () => {
    expect(solveDecision({ mode: "score", hasPriority: false, recoPriority: null })).toBe("cp-fallback");
  });

  it("CP mode: CP, priority or not", () => {
    expect(solveDecision({ mode: "cp", hasPriority: false, recoPriority: null })).toBe("cp");
    expect(solveDecision({ mode: "cp", hasPriority: true, recoPriority: weights })).toBe("cp");
  });
});

describe("samePriority", () => {
  it("a missing stat counts as 0", () => {
    expect(samePriority({ spd: 3 }, { spd: 3, atk: 0 })).toBe(true);
    expect(samePriority({}, {})).toBe(true);
  });

  it("an edited weight, an added or removed stat: different", () => {
    expect(samePriority({ spd: 3 }, { spd: 2 })).toBe(false);
    expect(samePriority({ spd: 3 }, { spd: 3, atk: 1 })).toBe(false);
    expect(samePriority({ spd: 3, atk: 1 }, { spd: 3 })).toBe(false);
  });
});

describe("SOLVE's reco fetch → default priority (fetch stubbed)", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("a reco: its first build's weights, from the Builder's route", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(reco({ A: { SubstatPrio: [["spd"]] }, B: { SubstatPrio: [["atkPct"]] } }))));
    vi.stubGlobal("fetch", fetchMock);
    const r = await fetchReco(42);
    expect(fetchMock).toHaveBeenCalledWith("/api/reco/42", expect.anything());
    expect(r.status === "ok" ? recoPriorityOf(r.reco) : null).toEqual({ spd: 3 });
  });

  it("no reco (404) or a failed fetch: no weights → CP this once", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    expect((await fetchReco(1)).status).toBe("none");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const r = await fetchReco(1);
    expect(r.status).toBe("error");
    const recoPriority = r.status === "ok" ? recoPriorityOf(r.reco) : null;
    expect(solveDecision({ mode: "score", hasPriority: false, recoPriority })).toBe("cp-fallback");
  });
});
