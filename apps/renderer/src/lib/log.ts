/**
 * Lightweight debug logger gated on `gs.debug.<flag>` localStorage keys — the
 * same convention as the Builds stat-lock toggle (`gs.debug.statLocks`). Off
 * by default: when the flag isn't truthy, `debug()` does two cheap reads and
 * returns, so there's zero console noise in normal use and no need to strip
 * call sites for release.
 *
 * Toggle from the devtools console:
 *   localStorage['gs.debug.solver'] = 'true'   // then re-run a solve
 * (or via the Settings → Debug panel once those toggles are wired).
 *
 * Renderer-only — Web Workers have no `localStorage`, so the solver's
 * orchestrator (main thread) logs fan-out/merge here while the per-chunk
 * worker stays silent. Capture / desktop run in the Electron main process and
 * log through their own Node channel.
 */
import { readSetting } from "./settings.js";

export type DebugFlag = "solver" | "statLocks";

/** `gs.debug.<flag>` ↔ its `lib/settings.ts` entry. */
const FLAG_SETTING = { solver: "debugSolver", statLocks: "debugStatLocks" } as const;

/** True when `gs.debug.<flag>` is on — read through `readSetting`, the same
 *  declaration (and tolerant parse) as the Settings → Debug toggle.
 *  `usePersistedState` stores booleans as JSON (`"true"`/`"false"`); a hand-set
 *  `"1"` works too. No localStorage (worker, privacy mode) → debug off. */
export function debugEnabled(flag: DebugFlag): boolean {
  return readSetting(FLAG_SETTING[flag]);
}

/** `console.log` tagged + coloured by flag, but only when that flag is on. */
export function debug(flag: DebugFlag, ...args: unknown[]): void {
  if (debugEnabled(flag)) console.log(`%c[gs:${flag}]`, "color:#22d3ee;font-weight:600", ...args);
}
