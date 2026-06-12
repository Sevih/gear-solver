/**
 * Auto-import: load distilled game data (/gamedata/*) and the latest captured
 * account (/captured/*), both served live by the Vite dev middleware from the
 * repo dirs (data/derived and tools/capture/out). Re-run capture + refresh to
 * pick up a new snapshot.
 */
import {
  parseInventory,
  type GameData,
  type Inventory,
  type RawUserItem,
  type RawUserCharacter,
} from "@gear-solver/core";

async function getJSON<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export async function loadGameData(): Promise<GameData | null> {
  const [options, equipment, sets, characters] = await Promise.all([
    getJSON<GameData["options"]>("/gamedata/options.json"),
    getJSON<GameData["equipment"]>("/gamedata/equipment.json"),
    getJSON<GameData["sets"]>("/gamedata/sets.json"),
    getJSON<GameData["characters"]>("/gamedata/characters.json"),
  ]);
  if (!options || !equipment || !sets || !characters) return null;
  return { options, equipment, sets, characters };
}

export interface LoadResult {
  game: GameData | null;
  inventory: Inventory | null;
  source: "auto" | "none";
}

/** Try to auto-load everything. Returns nulls if the captured files aren't present. */
export async function autoImport(): Promise<LoadResult> {
  const [game, userItem, userChar] = await Promise.all([
    loadGameData(),
    getJSON<RawUserItem>("/captured/user_item.json"),
    getJSON<RawUserCharacter>("/captured/user_character.json"),
  ]);
  if (!userItem) return { game, inventory: null, source: "none" };
  return { game, inventory: parseInventory(userItem, userChar ?? undefined, game ?? undefined), source: "auto" };
}

/** Manual fallback: parse user-provided files with the (already loaded) game data. */
export function parseFiles(
  game: GameData | null,
  userItem: RawUserItem,
  userChar?: RawUserCharacter,
): Inventory {
  return parseInventory(userItem, userChar, game ?? undefined);
}
