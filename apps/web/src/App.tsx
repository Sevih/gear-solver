import { useEffect, useRef, useState } from "react";
import type { GameData, Inventory, RawUserItem, RawUserCharacter, UserGeasLevels } from "@gear-solver/core";
import { autoImport, parseFiles } from "./data.js";
import { streamCapture, getCaptureStatus, type CaptureStatus } from "./capture.js";
import { GsHeader, PageBackground, type Tab } from "./design/Shell.js";
import { InventoryScreen } from "./screens/InventoryScreen.js";
import { BuildsScreen } from "./screens/BuildsScreen.js";
import { BuilderScreen } from "./screens/BuilderScreen.js";
import { usePersistedState } from "./hooks/usePersistedState.js";

// Resolved-at-build-time site version (set in next.config / vite env).
const APP_VERSION =
  (typeof import.meta !== "undefined" && (import.meta as { env?: { VITE_APP_VERSION?: string } }).env?.VITE_APP_VERSION) ||
  "0.4";

export function App() {
  const [tab, setTab] = usePersistedState<Tab>("gs.tab", "Inventory");
  const [game, setGame] = useState<GameData | null>(null);
  const [inv, setInv] = useState<Inventory | null>(null);
  const [userGeas, setUserGeas] = useState<UserGeasLevels | null>(null);
  const [userCodex, setUserCodex] = useState<number | null>(null);
  const [status, setStatus] = useState("");
  const [capStatus, setCapStatus] = useState<CaptureStatus | null>(null);
  const [running, setRunning] = useState<"none" | "capture" | "disarm">("none");
  const [log, setLog] = useState<string[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const logRef = useRef<HTMLPreElement | null>(null);

  async function refreshInventory(label: string) {
    const r = await autoImport();
    setGame(r.game);
    setInv(r.inventory);
    setUserGeas(r.userGeasLevels);
    setUserCodex(r.userCodexLevel);
    if (r.inventory) setStatus(`${label} · ${r.game ? "stats resolved" : "engine-only fallback"}`);
    else setStatus(r.game ? "Game data loaded — no capture found." : "No data. Arm capture to begin.");
  }

  useEffect(() => { void refreshInventory("Auto-import"); }, []);
  useEffect(() => { void getCaptureStatus().then(setCapStatus); }, []);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);

  async function onFiles(files: FileList | null) {
    if (!files) return;
    let userItem: RawUserItem | null = null;
    let userChar: RawUserCharacter | undefined;
    for (const f of Array.from(files)) {
      const j = JSON.parse(await f.text());
      if (j.ItemList) userItem = j as RawUserItem;
      else if (j.CharList) userChar = j as RawUserCharacter;
    }
    if (userItem) {
      setInv(parseFiles(game, userItem, userChar));
      setStatus("Manual import OK");
    }
  }

  async function runCapture(mode: "capture" | "disarm") {
    if (running !== "none") return;
    setRunning(mode);
    setLog([]); setLogOpen(true);
    try {
      const { exitCode } = await streamCapture(
        mode === "capture" ? "/api/capture/run" : "/api/capture/disarm",
        (line) => setLog((l) => [...l, line]),
      );
      if (mode === "capture") {
        if (exitCode === 0) await refreshInventory("Capture OK");
        else if (exitCode === 2) setStatus("Pipeline armed — play to the lobby, then reload.");
        else setStatus(`Capture failed (exit ${exitCode}) — see log.`);
      } else {
        setStatus(exitCode === 0 ? "Pipeline disarmed." : `Disarm failed (exit ${exitCode}).`);
      }
    } catch (err) {
      setLog((l) => [...l, `[client] ${err instanceof Error ? err.message : String(err)}`]);
      setStatus("Network error during capture.");
    } finally {
      setRunning("none");
      void getCaptureStatus().then(setCapStatus);
    }
  }

  const captureState = running === "capture" ? "capturing" : (capStatus?.armed ? "armed" : "idle");
  const lastCapture = capStatus?.userItemMtime ?? null;

  return (
    <PageBackground>
      <GsHeader
        active={tab}
        onTabChange={setTab}
        version={APP_VERSION}
        capture={{
          state: captureState,
          onCapture: () => runCapture("capture"),
          onDisarm: () => runCapture("disarm"),
          onReload: () => refreshInventory("Reloaded inventory"),
          busy: running !== "none",
        }}
      />

      {(status || log.length > 0) && (
        <div className="border-b border-white/6 bg-black/30 px-6 py-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-zinc-400">{status}</span>
            {log.length > 0 && (
              <button
                onClick={() => setLogOpen((v) => !v)}
                className="font-mono text-[10px] text-cyan-300 hover:text-cyan-200"
              >
                {logOpen ? "Hide" : "Show"} log ({log.length})
              </button>
            )}
          </div>
          {logOpen && log.length > 0 && (
            <pre
              ref={logRef}
              className="mt-2 max-h-48 overflow-y-auto rounded-md border border-white/[0.07] bg-black/40 p-2 font-mono text-[10.5px] leading-relaxed text-zinc-400"
            >
              {log.join("\n")}
            </pre>
          )}
        </div>
      )}

      <main className="min-h-[calc(100vh-60px)]">
        {tab === "Inventory" && <InventoryScreen inventory={inv} game={game} lastCapture={lastCapture} />}
        {tab === "Builds" && <BuildsScreen inventory={inv} game={game} userGeasLevels={userGeas} userCodexLevel={userCodex} />}
        {tab === "Builder" && <BuilderScreen />}
      </main>

      {!inv && (
        <div className="px-6 py-2 text-center text-[11px] text-zinc-500">
          Manual fallback:{" "}
          <input
            type="file"
            accept="application/json"
            multiple
            onChange={(e) => onFiles(e.target.files)}
            className="text-[11px] text-zinc-400"
          />
        </div>
      )}
    </PageBackground>
  );
}
