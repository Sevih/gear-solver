/**
 * Desktop (Electron main / Node) debug logger, gated on the `GS_DEBUG` env
 * var. The renderer's `lib/log.ts` gates on localStorage (`gs.debug.*`); the
 * main process has no localStorage, so this reads `GS_DEBUG` once at launch:
 *
 *   GS_DEBUG=*               → every channel
 *   GS_DEBUG=capture,server  → those channels only
 *
 * Off by default (unset) — `dlog()` does one Set lookup and returns, so the
 * call sites stay in for release with no stdout noise.
 *
 * `dwarn()` is the exception: it always logs, regardless of GS_DEBUG. It's for
 * failures that currently vanish silently (a swallowed I/O error, an
 * orphan-kill fallback) — a rare, actionable diagnostic shouldn't need a flag
 * to surface.
 */
export type LogChannel = "server" | "capture";

const CHANNELS: ReadonlySet<string> = (() => {
  const raw = process.env.GS_DEBUG?.trim();
  if (!raw) return new Set<string>();
  if (raw === "1" || raw === "true" || raw === "*") return new Set(["*"]);
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
})();

function on(ch: LogChannel): boolean {
  return CHANNELS.has("*") || CHANNELS.has(ch);
}

/** Gated info log — only when `GS_DEBUG` names this channel (or `*`). */
export function dlog(ch: LogChannel, ...args: unknown[]): void {
  if (on(ch)) console.log(`[gs:${ch}]`, ...args);
}

/** Always-on diagnostic for swallowed failures — does NOT need `GS_DEBUG`. */
export function dwarn(ch: LogChannel, ...args: unknown[]): void {
  console.warn(`[gs:${ch}]`, ...args);
}
