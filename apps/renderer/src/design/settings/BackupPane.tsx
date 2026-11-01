/**
 * Settings → Backup — export / import of everything the user set up (JSON):
 * the keys `lib/storage/keys.ts` marks `backup: true`, listed under Export.
 */
import { applyBackup, buildBackup, type ImportResult } from "../../lib/storage/transfer.js";
import { BACKUP_KEYS, backupLabels } from "../../lib/storage/keys.js";
import { localDateStamp } from "../../lib/dateStamp.js";
import { SectionStrip, DataAction } from "./SettingsControls.js";

export function BackupPane({ importInputRef, onStatus }: { importInputRef: { current: HTMLInputElement | null }; onStatus: (message: string) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <SectionStrip title="Backup" />
      <div className="flex flex-col gap-1.5">
        <DataAction
          label="Export backup"
          description="Download everything you set up in the app as a JSON file (backup / move to another device)."
          actionLabel="Export"
          onClick={() => exportBackupFile(onStatus)}
        />
        <div className="px-3 text-[11px] leading-snug text-zinc-500">
          <div className="text-zinc-400">{backupLabels().join(" · ")}</div>
          <div>Never the captured gear: that comes from the game.</div>
        </div>
      </div>
      <DataAction
        label="Import backup"
        description="Merge an exported JSON file, old ones included, into what is here: builds and presets already present are kept; ranks, worklist entries, notes and settings from the file replace yours."
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

/** « Imported: 12 saved builds · 3 filter sets · hero ranks · worklist (4) » —
 *  what an import took, by registry label (keys sharing a label add up), each
 *  cited as its `summary` says. */
export function importSummary(result: ImportResult): string {
  const byLabel = new Map<string, { summary: (typeof BACKUP_KEYS)[number]["summary"]; count: number }>();
  for (const { key, label, summary } of BACKUP_KEYS) {
    const n = result[key] ?? 0;
    if (n > 0) byLabel.set(label, { summary, count: (byLabel.get(label)?.count ?? 0) + n });
  }
  if (byLabel.size === 0) return "Nothing new to import — everything in this file is already here.";
  const parts = [...byLabel].map(([label, { summary, count }]) => {
    const word = label.charAt(0).toLowerCase() + label.slice(1);
    if (summary === "count") return `${count} ${count === 1 ? word.replace(/s$/, "") : word}`;
    return summary === "paren" ? `${word} (${count})` : word;
  });
  return `Imported: ${parts.join(" · ")}`;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Side-effect helpers — outcomes go to the App's status (and journal)
 * ───────────────────────────────────────────────────────────────────────── */

/** Snapshot every backed-up key and trigger a browser download.
 *  Filename carries the date so multiple backups don't collide. */
function exportBackupFile(onStatus: (message: string) => void): void {
  try {
    const now = Date.now();
    const bundle = buildBackup(now);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const stamp = localDateStamp(now); // YYYY-MM-DD
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

/** Read a user-picked JSON file, merge it into localStorage, and report what
 *  it took. Always clears the input (via `done`) so re-picking the same file
 *  fires `onChange` again. */
async function importBackupFile(file: File | null, onStatus: (message: string) => void, done: () => void): Promise<void> {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text()) as unknown;
    onStatus(importSummary(applyBackup(parsed)));
  } catch (err) {
    onStatus(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    done();
  }
}
