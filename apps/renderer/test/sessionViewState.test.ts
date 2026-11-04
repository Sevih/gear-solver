/**
 * View state kept across a tab switch (sessionStorage): the codecs of
 * `usePersistedState` the screens read it through (`jsonStringSet`,
 * `jsonOneOf`), then the sources of Gear (its views, Pieces / Scrap and
 * Overview) and Presets — each of these states is read by `useSessionState`
 * under its `gs.*` key.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { jsonOneOf, jsonStringSet } from "../src/hooks/usePersistedState.js";

describe("jsonStringSet", () => {
  const codec = jsonStringSet();

  it("round-trips a set of uids as a list", () => {
    const raw = codec.serialize!(new Set(["a", "b"]));
    expect(JSON.parse(raw)).toEqual(["a", "b"]);
    expect(codec.deserialize!(raw)).toEqual(new Set(["a", "b"]));
  });

  it("drops non-string entries and refuses anything but a list", () => {
    expect(codec.deserialize!('["a",1,null,"b"]')).toEqual(new Set(["a", "b"]));
    for (const raw of ["null", '{"a":true}', '"a"']) expect(() => codec.deserialize!(raw)).toThrow();
  });
});

describe("jsonOneOf", () => {
  const codec = jsonOneOf(["overview", "class"] as const);

  it("reads a known value, refuses an unknown one", () => {
    expect(codec.deserialize!('"class"')).toBe("class");
    for (const raw of ['"talismans"', "null", "1"]) expect(() => codec.deserialize!(raw)).toThrow();
  });
});

describe("screens read their view state through useSessionState", () => {
  const source = (p: string) => readFileSync(new URL(`../src/screens/${p}`, import.meta.url), "utf8");

  it.each([
    ["gear/GearScreen.tsx", ["gs.gear.view"]],
    ["inventory/InventoryScreen.tsx", ["gs.inv.selected", "gs.inv.selection", "gs.inv.selectMode", "gs.gear.scrap.filters", "gs.gear.scrap.rule", "gs.gear.scrap.selectMode"]],
    ["presets/PresetsScreen.tsx", ["gs.presets.classFilter", "gs.presets.sort", "gs.presets.forced", "gs.presets.open"]],
    ["gear/OverviewView.tsx", ["gs.gear.breakdownView"]],
  ])("%s", (file, keys) => {
    const src = source(file);
    for (const key of keys) expect(src).toMatch(new RegExp(`useSessionState(<[^(]*>)?\\("${key.replace(/\./g, "\\.")}"`));
  });
});
