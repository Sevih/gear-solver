/**
 * `GET /api/game-version` — the Outerplane resource version currently live,
 * read from outerpedia's `game-version.json` (repo-source.ts). Fetched here,
 * server-side, because the renderer can't: the packaged document's CSP is
 * `connect-src 'self'` (server.ts), so a direct GitHub fetch from the renderer
 * is blocked. Shared by the Electron prod server and the Vite dev middleware
 * through api-handler.ts.
 *
 * A success is cached for 10 min in memory so focus / reload storms don't
 * hammer the raw endpoint; a failure isn't, so the next request retries. The
 * answer is always a 200 — `resVersion: null` when the version can't be read —
 * the renderer already renders without it.
 */
import type { ServerResponse } from "node:http";
import { dwarn } from "./log.js";
import { GAME_VERSION_URL } from "./repo-source.js";

export interface GameVersionReply {
  resVersion: string | null;
  /** When the version was fetched (epoch ms), null when it couldn't be. */
  at: number | null;
}

const TTL_MS = 10 * 60 * 1000;

/** One cache per API handler (a test builds its own handler, so its own cache). */
export function createGameVersionRoute(): (res: ServerResponse) => void {
  let cached: { resVersion: string; at: number } | null = null;

  async function read(): Promise<GameVersionReply> {
    if (cached && Date.now() - cached.at < TTL_MS) return cached;
    try {
      const r = await fetch(GAME_VERSION_URL, { cache: "no-cache", signal: AbortSignal.timeout(10_000) });
      if (!r.ok) return { resVersion: null, at: null };
      const data = (await r.json()) as { resVersion?: unknown } | null;
      if (typeof data?.resVersion !== "string") return { resVersion: null, at: null };
      cached = { resVersion: data.resVersion, at: Date.now() };
      return cached;
    } catch (err) {
      dwarn("server", "game version fetch failed:", err instanceof Error ? err.message : String(err));
      return { resVersion: null, at: null };
    }
  }

  return (res) => {
    void read().then((reply) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(reply));
    });
  };
}
