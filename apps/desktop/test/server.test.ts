import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";

// server.ts pulls Electron in through paths.ts / updater.ts. Under plain Node
// we stub the two modules: `isPackaged: false` puts paths.ts in dev mode, so
// the mounts resolve to the repo trees (data/derived, tools/capture/out).
vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => "", getVersion: () => "0.0.0" } }));
vi.mock("electron-updater", () => ({ default: { autoUpdater: { on: () => {} } } }));

let server: Server;
let base: string;

beforeAll(async () => {
  const { startServer } = await import("../src/server.js");
  const started = await startServer();
  server = started.server;
  base = `http://127.0.0.1:${started.port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

// A truncated escape makes decodeURIComponent throw URIError. Before the fix
// the throw escaped `handle`: no response (the fetch hangs until the timeout)
// and an uncaughtException in the Electron main process.
describe("desktop server — malformed percent-encoding", () => {
  for (const path of ["/gamedata/%E0%A4%A", "/captured/%E0%A4%A", "/captured/%E0%A4%A.json"]) {
    it(`${path} → 400`, async () => {
      const res = await fetch(base + path, { signal: AbortSignal.timeout(2000) });
      expect(res.status).toBe(400);
    });
  }

  it("still serves a well-formed data path", async () => {
    const res = await fetch(`${base}/gamedata/version.json`, { signal: AbortSignal.timeout(2000) });
    expect(res.status).toBe(200);
  });
});
