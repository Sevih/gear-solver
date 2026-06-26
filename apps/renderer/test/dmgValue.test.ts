import { describe, expect, it } from "vitest";
import { dmgTickGains, type DmgTickCandidate } from "../src/lib/dmgValue.js";
import type { FinalStats } from "../src/lib/composeBuild.js";

const STATS: FinalStats = {
  atk: 4000, hp: 20000, def: 800, spd: 200,
  crc: 70, chd: 200, eff: 0, res: 0,
  dmgUp: 0, dmgRed: 0, pen: 0, critDmgRed: 0,
};

const C = (over: Partial<DmgTickCandidate>): DmgTickCandidate => ({ key: "k", label: "L", field: "atk", delta: 0, ...over });

describe("dmgTickGains", () => {
  it("ranks candidates by descending damage gain", () => {
    const out = dmgTickGains(STATS, "atk", undefined, [
      C({ key: "atk", field: "atk", delta: 200 }),
      C({ key: "chd", field: "chd", delta: 4 }),
      C({ key: "crc", field: "crc", delta: 3 }),
    ]);
    expect(out.map((o) => o.key)).toHaveLength(3);
    for (let i = 1; i < out.length; i++) expect(out[i - 1]!.gainPct).toBeGreaterThanOrEqual(out[i]!.gainPct);
    out.forEach((o) => expect(o.gainPct).toBeGreaterThan(0));
  });

  it("a bigger stat delta yields a bigger gain (monotonic)", () => {
    const small = dmgTickGains(STATS, "atk", undefined, [C({ field: "atk", delta: 40 })])[0]!;
    const big = dmgTickGains(STATS, "atk", undefined, [C({ field: "atk", delta: 200 })])[0]!;
    expect(big.gainPct).toBeGreaterThan(small.gainPct);
  });

  it("CHC is dead weight when crit-capped (0 gain)", () => {
    const capped: FinalStats = { ...STATS, crc: 100 };
    const out = dmgTickGains(capped, "atk", undefined, [C({ key: "crc", field: "crc", delta: 3 })]);
    expect(out[0]!.gainPct).toBeCloseTo(0, 6);
  });

  it("zero base damage → empty (no division by zero)", () => {
    const dead: FinalStats = { ...STATS, atk: 0 };
    expect(dmgTickGains(dead, "atk", undefined, [C({ field: "atk", delta: 40 })])).toEqual([]);
  });
});
