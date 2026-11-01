/**
 * useDataVersion — the loaded derived-data stamp, fetched once on mount.
 * Null while loading and on data built before the stamp existed.
 */
import { useEffect, useState } from "react";
import { loadDataVersion, type DataVersion } from "../data.js";

export function useDataVersion(): DataVersion | null {
  const [version, setVersion] = useState<DataVersion | null>(null);
  useEffect(() => {
    let alive = true;
    void loadDataVersion().then((v) => { if (alive) setVersion(v); });
    return () => { alive = false; };
  }, []);
  return version;
}
