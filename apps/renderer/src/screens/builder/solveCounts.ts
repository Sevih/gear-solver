/**
 * Builder solve progress store — the P / S counts only the footer subscribes to.
 */


/** P / S counts of the running solve. */
interface SolveCounts { permutations: number; searched: number }
export const ZERO_SOLVE_COUNTS: SolveCounts = { permutations: 0, searched: 0 };
export interface SolveCountsStore {
  get(): SolveCounts;
  set(next: SolveCounts): void;
  subscribe(listener: () => void): () => void;
}
/** Tiny external store for the live P / S counts — written by the
 *  orchestrator's `onProgress`, read by `FilterFooter` through
 *  `useSyncExternalStore`, so a progress tick re-renders the footer only. */
export function createSolveCountsStore(): SolveCountsStore {
  let value = ZERO_SOLVE_COUNTS;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      if (next.permutations === value.permutations && next.searched === value.searched) return;
      value = next;
      for (const l of listeners) l();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
