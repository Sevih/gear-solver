/**
 * Shapes of the distilled game-data tables (data/derived/*.json, produced by
 * data/build.mjs). The app loads these and hands them to the parser.
 */

/** ItemOptionTemplet entry: stat type, applying type, per-tick raw value. */
export interface OptionDef {
  st: string; // ST_ATK, ST_CRITICAL_RATE, ...
  ap: string; // OAT_ADD | OAT_RATE
  v: number;  // raw per-tick value
}
export type OptionsTable = Record<string, OptionDef>;

export interface EquipmentDef {
  slot: string;
  grade: string | null;
  classLimit: string | null;
  setId: string | null;
  name: string | null;
  mainGroup: string | null;
  subGroup: string | null;
}
export type EquipmentTable = Record<string, EquipmentDef>;

export interface SetEffect {
  st: string;
  ap: string;
  v: number;
}
export interface SetLevel {
  level: number;
  p2: SetEffect | null;
  p4: SetEffect | null;
}
export interface SetDef {
  name: string | null;
  levels: SetLevel[];
}
export type SetsTable = Record<string, SetDef>;

export interface CharacterDef {
  name: string | null;
  cls: string | null;
  element: string | null;
  star: number | null;
  recommendSetId: string | null;
}
export type CharactersTable = Record<string, CharacterDef>;

/** Everything the parser/solver may need from static game data. */
export interface GameData {
  options: OptionsTable;
  equipment: EquipmentTable;
  sets: SetsTable;
  characters: CharactersTable;
}
