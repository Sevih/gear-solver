/**
 * Distill the raw Outerplane game tables (data/game/*.json) into the compact
 * lookup tables the engine consumes (data/derived/*.json).
 *
 * Run: node data/build.mjs   (or: npm run data:build)
 *
 * Keeps the engine input small and decoupled from the ~12 MB raw dumps. Re-run
 * after refreshing data/game/ from Outerpedia (see data/sync.ps1).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const GAME = join(here, "game");
const DERIVED = join(here, "derived");
mkdirSync(DERIVED, { recursive: true });

const load = (n) => JSON.parse(readFileSync(join(GAME, n), "utf-8"));
const save = (n, o) => writeFileSync(join(DERIVED, n), JSON.stringify(o));
const lang = "English";

// ---- text lookups (NameID -> localized name) ----
const textItem = new Map(load("TextItem.json").map((t) => [t.ID, t[lang]]));
const textChar = new Map(load("TextCharacter.json").map((t) => [t.ID, t[lang]]));

// ---- options: optionId -> { st, ap, v } (game-faithful; core applies divisor) ----
const options = {};
for (const o of load("ItemOptionTemplet.json")) {
  if (o.OptionType !== "IOT_STAT") continue;
  options[o.ID] = { st: o.StatType, ap: o.ApplyingType, v: Number(o.OptionValue) };
}
save("options.json", options);

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
const equipment = {};
for (const it of load("ItemTemplet.json")) {
  const slot = SLOT[it.ItemSubType];
  if (!slot) continue; // gear only
  equipment[it.ID] = {
    slot,
    grade: GRADE[it.ItemGrade] ?? null,
    classLimit: it.ClassLimit === "CCT_NONE" ? null : it.ClassLimit,
    setId: it.UniqueOptionID && it.UniqueOptionID !== "0" ? it.UniqueOptionID : null,
    name: textItem.get(it.NameID) ?? null,
    mainGroup: it.MainOptionGroupID ?? null,
    subGroup: it.SubOptionGroupID ?? null,
  };
}
save("equipment.json", equipment);

// ---- sets: groupId -> { name, levels:[{level, p2, p4}] } ----
const sets = {};
for (const s of load("ItemSpecialOptionTemplet.json")) {
  const g = (sets[s.GroupID] ??= { name: textItem.get(s.NameID) ?? null, levels: [] });
  g.levels.push({
    level: Number(s.Level),
    p2: s.StatType_2P ? { st: s.StatType_2P, ap: s.ApplyingType_2P, v: Number(s.OptionValue_2P) } : null,
    p4: s.StatType_4P ? { st: s.StatType_4P, ap: s.ApplyingType_4P, v: Number(s.OptionValue_4P) } : null,
  });
}
save("sets.json", sets);

// ---- characters: charId -> { name, cls, element, star, recommendSetId } ----
const characters = {};
for (const c of load("CharacterTemplet.json")) {
  if (c.Type !== "CT_PC") continue;
  characters[c.ID] = {
    name: textChar.get(c.NameID) ?? null,
    cls: c.Class ?? null,
    element: c.Element ?? null,
    star: Number(c.BasicStar) || null,
    recommendSetId: c.RecommandSetOptionID && c.RecommandSetOptionID !== "0" ? c.RecommandSetOptionID : null,
  };
}
save("characters.json", characters);

console.log(
  `derived: options=${Object.keys(options).length} equipment=${Object.keys(equipment).length} ` +
    `sets=${Object.keys(sets).length} characters=${Object.keys(characters).length}`,
);
