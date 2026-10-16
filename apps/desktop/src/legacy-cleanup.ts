/**
 * One-time cleanup of what the removed emulator capture source left in
 * userData. Runs at every launch (main.ts) and is a no-op once the files are
 * gone, so the first launch of a version without that source does the work.
 *
 *  - `capture-ca/`       — this install's mitmproxy CA, private key included.
 *  - `bin/mitmproxy/`    — the mitmdump.exe downloaded on the first capture.
 *  - `manual-device.json` — the adb path + device override of Settings → Setup.
 *  - inside the capture folder, only the pipeline's own files (`.mitm.pid`,
 *    the mitmdump logs, the `game.flows` traffic recording). The snapshots
 *    stay: the Steam plugin writes the same files there.
 *
 * Electron-free (paths are injected) so the test runs it on a temp tree.
 */
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const USER_DATA_ENTRIES = ["capture-ca", join("bin", "mitmproxy"), "manual-device.json"];
const CAPTURE_OUT_ENTRIES = [".mitm.pid", "mitm.log", "mitm.log.err", "game.flows"];

/** Delete the leftovers that exist and return their paths (empty when there
 *  was nothing to remove). A failed delete is skipped — the next launch retries. */
export function removeEmulatorLeftovers(userData: string, captureOut: string): string[] {
  const removed: string[] = [];
  const targets = [
    ...USER_DATA_ENTRIES.map((e) => join(userData, e)),
    ...CAPTURE_OUT_ENTRIES.map((e) => join(captureOut, e)),
  ];
  for (const p of targets) {
    if (!existsSync(p)) continue;
    try {
      rmSync(p, { recursive: true, force: true });
      removed.push(p);
    } catch { /* locked (e.g. a mitmdump still running) — retried next launch */ }
  }
  return removed;
}
