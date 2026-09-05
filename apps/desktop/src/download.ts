/**
 * Shared "download → verify → unzip" primitives for runtime provisioning
 * (mitmdump for the emulator source, BepInEx for the Steam source). Pure
 * Node — no Electron import — so the Vite dev middleware can use them too.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, rmSync } from "node:fs";

/** Stream `url` to `out` while hashing; throw (and delete the file) on any
 *  mismatch so a truncated or tampered archive is never extracted. `log`
 *  receives coarse progress lines (every ~20%). */
export async function downloadVerified(url: string, out: string, sha256: string, log: (line: string) => void, what = "download"): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${what} failed: HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length")) || 0;
  const hash = createHash("sha256");
  const file = createWriteStream(out);
  let received = 0;
  let lastPct = 0;
  try {
    const reader = res.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      hash.update(value);
      if (!file.write(value)) await new Promise<void>((r) => file.once("drain", () => r()));
      received += value.length;
      if (total > 0) {
        const pct = Math.floor((received / total) * 100);
        if (pct >= lastPct + 20) { lastPct = pct; log(`   ... ${pct}% (${Math.round(received / 1e5) / 10} MB)`); }
      }
    }
    await new Promise<void>((resolve, reject) => {
      file.once("error", reject);
      file.end(() => resolve());
    });
    const got = hash.digest("hex");
    if (got !== sha256) throw new Error(`${what} checksum mismatch (got ${got}, expected ${sha256}) — refusing to install it`);
  } catch (err) {
    file.destroy();
    rmSync(out, { force: true });
    throw err;
  }
}

/** Expand a `.zip` into `dest` through PowerShell (no zip lib in the Electron
 *  main bundle). The path MUST end in `.zip` — Expand-Archive refuses any
 *  other extension outright. */
export function expandZip(zipPath: string, dest: string): void {
  const r = spawnSync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command",
    `$ErrorActionPreference='Stop'; Expand-Archive -Force -Path "${zipPath}" -DestinationPath "${dest}"`,
  ], { windowsHide: true, encoding: "utf-8" });
  if (r.status !== 0) {
    const detail = (r.stderr || "").trim().split("\n")[0] || `exit ${r.status}`;
    throw new Error(`extracting ${zipPath} failed: ${detail}`);
  }
}
