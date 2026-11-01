/**
 * useSetting — `usePersistedState` bound to a `lib/settings.ts` entry: same
 * key, same default, and the same tolerant parse as the non-React
 * `readSetting`, so both readers agree on a hand-edited or stale value.
 */
import type { Dispatch, SetStateAction } from "react";
import { usePersistedState } from "./usePersistedState.js";
import { SETTINGS, parseSetting, type SettingName, type SettingValues } from "../lib/settings.js";

export function useSetting<N extends SettingName>(name: N): [SettingValues[N], Dispatch<SetStateAction<SettingValues[N]>>] {
  return usePersistedState<SettingValues[N]>(SETTINGS[name].key, SETTINGS[name].default, {
    deserialize: (raw) => parseSetting(name, raw),
  });
}
