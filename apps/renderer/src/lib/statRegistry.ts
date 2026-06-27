/**
 * Stat registry — the SINGLE source of truth for the solver's stat vocabulary.
 *
 * Background: the codebase historically carried TWO names for the same stat
 * (engine `critRate` vs user `crc`, `effRes` vs `res`, `dmgReduce` vs `dmgRed`,
 * `critDmgReduce` vs `critDmgRed`, `critDmg` vs `chd`), bridged ad-hoc by a
 * `STAT_TO_PRIORITY` map. That dual-naming was a silent-bug surface: nothing
 * guaranteed the bridge covered every key, so a new stat could no-op silently.
 *
 * This registry unifies on the ENGINE `StatType` names (the larger namespace —
 * gear rolls, gems, icons all use it) as the ONE canonical key. The few
 * user-facing keys were renamed to match (`crc→critRate`, …). Every derived map
 * (`ROLL_NORMS`, `STAT_NORMS`, `STAT_TO_PRIORITY`, the FinalStats axis set) is
 * generated FROM this registry, so they can never drift apart — and a
 * completeness test (`statRegistry.test.ts`) locks the invariants.
 *
 * Each AXIS = one canonical key (= one `FinalStats` field). An axis can have
 * one or two roll-level VARIANTS: ATK/DEF/HP each roll as a flat sub AND a %
 * sub that both compose into the single final axis (so the user picks "ATK"
 * once and both variants score against it); the rest are single-variant. The
 * per-roll vs final-stat magnitude split is why there are two norm scales
 * (`rollNorm` per variant, `statNorm` per axis).
 *
 * Pure data — imports only the `StatType` union from core so every key is
 * compile-checked. No React, no IO.
 */
import type { StatType } from "@gear-solver/core";

export interface StatVariant {
  /** Engine roll key as stored on `RolledStat.stat` / gem stats. */
  key: StatType;
  /** Per-ROLL normalization (max single sub/gem magnitude). */
  rollNorm: number;
  kind: "flat" | "pct";
}

export interface StatAxis {
  /** Canonical key — equals the `FinalStats` field name and the user priority key. */
  key: StatType;
  /** Roll variants composing into this axis (flat+% for ATK/DEF/HP, else one). */
  variants: readonly StatVariant[];
  /** Endgame final-stat normalization (full composed magnitude). */
  statNorm: number;
  /** True for stats that hard-cap at 100% in the damage model (scoring clamp). */
  capAt100?: boolean;
}

/** The canonical axes — one per `FinalStats` field, in display order. Numeric
 *  norms are copied verbatim from the former `ROLL_NORMS` / `STAT_NORMS` literals
 *  (parity is asserted by the registry test). */
export const STAT_AXES: readonly StatAxis[] = [
  { key: "atk", statNorm: 4000,  variants: [{ key: "atk", rollNorm: 300, kind: "flat" }, { key: "atkPct", rollNorm: 40, kind: "pct" }] },
  { key: "def", statNorm: 3000,  variants: [{ key: "def", rollNorm: 100, kind: "flat" }, { key: "defPct", rollNorm: 40, kind: "pct" }] },
  { key: "hp",  statNorm: 30000, variants: [{ key: "hp",  rollNorm: 1500, kind: "flat" }, { key: "hpPct", rollNorm: 40, kind: "pct" }] },
  { key: "spd", statNorm: 250,   variants: [{ key: "spd", rollNorm: 20, kind: "flat" }] },
  { key: "critRate", statNorm: 100, capAt100: true, variants: [{ key: "critRate", rollNorm: 20, kind: "pct" }] },
  { key: "critDmg",  statNorm: 250, variants: [{ key: "critDmg", rollNorm: 40, kind: "pct" }] },
  { key: "critDmgReduce", statNorm: 100, variants: [{ key: "critDmgReduce", rollNorm: 25, kind: "pct" }] },
  { key: "pen", statNorm: 100, capAt100: true, variants: [{ key: "pen", rollNorm: 30, kind: "pct" }] },
  { key: "dmgUp", statNorm: 100, variants: [{ key: "dmgUp", rollNorm: 25, kind: "pct" }] },
  { key: "dmgReduce", statNorm: 100, variants: [{ key: "dmgReduce", rollNorm: 25, kind: "pct" }] },
  { key: "eff", statNorm: 250, variants: [{ key: "eff", rollNorm: 50, kind: "flat" }] },
  { key: "effRes", statNorm: 300, variants: [{ key: "effRes", rollNorm: 50, kind: "flat" }] },
];

/** Canonical axis keys (= the `FinalStats` fields). */
export const FINAL_STAT_KEYS: readonly StatType[] = STAT_AXES.map((a) => a.key);

/** Per-ROLL normalization, keyed by ENGINE roll key (every variant of every
 *  axis). Used to score a single sub / gem contribution. Derived. */
export const ROLL_NORMS: Record<string, number> = Object.fromEntries(
  STAT_AXES.flatMap((a) => a.variants.map((v) => [v.key, v.rollNorm])),
);

/** Endgame final-stat normalization, keyed by canonical axis key. Used to
 *  score a composed final stat. Derived. */
export const STAT_NORMS: Record<string, number> = Object.fromEntries(
  STAT_AXES.map((a) => [a.key, a.statNorm]),
);

/** Roll key → canonical axis key. Now ONLY the flat/% variants differ from the
 *  identity (e.g. `atkPct → atk`); every single-variant axis maps to itself.
 *  Derived — replaces the former hand-maintained engine→user bridge. */
export const STAT_TO_PRIORITY: Record<string, string> = Object.fromEntries(
  STAT_AXES.flatMap((a) => a.variants.map((v) => [v.key, a.key])),
);

/** Axis keys that clamp at 100% in the damage model (CRC / PEN) — the scoring
 *  contribution past the cap is zero. Derived. */
export const SCORE_CAP_100: ReadonlySet<string> = new Set(
  STAT_AXES.filter((a) => a.capAt100).map((a) => a.key),
);

/** Legacy user-namespace stat keys → canonical (engine) axis keys. Persisted
 *  blobs (filter-preset `priority`/`statFilters`, saved-build `finalStats` /
 *  `reforge.priority`) written BEFORE the stat-key unification carry the old
 *  names; storage loaders rewrite them on read so old saves keep working. */
export const LEGACY_STAT_KEY_RENAME: Record<string, string> = {
  crc: "critRate",
  chd: "critDmg",
  res: "effRes",
  dmgRed: "dmgReduce",
  critDmgRed: "critDmgReduce",
};

/** Rewrite an object's keys through `LEGACY_STAT_KEY_RENAME`. Idempotent —
 *  already-canonical keys pass through untouched. New object; nullish → {}. */
export function renameLegacyStatKeys<T>(obj: Record<string, T> | undefined | null): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(obj ?? {})) out[LEGACY_STAT_KEY_RENAME[k] ?? k] = v;
  return out;
}
