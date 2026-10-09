import { describe, expect, it } from "vitest";
import { readManualFiles, type PickedFile } from "../src/data.js";

const file = (name: string, body: string): PickedFile => ({ name, text: async () => body });

describe("readManualFiles — manual capture import", () => {
  it("sorts user_item and user_character by their top-level list", async () => {
    const r = await readManualFiles([
      file("user_character.json", JSON.stringify({ CharList: [] })),
      file("user_item.json", JSON.stringify({ ItemList: [] })),
    ]);
    expect(r.error).toBeNull();
    expect(r.userItem).toEqual({ ItemList: [] });
    expect(r.userChar).toEqual({ CharList: [] });
  });

  it("reports an invalid JSON file instead of rejecting", async () => {
    const r = await readManualFiles([file("broken.json", "{ not json")]);
    expect(r.userItem).toBeNull();
    expect(r.error).toMatch(/^broken\.json: /);
  });

  it("ignores JSON that is not an object (null, numbers) instead of throwing", async () => {
    const r = await readManualFiles([file("null.json", "null"), file("n.json", "42")]);
    expect(r).toEqual({ userItem: null, userChar: undefined, error: null });
  });
});
