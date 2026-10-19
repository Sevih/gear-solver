import { afterEach, describe, expect, it, vi } from "vitest";
import { clampWorkerCount, resolveWorkerCount } from "../src/lib/solver/orchestrator.js";

/** Stub the two browser globals `resolveWorkerCount` reads. `localStorage` is
 *  a minimal getItem-only shim; pass `throws` to simulate a locked-down
 *  context where access throws. */
function stubEnv(hwc: number | undefined, stored: string | null, throws = false) {
  vi.stubGlobal("navigator", { hardwareConcurrency: hwc });
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => {
      if (throws) throw new Error("denied");
      return k === "gs.solver.workerCount" ? stored : null;
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("resolveWorkerCount", () => {
  it("defaults to hardwareConcurrency - 1 (leave one core for the UI)", () => {
    stubEnv(16, null);
    expect(resolveWorkerCount()).toBe(15);
  });

  it("never returns below 1 on a single-core machine", () => {
    stubEnv(1, null);
    expect(resolveWorkerCount()).toBe(1);
  });

  it("falls back to 4 cores when hardwareConcurrency is unavailable", () => {
    stubEnv(undefined, null);
    expect(resolveWorkerCount()).toBe(3); // (4 || 4) - 1
  });

  it("a valid override wins over the default", () => {
    stubEnv(8, "6");
    expect(resolveWorkerCount()).toBe(6);
    stubEnv(8, "8");
    expect(resolveWorkerCount()).toBe(8);
  });

  it("brings a persisted override above the core count back to the cores", () => {
    stubEnv(8, "20");
    expect(resolveWorkerCount()).toBe(8);
    stubEnv(8, null);
    expect(resolveWorkerCount(20)).toBe(8);
  });

  it("clamps an absurd override to the hard ceiling (64)", () => {
    stubEnv(128, "9999");
    expect(resolveWorkerCount()).toBe(64);
  });

  it("caps the default at the hard ceiling on a huge machine", () => {
    stubEnv(256, null);
    expect(resolveWorkerCount()).toBe(64);
  });

  it("ignores a non-positive / non-numeric override", () => {
    stubEnv(12, "0");
    expect(resolveWorkerCount()).toBe(11);
    stubEnv(12, "abc");
    expect(resolveWorkerCount()).toBe(11);
  });

  it("falls back to the default when localStorage access throws", () => {
    stubEnv(10, "20", true);
    expect(resolveWorkerCount()).toBe(9);
  });
});

describe("clampWorkerCount — the rule shared with the Settings input", () => {
  it("keeps a count within [1, cores]", () => {
    expect(clampWorkerCount(5, 8)).toBe(5);
    expect(clampWorkerCount(0, 8)).toBe(1);
    expect(clampWorkerCount(-3, 8)).toBe(1);
    expect(clampWorkerCount(9, 8)).toBe(8);
  });

  it("never exceeds the hard ceiling, whatever the core count", () => {
    expect(clampWorkerCount(100, 128)).toBe(64);
    expect(clampWorkerCount(64, 128)).toBe(64);
  });

  it("reads hardwareConcurrency when no core count is given (4 when unavailable)", () => {
    stubEnv(6, null);
    expect(clampWorkerCount(12)).toBe(6);
    stubEnv(undefined, null);
    expect(clampWorkerCount(12)).toBe(4);
  });
});
