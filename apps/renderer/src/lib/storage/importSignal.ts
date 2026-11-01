/**
 * Backup-import signal — run after each import has written localStorage
 * (`transfer.ts`, which re-exports `onBackupImported`). Screens and hooks that
 * hold a backed-up key in memory (`usePersistedState`, App's maps, the
 * Builder's and Presets' lists) reload it, or their next write would put back
 * the pre-import value. A module of its own so the storage hook can listen
 * without importing the registry.
 */
const importListeners = new Set<() => void>();

/** Run `listener` after each import has written localStorage. Returns the
 *  unsubscribe function (a ready-made `useEffect` cleanup). */
export function onBackupImported(listener: () => void): () => void {
  importListeners.add(listener);
  return () => { importListeners.delete(listener); };
}

/** Notify every listener — `applyBackup`, once its writes are done (or one
 *  failed halfway). */
export function notifyBackupImported(): void {
  for (const listener of importListeners) listener();
}
