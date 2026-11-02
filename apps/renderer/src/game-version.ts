/**
 * The current Outerplane resource version, as published by outerpedia's
 * `game-version.json` (its build pipeline rewrites it on every new APK) — the
 * freshest cross-platform answer to "what version of the game is live right
 * now", shown in the header subtitle.
 *
 * Read through the local server's `GET /api/game-version`
 * (apps/desktop/src/game-version.ts), never from GitHub directly: the packaged
 * document's CSP is `connect-src 'self'`, which blocks any cross-origin fetch.
 *
 * Cached for 10 min in-process so focus / reload doesn't ask the server every
 * time (the server keeps its own 10 min cache of the upstream file).
 */
interface GameVersionPayload {
  resVersion: string | null;
}

let cached: { resVersion: string; at: number } | null = null;
const TTL_MS = 10 * 60 * 1000;

export async function getGameVersion(): Promise<string | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.resVersion;
  try {
    const r = await fetch("/api/game-version", { cache: "no-cache" });
    if (!r.ok) return null;
    const data = (await r.json()) as GameVersionPayload;
    if (typeof data.resVersion !== "string") return null;
    cached = { resVersion: data.resVersion, at: Date.now() };
    return data.resVersion;
  } catch {
    return null;
  }
}
