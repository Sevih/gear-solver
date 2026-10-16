/**
 * electron-builder `beforePack` hook — the installer never carries a capture
 * CA (the private key of the capture source older versions had). The app no
 * longer generates nor ships one.
 *
 *  - Refuses to pack when the packaging config maps anything that would pick
 *    up `resources/prod-cert/` (the folder older builds generated).
 *  - When such a folder is still lying around, says so: it is ignored (no
 *    mapping copies it), and can be deleted.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const DESKTOP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const LEGACY_CA_DIR = join("resources", "prod-cert");

/** Throws when `config` (the `build` block of package.json) would package
 *  `resources/prod-cert`; returns the warnings to print. */
export function checkCaNotPackaged(config, desktopDir = DESKTOP_DIR) {
  const legacy = resolve(desktopDir, LEGACY_CA_DIR);
  const offending = [];
  for (const key of ["extraResources", "extraFiles", "files"]) {
    const raw = config[key];
    const entries = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
    for (const e of entries) {
      const from = typeof e === "string" ? e : (e.from ?? (key === "files" ? "" : null));
      if (from == null) continue;
      const pattern = typeof e === "string" ? e : JSON.stringify(e);
      const src = resolve(desktopDir, from.split("*")[0] || ".");
      const covers = legacy === src || legacy.startsWith(src + sep);
      // `files` globs are relative to the app dir: only a recursive one reaching resources/ counts.
      const reaches = key === "files" ? covers && /\*\*/.test(from) : covers;
      if (pattern.includes("prod-cert") || reaches) offending.push(`${key}: ${pattern}`);
    }
  }
  if (offending.length) {
    throw new Error(`packaging config would ship ${LEGACY_CA_DIR} (a capture CA must never be packaged):\n  ${offending.join("\n  ")}`);
  }
  return existsSync(legacy)
    ? [`[pack] ${legacy} is left over from an older build — ignored, NOT packaged (the capture CA is generated on each user's machine). Safe to delete.`]
    : [];
}

export default async function beforePack(context) {
  const desktopDir = context.packager.info.projectDir ?? DESKTOP_DIR;
  for (const line of checkCaNotPackaged(context.packager.config, desktopDir)) console.warn(line);
}
