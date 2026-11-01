/**
 * Settings › Data & updates — the update center (app version, check and
 * install), the game data version, game data sync and the captured-data wipe.
 */
import { useDataVersion } from "../../hooks/useDataVersion.js";
import { dataVersionLabel } from "../../lib/dataVersion.js";
import type { UpdateStatus } from "../../lib/update.js";
import { UpdateCard } from "./UpdateCard.js";
import { useConfirmClick } from "./useConfirmClick.js";
import { SectionStrip, DataAction } from "./SettingsControls.js";

export function DataPane({
  update, onCheckUpdate, onInstallUpdate, syncing, onSync, onAfterWipe, onStatus,
}: {
  /** App update status, polled by App (hooks/useAppUpdate.ts). */
  update: UpdateStatus;
  onCheckUpdate: () => void;
  onInstallUpdate: () => void;
  syncing: boolean;
  onSync: () => void;
  onAfterWipe?: () => void;
  onStatus: (message: string) => void;
}) {
  const [wipeArmed, confirmWipe] = useConfirmClick();
  // Read-only stamp of the loaded derived-data snapshot (data/derived/version.json,
  // written by build.mjs). Fetched once on open; absent on data built before the
  // stamp existed → renders an em-dash.
  const version = useDataVersion();
  return (
    <div className="flex flex-col gap-3">
      <SectionStrip title="App version" />
      <UpdateCard status={update} onCheck={onCheckUpdate} onInstall={onInstallUpdate} />
      <SectionStrip title="Game data" />
      <div className="rounded-lg border border-white/8 bg-black/20 px-3 py-2 text-[11px]">
        <span className="text-white/50">Game data version</span>{" "}
        <span className={version ? "font-mono text-white/85" : "text-white/40"}>{dataVersionLabel(version)}</span>
      </div>
      <DataAction
        label="Sync game data"
        description="Fetch the latest game tables published by outerpedia (run after a game patch; a local outerpedia checkout is used when there is one). Auto-runs at launch when they are newer."
        actionLabel={syncing ? "Syncing…" : "Sync"}
        disabled={syncing}
        onClick={onSync}
      />
      <DataAction
        label="Wipe captured data"
        description="Empty the whole capture folder: imported snapshots, the seen-paths log and unknown endpoints (_unknown/). Cannot be undone · requires confirmation."
        tone="danger"
        actionLabel={wipeArmed ? "Click again to confirm" : undefined}
        onClick={() => confirmWipe(() => void wipeCaptured(onStatus, onAfterWipe))}
      />
    </div>
  );
}

/** POST /api/capture/wipe (empties the whole capture folder) + refresh
 *  inventory. The Data & updates pane's button asks for a second click first. */
async function wipeCaptured(onStatus: (message: string) => void, onAfterWipe?: () => void): Promise<void> {
  try {
    const r = await fetch("/api/capture/wipe", { method: "POST" });
    if (!r.ok) {
      // The server's reason when it gives one (409: the Steam plugin is live).
      const j = (await r.json().catch(() => null)) as { error?: string } | null;
      onStatus(`Wipe failed: ${j?.error ?? `HTTP ${r.status}`}`);
      return;
    }
    onAfterWipe?.();
  } catch (err) {
    onStatus(`Wipe failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
