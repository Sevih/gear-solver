/**
 * Client for the `/api/emulators` endpoint exposed by the Vite dev middleware
 * and the Electron prod server. Surfaces what the backend detected so the
 * header can show "LDPlayer · 5555" or "MuMu not running" hints before the
 * user clicks Arm capture.
 */

export type EmulatorType = "ldplayer" | "mumu" | "nox";

export interface DetectedEmulator {
  type: EmulatorType;
  label: string;
  adbPath: string;
  listeningPorts: number[];
  running: boolean;
}

export interface EmulatorStatus {
  detected: DetectedEmulator[];
  chosen: DetectedEmulator | null;
  chosenPort: number | null;
}

export async function getEmulators(): Promise<EmulatorStatus | null> {
  try {
    const r = await fetch("/api/emulators");
    if (!r.ok) return null;
    return (await r.json()) as EmulatorStatus;
  } catch {
    return null;
  }
}
