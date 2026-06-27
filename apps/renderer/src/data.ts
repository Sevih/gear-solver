/**
 * Auto-import: load distilled game data (/gamedata/*) and the latest captured
 * account (/captured/*), both served live by the Vite dev middleware from the
 * repo dirs (data/derived and tools/capture/out). Re-run capture + refresh to
 * pick up a new snapshot.
 */
import {
  parseInventory,
  resolveCodexLevel,
  type GameData,
  type Inventory,
  type RawUserItem,
  type RawUserCharacter,
  type UserGeasLevels,
} from "@gear-solver/core";

/** Shape of the captured `/gift/info` payload — account-wide list of unlocked
 *  Geas nodes with their per-node level. `GiftID` matches `NodeID` in
 *  `CharacterAwakeningNodeTemplet`. */
interface RawUserGift {
  GiftList?: Array<{ GiftID: number; Level: number }>;
}

/** Shape of the captured `/archive/info` payload — codex (Hero Archive) state.
 *  We currently only consume `ArchiveCharacterRewardInfo` to derive the global
 *  codex stat level via `ArchiveBonusTemplet.CompleteCount` thresholds. */
interface RawUserArchive {
  ArchiveCharacterRewardInfo?: Array<{ CharacterID: number; RewardList: number[] }>;
}

async function getJSON<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

/** Stamp written by `data/build.mjs` into `data/derived/version.json`. `hash`
 *  is a content hash of every derived file (stable iff the data is unchanged);
 *  `builtAt` is an ISO timestamp of the LAST derived-data change (the write is
 *  idempotent — a no-op rebuild keeps the prior stamp, so this is the data
 *  vintage, not wall-clock build time). Both surfaced read-only in Settings →
 *  Data so the user can tell which game-data snapshot is loaded. */
export interface DataVersion {
  hash: string;
  builtAt: string;
}

/** Fetch the derived-data version stamp. Null when absent (data built before
 *  the stamp existed, or no build yet) or malformed — callers degrade to "—". */
export async function loadDataVersion(): Promise<DataVersion | null> {
  const v = await getJSON<Partial<DataVersion>>("/gamedata/version.json");
  return v && typeof v.hash === "string" && typeof v.builtAt === "string"
    ? { hash: v.hash, builtAt: v.builtAt }
    : null;
}

export async function loadGameData(): Promise<GameData | null> {
  const [options, equipment, sets, equipmentPassives, multiTierPassives, gems, singularityOptions, eePassives, characters, enhance, buffs, expCharacter, charLevelMax, codexCurve, archiveBonus, trustCharacter, trustBuffs, subTicks] = await Promise.all([
    getJSON<GameData["options"]>("/gamedata/options.json"),
    getJSON<GameData["equipment"]>("/gamedata/equipment.json"),
    getJSON<GameData["sets"]>("/gamedata/sets.json"),
    getJSON<GameData["equipmentPassives"]>("/gamedata/equipment-passives.json"),
    getJSON<GameData["multiTierPassives"]>("/gamedata/multi-tier-passives.json"),
    getJSON<GameData["gems"]>("/gamedata/gems.json"),
    getJSON<GameData["singularityOptions"]>("/gamedata/singularity-options.json"),
    getJSON<GameData["eePassives"]>("/gamedata/ee-passives.json"),
    getJSON<GameData["characters"]>("/gamedata/characters.json"),
    getJSON<GameData["enhance"]>("/gamedata/enhance.json"),
    getJSON<GameData["buffs"]>("/gamedata/buffs.json"),
    getJSON<GameData["expCharacter"]>("/gamedata/exp-character.json"),
    getJSON<GameData["charLevelMax"]>("/gamedata/char-level-max.json"),
    getJSON<GameData["codexCurve"]>("/gamedata/codex-curve.json"),
    getJSON<GameData["archiveBonus"]>("/gamedata/archive-bonus.json"),
    getJSON<GameData["trustCharacter"]>("/gamedata/trust-character.json"),
    getJSON<GameData["trustBuffs"]>("/gamedata/trust-buffs.json"),
    getJSON<GameData["subTicks"]>("/gamedata/sub-ticks.json"),
  ]);
  if (!options || !equipment || !sets || !equipmentPassives || !multiTierPassives || !gems || !singularityOptions || !eePassives || !characters || !enhance || !buffs || !expCharacter || !charLevelMax || !codexCurve || !archiveBonus || !trustCharacter || !trustBuffs) return null;
  // subTicks is optional — only powers the flat-vs-% info panel; default to {}
  // so a stale cache built before the table existed doesn't fail the load.
  return { options, equipment, sets, equipmentPassives, multiTierPassives, gems, singularityOptions, eePassives, characters, enhance, buffs, expCharacter, charLevelMax, codexCurve, archiveBonus, trustCharacter, trustBuffs, subTicks: subTicks ?? {} };
}

export interface LoadResult {
  game: GameData | null;
  inventory: Inventory | null;
  /** Account-wide Geas node levels — null when `/captured/user_gift.json` is
   *  absent (composer then falls back to per-node max). */
  userGeasLevels: UserGeasLevels | null;
  /** Resolved codex level 0..11 from the captured `/archive/info` reward
   *  count. Null when capture or archive curve is missing (composer falls
   *  back to its own default, currently max). */
  userCodexLevel: number | null;
  source: "auto" | "none";
}

/** Try to auto-load everything. Returns nulls if the captured files aren't present. */
export async function autoImport(): Promise<LoadResult> {
  const [game, userItem, userChar, userGift, userArchive] = await Promise.all([
    loadGameData(),
    getJSON<RawUserItem>("/captured/user_item.json"),
    getJSON<RawUserCharacter>("/captured/user_character.json"),
    getJSON<RawUserGift>("/captured/user_gift.json"),
    getJSON<RawUserArchive>("/captured/user_archive.json"),
  ]);
  const userGeasLevels = toUserGeasLevels(userGift);
  const userCodexLevel = toUserCodexLevel(userArchive, game);
  if (!userItem) return { game, inventory: null, userGeasLevels, userCodexLevel, source: "none" };
  return {
    game,
    inventory: parseInventory(userItem, userChar ?? undefined, game ?? undefined),
    userGeasLevels,
    userCodexLevel,
    source: "auto",
  };
}

function toUserGeasLevels(raw: RawUserGift | null): UserGeasLevels | null {
  if (!raw?.GiftList) return null;
  const out: UserGeasLevels = {};
  for (const g of raw.GiftList) out[String(g.GiftID)] = g.Level;
  return out;
}

/** Sum every reward milestone the user has unlocked across all characters,
 *  then look up the matching codex level via `ArchiveBonusTemplet`. The
 *  in-game codex tab shows one global level driven by this exact count. */
function toUserCodexLevel(raw: RawUserArchive | null, game: GameData | null): number | null {
  if (!raw?.ArchiveCharacterRewardInfo || !game?.archiveBonus) return null;
  let total = 0;
  for (const c of raw.ArchiveCharacterRewardInfo) {
    for (const v of c.RewardList) total += v;
  }
  return resolveCodexLevel(game.archiveBonus, total);
}

/** Manual fallback: parse user-provided files with the (already loaded) game data. */
export function parseFiles(
  game: GameData | null,
  userItem: RawUserItem,
  userChar?: RawUserCharacter,
): Inventory {
  return parseInventory(userItem, userChar, game ?? undefined);
}
