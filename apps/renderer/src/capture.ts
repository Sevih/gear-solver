/**
 * Client for the dev-only capture endpoints exposed by the Vite middleware.
 * POSTs to /api/capture/{run,disarm} return a plain-text stream of script
 * output, terminated by a `__EXIT__:<code>` sentinel line.
 */

export interface CaptureResult {
  exitCode: number;
}

/** Stream a capture script's output line by line; resolves with the exit code. */
export async function streamCapture(
  endpoint: "/api/capture/run" | "/api/capture/disarm",
  onLine: (line: string) => void,
  signal?: AbortSignal,
): Promise<CaptureResult> {
  const r = await fetch(endpoint, { method: "POST", signal });
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
  const reader = r.body.pipeThrough(new TextDecoderStream("utf-8")).getReader();
  let buf = "";
  let exitCode = -1;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let nl = buf.indexOf("\n");
      while (nl !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        nl = buf.indexOf("\n");
        const m = line.match(/^__EXIT__:(-?\d+)\s*$/);
        if (m) { exitCode = Number(m[1]); continue; }
        onLine(line);
      }
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  if (buf.length > 0) onLine(buf);
  return { exitCode };
}

export interface CaptureStatus {
  armed: boolean;
  captured: boolean;
  userItemMtime: number | null;
}

export async function getCaptureStatus(): Promise<CaptureStatus | null> {
  try {
    const r = await fetch("/api/capture/status");
    if (!r.ok) return null;
    return (await r.json()) as CaptureStatus;
  } catch {
    return null;
  }
}
