import { describe, expect, it } from "vitest";
import { fetchRecoForHero, type RecoFetch } from "../src/lib/reco/fetchReco.js";

const OK: RecoFetch = { status: "ok", reco: { builds: { A: {} } } as never };

/** A fetcher whose answer arrives only when `release()` is called. */
function deferredFetcher() {
  let release!: () => void;
  const fetcher = () => new Promise<RecoFetch>((resolve) => { release = () => resolve(OK); });
  return { fetcher, release: () => release() };
}

describe("Get preset — hero switch during the fetch", () => {
  it("returns the reco when the hero is still selected", async () => {
    const { fetcher, release } = deferredFetcher();
    const p = fetchRecoForHero("A", 1, () => "A", fetcher);
    release();
    expect(await p).toBe(OK);
  });

  it("drops the reco when another hero got selected meanwhile", async () => {
    let current: string | null = "A";
    const { fetcher, release } = deferredFetcher();
    const p = fetchRecoForHero("A", 1, () => current, fetcher);
    current = "B"; // user picks hero B before the reco for A arrives
    release();
    expect(await p).toBeNull();
  });
});
