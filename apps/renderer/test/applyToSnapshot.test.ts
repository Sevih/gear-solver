// The Builder's "Apply to snapshot" (formerly "Equip build"): greyed out ahead
// of the click while the game is open — the pure `applyBlockedReason` reads the
// same "plugin live in a running game" signal the server refuses the write on
// (409) — with the reason as the button's title; otherwise enabled, and its
// title says the game itself is never touched. Rendered server-side.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { applyBlockedReason } from "../src/equip.js";
import { EquipBuildButton } from "../src/screens/builder/EquipBuildButton.js";

const button = (blockedReason: string | null, disabled = false) => {
  const html = renderToStaticMarkup(createElement(EquipBuildButton, {
    disabled, blockedReason, moving: 3, steal: 0, heroName: "Ame", onEquip: async () => "ok" as const,
  }));
  return /<button([^>]*)>(.*?)<\/button>/.exec(html)!;
};

describe("applyBlockedReason", () => {
  it("blocks while the plugin is live in a running game", () => {
    expect(applyBlockedReason({ live: true })).toMatch(/game is open/);
  });

  it("lets it run with the game closed, or before the first Steam poll", () => {
    expect(applyBlockedReason({ live: false })).toBeNull();
    expect(applyBlockedReason(null)).toBeNull();
  });
});

describe("EquipBuildButton — Apply to snapshot", () => {
  it("reads Apply to snapshot → hero, enabled, with the local-only title", () => {
    const [, attrs, label] = button(null);
    expect(label).toBe("Apply to snapshot → Ame");
    expect(attrs).not.toContain("disabled");
    expect(attrs).toContain('title="Apply this build to the captured snapshot — the game itself is never touched"');
  });

  it("greyed out ahead of the click with the reason as its title while the game is open", () => {
    const reason = applyBlockedReason({ live: true })!;
    const [, attrs] = button(reason);
    expect(attrs).toContain('disabled=""');
    expect(attrs).toContain(`title="${reason}"`);
    expect(attrs).toContain("cursor-not-allowed");
  });

  it("still disabled when nothing moves, game closed", () => {
    expect(button(null, true)[1]).toContain('disabled=""');
  });
});
