/**
 * Settings → Data — game data sync, onboarding reset and captured-data wipe.
 */
import { useEffect, useState } from "react";
import { loadDataVersion, type DataVersion } from "../../data.js";
import { useConfirmClick } from "./useConfirmClick.js";
import { SectionStrip, DataAction } from "./SettingsControls.js";

export function DataPane({
  syncing, onSync, onResetOnboarding, onAfterWipe, onStatus,
}: {
  syncing: boolean;
  onSync: () => void;
  onResetOnboarding: () => void;
  onAfterWipe?: () => void;
  onStatus: (message: string) => void;
}) {
  const [wipeArmed, confirmWipe] = useConfirmClick();
  // Read-only stamp of the loaded derived-data snapshot (data/derived/version.json,
  // written by build.mjs). Fetched once on open; absent on data built before the
  // stamp existed → renders an em-dash.
  const [version, setVersion] = useState<DataVersion | null>(null);
  useEffect(() => {
    let alive = true;
    void loadDataVersion().then((v) => { if (alive) setVersion(v); });
    return () => { alive = false; };
  }, []);
  return (
    <div className="flex flex-col gap-3">
      <SectionStrip title="Data" />
      <div className="rounded-lg border border-white/8 bg-black/20 px-3 py-2 text-[11px]">
        <span className="text-white/50">Game data version</span>{" "}
        {version
          ? <>
              {version.resVersion && <span className="text-white/40">game {version.resVersion} · </span>}
              <span className="font-mono text-white/85">{version.hash}</span>
              <span className="text-white/40"> · built {new Date(version.builtAt).toLocaleString()}</span>
            </>
          : <span className="text-white/40">—</span>}
      </div>
      <DataAction
        label="Sync game data"
        description="Refresh the raw tables from the local outerpedia checkout and rebuild the derived data (run after a game patch). Auto-runs at launch when the source is newer."
        actionLabel={syncing ? "Syncing…" : "Sync"}
        disabled={syncing}
        onClick={onSync}
      />
      <DataAction
        label="Reset onboarding prompt"
        description="Show this Settings modal automatically on next launch as the setup wizard."
        onClick={onResetOnboarding}
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
 *  inventory. The Data pane's button asks for a second click first. */
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
