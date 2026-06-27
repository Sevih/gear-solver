/**
 * Stat registry invariants — locks the SINGLE source of truth so the
 * unified stat-key namespace can never silently drift again:
 *  - every FinalStats field has a registry axis (and vice-versa);
 *  - STAT_TO_PRIORITY covers every ROLL_NORMS (roll-variant) key and every
 *    target is a real axis — the gap that used to let a stat no-op silently;
 *  - every roll variant + every axis has a design token (icon/label);
 *  - ROLL_NORMS / STAT_NORMS numeric SNAPSHOT — a parity guard so a future
 *    edit to the registry numbers is a deliberate, reviewed change;
 *  - the legacy-key migration map only targets real axes and is idempotent.
 */
import { describe, expect, it } from "vitest";
import {
  FINAL_STAT_KEYS, ROLL_NORMS, STAT_AXES, STAT_NORMS, STAT_TO_PRIORITY,
  LEGACY_STAT_KEY_RENAME, renameLegacyStatKeys,
} from "../src/lib/statRegistry.js";
import type { FinalStats } from "../src/lib/composeBuild.js";
import { STAT } from "../src/design/tokens.js";

// A full FinalStats literal — its keys are the runtime truth for the type, and
// the literal won't compile if a field is renamed without updating it here.
const SAMPLE_FINAL: FinalStats = {
  atk: 0, def: 0, hp: 0, spd: 0, critRate: 0, critDmg: 0,
  critDmgReduce: 0, pen: 0, dmgUp: 0, dmgReduce: 0, eff: 0, effRes: 0,
};

describe("stat registry ↔ FinalStats", () => {
  it("FINAL_STAT_KEYS exactly matches the FinalStats fields", () => {
    expect([...FINAL_STAT_KEYS].sort()).toEqual(Object.keys(SAMPLE_FINAL).sort());
  });
  it("carries no legacy user keys (crc/chd/res/dmgRed/critDmgRed)", () => {
    for (const legacy of Object.keys(LEGACY_STAT_KEY_RENAME)) {
      expect(FINAL_STAT_KEYS).not.toContain(legacy);
    }
  });
});

describe("STAT_TO_PRIORITY bridge", () => {
  it("covers every ROLL_NORMS variant key", () => {
    for (const k of Object.keys(ROLL_NORMS)) expect(STAT_TO_PRIORITY[k]).toBeDefined();
  });
  it("every target is a real axis (FinalStats key)", () => {
    const axes = new Set<string>(FINAL_STAT_KEYS);
    for (const target of Object.values(STAT_TO_PRIORITY)) expect(axes.has(target)).toBe(true);
  });
  it("is identity except for the flat/% collapses", () => {
    for (const [k, v] of Object.entries(STAT_TO_PRIORITY)) {
      if (k.endsWith("Pct")) expect(v).toBe(k.slice(0, -3));
      else expect(v).toBe(k); // single-variant axes map to themselves
    }
  });
});

describe("design tokens completeness", () => {
  it("every roll variant + axis has a STAT token", () => {
    for (const axis of STAT_AXES) {
      expect(STAT[axis.key], `axis ${axis.key}`).toBeDefined();
      for (const v of axis.variants) expect(STAT[v.key], `variant ${v.key}`).toBeDefined();
    }
  });
});

describe("numeric parity snapshot", () => {
  it("ROLL_NORMS unchanged", () => {
    expect(ROLL_NORMS).toEqual({
      atk: 300, def: 100, hp: 1500, spd: 20,
      atkPct: 40, defPct: 40, hpPct: 40,
      critRate: 20, critDmg: 40, critDmgReduce: 25,
      pen: 30, dmgUp: 25, dmgReduce: 25, eff: 50, effRes: 50,
    });
  });
  it("STAT_NORMS unchanged (now keyed by canonical axis)", () => {
    expect(STAT_NORMS).toEqual({
      atk: 4000, def: 3000, hp: 30000, spd: 250,
      critRate: 100, critDmg: 250, critDmgReduce: 100,
      pen: 100, dmgUp: 100, dmgReduce: 100, eff: 250, effRes: 300,
    });
  });
});

describe("legacy-key migration", () => {
  it("every rename target is a real axis", () => {
    const axes = new Set<string>(FINAL_STAT_KEYS);
    for (const target of Object.values(LEGACY_STAT_KEY_RENAME)) expect(axes.has(target)).toBe(true);
  });
  it("rewrites old keys and is idempotent / order-preserving on values", () => {
    const old = { atk: 3, crc: 2, chd: 1, res: 4, dmgRed: 5, critDmgRed: 6 };
    const migrated = renameLegacyStatKeys(old);
    expect(migrated).toEqual({ atk: 3, critRate: 2, critDmg: 1, effRes: 4, dmgReduce: 5, critDmgReduce: 6 });
    expect(renameLegacyStatKeys(migrated)).toEqual(migrated); // idempotent
  });
  it("handles nullish input", () => {
    expect(renameLegacyStatKeys(undefined)).toEqual({});
    expect(renameLegacyStatKeys(null)).toEqual({});
  });
});
