/**
 * Map captured wire payloads (raw.ts) + static game data (gamedata.ts) into the
 * domain model (types.ts). Stat values are fully resolved here.
 */
import type { RawItem, RawUserItem, RawUserCharacter } from "./raw.js";
import type { Character, GearPiece, Inventory, Preset, RolledStat, Rarity, GearSlot } from "./types.js";
import type { EnhanceData, EquipmentDef, GameData } from "./gamedata.js";
import { resolveOption, resolveStat } from "./stats.js";

/** True when a RawItem is an equippable gear piece. */
export function isGear(item: RawItem, game?: GameData): boolean {
  if (game) return Boolean(game.equipment[String(item.ItemID)]);
  return Array.isArray(item.SubOptionList) && item.SubOptionList.length > 0;
}

function toRolled(optionId: number, ticks: number, game: GameData | undefined): RolledStat | null {
  if (!game) return null;
  const r = resolveStat(optionId, ticks, game.options);
  if (!r) return null;
  return { stat: r.stat, value: r.value, percent: r.percent };
}

/** Resolve a main-stat OptionID that points at a buff (IOT_BUFF in ItemOptionTemplet)
 *  rather than a direct stat. Talisman (ooparts) mains take this path: the BuffID
 *  has a per-level stat table in BuffsTable; we pick the row matching the item's
 *  current enhanceLevel (clamping to the array bounds). Returns null when the
 *  OptionID isn't a buff or the lookup fails. */
function resolveBuffMain(optionId: number, enhanceLevel: number, game: GameData): RolledStat | null {
  const def = game.options[String(optionId)];
  if (!def || !("buffId" in def)) return null;
  const levels = game.buffs[def.buffId];
  if (!levels || levels.length === 0) return null;
  const idx = Math.max(0, Math.min(enhanceLevel, levels.length - 1));
  const row = levels[idx];
  if (!row) return null;
  const r = resolveOption(row, 1);
  if (!r) return null;
  return {
    stat: r.stat,
    value: r.value,
    percent: r.percent,
    fromBuff: true,
    source: "option",
    // EE conditional mains are real on the gear (and surface in the UI's
    // main-stat panel) but don't apply to the character sheet — combat-only.
    ...(row.combatOnly ? { combatOnly: true } : {}),
    // EE main label resolved at build time ("DMG Increase vs Water", …).
    ...(row.name ? { name: row.name } : {}),
  };
}

/** Resolve the cumulative-Exp curve for a piece (slot+grade+star) and walk it to
 *  the highest level whose threshold is ≤ exp. Curve missing or exp=0 ⇒ +0. */
function levelFromExp(meta: EquipmentDef, enhance: EnhanceData, exp: number): number {
  if (exp <= 0 || !meta.grade || !meta.star) return 0;
  const curve = enhance.expCurves[`${meta.slot}|${meta.grade}|${meta.star}`];
  if (!curve) return 0;
  let lv = 0;
  for (let i = 1; i < curve.length; i++) {
    const threshold = curve[i];
    if (threshold === undefined) break;
    if (exp >= threshold) lv = i;
    else break;
  }
  return lv;
}

/** Main-stat multiplier for a given enhance/breakthrough/ascension state.
 *  Mirrors outerpedia-v2 `mainStat` / `mainStatAscended`. Talisman (slot=ooparts)
 *  has enhanceFactor=0 in-game ⇒ multiplier is a no-op (1). Factored out of
 *  `scaleMain` so the reforge-projection helper can re-scale an already-scaled
 *  main between two states via the ratio of multipliers. */
function mainMult(slot: string, lv: number, tier: number, ascended: boolean, singLevel: number, e: EnhanceData): number {
  if (slot === "ooparts") return 1;
  let mult: number;
  if (ascended) {
    const stepsSum = e.singularity.steps.slice(0, singLevel).reduce((a, b) => a + b, 0);
    mult = 1 + e.enhanceFactor * e.maxEnhanceLevel + e.singularity.activation + stepsSum;
  } else {
    mult = 1 + e.enhanceFactor * lv;
  }
  return mult * (1 + e.tierFactor * tier);
}

/** Round a raw main-stat value the way the game displays it: percent stats
 *  keep 1 decimal (floor), flat stats are integers (floor). */
function roundMain(raw: number, percent: boolean): number {
  return percent ? Math.floor(raw * 10 + 1e-9) / 10 : Math.floor(raw + 1e-9);
}

/** Apply enhance + breakthrough + (optional) singularity scaling to a rolled main stat. */
function scaleMain(base: RolledStat, slot: string, lv: number, tier: number, ascended: boolean, singLevel: number, e: EnhanceData): number {
  if (slot === "ooparts") return base.value;
  return roundMain(base.value * mainMult(slot, lv, tier, ascended, singLevel, e), base.percent);
}

/** Target enhancement ceiling a piece is projected to by the reforge-mode
 *  preview. `classic` = the non-ascended endgame (+10, 6 reforge ticks);
 *  `ascended` = the Singularity endgame (+15, sing step 5, 9 ticks). The
 *  engine maps its `reforgeMode` to one of these and feeds it to
 *  `projectMainToCeiling` (main-stat re-scale, here) + `simulateReforges`
 *  (substat ticks, in the solver engine). */
export interface ReforgeCeiling {
  enhanceLevel: number;
  ascended: boolean;
  singularityLevel: number;
}

/** Re-scale a piece's regular main stats (`source: "option"`, non-buff) from
 *  its current enhance/ascension state to a target ceiling, for the Builder's
 *  reforge-mode preview ("show what this piece becomes at +15 ascended").
 *
 *  The parsed `main` values are already scaled to the piece's current state
 *  (parse-time `scaleMain`), and `RolledStat` doesn't retain the base value, so
 *  we recover it via the multiplier ratio: `projected = current / curMult ×
 *  tgtMult`. The floor in the original scaling makes the recovered base
 *  slightly lossy, but the error is sub-unit — fine for a planning preview.
 *
 *  Never DOWNGRADES: a piece already past the ceiling (e.g. an ascended +15
 *  piece previewed in `classic` mode) is returned untouched. Talisman / EE,
 *  singularity rolls, EE passives and buff-shaped mains are left as-is — only
 *  the standard rolled mains scale with enhance. Returns the original piece
 *  reference when nothing changes (so callers can use identity to detect a
 *  projection happened). */
export function projectMainToCeiling(piece: GearPiece, game: GameData, target: ReforgeCeiling): GearPiece {
  const e = game.enhance;
  if (!e || !piece.slot || piece.slot === "ooparts" || piece.slot === "exclusive") return piece;
  const tier = piece.breakthrough;
  const curMult = mainMult(piece.slot, piece.enhanceLevel, tier, piece.ascended, piece.singularityLevel, e);
  const tgtMult = mainMult(piece.slot, target.enhanceLevel, tier, target.ascended, target.singularityLevel, e);
  // Don't downgrade a piece that's already beyond the previewed ceiling.
  if (tgtMult <= curMult || curMult === 0) return piece;
  const ratio = tgtMult / curMult;
  const main = piece.main.map((m) =>
    m.source === "option" && !m.fromBuff
      ? { ...m, value: roundMain(m.value * ratio, m.percent) }
      : m,
  );
  return {
    ...piece,
    main,
    enhanceLevel: target.enhanceLevel,
    ascended: target.ascended,
    singularityLevel: target.singularityLevel,
  };
}

export function parseGearPiece(item: RawItem, game?: GameData): GearPiece {
  const meta = game?.equipment[String(item.ItemID)];
  const enhance = game?.enhance;

  const ascended = item.SingularityStep > 0;
  const enhanceLevel = ascended
    ? 10 + item.SingularityLevel
    : (meta && enhance ? levelFromExp(meta, enhance, item.Exp) : 0);

  const subs: RolledStat[] = [];
  for (const s of item.SubOptionList) {
    // Skip empty padding slots only (OptionID=0). The captured `Level` is the
    // number of procs ABOVE the initial rolled tick — in-game displays
    // `LV (Level + 1)`. So Level=0 means a real sub with 1 proc (its base
    // value), NOT a placeholder. Validated against in-game readout:
    //   Surefire +15: 160005 L3 B2 → LV4 = 4 × 2% = 8% DMG+, …
    //   Fine Sword +0: 160013 L0 B0 → LV1 = 1 × 3 = 3 SPD
    if (s.OptionID === 0) continue;
    const totalTicks = s.Level + 1;
    const r = toRolled(s.OptionID, totalTicks, game);
    if (r) {
      // EFF / RES rate substats: keep the RAW per-mille display value (no bt
      // scaling). The in-game CalcFinalStat consumes these as `ItemOptionValueRate`
      // and multiplies the sum_flat (white EFF) by `(1 + sum_rate/1000)` — adding
      // a flat bt-scaled approximation only matches when baseline ≈ 100, and
      // diverges for higher baselines (e.g. G.Beth lv120 Ranger baseline EFF
      // 140 → +78 EFF mismatch vs in-game).
      subs.push({ ...r, ticks: totalTicks, reforgeTicks: s.Level - s.BaseLevel });
    } else {
      subs.push({ stat: "atk", value: 0, percent: false, ticks: totalTicks, reforgeTicks: s.Level - s.BaseLevel });
    }
  }

  const main: RolledStat[] = [];
  for (const oid of item.OptionList) {
    if (!oid) continue;
    // Talisman main stats are IOT_BUFF — they're already per-level (no scaling
    // applied on top). Try the buff path first; fall back to the standard IOT_STAT
    // path with enhance/tier/singularity scaling.
    if (game) {
      const buffMain = resolveBuffMain(oid, enhanceLevel, game);
      if (buffMain) { main.push(buffMain); continue; }
    }
    const r = toRolled(oid, 1, game); // base (+0) value, before enhancement scaling
    if (!r) continue;
    if (enhance && meta) {
      const scaled = scaleMain(r, meta.slot, enhanceLevel, item.BreakLimitLevel, ascended, item.SingularityLevel, enhance);
      main.push({ ...r, value: scaled, source: "option" });
    } else {
      main.push({ ...r, source: "option" });
    }
  }

  // Singularity-ascended pieces (weapon / accessory / armor 4-piece) roll an
  // unconditional `BT_STAT_PREMIUM` unique option captured as
  // `SingularityOptionID`. The unconditional variants are unconditional
  // DMG_BOOST (weapon/acc) or DMG_REDUCE_RATE (armor) — always on the
  // character sheet, routed through BuffValueRate (fromBuff=true). The
  // conditional `BT_STAT|TARGET_ELEMENT` and `BT_STAT|TARGET_HAS_BUFF`
  // variants (combat-only) are filtered out in data/build.mjs.
  if (game && item.SingularityOptionID) {
    const sopt = game.singularityOptions?.[String(item.SingularityOptionID)];
    if (sopt) {
      const resolved = resolveOption(sopt, 1);
      if (resolved) main.push({
        ...resolved,
        fromBuff: true,
        source: "singularity",
        name: sopt.name ?? null,
        desc: sopt.desc ?? null,
        combatOnly: sopt.combatOnly,
      });
    }
  }

  // EE level-gated permanent passives. Each entry's `levelThreshold` is the
  // EE enhance level needed to activate: `1` = always-on once equipped, `10`
  // = unlocks at +10 (e.g. Caren's +20% DEF via `BID_CEQUIP_2000089_ADD`).
  // All entries are `BT_STAT_PREMIUM` permanent self buffs (filter applied
  // in data/build.mjs), so `fromBuff: true` routes them through
  // `BuffValueRate` like singularity / talisman mains.
  if (game && meta?.slot === "exclusive") {
    const ePassives = game.eePassives?.[String(item.ItemID)];
    if (ePassives) {
      for (const ep of ePassives) {
        // Lv 1 entries unlock at enhanceLevel ≥ 0 (always when equipped); higher
        // thresholds require an actual enhance level. The in-game EE description
        // gates the upgrade by its enhancement readout (+10 → unlocks the
        // "Upgrade Effect" text).
        const unlocked = ep.levelThreshold <= 1 || enhanceLevel >= ep.levelThreshold;
        if (!unlocked) continue;
        // EePassiveDef extends StatOption so the destructuring picks up
        // st/ap/v directly — no need to rebuild the triple.
        const resolved = resolveOption(ep, 1);
        if (resolved) main.push({ ...resolved, fromBuff: true, source: "eePassive" });
      }
    }
  }

  // Talisman / EE gem slots — raw OptionIDs preserved at slot position
  // (length always 5, 0 = empty). Other gear slots leave gemSlots undefined.
  const gemSlots = (meta?.slot === "ooparts" || meta?.slot === "exclusive")
    ? Array.from({ length: 5 }, (_, i) => item.SubOptionList[i]?.OptionID ?? 0)
    : undefined;

  return {
    uid: item.ItemUID,
    itemId: item.ItemID,
    slot: (meta?.slot as GearSlot) ?? null,
    setId: meta?.setId ?? null,
    armorSetId: meta?.armorSetId ?? null,
    rarity: (meta?.grade as Rarity) ?? null,
    star: meta?.star ?? null,
    name: meta?.name ?? null,
    classLimit: meta?.classLimit ?? null,
    breakthrough: item.BreakLimitLevel,
    reforgeCount: item.SmeltingCount,
    enhanceLevel,
    singularityLevel: item.SingularityLevel,
    ascended,
    locked: item.IsLock === 1,
    equippedBy: item.CharUID === "0" ? null : item.CharUID,
    main,
    subs,
    ...(gemSlots ? { gemSlots } : {}),
  };
}

export function parseInventory(
  userItem: RawUserItem,
  userCharacter?: RawUserCharacter,
  game?: GameData,
): Inventory {
  const gear = userItem.ItemList.filter((i) => isGear(i, game)).map((i) => parseGearPiece(i, game));
  const characters: Character[] = (userCharacter?.CharList ?? []).map((c) => ({
    uid: c.CharUID,
    charId: c.CharID,
    name: game?.characters[String(c.CharID)]?.name ?? null,
    stars: c.TransStar,
    locked: c.IsLock === 1,
    exp: c.Exp,
    levelMaxStep: c.LevelMaxStep,
    trustExp: c.TrustExp,
    skills: {
      first: c.First,
      second: c.Second,
      ultimate: c.Ultimate,
      chainPassive: c.ChainPassive,
    },
    fusionCharId: Number((c as { FusionCharID?: unknown }).FusionCharID ?? 0) || 0,
  }));
  const presets: Preset[] = (userItem.PresetList ?? []).map((p) => ({
    num: p.Num,
    name: decodeBase64Utf8(p.Name),
    itemUids: p.ItemUIDList.map(String),
  }));
  return { gear, characters, presets };
}

/** Decode a base64 string to UTF-8 using `atob` + `TextDecoder` — both are
 *  globals in Node 20+ (the project's `engines.node`) and in Electron's
 *  Chromium renderer. Core's tsconfig omits the DOM lib (runtime-agnostic
 *  by design), so we access them via a typed `globalThis` view instead of
 *  forcing every consumer to include lib.dom. */
function decodeBase64Utf8(b64: string): string {
  const g = globalThis as unknown as {
    atob: (s: string) => string;
    TextDecoder: new (label?: string) => { decode(input: Uint8Array): string };
  };
  try {
    const bin = g.atob(b64);
    const bytes = Uint8Array.from(bin, (c: string) => c.charCodeAt(0));
    return new g.TextDecoder("utf-8").decode(bytes);
  } catch {
    return b64;
  }
}
