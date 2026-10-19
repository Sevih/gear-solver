/**
 * Atomic file write shared by the desktop server: the bytes go to a sibling
 * temp file, then a rename swaps it in, so a concurrent reader (the renderer
 * re-reading `user_item.json` right after an Equip, the game reading its
 * plugin config) never sees a half-written file. Electron-free so the Vite dev
 * middleware can load it.
 */
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

let tmpCounter = 0;

/** Write `data` (a string is written as UTF-8) to `file` through a temp file +
 *  rename, creating the parent folder. On failure the temp file is removed and
 *  the error rethrown — the previous `file`, if any, is left intact. */
export function writeAtomic(file: string, data: string | Uint8Array): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${tmpCounter++}.tmp`;
  try {
    writeFileSync(tmp, data);
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}
