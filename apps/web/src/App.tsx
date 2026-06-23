import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { GameData, Inventory, RawUserItem, RawUserCharacter, UserGeasLevels } from "@gear-solver/core";
import { autoImport, parseFiles } from "./data.js";
import { streamCapture, getCaptureStatus, type CaptureStatus } from "./capture.js";
import { getEmulators, type EmulatorStatus } from "./emulator.js";
import { GsHeader, PageBackground, type Tab } from "./design/Shell.js";
import { OnboardingWizard } from "./design/OnboardingWizard.js";
import { usePersistedState } from "./hooks/usePersistedState.js";

// Per-screen code splits — each screen ships its own chunk so the initial
// bundle drops to just the shell + the first screen the user opens.
// BuildsScreen pulls in compose-stats + the gear icon set; InventoryScreen
// pulls the design tokens + the GearRow/Card pair; Builder is mostly empty
// today but isolated for future growth. Suspense boundary below renders a
// minimal placeholder while the chunk arrives (one-time, then cached).
const InventoryScreen = lazy(() => import("./screens/InventoryScreen.js").then((m) => ({ default: m.InventoryScreen })));
const BuildsScreen = lazy(() => import("./screens/BuildsScreen.js").then((m) => ({ default: m.BuildsScreen })));
const BuilderScreen = lazy(() => import("./screens/BuilderScreen.js").then((m) => ({ default: m.BuilderScreen })));

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
  const [emulator, setEmulator] = useState<EmulatorStatus | null>(null);
  const [running, setRunning] = useState<"none" | "capture" | "disarm">("none");
  const [log, setLog] = useState<string[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const logRef = useRef<HTMLPreElement | null>(null);
  // Onboarding wizard — persisted "seen" flag so the modal only auto-opens
  // once per fresh install. The header's gear icon re-opens it on demand.
  // `wizardOpen` is the immediate UI state; `onboardingDone` survives reloads.
  const [onboardingDone, setOnboardingDone] = usePersistedState<boolean>("gs.onboarding.done", false);
  const [wizardOpen, setWizardOpen] = useState(!onboardingDone);

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
  useEffect(() => { void getEmulators().then(setEmulator); }, []);
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
        if (exitCode === 0) {
          await refreshInventory("Capture OK");
          // Auto-disarm in the background so mitmdump + the device iptables
          // redirect get torn down — otherwise mitmdump.exe stays alive after
          // window close and locks the bundled binary for the next rebuild.
          // Re-arm to capture supplementary endpoints (Codex, Awakening, …).
          void (async () => {
            try { await streamCapture("/api/capture/disarm", () => {}); } catch {}
            void getCaptureStatus().then(setCapStatus);
          })();
        }
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
          onReload: () => {
            void refreshInventory("Reloaded inventory");
            void getEmulators().then(setEmulator);
          },
          busy: running !== "none",
        }}
        emulator={{
          label: emulator?.chosen?.label ?? null,
          port: emulator?.chosenPort ?? null,
        }}
        onSetup={() => setWizardOpen(true)}
      />

      <OnboardingWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onReady={() => {
          setOnboardingDone(true);
          // Re-poll the emulator status so the header badge flips green
          // immediately after the wizard confirms everything is set.
          void getEmulators().then(setEmulator);
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
        <Suspense fallback={<div className="px-6 py-10 text-center text-[12px] text-zinc-500">Loading {tab.toLowerCase()}…</div>}>
          {tab === "Inventory" && <InventoryScreen inventory={inv} game={game} lastCapture={lastCapture} />}
          {tab === "Builds" && <BuildsScreen inventory={inv} game={game} userGeasLevels={userGeas} userCodexLevel={userCodex} />}
          {tab === "Builder" && <BuilderScreen />}
        </Suspense>
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
