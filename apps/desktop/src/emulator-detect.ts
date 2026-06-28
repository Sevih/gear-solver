/**
 * Detect Android emulators installed on the host (LDPlayer, MuMu Player,
 * NoxPlayer) and probe their default ADB ports to figure out which one is
 * actually running. The Electron server uses the result to:
 *  - pass the right `-Adb` path to capture.ps1 (each emulator bundles its
 *    own ADB), and
 *  - pass `-Device 127.0.0.1:<port>` so the script targets the running
 *    instance rather than the historical 5555 hardcode.
 *
 * The renderer fetches `/api/emulators` and surfaces what was detected so
 * the user knows whether to launch their emulator before clicking
 * Arm capture.
 *
 * Pure Node (fs + net) — no Electron deps so the Vite dev middleware can
 * import it too for parity between dev and packaged builds.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createConnection } from "node:net";

/** `generic` = a device the shared ADB server reported (`adb devices`) that
 *  doesn't match a known brand layout; `manual` lives on CaptureTarget only. */
export type EmulatorType = "ldplayer" | "mumu" | "nox" | "generic";

export interface DetectedEmulator {
  type: EmulatorType;
  /** Human-readable name for the UI badge. */
  label: string;
  /** Absolute path to the emulator's adb.exe (we use its bundled ADB rather
   *  than ours so the protocol version matches the daemon). */
  adbPath: string;
  /** Ports we found listening on 127.0.0.1 — typically one when a single
   *  instance is open, more if the user runs several. */
  listeningPorts: number[];
  /** Convenience flag: at least one port is listening. */
  running: boolean;
}

/** Static knowledge of where each emulator installs and which ADB ports it
 *  binds by default. Add more candidates here as users report layouts we
 *  miss (different drives, alt LDPlayer versions, MuMu Pro builds…). */
const KNOWN: Array<{
  type: EmulatorType;
  label: string;
  paths: string[];
  ports: number[];
}> = [
  {
    type: "ldplayer",
    label: "LDPlayer",
    paths: [
      "C:\\LDPlayer\\LDPlayer9\\adb.exe",
      "C:\\LDPlayer\\LDPlayer4\\adb.exe",
      "D:\\LDPlayer\\LDPlayer9\\adb.exe",
    ],
    // LDPlayer assigns ports 5555 + 2*n to instance n (0-indexed). 8 instances
    // covers any reasonable setup.
    ports: [5555, 5557, 5559, 5561, 5563, 5565, 5567, 5569],
  },
  {
    type: "mumu",
    label: "MuMu Player",
    paths: [
      "C:\\Program Files\\Netease\\MuMuPlayerGlobal-12.0\\shell\\adb.exe",
      "C:\\Program Files\\Netease\\MuMu Player 12\\shell\\adb.exe",
      "C:\\Program Files\\Netease\\MuMuPlayer-12.0\\shell\\adb.exe",
      "D:\\Program Files\\Netease\\MuMuPlayerGlobal-12.0\\shell\\adb.exe",
    ],
    // MuMu 12 binds 16384 (+32 per extra instance). 7555 / 5555 are legacy
    // fallbacks seen on older MuMu builds.
    ports: [16384, 16416, 16448, 16480, 7555, 5555],
  },
  {
    type: "nox",
    label: "NoxPlayer",
    paths: [
      "C:\\Program Files\\Nox\\bin\\nox_adb.exe",
      "C:\\Program Files\\Nox\\bin\\adb.exe",
      "C:\\Program Files (x86)\\Nox\\bin\\nox_adb.exe",
      "C:\\Program Files (x86)\\Nox\\bin\\adb.exe",
    ],
    // Nox starts at 62001 and increments by 1 per instance.
    ports: [62001, 62025, 62026, 62027, 62028, 5555],
  },
];

/** TCP-connect probe with a short timeout. ADB daemons reply to anything on
 *  their listen port, so connect-success is a sufficient liveness signal. */
function isPortListening(port: number, host = "127.0.0.1", timeoutMs = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ port, host });
    let done = false;
    const finish = (result: boolean) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(result);
    };
    sock.on("connect", () => finish(true));
    sock.on("error", () => finish(false));
    setTimeout(() => finish(false), timeoutMs);
  });
}

/** Look at every known install path; for each emulator found on disk, probe
 *  every port we know it can bind. Returns the full list (running first,
 *  installed-but-stopped after) so the UI can show "MuMu installed but not
 *  running" hints. */
export async function detectEmulators(): Promise<DetectedEmulator[]> {
  const found: DetectedEmulator[] = [];
  for (const k of KNOWN) {
    const adbPath = k.paths.find((p) => existsSync(p));
    if (!adbPath) continue;
    const probes = await Promise.all(
      k.ports.map(async (port) => ({ port, listening: await isPortListening(port) })),
    );
    const listeningPorts = probes.filter((r) => r.listening).map((r) => r.port);
    found.push({
      type: k.type,
      label: k.label,
      adbPath,
      listeningPorts,
      running: listeningPorts.length > 0,
    });
  }
  // Sort: running first, then by label.
  found.sort((a, b) => Number(b.running) - Number(a.running) || a.label.localeCompare(b.label));
  return found;
}

/** Pick the emulator the capture script should target. Strict preference for
 *  one that's actually running — falls back to first installed-but-stopped
 *  one so the UI can still suggest "launch <X> first". Returns null when
 *  nothing is detected. */
export function pickEmulator(detected: DetectedEmulator[]): DetectedEmulator | null {
  return detected.find((e) => e.running) ?? detected[0] ?? null;
}

/** First listening port of the chosen emulator. The script's `-Device`
 *  expects `127.0.0.1:<port>`; we hand back just the port and let the
 *  caller format. */
export function pickPort(emulator: DetectedEmulator): number | null {
  return emulator.listeningPorts[0] ?? null;
}

/** Spawn an ADB command and return { exitCode, stdout, stderr }. Used by
 *  the onboarding wizard to actively probe the device: ADB Debug Local
 *  Connection (`adb connect`) and Root toggle (`adb shell su -c id`). */
function runAdb(adbPath: string, args: string[], timeoutMs = 6000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(adbPath, args, { windowsHide: true });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve({ code: -1, stdout, stderr: stderr + "\n[timeout]" }); }, timeoutMs);
    child.stdout.on("data", (c) => (stdout += c.toString("utf-8")));
    child.stderr.on("data", (c) => (stderr += c.toString("utf-8")));
    child.on("error", (err) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: stderr + "\n[spawn error] " + err.message }); });
    child.on("exit", (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
  });
}

/** Parse `adb devices` and return the serials in `device` state. Every
 *  emulator's bundled adb talks to the SAME host adb server (port 5037), so
 *  this lists instances of ANY brand that have registered — the brand-agnostic
 *  detection path. Serials look like `127.0.0.1:5555` (emulators) or
 *  `emulator-5554` (AVD-style); we hand them back verbatim for `adb -s` /
 *  capture.ps1 `-Device`. */
async function listAdbDevices(adbPath: string): Promise<string[]> {
  const r = await runAdb(adbPath, ["devices"], 6000);
  if (r.code !== 0) return [];
  return r.stdout
    .split(/\r?\n/)
    .slice(1)                                   // drop the "List of devices attached" header
    .map((l) => l.trim())
    .filter((l) => /\sdevice$/.test(l))         // state column == "device" (skip offline/unauthorized)
    .map((l) => l.split(/\s+/)[0]!)
    .filter(Boolean);
}

/** A user-pinned adb + device, set in Settings → Setup → Manual device. Bypasses
 *  auto-detection entirely — the universal escape hatch for any rooted emulator
 *  we don't have a brand profile for. */
export interface ManualDevice {
  /** Absolute path to an adb.exe to drive. */
  adbPath: string;
  /** Device serial / `host:port` passed to `adb -s` and capture.ps1 `-Device`. */
  device: string;
}

/** The (adb, device) the capture pipeline should actually target, plus where it
 *  came from (for the wizard's status line). */
export interface CaptureTarget {
  adbPath: string;
  device: string;
  source: "manual" | EmulatorType;
  label: string;
}

/** Resolve which adb + device to drive, in priority order:
 *   1. an explicit **manual** override (trusted as long as its adb exists),
 *   2. a **running known-brand** emulator (LDPlayer/MuMu/Nox on a known port),
 *   3. **generic** — any device the shared adb server lists (`adb devices`),
 *      driven by a detected brand's adb or `fallbackAdb` (the bundled adb),
 *   4. an installed-but-stopped brand (device left blank) so the wizard can
 *      still say "launch X".
 *  Returns null when there's nothing to talk to and no adb to probe with. */
export async function resolveCaptureTarget(
  manual: ManualDevice | null,
  fallbackAdb: string | null,
): Promise<CaptureTarget | null> {
  if (manual && manual.adbPath && manual.device && existsSync(manual.adbPath)) {
    return { adbPath: manual.adbPath, device: manual.device, source: "manual", label: "Manual device" };
  }
  const detected = await detectEmulators();
  const running = detected.find((e) => e.running);
  if (running) {
    const port = pickPort(running);
    if (port) return { adbPath: running.adbPath, device: `127.0.0.1:${port}`, source: running.type, label: running.label };
  }
  // Generic: drive `adb devices` with whatever adb we can find (a brand's, or
  // the bundled fallback) and take the first connected device.
  const probeAdb = detected.find((e) => existsSync(e.adbPath))?.adbPath
    ?? (fallbackAdb && existsSync(fallbackAdb) ? fallbackAdb : null);
  if (probeAdb) {
    const devices = await listAdbDevices(probeAdb);
    if (devices.length > 0) {
      return { adbPath: probeAdb, device: devices[0]!, source: "generic", label: "Detected device" };
    }
  }
  if (detected.length > 0) {
    const e = detected[0]!;
    const port = pickPort(e);
    return { adbPath: e.adbPath, device: port ? `127.0.0.1:${port}` : "", source: e.type, label: e.label };
  }
  return null;
}

/** The `-Device` / `-Adb` flags capture.ps1 / disarm.ps1 take for a resolved
 *  target. Empty when nothing resolved (scripts fall back to their defaults). */
export function targetScriptArgs(target: CaptureTarget | null): string[] {
  if (!target) return [];
  const args: string[] = [];
  if (target.device) args.push("-Device", target.device);
  if (target.adbPath) args.push("-Adb", target.adbPath);
  return args;
}

/** Load the persisted manual override (null when unset or malformed). */
export function loadManualDevice(file: string): ManualDevice | null {
  try {
    if (!existsSync(file)) return null;
    const j = JSON.parse(readFileSync(file, "utf-8")) as Partial<ManualDevice>;
    if (j && typeof j.adbPath === "string" && typeof j.device === "string" && j.adbPath.trim() && j.device.trim()) {
      return { adbPath: j.adbPath.trim(), device: j.device.trim() };
    }
    return null;
  } catch {
    return null;
  }
}

/** Persist (or clear, when `md` is null) the manual override. Best-effort. */
export function saveManualDevice(file: string, md: ManualDevice | null): void {
  try {
    if (md == null) { if (existsSync(file)) rmSync(file, { force: true }); return; }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ adbPath: md.adbPath, device: md.device }), "utf-8");
  } catch {
    // quota / permission — next save retries.
  }
}

export interface PreflightCheck {
  /** Stable id for the wizard to reference (icon, fix instructions). */
  id: "emulator-installed" | "emulator-running" | "adb-connection" | "root-toggle";
  /** Whether the check passed. */
  ok: boolean;
  /** Short user-facing summary (renderer composes additional copy). */
  detail: string;
}

export interface PreflightResult {
  /** Resolved target identity for the wizard's status line + brand-fix lookup.
   *  `type` is the source ("manual" / "generic" / a brand); `label` is shown. */
  emulator: { type: string; label: string } | null;
  device: string | null;
  checks: PreflightCheck[];
  /** All four checks passed — wizard hides itself. */
  ready: boolean;
}

/** Run the four onboarding checks in sequence and return a structured
 *  result the wizard can render row-by-row. Bails early once a check fails
 *  (the next one would always be ✗ — no point probing for root if ADB
 *  isn't even connecting). The wizard shows the failed step in red plus
 *  its specific "how to fix" copy.
 *
 *  Target resolution honors a `manual` override and brand-agnostic generic
 *  detection (see resolveCaptureTarget); `fallbackAdb` is the bundled adb used
 *  to probe `adb devices` when no brand adb is on disk. */
export async function preflight(
  manual: ManualDevice | null = null,
  fallbackAdb: string | null = null,
): Promise<PreflightResult> {
  const target = await resolveCaptureTarget(manual, fallbackAdb);

  // 1 — something to talk to: a usable adb + a known device path (manual set,
  //     brand installed, or a device the adb server reported).
  const installedOk = target != null && existsSync(target.adbPath);
  const ident = target ? { type: target.source, label: target.label } : null;
  const checks: PreflightCheck[] = [{
    id: "emulator-installed",
    ok: installedOk,
    detail: target
      ? target.source === "manual" ? "manual device configured"
        : target.source === "generic" ? "device reported by adb"
        : `${target.label} detected`
      : "no emulator on disk, no device connected, no manual device set",
  }];
  if (!installedOk) return { emulator: ident, device: null, checks, ready: false };

  const device = target!.device;
  const hostPort = /^([\d.]+):(\d+)$/.exec(device);

  // 2 — instance running. For host:port we TCP-probe the ADB port (an up
  //     instance listens even before adb authorizes); a generic/USB serial is
  //     "present" by virtue of having been listed.
  let runningOk: boolean;
  let runningDetail: string;
  if (hostPort) {
    runningOk = await isPortListening(Number(hostPort[2]));
    runningDetail = runningOk ? `ADB port ${hostPort[2]} responding` : `nothing listening on ${device}`;
  } else if (device) {
    runningOk = true;
    runningDetail = `device ${device} present`;
  } else {
    runningOk = false;
    runningDetail = `${target!.label} installed but no instance running`;
  }
  checks.push({ id: "emulator-running", ok: runningOk, detail: runningDetail });
  if (!runningOk) return { emulator: ident, device: device || null, checks, ready: false };

  // 3 — ADB authorized. `adb connect` is idempotent (host:port only); then
  //     `adb -s <device> get-state` must print "device".
  if (hostPort) await runAdb(target!.adbPath, ["connect", device], 4000);
  const state = await runAdb(target!.adbPath, ["-s", device, "get-state"], 4000);
  const adbOk = state.code === 0 && state.stdout.trim() === "device";
  checks.push({
    id: "adb-connection",
    ok: adbOk,
    detail: adbOk
      ? "adb get-state = device"
      : `adb get-state = ${state.stdout.trim() || "no response"}${state.stderr ? ` (${state.stderr.trim().slice(0, 80)})` : ""}`,
  });
  if (!adbOk) return { emulator: ident, device, checks, ready: false };

  // 4 — root. `adb shell su -c id` returns `uid=0(root)` when the Root toggle
  //     is ON; without it we get `su: not found` / `Permission denied`.
  const id = await runAdb(target!.adbPath, ["-s", device, "shell", "su -c id"], 6000);
  const rootOk = /uid=0/.test(id.stdout);
  checks.push({
    id: "root-toggle",
    ok: rootOk,
    detail: rootOk
      ? "su -c id → uid=0(root)"
      : `su returned: ${(id.stdout + id.stderr).trim().slice(0, 100) || "no output"}`,
  });

  return { emulator: ident, device, checks, ready: checks.every((c) => c.ok) };
}
