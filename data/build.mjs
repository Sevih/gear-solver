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
// Dirs are env-overridable so the packaged app can build from the synced cache
// (data-sync.ts passes OUTERPEDIA_GAME_DIR / OUTERPEDIA_DERIVED_DIR), while a
// plain `node data/build.mjs` keeps using the repo's data/game + data/derived.
const GAME = process.env.OUTERPEDIA_GAME_DIR || join(here, "game");
const DERIVED = process.env.OUTERPEDIA_DERIVED_DIR || join(here, "derived");
mkdirSync(DERIVED, { recursive: true });

// Memoize per-file: BuffTemplet (4×), ItemTemplet (2×), CharacterTemplet (2×)
// would otherwise re-read + re-parse multi-MB JSON multiple times during a
// single build run. Mutation hazard is nil — every caller iterates read-only.
const _loadCache = new Map();
const load = (n) => {
  let v = _loadCache.get(n);
  if (v === undefined) {
    v = JSON.parse(readFileSync(join(GAME, n), "utf-8"));
    _loadCache.set(n, v);
  }
  return v;
};
const save = (n, o) => writeFileSync(join(DERIVED, n), JSON.stringify(o));
const lang = "English";

// Outerpedia-v2 checkout — used to enrich the equipment table with image refs
// (item art, effect icon, class). `OUTERPEDIA_PATH` env var wins; otherwise
// auto-detected across the maintainer's two known checkouts. Missing entries
// are skipped silently so the build never hard-fails.
function findOuterpedia() {
  // Test hook: ignore the checkout so build inputs resolve ONLY from
  // OUTERPEDIA_SYNC_DIR — proves the REPO-mode sync downloaded everything.
  if (process.env.OUTERPEDIA_NO_CHECKOUT) return null;
  const candidates = [
    process.env.OUTERPEDIA_PATH,
    "C:\\Users\\Sevih\\Documents\\Projet perso\\outerpedia-v2",
    "C:\\Users\\Sevih\\Documents\\dev\\outerpedia",
  ].filter(Boolean);
  for (const p of candidates) if (existsSync(p)) return p;
  return null;
}
const OUTERPEDIA = findOuterpedia();
// In the packaged app there's no checkout — data-sync.ts downloads the same
// build inputs into OUTERPEDIA_SYNC_DIR, mirroring their repo-relative paths.
// Resolve a repo-relative path against the sync dir first, then the checkout.
const SYNC_DIR = process.env.OUTERPEDIA_SYNC_DIR || null;
function resolveOuterpediaPath(rel) {
  if (SYNC_DIR) {
    const p = join(SYNC_DIR, rel);
    if (existsSync(p)) return p;
  }
  if (OUTERPEDIA) {
    const p = join(OUTERPEDIA, rel);
    if (existsSync(p)) return p;
  }
  return null;
}
function loadOuterpedia(rel) {
  const p = resolveOuterpediaPath(rel);
  if (!p) return null;
  return JSON.parse(readFileSync(p, "utf-8"));
}

// ---- text lookups (NameID -> localized name) ----
const textItem = new Map(load("TextItem.json").map((t) => [t.ID, t[lang]]));
const textChar = new Map(load("TextCharacter.json").map((t) => [t.ID, t[lang]]));
const textSystem = new Map(load("TextSystem.json").map((t) => [t.ID, t[lang]]));
// TextSkill carries the unique-option / Singularity narrative labels
// (`UO_SINGULAREQUIP_*` keys etc.) — it lives only in the outerpedia-v2
// admin dump, NOT in the API capture, so resolve via `loadOuterpedia()`.
// Empty Map when the checkout is absent — Singularity options just lose
// their narrative `name` (UI falls back to the synthesized stat label).
const textSkillRows = loadOuterpedia("data/admin/json2/TextSkill.json");
const textSkill = new Map(
  Array.isArray(textSkillRows)
    ? textSkillRows.map((t) => [t.ID, t.English ?? null])
    : []
);

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

// ---- buffs: BuffID -> [{ st, ap, v, combatOnly? } per enhancement level 0..maxLv] ----
// BuffTemplet rows give StatType/ApplyingType/Value per Level. In-game Level 1 = +0,
// Level N+1 = +N (for N ≤ maxEnhanceLevel). Engine resolves stat (flat vs percent) the
// same way as IOT_STAT entries via core/src/stats.ts.
//
// EE mains: 25/29 `BID_CEQUIP_MAIN_*` buffs are CONDITIONAL (TARGET_ELEMENT /
// OWNER_ELEMENT, e.g. DMG +X% vs Water) — they only fire in combat against a
// specific target so they don't contribute to the character sheet. We keep
// them here (so the UI can display them as the EE's main stat — Regina's
// EE for instance only has a conditional `DMG_WATER` main) but tag each
// level entry `combatOnly: true`. parse.ts forwards the flag onto the
// `RolledStat`; stat aggregators (composer / score) already skip
// `combatOnly` entries so the math layer stays correct.
//
// Talisman mains (`BID_ITEM_STAT_OOPARTS_*`) are always unconditional.
const eeCondByBuffId = new Map();
for (const b of load("BuffTemplet.json")) {
  const bid = b.BuffID;
  if (!bid || !bid.startsWith("BID_CEQUIP_MAIN_")) continue;
  if (!eeCondByBuffId.has(bid)) eeCondByBuffId.set(bid, b.BuffConditionType ?? "NONE");
}
// Build the human-readable label for an EE main BuffID. Examples:
//   BID_CEQUIP_MAIN_DMG_WATER             → "DMG Increase vs Water"
//   BID_CEQUIP_MAIN_DMG_REDUCE_FIRE       → "DMG Reduction vs Fire"
//   BID_CEQUIP_MAIN_BUFF_CHANCE_EARTH     → "Effectiveness vs Earth"
//   BID_CEQUIP_MAIN_BUFF_CRITICAL_RATE_W… → "Critical Hit Chance vs Water"
//                                            (from SYS_STAT_..._TARGET_WATER)
//   BID_CEQUIP_MAIN_DMG_REDUCE_CORE       → "DMG Reduction"   (unconditional)
//   BID_CEQUIP_MAIN_ACCURACY_CORE         → "Accuracy"        (unconditional)
//
// Strategy: split the suffix into (stat prefix, trailing modifier). The
// trailing modifier is either an element (WATER/FIRE/EARTH/LIGHT/DARK) or
// CORE (unconditional). Stat prefix → `SYS_STAT_*` in TextSystem. For
// element variants we PREFER the game's per-element key
// (`SYS_STAT_<…>_TARGET_<ELEMENT>`) when it exists — it's the wording the
// in-game tooltip shows; otherwise we compose "<Stat> vs <Element>".
// Returns null when any lookup fails so the UI falls back to statLong.
const EE_BUFF_PREFIX_STAT_KEY = {
  "DMG":                 "SYS_STAT_DMG_BOOST",
  "DMG_REDUCE":          "SYS_STAT_DMG_REDUCE_RATE",
  "BUFF_CHANCE":         "SYS_STAT_BUFF_CHANCE",
  "BUFF_CRITICAL_RATE":  "SYS_STAT_CRITICAL_RATE",
  "ACCURACY":            "SYS_STAT_ACCURACY",
};
const EE_TRAILING_MODIFIERS = ["FIRE", "WATER", "EARTH", "LIGHT", "DARK", "CORE"];
function eeMainLabel(buffId) {
  if (!buffId.startsWith("BID_CEQUIP_MAIN_")) return null;
  const rest = buffId.slice("BID_CEQUIP_MAIN_".length);
  let modifier = null;
  let statPrefix = rest;
  for (const mod of EE_TRAILING_MODIFIERS) {
    if (rest.endsWith(`_${mod}`)) {
      modifier = mod;
      statPrefix = rest.slice(0, -(mod.length + 1));
      break;
    }
  }
  const statKey = EE_BUFF_PREFIX_STAT_KEY[statPrefix];
  if (!statKey) return null;
  const statLabel = textSystem.get(statKey);
  if (!statLabel) return null;
  if (!modifier || modifier === "CORE") return statLabel;
  // Element variant — try the specific per-element key first (cleans the
  // literal `\n` line breaks the game embeds for narrow column display).
  const specific = textSystem.get(`${statKey}_TARGET_${modifier}`);
  if (specific) return specific.replace(/\\n|\r?\n/g, " ").replace(/\s+/g, " ").trim();
  const elLabel = textSystem.get(`SYS_ELEMENT_${modifier}`);
  return elLabel ? `${statLabel} vs ${elLabel}` : statLabel;
}

const buffs = {};
for (const b of load("BuffTemplet.json")) {
  const bid = b.BuffID;
  if (!bid) continue;
  if (!(bid.startsWith("BID_ITEM_STAT_OOPARTS_") || bid.startsWith("BID_CEQUIP_MAIN_"))) continue;
  if (!b.StatType || b.StatType === "ST_NONE") continue;
  const lv = Number(b.Level);
  if (!Number.isFinite(lv) || lv < 1) continue;
  const combatOnly = bid.startsWith("BID_CEQUIP_MAIN_") && eeCondByBuffId.get(bid) !== "NONE";
  const entry = { st: b.StatType, ap: b.ApplyingType, v: Number(b.Value) };
  if (combatOnly) entry.combatOnly = true;
  // Synthesize the in-game-style label once per BuffID — duplicated across
  // every Level entry so resolveBuffMain can pick it up without re-doing
  // the lookup at runtime. Cheap (≤29 unique IDs × ≤11 levels each).
  if (bid.startsWith("BID_CEQUIP_MAIN_")) {
    const label = eeMainLabel(bid);
    if (label) entry.name = label;
  }
  (buffs[bid] ??= [])[lv - 1] = entry;
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
// Primary, complete source for the unique-option (weapon/accessory) effect
// icon: `ItemSpecialOptionTemplet.IconName`, keyed by `GroupID` (= the item's
// UniqueOptionID = our `setId`). The curated outerpedia map above only covered
// ~129 items; ISO covers all 680 unique options and agrees 100% where both
// exist. Keyed by the first row seen per group (IconName is constant across
// the per-tier levels). The curated map stays a fallback.
const isoIconByGroup = new Map();
for (const s of load("ItemSpecialOptionTemplet.json")) {
  const gid = String(s.GroupID ?? "");
  if (gid && s.IconName && !isoIconByGroup.has(gid)) isoIconByGroup.set(gid, s.IconName);
}
const armorSetIcons = new Map();
// outerpedia-v2 ships the canonical localized "effect" strings for each
// armor 4-piece set per piece-count + tier (`effect_{2|4}_{1|4}` — _1 is the
// 4★ tier in-game, _4 is the 6★ tier). Mirror those strings into the
// derived sets.json so the inventory panel can render the in-game prose
// ("Increases Attack proportional to missing Health") instead of having to
// reverse-engineer a stat value from BuffTemplet — preserves the player's
// mental model of the set effects.
const armorSetEffects = new Map(); // setId -> { [`${pcs}_${tier}`]: string | null }
const armorSetList = loadOuterpedia("data/equipment/sets.json");
if (Array.isArray(armorSetList)) {
  for (const s of armorSetList) {
    if (!s || s.id == null) continue;
    const id = String(s.id);
    if (s.set_icon) armorSetIcons.set(id, s.set_icon);
    armorSetEffects.set(id, {
      "2_1": s.effect_2_1 ?? null,
      "4_1": s.effect_4_1 ?? null,
      "2_4": s.effect_2_4 ?? null,
      "4_4": s.effect_4_4 ?? null,
    });
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
    // ISO IconName (complete game source) first, curated outerpedia map as
    // fallback. `setId` (UniqueOptionID) can be a CSV — the GroupID is its
    // first part (cf. the ItemSpecialOption resolution below).
    effectIcon: (it.UniqueOptionID ? isoIconByGroup.get(String(it.UniqueOptionID).split(",")[0]) : null)
      ?? effectIcons.get(String(it.ID)) ?? null,
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
// Per-level lookup needed for set effect buffs whose value scales per set
// tier (e.g. BID_ITEM_UO_SET_15 has Level 1 for 4★, Level 2 for 6★).
const buffByIDLevel = new Map();
for (const b of buffTemplet) {
  const cur = buffByID.get(b.BuffID);
  if (!cur || Number(b.Level) > Number(cur.Level)) buffByID.set(b.BuffID, b);
  buffByIDLevel.set(`${b.BuffID}|${b.Level}`, b);
}

// Resolve a 2-pc / 4-pc set effect entry into a {st, ap, v} triple that the
// UI can render via `resolveOption`. Fallback chain:
//   1. Direct stat (StatType_XP ≠ ST_NONE) — the common case for Attack /
//      Defense / Life / Effectiveness / Speed / Crit / Lifesteal sets.
//   2. Linked buff (BuffID_XP) at the matching `Level`:
//      2a. Buff carries a real StatType (BT_STAT_OWNER_LOST_HP_RATE on
//          Revenge / Patience / Swiftness uses StatType=ATK/DEF/SPEED).
//      2b. Buff Type implies a stat (BT_DMG / BT_DMG_TARGET_BREAK →
//          DMG_BOOST; BT_DMG_REDUCE → DMG_REDUCE_RATE). Used by
//          Pulverization / Weakness / Augmentation, whose effect mechanic
//          is the buff Type itself.
//   3. Otherwise null (e.g. Immunity's BT_IMMUNE — boolean effect with no
//      numerical value, UI falls back to the set's prose description).
const BUFF_TYPE_TO_STAT = {
  BT_DMG: "ST_DMG_BOOST",
  BT_DMG_TARGET_BREAK: "ST_DMG_BOOST",
  BT_DMG_REDUCE: "ST_DMG_REDUCE_RATE",
};
function resolveSetEffectEntry(stat, ap, value, buffId, setLevel) {
  if (stat && stat !== "ST_NONE") {
    return { st: stat, ap, v: Number(value) };
  }
  if (!buffId) return null;
  const b = buffByIDLevel.get(`${buffId}|${setLevel}`);
  if (!b) return null;
  if (b.StatType && b.StatType !== "ST_NONE") {
    return { st: b.StatType, ap: b.ApplyingType, v: Number(b.Value) };
  }
  const mapped = BUFF_TYPE_TO_STAT[b.Type];
  // BT_DMG_REDUCE on ENEMY_TEAM stores a negative value (enemy's reduction
  // drops by 25% = player deals more). Surface the magnitude — the prose
  // desc above explains the direction.
  if (mapped && b.Value != null) {
    return { st: mapped, ap: b.ApplyingType ?? "OAT_RATE", v: Math.abs(Number(b.Value)) };
  }
  return null;
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
  // desc fallback chain: DescID (UO_SET_XX_DESC — often missing from TextItem,
  // lives in TextSkill for some sets) → SimpleDescID (ST_Set_XX_DESC — the
  // short human-readable summary that ALWAYS exists in TextItem, used for
  // ST_NONE "effect" sets like Revenge / Patience whose mechanic isn't a
  // direct stat). ??= keeps the first non-null per group.
  const initialDesc = textItem.get(s.DescID) ?? textItem.get(s.SimpleDescID) ?? null;
  const g = (sets[s.GroupID] ??= { name: textItem.get(s.NameID) ?? null, desc: initialDesc, levels: [] });
  g.desc ??= initialDesc;
  const setLevel = Number(s.Level);
  // gear-solver `setLevel` 1 = 4★ tier (outerpedia `_1`), 2 = 6★ tier (`_4`).
  const tierSuffix = setLevel === 2 ? "4" : "1";
  const effects = armorSetEffects.get(s.GroupID);
  g.levels.push({
    level: setLevel,
    // Engine-facing resolved stat (kept so the solver can score set bonuses
    // numerically when needed). Null for effect sets like Revenge.
    p2: resolveSetEffectEntry(s.StatType_2P, s.ApplyingType_2P, s.OptionValue_2P, s.BuffID_2P, setLevel),
    p4: resolveSetEffectEntry(s.StatType_4P, s.ApplyingType_4P, s.OptionValue_4P, s.BuffID_4P, setLevel),
    // UI-facing localized prose pulled from outerpedia-v2 (the source of
    // truth for the curated player-facing wording per tier).
    p2_desc: effects?.[`2_${tierSuffix}`] ?? null,
    p4_desc: effects?.[`4_${tierSuffix}`] ?? null,
  });
  // Collect EVERY Singularity option (group 30000 / 31000) regardless of
  // whether it's combat-only — the UI needs them all to display the rolled
  // effect; only stat aggregators filter via `combatOnly` to keep the
  // character sheet correct.
  if (s.OptionType === "IOT_BUFF" && s.BuffID && (s.GroupID === "30000" || s.GroupID === "31000")) {
    const buff = buffByID.get(s.BuffID);
    if (buff && buff.StatType && buff.StatType !== "ST_NONE") {
      // Unconditional `BT_STAT_PREMIUM` rows ALWAYS apply (routed through
      // BuffValueRate in-game). Everything else (BT_STAT with
      // BuffConditionType / TurnDuration ≠ -1 / SKILL_START triggers, …)
      // is gear-rolled but only fires in combat — flag `combatOnly: true`
      // so the math layer skips it while the UI still surfaces it.
      const unconditional = buff.Type === "BT_STAT_PREMIUM"
        && (!buff.BuffConditionType || buff.BuffConditionType === "NONE");
      singularityOptions[s.ID] = {
        st: buff.StatType,
        ap: buff.ApplyingType,
        v: Number(buff.Value),
        // Narrative label from TextSkill (e.g. "DMG Increase to target",
        // "DMG Reduction vs Earth"). NameID lives in TextSkill via the
        // `UO_SINGULAREQUIP_*` keys; null when the checkout is missing.
        name: textSkill.get(s.NameID) ?? null,
        // Rich description — preserves the in-game `<color=#hex>…</color>`
        // tags around the grade letter + value (e.g.
        // "<color=#b266ff>S</color> DMG dealt … <color=#0D99DA>138%</color>").
        // Value is already baked per option, no token substitution needed.
        desc: textSkill.get(s.DescID) ?? null,
        combatOnly: !unconditional,
      };
    }
  }
  // EE level-gated passive: same `IOT_BUFF` + `BT_STAT_PREMIUM` + `Cond=NONE`
  // shape as singularity options, but with extra filters that pin it to
  // PERMANENT SELF passives (combat-only base effects like Caren's
  // `BID_CEQUIP_2000089` at Lv1 are `BT_STAT` `SKILL_START` `TurnDuration=1`
  // — they fail this gate). The `Level` field is the EE enhance-level
  // threshold to unlock (1 = always when equipped, 10 = unlocks at +10).
  // An EE row can list MULTIPLE comma-separated BuffIDs. The classic shape is
  // a self buff + the same buff to same-class allies — e.g. Eris (2000117):
  //   BID_CEQUIP_2000117_1 = +50% CHD to SELF (TargetType ME, Cond NONE)
  //   BID_CEQUIP_2000117_2 = +50% CHD to MY_TEAM_WITHOUT_ME of OWNER_CLASS
  // We split and evaluate each against the self-passive gate below. The old
  // whole-string `buffByID.get(s.BuffID)` failed the lookup for ANY comma row,
  // silently dropping the SELF passive too — so Eris' +50% CHD (which in-game
  // shows on her own sheet, since she IS that class) never reached the
  // character sheet or the solver. 7 EEs were affected.
  if (s.BuffID && eeGroupIds.has(s.GroupID)) {
    for (const bid of String(s.BuffID).split(",")) {
      if (!bid) continue;
      const buff = buffByID.get(bid);
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
}
save("sets.json", sets);
save("singularity-options.json", singularityOptions);
save("ee-passives.json", eePassives);

// ---- equipmentPassives: itemId -> { name, textByTier[5] } ----
// The per-weapon / per-accessory base "unique option" passive (e.g.
// "Destruction" on weapon ID 754). Resolution pipeline:
//   1. ItemTemplet.UniqueOptionID (first comma fragment) → ItemSpecialOptionTemplet row
//   2. row.NameID + row.DescID → TextSkill (English) — name + template
//   3. row.BuffID (first comma fragment) → BuffTemplet rows per Level (1..5 = T0..T4)
//   4. Fill placeholders ([Value], [Rate], [Turn], [+Value2], …) per Level
//
// Mirrors outerpedia-v2/scripts/generate-item-stats-detail.py `build_passive()`:
// same _is_permille / _fmt_value / _fmt_turn / _token_values logic so the
// rendered text matches outerpedia-v2's interactive equipment detail view.
const specialOptByID = new Map();
for (const r of load("ItemSpecialOptionTemplet.json")) {
  if (!specialOptByID.has(r.ID)) specialOptByID.set(r.ID, r);
}

// Buff levels keyed by BuffID — list of rows sorted by Level ascending.
const buffLevelsByID = new Map();
for (const b of buffTemplet) {
  if (!b.BuffID) continue;
  const arr = buffLevelsByID.get(b.BuffID) ?? [];
  arr.push(b);
  buffLevelsByID.set(b.BuffID, arr);
}
for (const arr of buffLevelsByID.values()) {
  arr.sort((a, b) => Number(a.Level) - Number(b.Level));
}

const TOKEN_RE = /\[[^\]]+\]/g;

function isPermille(buff) {
  if (!buff) return false;
  if (buff.ApplyingType === "OAT_RATE") return true;
  const st = buff.StatType ?? "";
  if (st.includes("_RATE") || st.includes("_DMG")) return true;
  const t = buff.Type ?? "";
  return t === "BT_ADDITIVE_TURN" || t.includes("_ENHANCE");
}

function jsNum(x) {
  // Match outerpedia-v2 `_num()`: drop trailing .0 (15.0 → "15", 1.5 → "1.5").
  return x === Math.trunc(x) ? String(Math.trunc(x)) : String(x);
}

function fmtValue(buff) {
  if (!buff) return "?";
  const v = Number.parseInt(buff.Value ?? 0, 10) || 0;
  return isPermille(buff)
    ? `${jsNum(Math.abs(v) / 10)}%`
    : String(Math.abs(v));
}

function fmtTurn(buff) {
  const td = (buff?.TurnDuration ?? "").toString();
  return /^\d+$/.test(td) ? td : "?";
}

function findBuff(buffIdStr, level, index = 0) {
  const ids = buffIdStr.split(",").map((s) => s.trim());
  const target = index === 0 ? ids[0] : (ids[index] ?? `${ids[0]}_${index + 1}`);
  const rows = buffLevelsByID.get(target) ?? [];
  return rows.find((b) => Number(b.Level) === level) ?? null;
}

function maxBuffLevel(buffIdStr) {
  const first = buffIdStr.split(",")[0].trim();
  const rows = buffLevelsByID.get(first) ?? [];
  return rows.length ? Math.max(...rows.map((b) => Number(b.Level) || 1)) : 1;
}

function tokenValues(buffIdStr, level) {
  const b0 = findBuff(buffIdStr, level, 0);
  const b2 = findBuff(buffIdStr, level, 1);
  const b4 = findBuff(buffIdStr, level, 3);
  const b5 = findBuff(buffIdStr, level, 4);
  const rate = b0 && b0.CreateRate
    ? `${jsNum(Number(b0.CreateRate) / 10)}%`
    : "?";
  const val = fmtValue(b0), turn = fmtTurn(b0);
  const val2 = fmtValue(b2), turn2 = fmtTurn(b2);
  const val4 = fmtValue(b4), val5 = fmtValue(b5);
  return {
    "[Value]": val, "[+Value]": `+${val}`, "[-Value]": `-${val}`,
    "[Value2]": val2, "[+Value2]": `+${val2}`, "[-Value2]": `-${val2}`,
    "[Value4]": val4, "[Value5]": val5,
    "[Rate]": rate, "[RATE]": rate, "[Rate1]": rate,
    "[Turn]": turn, "[Turn1]": turn, "[+Turn]": turn, "[+Turn1]": turn, "[-Turn]": `-${turn}`,
    "[Turn2]": turn2,
  };
}

// Talismans + EE expose their passives via the multi-tier table below
// (base + +10 unlock semantics), not the per-breakthrough-tier shape the
// equipmentPassives loop produces. Defined here so the equipmentPassives
// gate (right below) can skip these subtypes — otherwise both tables
// would emit for the same item and the UI would render two passive cards.
const MULTI_TIER_SUBTYPES = new Set(["ITS_EQUIP_OOPARTS", "ITS_EQUIP_EXCLUSIVE"]);

const equipmentPassives = {};
for (const it of load("ItemTemplet.json")) {
  if (!SLOT[it.ItemSubType]) continue;          // gear only
  if (MULTI_TIER_SUBTYPES.has(it.ItemSubType)) continue;
  const uo = it.UniqueOptionID;
  if (!uo || uo === "0") continue;
  const opt = specialOptByID.get(String(uo).split(",")[0].trim());
  if (!opt) continue;
  const buffIdStr = opt.BuffID ?? "";
  if (!buffIdStr) continue;
  const descId = opt.DescID || opt.CustomCraftDescID;
  if (!descId) continue;
  const desc = textSkill.get(descId);
  if (!desc) continue;
  const tokens = new Set(desc.match(TOKEN_RE) ?? []);
  const maxLv = maxBuffLevel(buffIdStr);
  const textByTier = [];
  for (let lv = 1; lv <= maxLv; lv++) {
    const vals = tokenValues(buffIdStr, lv);
    let text = desc;
    // Only substitute tokens that actually appear in the desc, to avoid
    // touching colons / brackets used as plain punctuation. Wrap each
    // substituted value in `<color=#28d9ed>…</color>` to match outerpedia-v2's
    // rendering convention — the UI's GameText parses these tags into
    // colored spans so the dynamic value pops visually.
    for (const tok of tokens) {
      if (vals[tok] !== undefined) {
        text = text.split(tok).join(`<color=#28d9ed>${vals[tok]}</color>`);
      }
    }
    textByTier.push(text);
  }
  equipmentPassives[it.ID] = {
    name: textSkill.get(opt.NameID) ?? null,
    textByTier,
  };
}
save("equipment-passives.json", equipmentPassives);

// ---- multiTierPassives: itemId -> { name, tiers[{unlockLevel, isAdd, desc}] } ----
// Talisman / EE passive — fundamentally different from `equipmentPassives`:
// instead of one passive scaling per breakthrough tier, the item carries a
// SHORT LIST of independent tiers (typically base + optional `+10 unlock`).
// Source: `ItemTemplet.UniqueOptionID` is a comma-separated list (`base[, lv10]`).
// Each fragment resolves to an ItemSpecialOptionTemplet row at its own Level
// (1 = always-on, 10 = +10 unlock). Each tier's BuffID has a single Level=1
// row in BuffTemplet (different BuffID for the upgrade variant); placeholders
// `[Value]/[Rate]/…` substituted from that single row.
const multiTierPassives = {};
for (const it of load("ItemTemplet.json")) {
  if (!MULTI_TIER_SUBTYPES.has(it.ItemSubType)) continue;
  const uoIds = String(it.UniqueOptionID ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && s !== "0");
  if (uoIds.length === 0) continue;
  const tiers = [];
  let nameForItem = null;
  for (const uid of uoIds) {
    const opt = specialOptByID.get(uid);
    if (!opt) continue;
    const descId = opt.DescID || opt.CustomCraftDescID;
    const buffIdStr = opt.BuffID ?? "";
    if (!descId || !buffIdStr) continue;
    const descTpl = textSkill.get(descId);
    if (!descTpl) continue;
    nameForItem ??= textSkill.get(opt.NameID) ?? null;
    // Two valid talisman/EE encodings co-exist in the game data:
    //   1. Per-tier BuffID — base uses `BID_..._01`, +10 uses
    //      `BID_..._01_lv10`. Each buff has a single Level=1 row that
    //      carries the value for that tier.
    //   2. Shared BuffID — base and +10 share one `BID_..._04`, but the
    //      buff has TWO rows: Level=1 (base value) and Level=10 (upgraded
    //      value). The per-tier separation lives in BuffTemplet's Level
    //      column, not the BuffID.
    // Look up at the SpecOpt row's `Level` field, capped to whatever
    // levels the buff actually exposes — handles both shapes correctly
    // (encoding 1: only Level=1 exists → cap takes us back to 1; encoding
    // 2: Levels 1 and 10 both exist → we hit the right one).
    const buffMaxLv = maxBuffLevel(buffIdStr);
    const lookupLv = Math.min(Number(opt.Level) || 1, buffMaxLv);
    const vals = tokenValues(buffIdStr, lookupLv);
    const tokens = new Set(descTpl.match(TOKEN_RE) ?? []);
    let desc = descTpl;
    for (const tok of tokens) {
      if (vals[tok] !== undefined) {
        desc = desc.split(tok).join(`<color=#28d9ed>${vals[tok]}</color>`);
      }
    }
    tiers.push({
      unlockLevel: Number(opt.Level) || 1,
      isAdd: opt.IsAdd === "True",
      desc,
    });
  }
  if (tiers.length === 0) continue;
  // Sort by unlockLevel so the UI always lists base first, then upgrades.
  tiers.sort((a, b) => a.unlockLevel - b.unlockLevel);
  multiTierPassives[it.ID] = { name: nameForItem, tiers };
}
save("multi-tier-passives.json", multiTierPassives);

// ---- gems: OptionID -> { type, level, stat, percent, value } ----
// Talisman / EE substat slots are NOT rolled — they're swappable gems the
// player slots in/out. Each gem is encoded as an ItemOptionTemplet entry
// in the 15001..15054 range: 9 stat slots × 6 levels packed sequentially
// (15001 = ATK lv1, 15002 = DEF lv1, …, 15009 = DMG- lv1, 15010 = ATK lv2,
// …, 15054 = DMG- lv6). We index by OptionID so the UI can resolve a
// captured gem to its image filename + value badge in one lookup.
const GEM_STAT_BY_INDEX = [
  { st: "ST_ATK",                ap: "OAT_RATE", type: "ATK" },
  { st: "ST_DEF",                ap: "OAT_RATE", type: "Def" },
  { st: "ST_HP",                 ap: "OAT_RATE", type: "Heal" },
  { st: "ST_CRITICAL_RATE",      ap: "OAT_ADD",  type: "CriRate" },
  { st: "ST_CRITICAL_DMG_RATE",  ap: "OAT_ADD",  type: "CriDmgRate" },
  { st: "ST_BUFF_CHANCE",        ap: "OAT_RATE", type: "BuffChance" },
  { st: "ST_BUFF_RESIST",        ap: "OAT_RATE", type: "BuffResist" },
  { st: "ST_DMG_BOOST",          ap: "OAT_ADD",  type: "DMG_INCREASE" },
  { st: "ST_DMG_REDUCE_RATE",    ap: "OAT_ADD",  type: "DMG_REDUCE" },
];
const GEMS_BASE_ID = 15001;
const GEMS_PER_LEVEL = GEM_STAT_BY_INDEX.length;   // 9
const GEM_MAX_LEVEL = 6;

const gems = {};
for (let lv = 1; lv <= GEM_MAX_LEVEL; lv++) {
  for (let i = 0; i < GEMS_PER_LEVEL; i++) {
    const id = String(GEMS_BASE_ID + (lv - 1) * GEMS_PER_LEVEL + i);
    const slot = GEM_STAT_BY_INDEX[i];
    const opt = options[id];
    // Cross-check with ItemOptionTemplet — if our stat-slot mapping ever
    // drifts (game update reorders the gem family), we'd silently emit a
    // wrong gem. Skipping the entry surfaces the drift in the next rebuild.
    if (!opt || !("st" in opt) || opt.st !== slot.st || opt.ap !== slot.ap) continue;
    gems[id] = {
      type: slot.type,
      level: lv,
      st: opt.st,
      ap: opt.ap,
      v: opt.v,
    };
  }
}
save("gems.json", gems);

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

// Skip "variant" chars whose `NameID` points at another char's name file —
// they're transcend-visual alt-models or PvP/event variants that share
// ingredients with the canonical entry (e.g. 2010065-2050065 are Ame
// 2000065 alt visuals; 2300001/2400001/… are Stella variants; 2710005 is
// a Lisha-core alt). The canonical rule is `NameID === ID + "_Name"`. Drops
// ~122 entries (243 → 121, characters.json 1.5 MB → 800 KB) without
// touching any runtime lookup — verified against the captured
// user_character: zero captured CharID/FusionCharID fails this test.
// Per-character damage scaling, read from outerpedia's already-extracted
// per-char buff file (`public/damage-calc/buffs/{id}.json`). Each scaling buff
// carries the engine `statRef` + a permille `amount`:
//   - `scaling_swap`      → the skill swaps ATK for this stat (Caren → DEF).
//   - `scaling_add_*`      → an additive secondary component (D.Stella + HP×3%).
// We emit `dmgStat` (the swapped MAIN, only when non-ATK — its ratio is a
// constant that doesn't change same-hero ranking) and `dmgSec` (secondaries
// with their ratio, which DO shift ranking). Only damage-relevant stats
// (atk/def/hp) are kept — `scaling_add` is overloaded for non-damage effects
// (SPEED / gold / buff-chance) which aren't part of the damage base.
const SCALING_STAT_TO_KEY = { ST_ATTACK: "atk", ST_DEF: "def", ST_HP: "hp" };
const DMG_SEC_STATS = new Set(["atk", "def", "hp"]);
function readDmgScaling(charId) {
  const f = resolveOuterpediaPath(`public/damage-calc/buffs/${charId}.json`);
  if (!f) return {};
  try {
    const buffs = JSON.parse(readFileSync(f, "utf-8"))?.buffs ?? [];
    let dmgStat = null;
    const secMax = new Map(); // stat -> max ratio (S1/S2/S3 repeat the same scaling)
    for (const b of buffs) {
      const e = b?.effect;
      const key = e && SCALING_STAT_TO_KEY[e.statRef];
      if (!key) continue;
      if (e.target === "scaling_swap") {
        if (key !== "atk") dmgStat = key; // ATK swap never happens; default stays atk
      } else if (e.target === "scaling_add_pct" || e.target === "scaling_add_flat") {
        if (!DMG_SEC_STATS.has(key)) continue;
        const ratio = Number(e.amount) / 1000;
        if (ratio > 0) secMax.set(key, Math.max(secMax.get(key) ?? 0, ratio));
      }
    }
    const dmgSec = secMax.size > 0 ? [...secMax].map(([stat, ratio]) => ({ stat, ratio })) : null;
    return { dmgStat, dmgSec };
  } catch {
    return {};
  }
}

const characters = {};
for (const c of load("CharacterTemplet.json")) {
  if (c.Type !== "CT_PC") continue;
  if (c.NameID !== `${c.ID}_Name`) continue;
  const ing = ingredientsResult.characters[c.ID];
  // Nickname prefix (e.g. "Gnosis" for Gnosis Dahlia, "Mystic Sage" for
  // M.S.Ame). Only emit when CharacterExtraTemplet.ShowNickName=True for
  // this CharacterID — otherwise the in-game just shows the base Name.
  // Core Fusion variants (`2700xxx` IDs) are handled at the UI layer with
  // a literal "Core Fusion" prefix — their in-game NickName text (e.g.
  // "Eye of the Snowy Mountains") is flavor, not the variant identifier.
  const nickname = showNickName.has(c.ID) ? (textChar.get(c.NickNameID) ?? null) : null;
  const { dmgStat, dmgSec } = readDmgScaling(c.ID);
  characters[c.ID] = {
    name: textChar.get(c.NameID) ?? null,
    nickname,
    cls: c.Class ?? null,
    element: c.Element ?? null,
    star: Number(c.BasicStar) || null,
    ingredients: ing ?? null,
    recommendSetId: c.RecommandSetOptionID && c.RecommandSetOptionID !== "0" ? c.RecommandSetOptionID : null,
    ...(dmgStat ? { dmgStat } : {}),
    ...(dmgSec ? { dmgSec } : {}),
  };
}
save("characters.json", characters);

// ── Substat tick values (flat-vs-% rentability, Builder info panel) ──────────
// Source: outerpedia's pre-parsed `subStatPools` (data/equipment/item-stats-detail.json),
// keyed by gear-star tier ("105" = 5★, "106" = 6★); `step` is the per-tick value,
// `max` = step × 6. We keep only the ATK/DEF/HP flat+% duals (the only stats with a
// flat-vs-% choice) and remap to engine stat keys. Skipped silently if absent.
const subTickDetail = loadOuterpedia("data/equipment/item-stats-detail.json");
if (subTickDetail?.subStatPools) {
  const STAT_KEY = { ATK: "atk", "ATK%": "atkPct", DEF: "def", "DEF%": "defPct", HP: "hp", "HP%": "hpPct" };
  const TIER_STAR = { 105: "5", 106: "6" };
  const subTicks = {};
  for (const [tier, star] of Object.entries(TIER_STAR)) {
    const pool = subTickDetail.subStatPools[tier]?.pool;
    if (!Array.isArray(pool)) continue;
    const row = {};
    for (const p of pool) {
      const key = STAT_KEY[p.key];
      if (key) row[key] = { step: p.step, percent: !!p.percent };
    }
    if (Object.keys(row).length) subTicks[star] = row;
  }
  if (Object.keys(subTicks).length) save("sub-ticks.json", subTicks);
}

console.log(
  `derived: options=${Object.keys(options).length} equipment=${Object.keys(equipment).length} ` +
    `sets=${Object.keys(sets).length} characters=${Object.keys(characters).length} ` +
    `expCurves=${Object.keys(expCurves).length} singSteps=${singularitySteps.length} ` +
    `buffs=${Object.keys(buffs).length} eePassives=${Object.keys(eePassives).length}`,
);
