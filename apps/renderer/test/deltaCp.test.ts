import { describe, expect, it } from "vitest";
import { deltaCpLabel } from "../src/lib/deltaCp.js";

describe("deltaCpLabel — the ΔCP headline says its base", () => {
  it("reforge off: bare ΔCP, no tooltip (both sides as captured)", () => {
    expect(deltaCpLabel(1234, "disable", "Off")).toEqual({ text: `ΔCP +${(1234).toLocaleString()}`, title: null });
    expect(deltaCpLabel(-56.4, "disable", "Off").text).toBe("ΔCP -56");
    expect(deltaCpLabel(0, "disable", "Off").text).toBe("ΔCP 0");
  });

  it("reforge on: names the projected mode against the equipped gear as it is", () => {
    expect(deltaCpLabel(1234, "classic", "+10R6")).toEqual({
      text: `ΔCP +${(1234).toLocaleString()} vs equipped (build at +10R6)`,
      title: "The build is projected to +10R6; your equipped gear is counted as it is now.",
    });
    expect(deltaCpLabel(-12, "ascended", "+15R9").text).toBe("ΔCP -12 vs equipped (build at +15R9)");
  });
});
