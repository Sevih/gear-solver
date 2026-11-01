/**
 * useAppUpdate — the app update status, polled from App so it stays live
 * whatever the tab (the header badge reads it; Home's update card too).
 * Faster while a download or a check is in flight so the % bar animates; idle
 * states tick slowly. Seeded with a static "up to date" using the build-time
 * app version so the card never flashes empty.
 */
import { useCallback, useEffect, useState } from "react";
import { checkForUpdate, getUpdateStatus, installUpdate, type UpdateStatus } from "../lib/update.js";

export function useAppUpdate(appVersion: string): { update: UpdateStatus; check: () => void; install: () => void } {
  const [update, setUpdate] = useState<UpdateStatus>({
    state: "uptodate", version: null, progress: 0, error: null, appVersion, dataSha: null,
  });
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const s = await getUpdateStatus();
      if (!alive) return;
      if (s) setUpdate(s);
      const delay = (s?.state === "downloading" || s?.state === "checking") ? 1000 : 4000;
      timer = setTimeout(tick, delay);
    };
    void tick();
    return () => { alive = false; clearTimeout(timer); };
  }, []);

  const check = useCallback(() => { setUpdate((u) => ({ ...u, state: "checking", error: null })); void checkForUpdate(); }, []);
  const install = useCallback(() => { void installUpdate(); }, []);
  return { update, check, install };
}
