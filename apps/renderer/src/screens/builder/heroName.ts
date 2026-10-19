/**
 * Builder hero naming — display name and search haystack shared by the hero
 * picker, the exclude-heroes picker and the worklist entry.
 */
import type { Character, GameData } from "@gear-solver/core";

/** Hero display name aligned with the Builds tab: "Nickname Name" when the
 *  character has an in-game shown nickname (e.g. "Mystic Sage Ame"),
 *  "Core Fusion …" prefix when the captured Character was forged from a
 *  fusion, and a `#${charId}` fallback when the data layer didn't resolve
 *  a name at all. */
export function displayNameOf(c: Character, meta: { nickname: string | null } | null): string {
  const base = meta?.nickname ? `${meta.nickname} ${c.name ?? ""}`.trim() : (c.name ?? `#${c.charId}`);
  return c.fusionCharId !== 0 ? `Core Fusion ${base}` : base;
}

/** Hero search haystack — shared between `HeroSelect` and
 *  `ExcludeHeroesPicker`. Same matching the Builds tab uses: display name +
 *  raw name + nickname + charId, plus a "core fusion" tag for fused chars
 *  so the user can find them by typing "core" or "fusion". */
export function heroSearchHaystack(c: Character, game: GameData | null): string {
  const meta = game?.characters[String(c.charId)] ?? null;
  const fusionTag = c.fusionCharId !== 0 ? "core fusion" : "";
  return `${fusionTag} ${displayNameOf(c, meta)} ${meta?.nickname ?? ""} ${c.name ?? ""} ${c.charId}`.toLowerCase();
}
