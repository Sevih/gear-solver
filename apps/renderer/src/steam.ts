/**
 * Client for the Steam capture source (`/api/steam/*`, served by both the Vite
 * dev middleware and the Electron prod server — see apps/desktop/src/steam-capture.ts).
 *
 * The capture is passive: a BepInEx plugin inside the game writes
 * every decoded response straight into the capture folder while you play. The
 * app only needs to (1) install that plugin once and (2) watch the folder.
 */

export interface SteamPluginHeartbeat {
  version: string;
  pid: number;
  startedAt: string;
  /** The path-aware hook fired at least once (vs the shape fallback). */
  pathHook: boolean;
  captures: number;
  lastPath: string | null;
  lastCaptureAt: string | null;
  outDir: string;
}

/** Mirror of `SteamStatus` in apps/desktop/src/steam-capture.ts. */
export interface SteamStatus {
  installed: boolean;
  gameDir: string | null;
  buildId: string | null;
  /** The client outerpedia last read (bundled `game-client.json` `client`). */
  reference: { version: string; buildId: string; dumpedAt: string };
  /** The installed build is known and differs from the reference's. */
  buildDiffers: boolean;
  bepinex: { present: boolean; version: string | null };
  plugin: { present: boolean; upToDate: boolean; outDir: string | null; outDirOk: boolean };
  bundleAvailable: boolean;
  gameRunning: boolean;
  heartbeat: SteamPluginHeartbeat | null;
  /** Game running AND the plugin heartbeat belongs to that process. */
  live: boolean;
  /** Installed + plugin present, up to date and pointed at our folder. */
  ready: boolean;
  /** Proton only: the Steam launch options carry `WINEDLLOVERRIDES="winhttp=n,b"`.
   *  Null on Windows or when Steam's `localconfig.vdf` is unreadable. */
  launchOptionsOk: boolean | null;
}

export async function getSteamStatus(): Promise<SteamStatus | null> {
  try {
    const r = await fetch("/api/steam/status");
    if (!r.ok) return null;
    return (await r.json()) as SteamStatus;
  } catch {
    return null;
  }
}

/** Ask Steam to start OUTERPLANE. Resolves false if the backend refused. */
export async function launchSteamGame(): Promise<boolean> {
  try {
    const r = await fetch("/api/steam/launch", { method: "POST" });
    return r.ok || r.status === 204;
  } catch {
    return false;
  }
}

export interface SteamUninstallResult {
  ok: boolean;
  lines: string[];
  error?: string;
  status?: SteamStatus;
}

/** Remove the plugin (and BepInEx too when `removeBepinex`, unless other
 *  plugins live there). Refused while the game runs (409). */
export async function uninstallSteamPlugin(removeBepinex = false): Promise<SteamUninstallResult> {
  try {
    const r = await fetch("/api/steam/uninstall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ removeBepinex }),
    });
    const j = (await r.json().catch(() => null)) as { status?: SteamStatus; lines?: string[]; error?: string } | null;
    if (!r.ok) return { ok: false, lines: j?.lines ?? [], error: j?.error ?? `HTTP ${r.status}` };
    return { ok: true, lines: j?.lines ?? [], status: j?.status };
  } catch (err) {
    return { ok: false, lines: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/** The capture pill: one vocabulary for the header pill and the first-capture
 *  steps, so they never disagree. `label` is the short state, `title`
 *  the detail (what is wrong or live, the plugin version, the game folder). */
export interface CaptureBadge {
  label: string;
  /** live = plugin loaded in a running game; warn = something to do or to
   *  wait for; idle = nothing to do here (checking, not found, game closed). */
  tone: "live" | "warn" | "idle";
  title: string;
}

export function captureBadge(s: SteamStatus | null): CaptureBadge {
  if (!s) return { label: "Checking…", tone: "idle", title: "Probing the Steam library…" };
  if (!s.installed) return { label: "Steam not found", tone: "idle", title: "OUTERPLANE isn't installed through Steam on this PC — install it from Steam, or import your snapshot files manually" };
  const at = (detail: string) => (s.gameDir ? `${detail} · ${s.gameDir}` : detail);
  if (!s.ready) {
    if (s.plugin.present && !s.plugin.upToDate) return { label: "Plugin update available", tone: "warn", title: at("Installed plugin differs from the bundled one") };
    const why = !s.plugin.present ? "Capture plugin not installed"
      : !s.plugin.outDirOk ? `Plugin writes to ${s.plugin.outDir ?? "its default folder"}, not ours`
      : "BepInEx runtime missing";
    return { label: "Plugin needed", tone: "warn", title: at(why) };
  }
  if (s.live) return { label: "Live", tone: "live", title: at(`Plugin${s.heartbeat?.version ? ` v${s.heartbeat.version}` : ""} live in the running game`) };
  if (s.gameRunning) return { label: "Waiting for game", tone: "warn", title: at("Game running, no plugin heartbeat yet — restart the game if it stays like this") };
  return { label: "Game closed", tone: "idle", title: at("Plugin ready — launch the game to capture") };
}
