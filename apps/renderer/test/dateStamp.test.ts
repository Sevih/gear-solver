import { afterEach, describe, expect, it } from "vitest";
import { localDateStamp } from "../src/lib/dateStamp.js";

// Node re-reads TZ on assignment: each case pins the zone, then restores it.
const savedTz = process.env.TZ;
afterEach(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

describe("localDateStamp — the local day, not the UTC one", () => {
  it("00:30 in Paris is still that day (UTC is the day before)", () => {
    process.env.TZ = "Europe/Paris";
    const ms = new Date(2026, 9, 30, 0, 30).getTime();
    expect(new Date(ms).toISOString().slice(0, 10)).toBe("2026-10-29");
    expect(localDateStamp(ms)).toBe("2026-10-30");
  });

  it("23:30 in Los Angeles is still that day (UTC is the day after)", () => {
    process.env.TZ = "America/Los_Angeles";
    const ms = new Date(2026, 0, 5, 23, 30).getTime();
    expect(localDateStamp(ms)).toBe("2026-01-05");
  });
});
