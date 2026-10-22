import { describe, expect, it } from "vitest";
import { assertPluginVersion } from "../scripts/fetch-binaries.mjs";

const pluginCs = (v: string) => `public sealed class Plugin\n{\n    public const string Version = "${v}";\n}\n`;
const csproj = (v: string) => `<Project>\n  <PropertyGroup>\n    <Version>${v}</Version>\n  </PropertyGroup>\n</Project>\n`;
// Plugin.Version sits in the DLL as a UTF-16LE constant; padding around it stands for the rest of the PE.
const dll = (...chunks: Buffer[]) => Buffer.concat([Buffer.alloc(64), ...chunks, Buffer.alloc(64)]);

describe("assertPluginVersion (release guard on the bundled capture plugin)", () => {
  it("returns the version when Plugin.cs, the .csproj and the DLL agree", () => {
    expect(assertPluginVersion({ pluginCs: pluginCs("0.2.0"), csproj: csproj("0.2.0"), dllBytes: dll(Buffer.from("0.2.0", "utf16le")) })).toBe("0.2.0");
  });

  it("throws with the three values when Plugin.Version and the .csproj differ", () => {
    expect(() =>
      assertPluginVersion({ pluginCs: pluginCs("0.2.0"), csproj: csproj("0.1.0"), dllBytes: dll(Buffer.from("0.2.0", "utf16le")) }),
    ).toThrow("Plugin.Version=0.2.0, .csproj <Version>=0.1.0, DLL contains 0.2.0");
  });

  it("throws when the DLL does not carry the version (stale build)", () => {
    expect(() =>
      assertPluginVersion({ pluginCs: pluginCs("0.2.0"), csproj: csproj("0.2.0"), dllBytes: dll(Buffer.from("0.1.0", "utf16le")) }),
    ).toThrow("DLL does not contain 0.2.0");
    // The UTF-8 copy alone comes from the .csproj attributes, not from Plugin.Version.
    expect(() =>
      assertPluginVersion({ pluginCs: pluginCs("0.2.0"), csproj: csproj("0.2.0"), dllBytes: dll(Buffer.from("0.2.0", "utf-8")) }),
    ).toThrow(/does not contain/);
  });

  it("throws when Plugin.Version cannot be read", () => {
    expect(() => assertPluginVersion({ pluginCs: "class Plugin {}", csproj: csproj("0.2.0"), dllBytes: dll() })).toThrow(
      "Plugin.Version=(not found)",
    );
  });
});
