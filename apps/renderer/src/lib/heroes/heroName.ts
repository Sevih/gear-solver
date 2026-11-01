/**
 * Hero naming — display name and search haystack shared by every hero list:
 * the `HeroPicker` (Builder, Options, Presets), the Builds roster search and
 * the worklist entry.
 */
import type { Character, GameData } from "@gear-solver/core";
import { effectiveCharacter } from "@gear-solver/core";

/** Hero display name aligned with the Builds tab: "Nickname Name" when the
 *  character has an in-game shown nickname (e.g. "Mystic Sage Ame"),
 *  "Core Fusion …" prefix when the captured Character was forged from a
 *  fusion, and a `#${charId}` fallback when the data layer didn't resolve
 *  a name at all. */
export function displayNameOf(c: Character, meta: { nickname: string | null } | null): string {
  const base = meta?.nickname ? `${meta.nickname} ${c.name ?? ""}`.trim() : (c.name ?? `#${c.charId}`);
  return c.fusionCharId !== 0 ? `Core Fusion ${base}` : base;
}

/** Hero search haystack — the one matching of every hero search (picker and
 *  Builds roster). Reads the sheet the name is displayed from
 *  (`effectiveCharacter`), so a fused hero is found under its displayed name,
 *  and also under its base sheet's nickname, its raw name and both charIds;
 *  plus a "core fusion" tag for fused chars so the user can find them by
 *  typing "core" or "fusion". Lower-cased: match it against a lower-cased
 *  query. */
export function heroSearchHaystack(c: Character, game: GameData | null): string {
  const shown = effectiveCharacter(c, game?.characters).def;
  const base = game?.characters[String(c.charId)] ?? null;
  const fused = c.fusionCharId !== 0;
  const fusionTag = fused ? "core fusion" : "";
  const nicknames = [...new Set([shown?.nickname, base?.nickname].filter((n): n is string => !!n))].join(" ");
  const ids = fused ? `${c.charId} ${c.fusionCharId}` : `${c.charId}`;
  return `${fusionTag} ${displayNameOf(c, shown)} ${nicknames} ${c.name ?? ""} ${ids}`.toLowerCase();
}

/** True when `c` matches the search `query` (trimmed, case-insensitive); an
 *  empty query matches every hero. */
export function heroMatches(c: Character, game: GameData | null, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || heroSearchHaystack(c, game).includes(q);
}
