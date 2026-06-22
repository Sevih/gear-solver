/**
 * Distill the raw Outerplane game tables (data/game/*.json) into the compact
 * lookup tables the engine consumes (data/derived/*.json).
 *
 * Run: node data/build.mjs   (or: npm run data:build)
 *
 * Keeps the engine input small and decoupled from the ~12 MB raw dumps. Re-run
 * after refreshing data/game/ from Outerpedia (see data/sync.ps1).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { computeCharacterIngredients } from "./calc-stats.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const GAME = join(here, "game");
const DERIVED = join(here, "derived");
mkdirSync(DERIVED, { recursive: true });

const load = (n) => JSON.parse(readFileSync(join(GAME, n), "utf-8"));
const save = (n, o) => writeFileSync(join(DERIVED, n), JSON.stringify(o));
const lang = "English";

// Outerpedia-v2 checkout — used to enrich the equipment table with image refs
// (item art, effect icon, class). Auto-detected across the maintainer's two PCs;
// missing entries are skipped silently so the build never hard-fails.
function findOuterpedia() {
  for (const p of [
    "C:\\Users\\Sevih\\Documents\\Projet perso\\outerpedia-v2",
    "C:\\Users\\Sevih\\Documents\\dev\\outerpedia",
  ]) if (existsSync(p)) return p;
  return null;
}
const OUTERPEDIA = findOuterpedia();
function loadOuterpedia(rel) {
  if (!OUTERPEDIA) return null;
  const p = join(OUTERPEDIA, rel);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8"));
}

// ---- text lookups (NameID -> localized name) ----
const textItem = new Map(load("TextItem.json").map((t) => [t.ID, t[lang]]));
const textChar = new Map(load("TextCharacter.json").map((t) => [t.ID, t[lang]]));

// ---- character "show nickname" flag (Gnosis Dahlia, Mystic Sage Ame, …) ----
// CharacterExtraTemplet (admin-only dump, lives in outerpedia-v2) holds the
// per-char `ShowNickName=True/False` flag that decides whether the in-game
// display prepends the NickName to the Name. Without this every limited /
// alt-class variant collapses to its base name ("Dahlia" / "Skadi") in the
// roster search. Set of CharacterIDs we should prefix.
const showNickName = new Set();
const charExtra = loadOuterpedia("data/admin/json2/CharacterExtraTemplet.json");
if (Array.isArray(charExtra)) {
  for (const r of charExtra) {
    if (r?.CharacterID && r.ShowNickName === "True") showNickName.add(String(r.CharacterID));
  }
}

// ---- options: optionId -> stat-shaped (IOT_STAT) or buff-shaped (IOT_BUFF) ----
// IOT_STAT: directly carries StatType/ApplyingType/OptionValue → resolved on the fly.
// IOT_BUFF: refers to a BuffID whose actual stat values live in BuffTemplet, indexed by
// Level (1..maxEnchantLevel+1). Talisman main stats live here. Engine resolves these
// at parse time using the item's enhanceLevel.
const options = {};
for (const o of load("ItemOptionTemplet.json")) {
  if (o.OptionType === "IOT_STAT") {
    options[o.ID] = { st: o.StatType, ap: o.ApplyingType, v: Number(o.OptionValue) };
  } else if (o.OptionType === "IOT_BUFF" && o.BuffID) {
    options[o.ID] = { buffId: o.BuffID };
  }
}
save("options.json", options);

// ---- buffs: BuffID -> [{ st, ap, v } per enhancement level 0..maxLv] ----
// BuffTemplet rows give StatType/ApplyingType/Value per Level. In-game Level 1 = +0,
// Level N+1 = +N (for N ≤ maxEnhanceLevel). Engine resolves stat (flat vs percent) the
// same way as IOT_STAT entries via core/src/stats.ts. We strip non-BT_STAT_PREMIUM rows
// (Type) to focus on talisman main stat lookups.
//
// EE mains: 25/29 `BID_CEQUIP_MAIN_*` buffs are conditional (TARGET_ELEMENT /
// OWNER_ELEMENT) — those are combat-only triggers and don't show on the
// character sheet. We gate by the buff's `BuffConditionType` so only the 4
// unconditional `_CORE` variants (DMG_REDUCE_CORE / ACCURACY_CORE /
// BUFF_CHANCE_CORE / BUFF_CRITICAL_RATE_CORE) emit. The check needs the
// buff's full row, so we resolve via the BuffTemplet on the first pass.
const eeCondByBuffId = new Map();
for (const b of load("BuffTemplet.json")) {
  const bid = b.BuffID;
  if (!bid || !bid.startsWith("BID_CEQUIP_MAIN_")) continue;
  if (!eeCondByBuffId.has(bid)) eeCondByBuffId.set(bid, b.BuffConditionType ?? "NONE");
}
const buffs = {};
for (const b of load("BuffTemplet.json")) {
  const bid = b.BuffID;
  if (!bid) continue;
  if (!(bid.startsWith("BID_ITEM_STAT_OOPARTS_") || bid.startsWith("BID_CEQUIP_MAIN_"))) continue;
  if (bid.startsWith("BID_CEQUIP_MAIN_") && eeCondByBuffId.get(bid) !== "NONE") continue;
  if (!b.StatType || b.StatType === "ST_NONE") continue;
  const lv = Number(b.Level);
  if (!Number.isFinite(lv) || lv < 1) continue;
  (buffs[bid] ??= [])[lv - 1] = { st: b.StatType, ap: b.ApplyingType, v: Number(b.Value) };
}
save("buffs.json", buffs);

// ---- equipment: itemId -> { slot, grade, classLimit, setId, name } ----
const SLOT = {
  ITS_EQUIP_WEAPON: "weapon",
  ITS_EQUIP_HELMET: "helmet",
  ITS_EQUIP_ARMOR: "armor",
  ITS_EQUIP_GLOVES: "gloves",
  ITS_EQUIP_SHOES: "boots",
  ITS_EQUIP_ACCESSORY: "accessory",
  ITS_EQUIP_EXCLUSIVE: "exclusive",
  ITS_EQUIP_OOPARTS: "ooparts",
};
const GRADE = { IG_NORMAL: "normal", IG_MAGIC: "magic", IG_RARE: "rare", IG_UNIQUE: "unique" };

// Image refs come from two places:
//   1. `IconName` in ItemTemplet — present on every equipment row (3128/3128).
//      Names the item art file (e.g. "TI_Equipment_Weapon_06"). Used as-is.
//   2. The maintainer's outerpedia-v2 checkout — `data/equipment/{weapon,
//      accessory,talisman,ee}.json` carries curated unique-option effect
//      icons (`effect_icon`, e.g. "TI_Icon_UO_Weapon_11") that aren't in the
//      raw game tables, and `data/equipment/sets.json` carries the curated
//      `set_icon` per armor 4-piece set (non-linear mapping — Speed Set
//      id 13 → TI_Icon_Set_Enchant_15, etc.). Optional; absent → no badge.
const effectIcons = new Map();
for (const file of ["weapon", "accessory", "talisman", "ee"]) {
  const list = loadOuterpedia(`data/equipment/${file}.json`);
  if (!list) continue;
  const rows = Array.isArray(list) ? list : Object.values(list);
  for (const r of rows) {
    if (!r || !r.id || !r.effect_icon) continue;
    effectIcons.set(String(r.id), r.effect_icon);
  }
}
const armorSetIcons = new Map();
const armorSetList = loadOuterpedia("data/equipment/sets.json");
if (Array.isArray(armorSetList)) {
  for (const s of armorSetList) {
    if (s && s.id != null && s.set_icon) armorSetIcons.set(String(s.id), s.set_icon);
  }
}

// ClassLimit codes → file-name fragments used by the public class icon set.
// PRIEST maps to "Healer" because the game image file is `CM_Class_Healer.webp`.
const CLASS_NAME = {
  CCT_ATTACKER: "Striker",
  CCT_MAGE: "Mage",
  CCT_RANGER: "Ranger",
  CCT_DEFENDER: "Defender",
  CCT_PRIEST: "Healer",
};

const equipment = {};
for (const it of load("ItemTemplet.json")) {
  const slot = SLOT[it.ItemSubType];
  if (!slot) continue; // gear only
  const armorSetId = it.SetOptionID && it.SetOptionID !== "0" ? it.SetOptionID : null;
  equipment[it.ID] = {
    slot,
    grade: GRADE[it.ItemGrade] ?? null,
    star: Number(it.BasicStar) || null,
    classLimit: it.ClassLimit === "CCT_NONE" ? null : it.ClassLimit,
    setId: it.UniqueOptionID && it.UniqueOptionID !== "0" ? it.UniqueOptionID : null,
    // Armor 4-piece set (Attack/Defense/Life/...). Lives in `SetOptionID` for
    // helmet/armor/gloves/boots — kept here as the canonical ID for future
    // set-bonus calc work. The displayed icon is resolved separately below
    // via the curated outerpedia-v2 `sets.json` mapping (non-linear — e.g.
    // Speed set id 13 → TI_Icon_Set_Enchant_15).
    armorSetId,
    name: textItem.get(it.NameID) ?? null,
    mainGroup: it.MainOptionGroupID ?? null,
    subGroup: it.SubOptionGroupID ?? null,
    image: it.IconName || null,
    effectIcon: effectIcons.get(String(it.ID)) ?? null,
    armorSetIcon: armorSetId ? (armorSetIcons.get(armorSetId) ?? null) : null,
    class: CLASS_NAME[it.ClassLimit] ?? null,
  };
}
save("equipment.json", equipment);

// ---- enhance: scaling constants + per-(slot,grade,star) cumulative exp curves ----
// Main-stat formula (mirrors outerpedia-v2 item-stats-detail.json):
//   standard (lv ≤ 10):  value = base × (1 + enhanceFactor × lv) × (1 + tierFactor × tier)
//   ascended (lv > 10):  value = base × (1 + enhanceFactor × 10 + singularity.activation
//                                       + Σ singularity.steps[0..lv-10-1])
//                                     × (1 + tierFactor × tier)
// Per-row cumulative Exp threshold for level L lives in column `<Grade>_<Star>`
// of ItemEnchantTemplet (e.g. Unique_6 for a 6★ unique). UpgradeFactorforOP is
// uniform across standard slots = 0.4; OOPARTS (talisman) is 0.
const enhanceFactor = 0.4;
const tierFactor = 0.05;
const maxEnhanceLevel = 10;
const expCurves = {};   // `${slot}|${grade}|${star}` -> [0, exp@1, …, exp@10]
for (const r of load("ItemEnchantTemplet.json")) {
  const slot = SLOT[r.ItemSubType];
  if (!slot) continue;
  const lv = Number(r.EnchantLevel);
  if (lv < 0 || lv > maxEnhanceLevel) continue;
  for (const [grade, gradeKey] of [["normal", "Normal"], ["magic", "Magic"], ["rare", "Rare"], ["unique", "Unique"]]) {
    for (let star = 1; star <= 6; star++) {
      const v = r[`${gradeKey}_${star}`];
      if (v === undefined) continue;
      const key = `${slot}|${grade}|${star}`;
      (expCurves[key] ??= Array(maxEnhanceLevel + 1).fill(0))[lv] = Number(v);
    }
  }
}
// Singularity: SET_ENCHANT row carries the activation factor (uniform across
// eligible slots), SET_EQUIP_ENHANCE rows give the per-step factor in NextEnchantLevel order.
const singActivations = new Set();
const singStepsBySlot = {};
for (const r of load("SingularityEquipEnchantTemplet.json")) {
  const slot = SLOT[r.ItemSubType];
  if (!slot) continue;
  const factor = Number(r.UpgradeFactorforOP);
  if (r.EnchantType === "SET_ENCHANT") singActivations.add(factor);
  else if (r.EnchantType === "SET_EQUIP_ENHANCE") {
    const next = Number(r.NextEnchantLevel);
    (singStepsBySlot[slot] ??= {})[next] = factor;
  }
}
const activation = [...singActivations][0] ?? 0;
// Steps are uniform across slots — pick any populated slot.
const slotSteps = Object.values(singStepsBySlot)[0] ?? {};
const singularitySteps = Object.keys(slotSteps).sort((a, b) => Number(a) - Number(b)).map((k) => slotSteps[k]);

save("enhance.json", {
  enhanceFactor,
  tierFactor,
  maxEnhanceLevel,
  singularity: { activation, steps: singularitySteps },
  // Talisman (OOPARTS) does NOT scale via this curve — keep entries but the
  // engine treats slot=ooparts as flat (enhanceFactor=0 in-game).
  expCurves,
});

// ---- sets: groupId -> { name, levels:[{level, p2, p4}] } ----
// Also extracts the ItemSpecialOption rows that carry an unconditional
// `BT_STAT_PREMIUM` BuffID — those are the Singularity-ascended-piece
// "common" unique options (uncondional DMG_BOOST on weapon/accessory,
// unconditional DMG_REDUCE on armor pieces). The conditional `BT_STAT`
// variants (TARGET_ELEMENT / TARGET_HAS_BUFF) are combat-only and stay
// off the character sheet.
const sets = {};
const singularityOptions = {}; // SingularityOptionID -> { st, ap, v }  (per-mille raw)
const buffTemplet = load("BuffTemplet.json");
// Buff lookup: pick the MAX-Level row per BuffID. EE upgrades reference an
// `_ADD` buff that only exists at one Level; for buffs with multiple level
// rows (rare for EE passives) we conservatively pick the strongest.
const buffByID = new Map();
for (const b of buffTemplet) {
  const cur = buffByID.get(b.BuffID);
  if (!cur || Number(b.Level) > Number(cur.Level)) buffByID.set(b.BuffID, b);
}
// EE GroupIDs — used to gate the `eePassives` extraction below. For EE items
// the first part of `UniqueOptionID` IS the GroupID (and matches the ItemID
// per observed data), so we collect them directly from ItemTemplet.
const eeGroupIds = new Set();
for (const it of load("ItemTemplet.json")) {
  if (it.ItemSubType !== "ITS_EQUIP_EXCLUSIVE") continue;
  for (const g of String(it.UniqueOptionID ?? "").split(",")) {
    if (g) eeGroupIds.add(g);
  }
}
const eePassives = {}; // GroupID -> [{ levelThreshold, st, ap, v }]
for (const s of load("ItemSpecialOptionTemplet.json")) {
  const g = (sets[s.GroupID] ??= { name: textItem.get(s.NameID) ?? null, levels: [] });
  g.levels.push({
    level: Number(s.Level),
    p2: s.StatType_2P ? { st: s.StatType_2P, ap: s.ApplyingType_2P, v: Number(s.OptionValue_2P) } : null,
    p4: s.StatType_4P ? { st: s.StatType_4P, ap: s.ApplyingType_4P, v: Number(s.OptionValue_4P) } : null,
  });
  if (s.OptionType === "IOT_BUFF" && s.BuffID) {
    const buff = buffByID.get(s.BuffID);
    if (buff && buff.Type === "BT_STAT_PREMIUM" && (!buff.BuffConditionType || buff.BuffConditionType === "NONE")) {
      singularityOptions[s.ID] = {
        st: buff.StatType,
        ap: buff.ApplyingType,
        v: Number(buff.Value),
      };
    }
  }
  // EE level-gated passive: same `IOT_BUFF` + `BT_STAT_PREMIUM` + `Cond=NONE`
  // shape as singularity options, but with extra filters that pin it to
  // PERMANENT SELF passives (combat-only base effects like Caren's
  // `BID_CEQUIP_2000089` at Lv1 are `BT_STAT` `SKILL_START` `TurnDuration=1`
  // — they fail this gate). The `Level` field is the EE enhance-level
  // threshold to unlock (1 = always when equipped, 10 = unlocks at +10).
  if (s.BuffID && eeGroupIds.has(s.GroupID)) {
    const buff = buffByID.get(s.BuffID);
    const ok = buff
      && buff.Type === "BT_STAT_PREMIUM"
      && buff.TargetType === "ME"
      && buff.BuffCreateType === "PASSIVE"
      && (buff.BuffConditionType ?? "NONE") === "NONE"
      && buff.TurnDuration === "-1";
    if (ok) {
      (eePassives[s.GroupID] ??= []).push({
        levelThreshold: Number(s.Level),
        st: buff.StatType,
        ap: buff.ApplyingType,
        v: Number(buff.Value),
      });
    }
  }
}
save("sets.json", sets);
save("singularity-options.json", singularityOptions);
save("ee-passives.json", eePassives);

// ---- expCharacter: per-level cumulative XP threshold (ExpCharacterTemplet) ----
// Used at runtime to resolve a captured character's `Exp` to a level. Array index
// 0..120 = lv (slot 0 unused); slot at lv L holds the cumulative XP needed to
// REACH that level. ExpCharacterTemplet has a parallel `TrustExp` column on
// rows lv 1..100 (caps at lv 100 = 850000 TrustExp) — emitted separately as
// the trust-character curve.
const expRowsRaw = load("ExpCharacterTemplet.json").map((r) => ({
  lv: Number(r.Level),
  exp: Number(r.TotalExp),
  trustExp: Number(r.TrustExp),
}));
const maxLv = expRowsRaw.reduce((m, r) => Math.max(m, r.lv), 0);
const expCurveByLevel = Array(maxLv + 1).fill(0);
for (const r of expRowsRaw) expCurveByLevel[r.lv] = r.exp;
save("exp-character.json", expCurveByLevel);

// Trust curve caps at lv 100 (rows above hold trustExp=0); slot 0 unused.
const trustCurveByLevel = Array(101).fill(0);
for (const r of expRowsRaw) {
  if (r.lv >= 1 && r.lv <= 100) trustCurveByLevel[r.lv] = r.trustExp;
}
save("trust-character.json", trustCurveByLevel);

// ---- trustBuffs: TrustBuffTemplet entries as flat ATK/DEF/HP additions ----
// Each tier resolves to one stat addition: trust_level_<STAT>_<N> via BuffTemplet.
// Emitted in insertion order (5×ATK, 5×DEF, 5×HP). Game rule for which tier
// unlocks at which Trust level is "every 20 levels = +1 tier" (max 5 at Lv
// 100). NOT applied anywhere right now: in-game Trust is invisible on the
// character sheet AND not folded into the displayed sheet ATK either, so the
// composer ignores it. Kept derived so we can plug it in instantly if
// Outerplane ever exposes Trust on the character sheet. Buff lookup uses the
// raw BuffTemplet rows since these are `BT_STAT` (not BT_STAT_PREMIUM).
const buffStats = new Map();
for (const b of load("BuffTemplet.json")) {
  if (!b.BuffID?.startsWith("trust_level_")) continue;
  buffStats.set(b.BuffID, {
    stat: b.StatType,
    apply: b.ApplyingType,
    value: Number(b.Value),
  });
}
const trustBuffs = load("TrustBuffTemplet.json")
  .map((r) => ({ tier: Number(r.ID), buffId: r.BuffID, ...(buffStats.get(r.BuffID) ?? null) }))
  .filter((r) => r.stat);
save("trust-buffs.json", trustBuffs);

// ---- charLevelMax: BasicStar -> step (1..3) -> { requireLevel, maxLevel, modifier } ----
// CharacterMaxLevelTemplet rows are keyed by (BasicStar, Element, Step) but the
// per-element variation is just the breakthrough material — the stat ingredients
// are the same across elements. Collapse to (BasicStar, Step). Step 0 is implicit
// (no break, max=100).
const charLevelMax = {};
for (const r of load("CharacterMaxLevelTemplet.json")) {
  const star = Number(r.BasicStar);
  const step = Number(r.Step);
  const key = `${star}|${step}`;
  if (charLevelMax[key]) continue; // first element row wins; all share the same stat block
  charLevelMax[key] = {
    requireLevel: Number(r.RequireLevel),
    maxLevel: Number(r.MaxLevel),
    statModifierAfter100: Number(r.LevelUpStatModifierAfter100),
  };
}
save("char-level-max.json", charLevelMax);

// ---- archiveBonus: codex level threshold curve (account-wide) ----
// ArchiveBonusTemplet maps a `CompleteCount` (total rewards collected across
// `ArchiveCharacterRewardInfo`) to a `Level` 1..11 that picks the matching
// CharacterArchiveStatTemplet row. Stored as an ascending-by-count array so
// the runtime can binary/linear-scan it for the resolved codex level.
const archiveBonusCurve = load("ArchiveBonusTemplet.json")
  .map((r) => ({ requiredCount: Number(r.CompleteCount), level: Number(r.Level) }))
  .sort((a, b) => a.requiredCount - b.requiredCount);
save("archive-bonus.json", archiveBonusCurve);

// ---- characters: charId -> { name, cls, element, star, recommendSetId,
//                              ingredients: { base, evoByLevel, transcendByStar,
//                                             classPassive, skill8ByLevel, gifts } } ----
// Ingredients are raw per-source bonuses extracted from the templet tables.
// The web layer composes them at runtime using the captured user progression
// (Exp → level, TransStar, …) plus user-toggleable inputs (codex level,
// include-Skill_8, include-gifts). See data/calc-stats.mjs and the core's
// compose-stats.ts for the full pipeline. The global codex curve goes to its
// own derived file (codex-curve.json) since it's account-wide, not per-char.
const ingredientsResult = computeCharacterIngredients({
  characterTemplet: load("CharacterTemplet.json"),
  evoStats:         load("CharacterEvolutionStatTemplet.json"),
  archiveStats:     load("CharacterArchiveStatTemplet.json"),
  transcendent:     load("CharacterTranscendentTemplet.json"),
  skillLevels:      load("CharacterSkillLevelTemplet.json"),
  buffs:            load("BuffTemplet.json"),
  awakLevels:       load("CharacterAwakeningLevelTemplet.json"),
  awakNodes:        load("CharacterAwakeningNodeTemplet.json"),
  fusionTemplet:    load("CharacterFusionTemplet.json"),
});
save("codex-curve.json", ingredientsResult.codexByLevel);

const characters = {};
for (const c of load("CharacterTemplet.json")) {
  if (c.Type !== "CT_PC") continue;
  const ing = ingredientsResult.characters[c.ID];
  // Nickname prefix (e.g. "Gnosis" for Gnosis Dahlia, "Mystic Sage" for
  // M.S.Ame). Only emit when CharacterExtraTemplet.ShowNickName=True for
  // this CharacterID — otherwise the in-game just shows the base Name.
  // Core Fusion variants (`2700xxx` IDs) are handled at the UI layer with
  // a literal "Core Fusion" prefix — their in-game NickName text (e.g.
  // "Eye of the Snowy Mountains") is flavor, not the variant identifier.
  const nickname = showNickName.has(c.ID) ? (textChar.get(c.NickNameID) ?? null) : null;
  characters[c.ID] = {
    name: textChar.get(c.NameID) ?? null,
    nickname,
    cls: c.Class ?? null,
    element: c.Element ?? null,
    star: Number(c.BasicStar) || null,
    ingredients: ing ?? null,
    recommendSetId: c.RecommandSetOptionID && c.RecommandSetOptionID !== "0" ? c.RecommandSetOptionID : null,
  };
}
save("characters.json", characters);

console.log(
  `derived: options=${Object.keys(options).length} equipment=${Object.keys(equipment).length} ` +
    `sets=${Object.keys(sets).length} characters=${Object.keys(characters).length} ` +
    `expCurves=${Object.keys(expCurves).length} singSteps=${singularitySteps.length} ` +
    `buffs=${Object.keys(buffs).length} eePassives=${Object.keys(eePassives).length}`,
);
