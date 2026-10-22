/**
 * Best-skill factor (`lib/dmgSkill.ts`) — the explicit fallback contract:
 * missing data → ×1.00 AND flagged, never a silent 0 that would blank the
 * Dmg column. Plus the label the header badge / tooltips show. And the
 * per-turn rotation factor (`turnSkillFactor`) of the DmgS / McdS columns,
 * falling back to the best skill on a snapshot without `rotation`.
 */
import { readFileSync } from "node:fs";
import type { CharactersTable } from "@gear-solver/core";
import { describe, expect, it } from "vitest";
import { dmgSkillFactor, dmgSkillInfo, turnSkillFactor } from "../src/lib/dmgSkill.js";
import { ratingTitle, SOLVER_RATINGS } from "../src/screens/builder/statColumns.js";

describe("dmgSkillFactor", () => {
  it("‰ → multiplier", () => {
    expect(dmgSkillFactor({ slot: "S3", factor: 1670 })).toBeCloseTo(1.67);
    expect(dmgSkillFactor({ slot: "S2", burst: 1, factor: 2392 })).toBeCloseTo(2.392);
    expect(dmgSkillFactor({ slot: "S1", factor: 860 })).toBeCloseTo(0.86); // sub-100% skills exist (Primine S1)
  });

  it("missing / invalid data → ×1 (explicit fallback, never 0)", () => {
    expect(dmgSkillFactor(undefined)).toBe(1);
    expect(dmgSkillFactor(null)).toBe(1);
    expect(dmgSkillFactor({ slot: "S1", factor: 0 })).toBe(1);
    expect(dmgSkillFactor({ slot: "S1", factor: -5 })).toBe(1);
  });
});

describe("dmgSkillInfo", () => {
  it("labels the winning slot, burst state when any, flags unresolved chains", () => {
    expect(dmgSkillInfo({ slot: "S3", factor: 1670 })).toMatchObject({ label: "S3", factor: 1.67, missing: false, approx: false });
    expect(dmgSkillInfo({ slot: "S2", burst: 3, factor: 2730 })).toMatchObject({ label: "S2 B3", factor: 2.73, missing: false, approx: false });
    expect(dmgSkillInfo({ slot: "S1", factor: 1800, unresolvedHits: true })).toMatchObject({ label: "S1", factor: 1.8, missing: false, approx: true });
  });

  it("missing data → label '—', factor 1, missing=true (the UI warns instead of hiding)", () => {
    expect(dmgSkillInfo(undefined)).toMatchObject({ label: "—", factor: 1, missing: true, approx: false });
    expect(dmgSkillInfo({ slot: "S1", factor: 0 })).toMatchObject({ label: "—", factor: 1, missing: true, approx: false });
  });
});

describe("turnSkillFactor / dmgSkillInfo().turn — the cooldown rotation of the per-turn columns", () => {
  const best = { slot: "S2", factor: 2004 } as const;
  const rotation = { factorPerTurn: 1735, cycle: 4, uses: { S1: 1, S2: 2, S3: 1 } };

  it("rotation present → factorPerTurn / 1000; the per-hit factor stays the best skill", () => {
    expect(turnSkillFactor(rotation, best)).toBeCloseTo(1.735);
    const info = dmgSkillInfo(best, rotation);
    expect(info.factor).toBeCloseTo(2.004);
    expect(info.turn).toEqual({ factor: 1.735, label: "S3 ×1, S2 ×2, S1 ×1 over 4 turns", missing: false, approx: false });
  });

  it("no rotation (snapshot before the field) → best-skill fallback, flagged, never an error", () => {
    expect(turnSkillFactor(undefined, best)).toBe(dmgSkillFactor(best));
    expect(turnSkillFactor(null, best)).toBe(dmgSkillFactor(best));
    expect(turnSkillFactor({ ...rotation, factorPerTurn: 0 }, best)).toBe(dmgSkillFactor(best));
    expect(turnSkillFactor(undefined, undefined)).toBe(1);
    expect(dmgSkillInfo(best).turn).toEqual({ factor: 2.004, label: "S2", missing: true, approx: false });
    expect(dmgSkillInfo({ slot: "S1", factor: 1800, unresolvedHits: true }).turn.approx).toBe(true);
    expect(dmgSkillInfo(undefined).turn).toEqual({ factor: 1, label: "—", missing: true, approx: false });
  });

  it("approx follows rotation.approx; unused skills are left out of the label", () => {
    const t = dmgSkillInfo(best, { factorPerTurn: 2500, cycle: 1, uses: { S1: 0, S2: 0, S3: 1 }, approx: true }).turn;
    expect(t).toEqual({ factor: 2.5, label: "S3 ×1 over 1 turn", missing: false, approx: true });
  });

  it("column tooltips: DmgS / McdS name the rotation (and approx), Dmg / Mcd keep the best hit", () => {
    const info = dmgSkillInfo(best, { ...rotation, approx: true });
    const title = (key: string) => ratingTitle(SOLVER_RATINGS.find((r) => r.key === key)!, info, false);
    for (const k of ["dmgs", "mcds"]) {
      expect(title(k)).toContain("× average factor per turn (S3/S2/S1 rotation by cooldowns): S3 ×1, S2 ×2, S1 ×1 over 4 turns ×1.74");
      expect(title(k)).toContain("approx");
    }
    for (const k of ["dmg", "mcd"]) {
      expect(title(k)).toContain("Best skill: S2 ×2.00");
      expect(title(k)).not.toContain("per turn");
    }
    expect(ratingTitle(SOLVER_RATINGS.find((r) => r.key === "dmgs")!, dmgSkillInfo(best), false)).toContain("No rotation in this data snapshot");
  });

  it("real data: every hero has a rotation; Tamamo-no-Mae's is worth less than her best skill alone", () => {
    const characters = JSON.parse(readFileSync(new URL("../../../data/derived/characters.json", import.meta.url), "utf8")) as CharactersTable;
    for (const [id, c] of Object.entries(characters)) expect(c.rotation?.factorPerTurn, id).toBeGreaterThan(0);
    const tamamo = characters["2000080"]!;
    expect(tamamo.name).toBe("Tamamo-no-Mae");
    // 1735 ‰ per turn (S1 ×1, S2 ×2, S3 ×1 over 4 turns) vs her best hit S2 2004 ‰.
    expect(turnSkillFactor(tamamo.rotation, tamamo.bestSkill)).toBeCloseTo(1.735);
    expect(dmgSkillFactor(tamamo.bestSkill)).toBeCloseTo(2.004);
    expect(turnSkillFactor(tamamo.rotation, tamamo.bestSkill)).toBeLessThan(dmgSkillFactor(tamamo.bestSkill));
  });
});
