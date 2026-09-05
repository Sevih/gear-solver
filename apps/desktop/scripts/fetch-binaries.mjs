#!/usr/bin/env node
/**
 * One-shot provisioner for the build-time binaries of the packaged Electron
 * app. Run before `npm run pack` / `npm run dist`, and any time you want a
 * fresher mitmproxy or platform-tools release.
 *
 *   mitmproxy   (mitmdump.exe only) — BUILD-TIME ONLY: it generates the
 *               dedicated prod CA below but is NOT bundled in the installer.
 *               AV heuristics flag the mitmproxy binaries (PUA), so the
 *               packaged app downloads its own checksum-verified copy on
 *               first capture instead — see src/mitm-provision.ts and keep
 *               MITMPROXY_VERSION / MITMPROXY_SHA256 in sync with it.
 *   platform-tools (adb.exe + AdbWinApi / AdbWinUsbApi DLLs)
 *               from Google's always-latest pointer URL; we keep only the
 *               three files we actually need.
 *   capture-steam (GearSolverCapture.dll) — the BepInEx plugin for the Steam
 *               client, built from tools/capture-steam with the .NET SDK
 *               (needs the game installed: it compiles against its Unity
 *               assemblies). Copied to resources/capture-steam/ and bundled
 *               as `<resources>/capture-steam` (BepInEx itself is downloaded
 *               at install time by steam-capture.ts, not bundled).
 *
 * Output: apps/desktop/resources/bin/{mitmproxy,adb}/ (gitignored). The
 * electron-builder extraResources mapping copies only the adb tree to
 * `<resources>/bin/adb` in the packaged build.
 *
 * Windows-only (we shell out to PowerShell's Expand-Archive). The Electron
 * tool ships Windows-only anyway — the capture pipeline depends on LDPlayer
 * / MuMu / NoxPlayer, all Windows.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BIN = join(here, "..", "resources", "bin");
const RESOURCES = join(here, "..", "resources");
const REPO = join(here, "..", "..", "..");

// Keep both pins in sync with src/mitm-provision.ts (runtime download).
const MITMPROXY_VERSION = "12.1.2";
const MITMPROXY_SHA256 = "81c268b4d4965899f59043201bd0707075c5b820310be382b2fd41c554f370a2";
const MITMPROXY_URL = `https://downloads.mitmproxy.org/${MITMPROXY_VERSION}/mitmproxy-${MITMPROXY_VERSION}-windows-x86_64.zip`;
const PLATFORM_TOOLS_URL = "https://dl.google.com/android/repository/platform-tools-latest-windows.zip";

async function download(url, out) {
  console.log(`[fetch] ${url}`);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download failed: ${url} -> HTTP ${r.status}`);
  const stream = createWriteStream(out);
  const reader = r.body.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    stream.write(value);
  }
  await new Promise((resolve) => stream.end(resolve));
}

function expand(zip, dest) {
  console.log(`[unzip] ${zip} -> ${dest}`);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const r = spawnSync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command",
    `Expand-Archive -Force -Path "${zip}" -DestinationPath "${dest}"`,
  ], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("Expand-Archive failed");
}

async function provisionMitmproxy() {
  const dest = join(BIN, "mitmproxy");
  if (existsSync(join(dest, "mitmdump.exe"))) {
    console.log("[ok] mitmproxy already present, skipping (delete the folder to refresh)");
    return;
  }
  const tmp = join(tmpdir(), `mitmproxy-${Date.now()}.zip`);
  await download(MITMPROXY_URL, tmp);
  const got = createHash("sha256").update(readFileSync(tmp)).digest("hex");
  if (got !== MITMPROXY_SHA256) {
    rmSync(tmp, { force: true });
    throw new Error(`mitmproxy zip checksum mismatch (got ${got}, expected ${MITMPROXY_SHA256}) — update both pins if the release moved`);
  }
  expand(tmp, dest);
  rmSync(tmp, { force: true });
  // Only mitmdump.exe is used (prod CA generation); the siblings are the AV
  // bait we no longer want anywhere near the packaging pipeline.
  for (const f of ["mitmproxy.exe", "mitmweb.exe"]) rmSync(join(dest, f), { force: true });
  console.log(`[ok] mitmproxy ${MITMPROXY_VERSION} (mitmdump.exe only, checksum OK) -> ${dest}`);
}

async function provisionPlatformTools() {
  const dest = join(BIN, "adb");
  if (existsSync(join(dest, "adb.exe"))) {
    console.log("[ok] adb already present, skipping (delete the folder to refresh)");
    return;
  }
  const zip = join(tmpdir(), `platform-tools-${Date.now()}.zip`);
  const stage = join(tmpdir(), `platform-tools-stage-${Date.now()}`);
  await download(PLATFORM_TOOLS_URL, zip);
  expand(zip, stage);
  mkdirSync(dest, { recursive: true });
  // platform-tools.zip contains ~200MB of unused tooling (fastboot, sysroot,
  // systrace, …). Keep only the 3 files our PowerShell scripts touch.
  const PT = join(stage, "platform-tools");
  for (const f of ["adb.exe", "AdbWinApi.dll", "AdbWinUsbApi.dll"]) {
    const from = join(PT, f);
    const to = join(dest, f);
    const r = spawnSync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      `Copy-Item -Force "${from}" "${to}"`,
    ], { stdio: "inherit" });
    if (r.status !== 0) throw new Error(`copy ${f} failed`);
  }
  rmSync(stage, { recursive: true, force: true });
  rmSync(zip, { force: true });
  console.log(`[ok] platform-tools (adb + DLLs) -> ${dest}`);
}

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

/** Locate an OpenSSL executable. Git for Windows ships one under usr/bin; the
 *  OpenSSL-Win64 installer puts it under Program Files. PATH wins if set. */
function findOpenssl() {
  const candidates = [
    "openssl",
    "C:\\Program Files\\Git\\usr\\bin\\openssl.exe",
    "C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe",
    "C:\\Program Files\\OpenSSL-Win64\\bin\\openssl.exe",
  ];
  for (const c of candidates) {
    const r = spawnSync(c, ["version"], { stdio: "ignore" });
    if (r.status === 0) return c;
  }
  return null;
}

/** Generate a fresh mitmproxy CA dedicated to the packaged prod build so we
 *  never ship the dev's personal ~/.mitmproxy/ private key. Steps:
 *    1. Spawn the bundled mitmdump with `--set confdir=resources/prod-cert`.
 *       mitmdump generates the CA lazily during startup (before binding to
 *       the proxy port), so we just wait for the pem to appear and kill it.
 *    2. Compute Android `subject_hash_old` via OpenSSL (Git Bash ships one).
 *       Mitmproxy's CA subject is fixed (`O=mitmproxy CN=mitmproxy`) so the
 *       hash should always be `c8750f0d` — we still verify in case mitmproxy
 *       ever changes its CA template.
 *    3. Copy mitmproxy-ca-cert.pem to `<hash>.0` (the filename Android's
 *       system CA store expects).
 *  The resulting tree is bundled via electron-builder extraResources and
 *  consumed by capture.ps1 in prod via `-MitmConfDir` + `-CertDir`. */
async function provisionProdCert() {
  const certDir = join(here, "..", "resources", "prod-cert");
  const caPath = join(certDir, "mitmproxy-ca.pem");
  const certPemPath = join(certDir, "mitmproxy-ca-cert.pem");
  const expectedHash = "c8750f0d";
  if (existsSync(join(certDir, `${expectedHash}.0`))) {
    console.log("[ok] prod cert already present, skipping (delete prod-cert/ to refresh)");
    return;
  }
  const mitmdump = join(BIN, "mitmproxy", "mitmdump.exe");
  if (!existsSync(mitmdump)) throw new Error("mitmdump missing — provisionMitmproxy must run first");
  mkdirSync(certDir, { recursive: true });

  console.log(`[cert] generating dedicated prod CA in ${certDir}`);
  const proc = spawn(mitmdump, [
    "--set", `confdir=${certDir}`,
    "--listen-host", "127.0.0.1",
    "--listen-port", "0",
  ], { stdio: "ignore" });
  try {
    for (let i = 0; i < 100; i++) {
      if (existsSync(caPath)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!existsSync(caPath)) throw new Error("mitmdump did not write CA within 10s");
  } finally {
    proc.kill();
  }
  console.log(`[cert] CA pem ready at ${caPath}`);

  let hash = expectedHash;
  const openssl = findOpenssl();
  if (openssl) {
    const r = spawnSync(openssl, [
      "x509", "-inform", "PEM", "-subject_hash_old", "-noout", "-in", certPemPath,
    ], { encoding: "utf-8" });
    if (r.status === 0 && r.stdout.trim()) {
      const out = r.stdout.trim();
      if (out !== hash) {
        console.warn(`[warn] mitmproxy CA subject hash changed: ${out} (expected ${expectedHash}) — using observed value`);
        hash = out;
      }
    } else {
      console.warn(`[warn] openssl subject_hash_old failed (status=${r.status}); assuming ${hash}`);
    }
  } else {
    console.warn(`[warn] OpenSSL not found in PATH or Git/OpenSSL-Win64 install dirs; assuming ${hash}`);
  }

  const hashFile = join(certDir, `${hash}.0`);
  const cp = spawnSync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command",
    `Copy-Item -Force "${certPemPath}" "${hashFile}"`,
  ], { stdio: "inherit" });
  if (cp.status !== 0) throw new Error("Copy-Item of CA cert to hashed name failed");
  console.log(`[ok] android cert ready: ${hashFile}`);
}

/** Wrap a PNG as a single-image Windows ICO container. electron-builder
 *  needs build/icon.ico to be >= 256x256 square; the favicon.ico in
 *  outerpedia-v2 is 189x256 (the site's tall-logo favicon) so we
 *  regenerate from the square 512x512 PNG asset. Inline because
 *  ImageMagick isn't on the dev's PATH and the format is trivial: 6-byte
 *  header + 16-byte directory entry + the raw PNG payload. */
function provisionWindowsIcon() {
  const srcPng = join(here, "..", "..", "..", "..", "outerpedia-v2", "public", "icons", "icon-512x512.png");
  const buildDir = join(here, "..", "build");
  const outIco = join(buildDir, "icon.ico");
  if (!existsSync(srcPng)) {
    console.warn(`[warn] icon source not found at ${srcPng} - skipping .ico generation`);
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

mkdirSync(BIN, { recursive: true });
await provisionMitmproxy();
await provisionPlatformTools();
await provisionProdCert();
provisionSteamPlugin();
provisionWindowsIcon();
console.log(`[done] all binaries + prod cert + icon provisioned under ${BIN}/..`);
