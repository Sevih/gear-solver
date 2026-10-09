import { afterEach, describe, expect, it, vi } from "vitest";
import { getGameVersion } from "../src/game-version.js";

afterEach(() => vi.unstubAllGlobals());

describe("game version — source", () => {
  it("reads game-version.json from the live outerpedia repo", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ resVersion: "1.11.404" })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getGameVersion()).toBe("1.11.404");
    // outerpediaV2 is archived: it still answers 200, frozen on an old version.
    expect(fetchMock).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/Sevih/outerpedia/main/data/generated/game-version.json",
      expect.anything(),
    );
  });
});
