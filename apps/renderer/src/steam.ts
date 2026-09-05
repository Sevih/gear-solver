/**
 * Client for the Steam capture source (`/api/steam/*`, served by both the Vite
 * dev middleware and the Electron prod server — see apps/desktop/src/steam-capture.ts).
 *
 * The Steam source has no arm/disarm: a BepInEx plugin inside the game writes
 * every decoded response straight into the capture folder while you play. The
 * app only needs to (1) install that plugin once and (2) watch the folder.
 */

/** Which acquisition path the app drives. Persisted under `gs.capture.source`;
 *  null = auto (Steam when the game is found in a Steam library, else emulator). */
export type CaptureSource = "steam" | "emulator";
export const CAPTURE_SOURCE_KEY = "gs.capture.source";

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
  bepinex: { present: boolean; version: string | null };
  plugin: { present: boolean; upToDate: boolean; outDir: string | null; outDirOk: boolean };
  bundleAvailable: boolean;
  gameRunning: boolean;
  heartbeat: SteamPluginHeartbeat | null;
  /** Game running AND the plugin heartbeat belongs to that process. */
  live: boolean;
  /** Installed + plugin present, up to date and pointed at our folder. */
  ready: boolean;
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

/** One-line human summary of the Steam source state, shared by the header
 *  pill, the Home health card and the setup wizard so they never disagree. */
export function describeSteam(s: SteamStatus | null): { tone: "ready" | "warn" | "missing" | "live"; text: string } {
  if (!s) return { tone: "missing", text: "Steam · checking…" };
  if (!s.installed) return { tone: "missing", text: "Steam · OUTERPLANE not found" };
  if (!s.ready) {
    if (!s.plugin.present) return { tone: "warn", text: "Steam · plugin not installed" };
    if (!s.plugin.upToDate) return { tone: "warn", text: "Steam · plugin update available" };
    if (!s.plugin.outDirOk) return { tone: "warn", text: "Steam · plugin points elsewhere" };
    return { tone: "warn", text: "Steam · BepInEx missing" };
  }
  if (s.live) return { tone: "live", text: "Steam · plugin live" };
  if (s.gameRunning) return { tone: "warn", text: "Steam · game up, plugin not loaded" };
  return { tone: "ready", text: "Steam · ready, game not running" };
}
