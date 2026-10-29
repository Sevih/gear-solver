/**
 * Settings → Setup — the Steam capture plugin checklist (game found / plugin
 * installed / plugin live) and the plugin removal.
 */
import { useState } from "react";
import { cx } from "../cx.js";
import { uninstallSteamPlugin, type SteamStatus } from "../../steam.js";
import { SectionStrip } from "./SettingsControls.js";
import { useMountedRef, useConfirmClick } from "./useConfirmClick.js";

/* ─────────────────────────────────────────────────────────────────────────
 * Panes
 * ───────────────────────────────────────────────────────────────────────── */

/** Header note of the Steam pane: the installed build, then the client
 *  outerpedia last read ("build 123 · reference v1.4.18 (build 25744766)"). */
function steamBuildNote(s: SteamStatus | null): string | null {
  if (!s) return null;
  const reference = `reference v${s.reference.version} (build ${s.reference.buildId})`;
  return s.buildId ? `build ${s.buildId} · ${reference}` : reference;
}

/** Capture setup wizard: three checks, the first two gate "ready" (the plugin
 *  is in place); the third is live status (game running with the plugin
 *  loaded) shown for feedback, since capture itself needs no click. */
export function SteamSetupPane({ steam, loading, busy, onInstall, onLaunch, onProbe, onStatus }: {
  steam: SteamStatus | null; loading: boolean; busy: boolean;
  onInstall: () => void; onLaunch: () => void; onProbe: () => void;
  onStatus: (message: string) => void;
}) {
  const s = steam;
  const installedOk = Boolean(s?.installed);
  const pluginOk = Boolean(s?.ready);
  const liveOk = Boolean(s?.live);
  const pluginDetail = !s ? "" : !s.bepinex.present ? "BepInEx runtime missing"
    : !s.plugin.present ? "plugin DLL missing"
    : !s.plugin.upToDate ? (s.bundleAvailable ? "installed plugin differs from the bundled one" : "bundled plugin not built (dev: npm run capture-steam:build)")
    : !s.plugin.outDirOk ? `plugin writes to ${s.plugin.outDir ?? "its default folder"}, not ours`
    : `plugin ok${s.bepinex.version ? ` · BepInEx ${s.bepinex.version}` : ""}`;
  const liveDetail = !s ? "" : s.live
    ? `plugin ${s.heartbeat?.version ?? ""} live · ${s.heartbeat?.captures ?? 0} captures${s.heartbeat?.lastPath ? ` · last ${s.heartbeat.lastPath}` : ""}`
    : s.gameRunning ? "game running, but no plugin heartbeat — restart the game after installing"
    : "game not running";
  const steps = [
    { id: "game", title: "OUTERPLANE installed via Steam", ok: installedOk, detail: s?.gameDir ?? (s ? "not found in any Steam library" : ""),
      fix: "Install OUTERPLANE from Steam (it's free). We find it through your Steam library folders — no path to type. Without it, you can still import your snapshot files by hand (Manual fallback, at the bottom of the window)." },
    { id: "plugin", title: "Capture plugin installed", ok: pluginOk, detail: pluginDetail,
      fix: "Click Install plugin: it drops the BepInEx loader (downloaded once from the official release, checksum-verified) and our GearSolverCapture.dll into the game folder, then points the plugin at this app's capture folder. The game must be closed while installing." },
    { id: "live", title: "Game running with the plugin loaded", ok: liveOk, detail: liveDetail,
      fix: "Launch OUTERPLANE from Steam. The plugin loads with the game and writes your roster + gear the moment the lobby loads — the app re-imports on its own." },
  ] as const;
  const ready = installedOk && pluginOk;
  const firstOpen = steps.findIndex((st) => !st.ok);
  const currentIndex = firstOpen < 0 ? steps.length : firstOpen;
  const doneCount = steps.filter((st) => st.ok).length;
  const canInstall = installedOk && !busy && !s?.gameRunning && Boolean(s?.bundleAvailable);

  return (
    <div className="flex flex-col gap-3.5">
      <SectionStrip title="Capture setup · Steam" note={steamBuildNote(s)} />
      {s?.buildDiffers && (
        <p className="rounded-md border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[11.5px] text-amber-200">
          This game build differs from the client outerpedia last read (v{s.reference.version}, build {s.reference.buildId}).
        </p>
      )}
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1">
          {steps.map((st, i) => (
            <div key={st.id} className={cx("h-1.5 flex-1 rounded-full", st.ok ? "bg-emerald-400" : i === currentIndex ? "bg-cyan-400" : "bg-white/10")} />
          ))}
        </div>
        <span className="shrink-0 font-mono text-[10.5px] text-zinc-400">{doneCount}/{steps.length}</span>
      </div>

      <div className="flex flex-col gap-2">
        {steps.map((st, i) => {
          if (st.ok) return <StepDoneRow key={st.id} title={`${st.title}${st.detail ? ` — ${st.detail}` : ""}`} />;
          if (i !== currentIndex) return <StepUpcomingRow key={st.id} n={i + 1} title={st.title} />;
          return (
            <div key={st.id} className="flex flex-col gap-2 rounded-lg border border-cyan-400/35 bg-cyan-500/6 px-3.5 py-3">
              <div className="flex items-center gap-2">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-cyan-400 text-[11px] font-bold text-cyan-950">{i + 1}</span>
                <span className="text-[13.5px] font-semibold text-cyan-200">{st.title}</span>
                <span className="ml-auto shrink-0 font-mono text-[10px] text-cyan-300/70">step {i + 1} of {steps.length}</span>
              </div>
              <p className="text-[12px] leading-relaxed text-zinc-300">{st.fix}</p>
              {st.detail && <span className="font-mono text-[10.5px] text-zinc-500">{st.detail}</span>}
              <div className="flex items-center gap-2 pt-0.5">
                {st.id === "plugin" && (
                  <button
                    type="button" onClick={onInstall} disabled={!canInstall}
                    title={s?.gameRunning ? "Close OUTERPLANE first — the plugin file is locked while the game runs" : !s?.bundleAvailable ? "Plugin DLL not built on this side" : "Install / update the capture plugin"}
                    className={cx(
                      "inline-flex h-7 items-center rounded-md border px-3 text-[11.5px] font-semibold transition-colors",
                      canInstall ? "border-cyan-400/40 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25" : "cursor-not-allowed border-white/6 bg-white/2 text-zinc-500",
                    )}
                  >{busy ? "Installing…" : s?.plugin.present ? "Update plugin" : "Install plugin"}</button>
                )}
                {st.id === "live" && !s?.gameRunning && (
                  <button
                    type="button" onClick={onLaunch} disabled={busy}
                    className="inline-flex h-7 items-center rounded-md border border-cyan-400/40 bg-cyan-500/15 px-3 text-[11.5px] font-semibold text-cyan-100 hover:bg-cyan-500/25"
                  >Launch game</button>
                )}
                <span className="text-[11px] text-zinc-500">
                  {loading ? "Re-checking…" : <>then click <b className="text-cyan-300">Re-check</b> below.</>}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {s?.installed && s.launchOptionsOk != null && <ProtonLaunchOptionsRow ok={s.launchOptionsOk} />}

      {ready && (
        <div className="flex flex-col gap-2.5 rounded-lg border border-emerald-400/35 bg-emerald-500/8 px-3.5 py-3">
          <div className="flex items-center gap-2">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-400 text-[12px] font-bold text-emerald-950">✓</span>
            <span className="text-[13.5px] font-semibold text-emerald-200">{liveOk ? "Capturing · plugin live" : "Ready · Steam"}</span>
          </div>
          <ol className="flex flex-col gap-1.5 text-[12px] leading-relaxed text-zinc-300">
            <li><b className="text-zinc-200">1.</b> Launch <b className="text-zinc-200">OUTERPLANE</b> from Steam and play to the lobby — roster + gear import automatically (no Arm, no Reload).</li>
            <li><b className="text-zinc-200">2.</b> <span className="text-zinc-400">Optional:</span> open the in-game <b className="text-zinc-200">Hero Archive</b> + <b className="text-zinc-200">Gift</b> screens once — codex + geas import as soon as they load.</li>
            <li><b className="text-zinc-200">3.</b> After a game update, come back here: if the plugin needs a refresh the header says so.</li>
          </ol>
        </div>
      )}

      <SteamRemoveSection steam={s} busy={busy} onDone={onProbe} onStatus={onStatus} />
    </div>
  );
}

/** Collapsed "Remove plugin" escape hatch (also strips BepInEx when nothing
 *  else uses it). Asks for a second click first; refused by the backend while
 *  the game runs. */
function SteamRemoveSection({ steam, busy, onDone, onStatus }: { steam: SteamStatus | null; busy: boolean; onDone: () => void; onStatus: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [armed, confirmClick] = useConfirmClick();
  const mounted = useMountedRef();
  if (!steam?.plugin.present) return null;
  const remove = async () => {
    setWorking(true);
    try {
      const r = await uninstallSteamPlugin(true);
      if (!r.ok) onStatus(`Remove failed: ${r.error ?? "unknown error"}`);
      onDone();
    } finally { if (mounted.current) setWorking(false); }
  };
  return (
    <div className="flex flex-col gap-2 border-t border-white/6 pt-3">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-fit items-center gap-1.5 text-[11px] font-semibold text-zinc-400 hover:text-zinc-200">
        <span className={cx("inline-block text-[9px] transition-transform", open && "rotate-90")}>▸</span>
        <span className="tracking-[0.04em]">Remove plugin</span>
      </button>
      {open && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-white/8 bg-black/20 px-3 py-2.5">
          <p className="text-[11.5px] leading-relaxed text-zinc-400">
            Deletes <span className="font-mono text-zinc-300">BepInEx/plugins/GearSolverCapture</span> and its config from the game folder. Your captured snapshots stay in the app. Close the game first.
          </p>
          <button
            type="button" onClick={() => confirmClick(() => void remove())} disabled={busy || working || steam.gameRunning}
            className={cx(
              "inline-flex h-7 shrink-0 items-center rounded-md border px-3 text-[11.5px] font-semibold",
              busy || working || steam.gameRunning ? "cursor-not-allowed border-white/6 bg-white/2 text-zinc-500" : "border-rose-400/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20",
            )}
          >{working ? "Removing…" : armed ? "Click again to confirm" : "Remove"}</button>
        </div>
      )}
    </div>
  );
}

/** Linux / Proton only (`launchOptionsOk` is null on Windows): BepInEx's
 *  winhttp.dll proxy loads only with the WINEDLLOVERRIDES launch option. */
function ProtonLaunchOptionsRow({ ok }: { ok: boolean }) {
  if (ok) return <StepDoneRow title="Proton launch option set — WINEDLLOVERRIDES" />;
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[11.5px] text-amber-200">
      <span>Proton launch option missing — BepInEx won't load without it. Paste this line in Steam › OUTERPLANE › Properties › General › Launch Options:</span>
      <code className="w-fit select-all rounded bg-black/30 px-2 py-1 font-mono text-[11px] text-amber-100">WINEDLLOVERRIDES="winhttp=n,b" %command%</code>
      <span className="text-amber-200/70">Steam must be restarted after editing it.</span>
    </div>
  );
}

function StepDoneRow({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2.5 px-0.5 py-0.5">
      <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-emerald-400/90 text-[10px] font-bold text-emerald-950">✓</span>
      <span className="text-[12.5px] text-zinc-300">{title}</span>
    </div>
  );
}

function StepUpcomingRow({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-2.5 px-0.5 py-0.5 opacity-45">
      <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full border border-zinc-600 text-[9px] font-mono text-zinc-400">{n}</span>
      <span className="text-[12.5px] text-zinc-400">{title}</span>
    </div>
  );
}
