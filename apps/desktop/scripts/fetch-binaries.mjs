#!/usr/bin/env node
/**
 * One-shot provisioner for the build-time binaries of the packaged Electron
 * app. Run before `npm run pack` / `npm run dist`.
 *
 *   capture-steam (GearSolverCapture.dll) — the BepInEx plugin for the Steam
 *               client, built from tools/capture-steam with the .NET SDK
 *               (needs the game installed: it compiles against its Unity
 *               assemblies). Copied to resources/capture-steam/ and bundled
 *               as `<resources>/capture-steam` (BepInEx itself is downloaded
 *               at install time by steam-capture.ts, not bundled).
 *   build/icon.ico — the installer / window icon, see provisionWindowsIcon().
 *
 * Needs the .NET SDK (`dotnet.exe`) and the game installed.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findOuterpediaCheckout } from "../../../scripts/outerpedia-checkout.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const RESOURCES = join(here, "..", "resources");
const REPO = join(here, "..", "..", "..");

/** Build the Steam capture plugin and stage its DLL for extraResources. Always
 *  rebuilds (2 s) so a plugin source change can't ship stale. */
function provisionSteamPlugin() {
  const proj = join(REPO, "tools", "capture-steam");
  console.log(`[dotnet] build ${proj}`);
  // Run from the project dir instead of passing its path: the repo lives under
  // a folder with a space ("Projet perso") and `shell: true` would split it.
  const r = spawnSync("dotnet.exe", ["build", "-c", "Release", "--nologo", "-v", "q"], { stdio: "inherit", cwd: proj, windowsHide: true });
  if (r.status !== 0) throw new Error("dotnet build of tools/capture-steam failed (is the .NET SDK installed and the game present?)");
  const dll = join(proj, "dist", "GearSolverCapture.dll");
  if (!existsSync(dll)) throw new Error(`plugin DLL not produced: ${dll}`);
  const dest = join(RESOURCES, "capture-steam");
  mkdirSync(dest, { recursive: true });
  copyFileSync(dll, join(dest, "GearSolverCapture.dll"));
  console.log(`[ok] capture-steam plugin -> ${dest}`);
}

/** Wrap a PNG as a single-image Windows ICO container. electron-builder
 *  needs build/icon.ico to be >= 256x256 square; the site's favicon.ico
 *  is 189x256 (the tall-logo favicon) so we regenerate from the square
 *  512x512 PNG asset of the outerpedia checkout (OUTERPEDIA_PATH env →
 *  .env.local → sibling ../outerpedia, see scripts/outerpedia-checkout.mjs). Inline because
 *  ImageMagick isn't on the dev's PATH and the format is trivial: 6-byte
 *  header + 16-byte directory entry + the raw PNG payload. */
function provisionWindowsIcon() {
  const iconRel = join("public", "icons", "icon-512x512.png");
  const checkout = findOuterpediaCheckout(REPO, iconRel);
  const srcPng = checkout ? join(checkout, iconRel) : null;
  const buildDir = join(here, "..", "build");
  const outIco = join(buildDir, "icon.ico");
  if (!srcPng) {
    console.warn(`[warn] no outerpedia checkout with ${iconRel} (set OUTERPEDIA_PATH?) - skipping .ico generation`);
    return;
  }
  mkdirSync(buildDir, { recursive: true });
  const png = readFileSync(srcPng);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  // ICO width/height fields are 1 byte each; 256+ is encoded as 0.
  const w = width >= 256 ? 0 : width;
  const h = height >= 256 ? 0 : height;
  const dataOffset = 6 + 16; // 6-byte header + 1 dir entry
  const out = Buffer.alloc(dataOffset + png.length);
  out.writeUInt16LE(0, 0);                  // Reserved
  out.writeUInt16LE(1, 2);                  // Type (1 = icon)
  out.writeUInt16LE(1, 4);                  // Image count
  out.writeUInt8(w, 6);                     // Width
  out.writeUInt8(h, 7);                     // Height
  out.writeUInt8(0, 8);                     // Palette (0 for non-indexed)
  out.writeUInt8(0, 9);                     // Reserved
  out.writeUInt16LE(1, 10);                 // Color planes
  out.writeUInt16LE(32, 12);                // Bits per pixel
  out.writeUInt32LE(png.length, 14);        // Payload size
  out.writeUInt32LE(dataOffset, 18);        // Payload offset
  png.copy(out, dataOffset);
  writeFileSync(outIco, out);
  console.log(`[ok] windows icon ${width}x${height} -> ${outIco}`);
}

provisionSteamPlugin();
provisionWindowsIcon();
console.log(`[done] plugin + icon provisioned under ${RESOURCES} and build/`);
