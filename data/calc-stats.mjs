/**
 * Per-character stat-calc ingredients — extracted from the raw templet tables
 * and consumed at runtime by the web layer to compose the no-gear stat block
 * using the actual user progression (level, TransStar, codex toggle, gifts
 * toggle, …).
 *
 * Ported from outerpedia-v2's /api/admin/characters/:id/stats route but split
 * into raw ingredient blocks rather than a pre-baked "max-everything" output,
 * so the web layer can switch off Skill_8/gifts/codex and pick the actual
 * captured TransStar (and the corresponding Skill_8 level).
 *
 * Encoding rules (mirror the route exactly):
 *   - CHC/CHD/PEN/DMG_INC/DMG_RED — value is per-mille (÷10 → percent points)
 *   - ATK/DEF/HP OAT_RATE         — folded into atkPct/defPct/hpPct
 *   - ATK/DEF/HP OAT_ADD          — flat
 *   - SPD/EFF/RES OAT_ADD         — flat integer
 *   - SPD/EFF/RES OAT_RATE        — `floor(baseForRate × value / 1000)` (flat
 *                                   premium on base+evo)
 */

const ELEMENT_INDEX = { CET_EARTH: 0, CET_WATER: 1, CET_FIRE: 2, CET_LIGHT: 3, CET_DARK: 4 };
const CLASS_INDEX = { CCT_DEFENDER: 1, CCT_ATTACKER: 2, CCT_RANGER: 3, CCT_MAGE: 4, CCT_PRIEST: 5 };
const SUBCLASS_INDEX = {
  ATTACKER: 1, BRUISER: 2, WIZARD: 3, ENCHANTER: 4,
  VANGUARD: 5, TACTICIAN: 6, SWEEPER: 7, PHALANX: 8,
  RELIEVER: 9, SAGE: 10,
};

function num(v) { if (!v) return 0; const p = parseInt(v, 10); return Number.isFinite(p) ? p : 0; }
function splitCsv(s) { if (!s) return []; return s.split(",").map((x) => x.trim()).filter(Boolean); }
function zeroStats() {
  return {
    atk: 0, def: 0, hp: 0, spd: 0,
    chc: 0, chd: 0, pen: 0,
    dmgInc: 0, dmgRed: 0,
    eff: 0, res: 0,
    atkPct: 0, defPct: 0, hpPct: 0,
  };
}
function isEmpty(s) { for (const k of Object.keys(s)) if (s[k] !== 0) return false; return true; }

function pickSkillLevelRow(rows, skillId, level) {
  let best;
  for (const r of rows) {
    if (r.SkillID !== skillId) continue;
    if (level != null) {
      if (num(r.SkillLevel) === level) return r;
      continue;
    }
    if (!best || num(r.SkillLevel) > num(best.SkillLevel)) best = r;
  }
  return best;
}
function pickMaxBuff(rows, buffId) {
  let best;
  for (const r of rows) {
    if (r.BuffID !== buffId) continue;
    if (!best || num(r.Level) > num(best.Level)) best = r;
  }
  return best;
}

// Emit raw lv 1 (Min) / lv 100 (Max) anchors from CharacterTemplet. The
// in-game per-level interpolation is integer-arithmetic:
//   stat(L) = Min + floor((Max - Min) × (L - 1) / 99)
// so at L=100 it lands exactly on Max regardless of whether (Max-Min) divides
// evenly by 99. The runtime composer reproduces that formula in compose-stats.ts;
// no pre-compensation needed on the stored anchors. Stats where min == max
// (SPD/CHC/CHD/EFF for most chars) don't grow with level — the formula
// handles them automatically (delta = 0).
function extractBase(row) {
  return {
    atk: { min: num(row.Atk_Min), max: num(row.Atk_Max) },
    def: { min: num(row.Def_Min), max: num(row.Def_Max) },
    hp:  { min: num(row.HP_Min),  max: num(row.HP_Max)  },
    spd: { min: num(row.Speed_Min),       max: num(row.Speed_Max) },
    chc: { min: num(row.CriticalRate_Min) / 10,    max: num(row.CriticalRate_Max) / 10 },
    chd: { min: num(row.CriticalDMGRate_Min) / 10, max: num(row.CriticalDMGRate_Max) / 10 },
    eff: { min: num(row.BuffChance_Min),  max: num(row.BuffChance_Max) },
    res: { min: num(row.BuffResist_Min),  max: num(row.BuffResist_Max) },
  };
}

// Per-row evolution adds keyed by EvolutionLevel (the captured TransStar gates
// which rows the in-game character has unlocked — cumulative through TransStar).
function extractEvoByLevel(evoStats, charId) {
  const out = {};
  for (const r of evoStats) {
    if (r.CharacterID !== charId) continue;
    const lvl = String(num(r.EvolutionLevel));
    const dest = out[lvl] ?? zeroStats();
    for (let i = 1; i <= 3; i++) {
      const t = r[`RewardStatType_${i}`];
      const v = num(r[`RewardValue_${i}`]);
      if (t === "ST_ATK")                    dest.atk += v;
      else if (t === "ST_DEF")               dest.def += v;
      else if (t === "ST_HP")                dest.hp += v;
      else if (t === "ST_SPEED")             dest.spd += v;
      else if (t === "ST_BUFF_CHANCE")       dest.eff += v;
      else if (t === "ST_BUFF_RESIST")       dest.res += v;
      else if (t === "ST_CRITICAL_RATE")     dest.chc += v / 10;
      else if (t === "ST_CRITICAL_DMG_RATE") dest.chd += v / 10;
      else if (t === "ST_DMG_BOOST")         dest.dmgInc += v / 10;
      else if (t === "ST_DMG_REDUCE_RATE")   dest.dmgRed += v / 10;
      else if (t === "ST_PIERCE_POWER_RATE") dest.pen += v / 10;
    }
    out[lvl] = dest;
  }
  return out;
}

// Codex (Hero Archive) %-multipliers per Lv 1..11 — global, NOT per char.
function extractCodexCurve(archiveStats) {
  const out = [];
  out.push({ atkPct: 0, defPct: 0, hpPct: 0 }); // Lv 0 = no codex
  for (const r of archiveStats.slice().sort((a, b) => num(a.ID) - num(b.ID))) {
    out.push({ atkPct: num(r.Atk_Rate) / 10, defPct: num(r.Def_Rate) / 10, hpPct: num(r.HP_Rate) / 10 });
  }
  return out;
}

// Per-TransStar transcend % bonuses + Skill_8 unlocked level. Indexed by TransStar.
function extractTranscendByStar(transcendent, basicStar, charId) {
  const charSpecific = transcendent.filter((r) => r.CharacterID === charId);
  const pool = charSpecific.length > 0
    ? charSpecific
    : transcendent.filter((r) => r.CharacterID === "0" && num(r.BasicStar) === basicStar);
  const out = {};
  for (const r of pool) {
    const star = num(r.TransStar);
    if (star === 0) continue;
    out[String(star)] = {
      atkPct: num(r.RewardAtkRate) / 10,
      defPct: num(r.RewardDefRate) / 10,
      hpPct:  num(r.RewardHPRate)  / 10,
      skillLevel: num(r.SkillLevel),
      // Star UI metadata used by the BP formula (CalcBattlePower in libil2cpp).
      // ShowUIStar drives the in-game star display (1..6 for 3★ chars), StarPlus
      // adds a "+" star indicator. Both feed star_bonus = ShowUIStar×500 + StarPlus×120.
      showUIStar: num(r.ShowUIStar),
      starPlus:   num(r.StarPlus),
    };
  }
  return out;
}

function applyPremiumBuff(dest, buff, baseForRate) {
  if (buff.Type !== "BT_STAT_PREMIUM") return;
  if ((buff.BuffConditionType ?? "NONE") !== "NONE") return;
  const value = num(buff.Value);
  const rate = buff.ApplyingType === "OAT_RATE";
  const add  = buff.ApplyingType === "OAT_ADD";
  if (!rate && !add) return;
  if (buff.StatType === "ST_CRITICAL_RATE")     { dest.chc    += value / 10; return; }
  if (buff.StatType === "ST_CRITICAL_DMG_RATE") { dest.chd    += value / 10; return; }
  if (buff.StatType === "ST_PIERCE_POWER_RATE") { dest.pen    += value / 10; return; }
  if (buff.StatType === "ST_DMG_REDUCE_RATE")   { dest.dmgRed += value / 10; return; }
  if (buff.StatType === "ST_DMG_BOOST")         { dest.dmgInc += value / 10; return; }
  if (buff.StatType === "ST_ATK") { if (rate) dest.atkPct += value / 10; else dest.atk += value; return; }
  if (buff.StatType === "ST_DEF") { if (rate) dest.defPct += value / 10; else dest.def += value; return; }
  if (buff.StatType === "ST_HP")  { if (rate) dest.hpPct  += value / 10; else dest.hp  += value; return; }
  if (buff.StatType === "ST_SPEED") {
    if (rate) dest.spd += Math.floor(baseForRate.spd * value / 1000); else dest.spd += value;
    return;
  }
  if (buff.StatType === "ST_BUFF_CHANCE") {
    if (rate) dest.eff += Math.floor(baseForRate.eff * value / 1000); else dest.eff += value;
    return;
  }
  if (buff.StatType === "ST_BUFF_RESIST") {
    if (rate) dest.res += Math.floor(baseForRate.res * value / 1000); else dest.res += value;
    return;
  }
}

function extractClassPassive(row, skillLevels, buffs, baseForRate) {
  const out = zeroStats();
  const skillId = row.Skill_22;
  if (!skillId) return out;
  const levelRow = pickSkillLevelRow(skillLevels, skillId);
  for (const bid of splitCsv(levelRow?.BuffID)) {
    const b = pickMaxBuff(buffs, bid);
    if (b) applyPremiumBuff(out, b, baseForRate);
  }
  return out;
}

// Per-level Skill_8 buffs. Each transcend skillLevel index gets its own block.
function extractSkill8ByLevel(row, skillLevels, buffs, transcendByStar, baseForRate) {
  const out = {};
  const skillId = row.Skill_8;
  if (!skillId) return out;
  const seen = new Set();
  for (const star of Object.keys(transcendByStar)) {
    const lvl = transcendByStar[star].skillLevel;
    if (lvl <= 0 || seen.has(lvl)) continue;
    seen.add(lvl);
    const levelRow = pickSkillLevelRow(skillLevels, skillId, lvl);
    if (!levelRow) continue;
    const dest = zeroStats();
    for (const bid of splitCsv(levelRow.BuffID)) {
      const b = pickMaxBuff(buffs, bid);
      if (b) applyPremiumBuff(dest, b, baseForRate);
    }
    if (!isEmpty(dest)) out[String(lvl)] = dest;
  }
  return out;
}

function accumulateGeasBonus(dest, levelRow, buffs) {
  let statType = levelRow.StatType ?? "ST_NONE";
  let applying = levelRow.ApplyingType ?? "OAT_NONE";
  let value    = num(levelRow.OptionValue);
  let condition = "NONE";
  if (levelRow.OptionType === "IOT_BUFF" && levelRow.BuffID) {
    const b = pickMaxBuff(buffs, levelRow.BuffID);
    if (!b) return;
    if (b.Type !== "BT_STAT_PREMIUM") return;
    statType = b.StatType; applying = b.ApplyingType; value = num(b.Value); condition = b.BuffConditionType ?? "NONE";
  }
  if (condition !== "NONE") return;
  const rate = applying === "OAT_RATE";
  const add  = applying === "OAT_ADD";
  if (!rate && !add) return;
  if (statType === "ST_CRITICAL_RATE")     { dest.chc    += value / 10; return; }
  if (statType === "ST_CRITICAL_DMG_RATE") { dest.chd    += value / 10; return; }
  if (statType === "ST_PIERCE_POWER_RATE") { dest.pen    += value / 10; return; }
  if (statType === "ST_DMG_REDUCE_RATE")   { dest.dmgRed += value / 10; return; }
  if (statType === "ST_DMG_BOOST")         { dest.dmgInc += value / 10; return; }
  if (statType === "ST_ATK") { if (rate) dest.atkPct += value / 10; else dest.atk += value; return; }
  if (statType === "ST_DEF") { if (rate) dest.defPct += value / 10; else dest.def += value; return; }
  if (statType === "ST_HP")  { if (rate) dest.hpPct  += value / 10; else dest.hp  += value; return; }
  if (add) {
    if (statType === "ST_SPEED")            dest.spd += value;
    else if (statType === "ST_BUFF_CHANCE") dest.eff += value;
    else if (statType === "ST_BUFF_RESIST") dest.res += value;
  }
}

// Geas — element / class / subclass nodes that apply to this char. Emitted as
// a per-node, per-level table so the runtime composer can resolve the actual
// unlock level for each node from the captured `/gift/info` GiftList. When the
// capture is absent, the composer falls back to the per-node max level (which
// matches the previous always-max behavior).
//
// Value at level N is cumulative (not delta): e.g. group 60101 has Lv 1 = CHD
// 50 and Lv 2 = CHD 100 — owning Lv 2 grants +100 CHD, not +150. We emit one
// StatBlock per existing level row so the composer just picks the user's row.
//
// Each node carries a `source`: "stat" when its level rows are IOT_STAT
// (direct stat additions — e.g. +100 ATK), "buff" when they're IOT_BUFF
// (BT_STAT_PREMIUM buffs — e.g. +50 EFF via RANGER_PASSIVE_3_10). In-game
// counts the IOT_STAT contributions in the WHITE portion of each stat (raw
// additive sources) and bundles IOT_BUFF contributions into the YELLOW
// delta alongside class passive / Skill_8 / gear.
function extractGeasByNode(row, awakNodes, awakLevels, buffs) {
  const elemIdx  = ELEMENT_INDEX[row.Element ?? ""]   ?? -1;
  const classIdx = CLASS_INDEX[row.Class ?? ""]       ?? -1;
  const subIdx   = SUBCLASS_INDEX[row.SubClass ?? ""] ?? -1;
  const levelsByGroup = new Map();
  for (const r of awakLevels) {
    const gid = r.AwakeningLevelGroupID;
    if (!gid) continue;
    let inner = levelsByGroup.get(gid);
    if (!inner) { inner = new Map(); levelsByGroup.set(gid, inner); }
    inner.set(num(r.AwakeningLevel), r);
  }
  const out = {};
  for (const node of awakNodes) {
    const gid = node.AwakeningLevelGroupID;
    if (!gid) continue;
    const v = num(node.AwakeningApplyTypeValue);
    let match = false;
    if (node.AwakeningApplyType === "AAT_ELEMENTAL" && v === elemIdx)   match = true;
    else if (node.AwakeningApplyType === "AAT_CLASS" && v === classIdx) match = true;
    else if (node.AwakeningApplyType === "AAT_SUBCLASS" && v === subIdx) match = true;
    if (!match) continue;
    const inner = levelsByGroup.get(gid);
    if (!inner) continue;
    const perLevel = {};
    let source = null;
    for (const [lvl, lvlRow] of inner) {
      const dest = zeroStats();
      accumulateGeasBonus(dest, lvlRow, buffs);
      if (!isEmpty(dest)) {
        perLevel[String(lvl)] = dest;
        if (source === null) source = lvlRow.OptionType === "IOT_BUFF" ? "buff" : "stat";
      }
    }
    if (Object.keys(perLevel).length > 0) out[node.ID] = { source: source ?? "stat", levels: perLevel };
  }
  return out;
}

/** Build the per-char ingredient bundles + the global codex curve. */
export function computeCharacterIngredients(tables) {
  const {
    characterTemplet,
    evoStats,
    archiveStats,
    transcendent,
    skillLevels,
    buffs,
    awakLevels,
    awakNodes,
    fusionTemplet,
  } = tables;

  const codexByLevel = extractCodexCurve(archiveStats); // global

  const characters = {};
  for (const row of characterTemplet) {
    if (row.Type !== "CT_PC") continue;
    const id = row.ID;
    const fusionRow = fusionTemplet.find((r) => r.ChangeCharID === id);
    const evoCharId = fusionRow?.CharacterID ?? id;
    const basicStar = num(row.BasicStar);
    const base = extractBase(row);
    const evoByLevel = extractEvoByLevel(evoStats, evoCharId);
    // baseForRate is used by OAT_RATE buffs for SPD/EFF/RES — computed against
    // base + max evolution (sum of all rows). When the user is below max trans
    // some of the rate-based buffs will be slightly off; acceptable for now.
    const evoMax = zeroStats();
    for (const k of Object.keys(evoByLevel)) for (const f of Object.keys(evoMax)) evoMax[f] += evoByLevel[k][f];
    // OAT_RATE buffs on SPD/EFF/RES resolve against (lv100 max + max evo); we
    // ignore lv > 100 scaling here since rate buffs round to int and re-emit-
    // ting per (level, LB step) would explode the ingredient size.
    const baseForRate = { spd: base.spd.max + evoMax.spd, eff: base.eff.max + evoMax.eff, res: base.res.max + evoMax.res };
    const transcendByStar = extractTranscendByStar(transcendent, basicStar, id);
    const classPassive = extractClassPassive(row, skillLevels, buffs, baseForRate);
    const skill8ByLevel = extractSkill8ByLevel(row, skillLevels, buffs, transcendByStar, baseForRate);
    const geasByNode = extractGeasByNode(row, awakNodes, awakLevels, buffs);
    characters[id] = { base, evoByLevel, transcendByStar, classPassive, skill8ByLevel, geasByNode };
  }
  return { codexByLevel, characters };
}
