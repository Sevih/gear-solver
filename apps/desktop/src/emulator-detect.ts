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
import { existsSync } from "node:fs";
import { createConnection } from "node:net";

export type EmulatorType = "ldplayer" | "mumu" | "nox";

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

export interface PreflightCheck {
  /** Stable id for the wizard to reference (icon, fix instructions). */
  id: "emulator-installed" | "emulator-running" | "adb-connection" | "root-toggle";
  /** Whether the check passed. */
  ok: boolean;
  /** Short user-facing summary (renderer composes additional copy). */
  detail: string;
}

export interface PreflightResult {
  emulator: DetectedEmulator | null;
  device: string | null;
  checks: PreflightCheck[];
  /** All four checks passed — wizard hides itself. */
  ready: boolean;
}

/** Run the four onboarding checks in sequence and return a structured
 *  result the wizard can render row-by-row. Bails early once a check fails
 *  (the next one would always be ✗ — no point probing for root if ADB
 *  isn't even connecting). The wizard shows the failed step in red plus
 *  its specific "how to fix" copy. */
export async function preflight(): Promise<PreflightResult> {
  const detected = await detectEmulators();
  const emu = pickEmulator(detected);

  const installedOk = emu != null;
  const checks: PreflightCheck[] = [{
    id: "emulator-installed",
    ok: installedOk,
    detail: emu ? `${emu.label} detected` : "no supported emulator found on disk",
  }];
  if (!installedOk) return { emulator: null, device: null, checks, ready: false };

  const runningOk = emu!.running;
  checks.push({
    id: "emulator-running",
    ok: runningOk,
    detail: runningOk
      ? `ADB port ${pickPort(emu!)} responding`
      : `${emu!.label} installed but no instance listening on any known ADB port`,
  });
  if (!runningOk) return { emulator: emu, device: null, checks, ready: false };

  const port = pickPort(emu!)!;
  const device = `127.0.0.1:${port}`;

  // adb connect is idempotent — if the device is already attached it just
  // re-confirms. Then `adb -s <device> get-state` should print "device".
  await runAdb(emu!.adbPath, ["connect", device], 4000);
  const state = await runAdb(emu!.adbPath, ["-s", device, "get-state"], 4000);
  const adbOk = state.code === 0 && state.stdout.trim() === "device";
  checks.push({
    id: "adb-connection",
    ok: adbOk,
    detail: adbOk
      ? `adb get-state = device`
      : `adb get-state = ${state.stdout.trim() || "no response"}${state.stderr ? ` (${state.stderr.trim().slice(0, 80)})` : ""}`,
  });
  if (!adbOk) return { emulator: emu, device, checks, ready: false };

  // `adb shell su -c id` returns `uid=0(root)` when the Root toggle is ON.
  // Without root, we see `su: not found` or `Permission denied` (depending
  // on the emulator); both are detected by absence of `uid=0`.
  const id = await runAdb(emu!.adbPath, ["-s", device, "shell", "su -c id"], 6000);
  const rootOk = /uid=0/.test(id.stdout);
  checks.push({
    id: "root-toggle",
    ok: rootOk,
    detail: rootOk
      ? "su -c id → uid=0(root)"
      : `su returned: ${(id.stdout + id.stderr).trim().slice(0, 100) || "no output"}`,
  });

  return { emulator: emu, device, checks, ready: checks.every((c) => c.ok) };
}
