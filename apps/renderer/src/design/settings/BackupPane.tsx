/**
 * Settings → Backup — export / import of builds & presets (JSON).
 */
import { applyBackup, buildBackup } from "../../lib/storage/transfer.js";
import { SectionStrip, DataAction } from "./SettingsControls.js";

export function BackupPane({ importInputRef, onStatus }: { importInputRef: { current: HTMLInputElement | null }; onStatus: (message: string) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <SectionStrip title="Backup" />
      <DataAction
        label="Export builds & presets"
        description="Download your saved builds, filter presets and the heroes of your in-game presets (Presets tab) as a JSON file (backup / move to another device). Captured gear is not included — re-capture it there."
        actionLabel="Export"
        onClick={() => exportBackupFile(onStatus)}
      />
      <DataAction
        label="Import builds & presets"
        description="Merge a previously exported JSON file into your current builds & presets (entries already present are kept)."
        actionLabel="Import"
        onClick={() => importInputRef.current?.click()}
      />
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => void importBackupFile(e.target.files?.[0] ?? null, onStatus, () => { if (importInputRef.current) importInputRef.current.value = ""; })}
      />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Side-effect helpers — outcomes go to the App's status bar
 * ───────────────────────────────────────────────────────────────────────── */

/** Snapshot saved builds + filter presets + preset heroes and trigger a browser download.
 *  Filename carries the date so multiple backups don't collide. */
function exportBackupFile(onStatus: (message: string) => void): void {
  try {
    const now = Date.now();
    const bundle = buildBackup(now);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const stamp = new Date(now).toISOString().slice(0, 10); // YYYY-MM-DD
    const a = document.createElement("a");
    a.href = url;
    a.download = `gear-solver-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke on the next tick so the click has consumed the URL.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch (err) {
    onStatus(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Read a user-picked JSON file, merge it into localStorage, and report the
 *  count. Always clears the input (via `done`) so re-picking the same file
 *  fires `onChange` again. */
async function importBackupFile(file: File | null, onStatus: (message: string) => void, done: () => void): Promise<void> {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text()) as unknown;
    const result = applyBackup(parsed);
    const { builds, presetGroups } = result;
    // Builder and Inventory filter presets read as one "presets" count.
    const presets = result.presets + result.inventoryPresets;
    if (builds === 0 && presets === 0 && presetGroups === 0) {
      onStatus("Nothing new to import — every build and preset in this file is already present.");
    } else {
      const groups = presetGroups > 0 ? `, heroes of ${presetGroups} in-game preset${presetGroups === 1 ? "" : "s"}` : "";
      onStatus(`Imported ${builds} build${builds === 1 ? "" : "s"} and ${presets} preset${presets === 1 ? "" : "s"}${groups}.`);
    }
  } catch (err) {
    onStatus(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    done();
  }
}
