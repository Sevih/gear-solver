import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveInside } from "../src/safe-path.js";

const base = join(sep, "srv", "data");

describe("resolveInside", () => {
  it("resolves paths under the base", () => {
    expect(resolveInside(base, "a/b.json")).toBe(join(base, "a", "b.json"));
    expect(resolveInside(base, "/index.html")).toBe(join(base, "index.html"));
    expect(resolveInside(base, "a/../b.json")).toBe(join(base, "b.json"));
    expect(resolveInside(base, "..file.json")).toBe(join(base, "..file.json"));
  });

  it("rejects an escape into a sibling whose name starts with the base's", () => {
    expect(resolveInside(base, "../data2/secret.json")).toBeNull();
    expect(resolveInside(base, "../data-old/secret.json")).toBeNull();
  });

  it("rejects plain parent escapes", () => {
    expect(resolveInside(base, "..")).toBeNull();
    expect(resolveInside(base, "../../etc/passwd")).toBeNull();
  });
});
