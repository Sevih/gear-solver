import { describe, expect, it } from "vitest";
import { createOnboardingGate } from "../src/lib/onboarding.js";

/** Replays App's wiring: the persisted flag + the two callbacks it hands the
 *  Settings modal. */
function session(initialDone: boolean) {
  const gate = createOnboardingGate();
  let done = initialDone;
  return {
    get done() { return done; },
    onReady() { if (gate.acceptsReady()) done = true; },
    onResetOnboarding() { gate.reset(); done = false; },
  };
}

describe("onboarding gate", () => {
  it("a ready probe marks onboarding done on a fresh install", () => {
    const s = session(false);
    s.onReady();
    expect(s.done).toBe(true);
  });

  it("reset survives reopening Settings (a new ready probe) in the same session", () => {
    const s = session(true);
    s.onResetOnboarding();
    s.onReady(); // modal reopened → Setup tab → probe → ready
    expect(s.done).toBe(false);
  });

  it("after a relaunch the next ready probe marks it done again", () => {
    const relaunched = session(false);
    relaunched.onReady();
    expect(relaunched.done).toBe(true);
  });
});
