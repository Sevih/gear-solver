import { describe, it, expect } from "vitest";
import { CONTRACT_STAT_TO_ENGINE, resolveOption } from "../src/stats.js";
import statKeysJson from "../../../data/derived/stat-keys.json";

// `GAME_STAT` (the runtime table) held against outerpedia's `stat-keys.json`
// (ST_* → OAT_* → contract key, % nature, abbreviation). Nothing loads that
// file at runtime: a pair outerpedia adds must fail here rather than silently
// drop out of the panel. Coverage is checked per key, not by freezing the
// contract's rows. `GAME_STAT` rows no contract pair carries (ST_HIT_AP,
// ST_KILL_AP as of 2026-10-18) are allowed.
interface ContractStatKey {
  key: string;
  percent: boolean;
  abbr: string | null;
}
const STAT_KEYS = statKeysJson as Record<string, Record<string, ContractStatKey>>;

const PAIRS = Object.entries(STAT_KEYS).flatMap(([st, byAp]) =>
  Object.entries(byAp).map(([ap, entry]) => ({ st, ap, ...entry })),
);

describe("GAME_STAT against the contract's stat-keys.json", () => {
  it("every contract key has its CONTRACT_STAT_TO_ENGINE entry", () => {
    const missing = [...new Set(PAIRS.map((p) => p.key))].filter((k) => !(k in CONTRACT_STAT_TO_ENGINE));
    expect(
      missing,
      `contract key(s) ${missing.join(", ")} unknown to packages/core/src/stats.ts: add the CONTRACT_STAT_TO_ENGINE entry ` +
        "(and the GAME_STAT row for its ST_*), or map it to null if it is not an engine stat",
    ).toEqual([]);
  });

  it.each(PAIRS)("$st / $ap ($key) resolves through GAME_STAT", ({ st, ap, key, percent }) => {
    const engine = CONTRACT_STAT_TO_ENGINE[key];
    const resolved = resolveOption({ st, ap, v: 10 }, 1);
    if (engine === undefined) return; // reported by the coverage test above
    if (engine === null) {
      expect(resolved, `${st} / ${ap} (${key}) is mapped to null but GAME_STAT resolves it`).toBeNull();
      return;
    }
    expect(
      resolved,
      `${st} / ${ap} (${key}) is unknown to GAME_STAT: add its row in packages/core/src/stats.ts, ` +
        `or map ${key} to null in CONTRACT_STAT_TO_ENGINE if it is not an engine stat`,
    ).not.toBeNull();
    expect(resolved).toEqual({ stat: engine, percent, value: percent ? 1 : 10 });
  });

  it("matches the contract as of 2026-10-18: 23 pairs resolved, ST_AVOID / OAT_ADD to null", () => {
    const nulls = PAIRS.filter((p) => CONTRACT_STAT_TO_ENGINE[p.key] === null);
    expect(nulls.map((p) => `${p.st}/${p.ap}`)).toContain("ST_AVOID/OAT_ADD");
    expect(PAIRS.length - nulls.length).toBeGreaterThanOrEqual(23);
  });
});
