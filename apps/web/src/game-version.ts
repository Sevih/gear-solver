/**
 * Fetch the current Outerplane resource version from the outerpedia-v2 repo
 * on GitHub. The site's build pipeline writes this file every time it
 * detects a new APK, so it's the freshest cross-platform source of truth
 * for "what version of the game is live right now" — useful for the user
 * to know whether their installed app needs a `data:build` refresh.
 *
 * Cached for 10 min in-process to avoid hammering the GitHub raw endpoint
 * on every focus / reload (browser HTTP cache complements this).
 */
const RAW_URL = "https://raw.githubusercontent.com/Sevih/outerpediaV2/main/data/generated/game-version.json";

interface GameVersionPayload {
  resVersion: string;
}

let cached: { resVersion: string; at: number } | null = null;
const TTL_MS = 10 * 60 * 1000;

export async function getGameVersion(): Promise<string | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.resVersion;
  try {
    const r = await fetch(RAW_URL, { cache: "no-cache" });
    if (!r.ok) return null;
    const data = (await r.json()) as GameVersionPayload;
    cached = { resVersion: data.resVersion, at: Date.now() };
    return data.resVersion;
  } catch {
    return null;
  }
}
