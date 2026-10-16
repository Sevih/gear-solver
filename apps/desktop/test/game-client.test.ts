import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findOuterpediaCheckout } from "../src/outerpedia-checkout.js";
import { BEPINEX_SHA256, BEPINEX_VERSION, GAME_EXE, OUTERPLANE_APPID } from "../src/steam-capture.js";

// `src/game-client.json` is a committed copy of outerpedia's shared Steam
// client reference, refreshed by `npm run data:sync` (data/sync.mjs).
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const REFERENCE = join("data", "curated", "game-client.json");
const copy = JSON.parse(readFileSync(fileURLToPath(new URL("../src/game-client.json", import.meta.url)), "utf-8"));
const checkout = findOuterpediaCheckout(REPO_ROOT, REFERENCE);

describe("game-client.json", () => {
  // CI has no outerpedia checkout: say so instead of passing silently.
  it.skipIf(!checkout)(`matches outerpedia's ${REFERENCE}${checkout ? "" : " (skipped: no outerpedia checkout found)"}`, () => {
    const reference = JSON.parse(readFileSync(join(checkout!, REFERENCE), "utf-8"));
    expect(copy).toEqual(reference);
  });

  it("feeds steam-capture.ts's exports", () => {
    expect(OUTERPLANE_APPID).toBe(String(copy.steam.appId));
    expect(GAME_EXE).toBe(copy.steam.exe);
    expect(BEPINEX_VERSION).toBe(copy.bepinex.version);
    expect(BEPINEX_SHA256).toBe(copy.bepinex.sha256);
  });
});
