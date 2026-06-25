/**
 * Reco proxy — relays `GET /api/reco/:id` to the outerpedia recommendations
 * API and streams the JSON back. We proxy server-side (rather than letting the
 * renderer fetch outerpedia.com directly) so there's no CORS dependency and the
 * packaged app keeps a single origin. Shared by the Electron prod server
 * (server.ts) and the Vite dev middleware (vite.config.ts).
 */
import type { ServerResponse } from "node:http";

/** Override when pointing at a staging outerpedia or a local dev instance. */
const OUTERPEDIA_API_BASE = process.env.OUTERPEDIA_API_BASE ?? "https://outerpedia.com";

export async function proxyReco(id: string, res: ServerResponse): Promise<void> {
  res.setHeader("Content-Type", "application/json");
  // The id is a numeric CharacterTemplet.ID — reject anything else so it can't
  // be interpolated into the upstream URL as a path segment / query.
  if (!/^\d+$/.test(id)) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "bad reco id" }));
    return;
  }
  try {
    const upstream = await fetch(`${OUTERPEDIA_API_BASE}/api/reco/${id}`, {
      headers: { accept: "application/json" },
      // Don't let a hung upstream wedge the request forever.
      signal: AbortSignal.timeout(8000),
    });
    // Relay the upstream status verbatim — 404 (no reco for this hero) is a
    // meaningful signal the renderer distinguishes from a transport error.
    res.statusCode = upstream.status;
    res.setHeader("Cache-Control", "public, max-age=300");
    res.end(await upstream.text());
  } catch (err) {
    res.statusCode = 502;
    res.end(JSON.stringify({ error: `reco upstream failed: ${err instanceof Error ? err.message : String(err)}` }));
  }
}
