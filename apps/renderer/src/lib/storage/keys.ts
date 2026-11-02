/**
 * Storage key registry — the ONE list of every `gs.*` key the app writes to
 * Web Storage: its store (localStorage / sessionStorage), whether the backup
 * carries it (`lib/storage/transfer.ts`), whether a game-data change prunes it
 * (`lib/storage/dataHash.ts`), the short label the user reads (Settings ›
 * Backup) and the module that owns it.
 *
 * The rule (D7): the backup carries every localStorage key — everything the
 * user set up — except the app's own state, listed with its reason below. The
 * captured gear is not a key: it lives in the capture plugin's files and is
 * never in the backup. Session keys are view state reset at each launch, never
 * backed up. `test/keys.test.ts` checks the list against every `"gs.` literal
 * of the code, both ways.
 *
 * A backed-up key declares how an import merges it (`merge`, one rule per
 * shape of data, run by `transfer.ts`). The settings come from
 * `lib/settings.ts` (`SETTINGS`), composed here, never redeclared.
 *
 * Pure module: no React, no storage access.
 */
import { SETTINGS, clampSetting, parseSetting, settingDefault, type SettingName, type SettingValues } from "../settings.js";
import { SAVED_BUILDS_KEY } from "./savedBuilds.js";
import { FILTER_PRESETS_KEY, isReadableFilterPreset } from "./filterPresets.js";
import { HERO_FILTERS_KEY } from "./heroFilters.js";
import { PRESET_HEROES_KEY } from "./presetHeroes.js";
import { INVENTORY_FILTER_PRESETS_KEY, SCRAP_DEFAULT_KEY, isReadableInventoryPreset } from "./inventoryFilterPresets.js";
import { LOCAL_PRESETS_KEY, isReadableLocalPreset } from "./localPresets.js";
import { EXCLUDED_PIECES_KEY } from "./excludedPieces.js";
import { HERO_PRIORITY_KEY, HERO_PRIORITY_SEEN_KEY } from "./heroPriority.js";
import { PRESET_LOCKED_KEY, PRESET_RANK_KEY, PRESET_SEEN_KEY } from "./presetPriority.js";
import { WORKLIST_KEY, isReadableWorklistEntry } from "./worklist.js";
import { FILTERS_STORAGE_KEY } from "../../screens/inventory/filters.js";

/** How an import merges a key's value into the stored one — one rule per shape
 *  of data. `accept` refuses an entry its loader would skip (neither merged nor
 *  counted). */
export type MergeRule =
  /** `heroUid → entries[]`, each with an `id`: an entry whose id is already
   *  stored for that hero is skipped (the stored one wins), the others are
   *  appended. */
  | { shape: "heroLists"; accept?: (entry: unknown) => boolean }
  /** A list of entries identified by `id` (and, with `uniqueName`, by `name`
   *  too). `keep: "stored"` skips an entry already stored; `keep: "imported"`
   *  replaces it in place. New entries are appended. */
  | { shape: "list"; id: "id" | "heroUid"; keep: "stored" | "imported"; uniqueName?: boolean; accept: (entry: unknown) => boolean }
  /** A record by identifier (uid, num, column…). By default the imported value
   *  replaces the stored one of the same key, the others stay; `keepStored`
   *  keeps a stored value it accepts. `ranks` then renumbers the merged map
   *  1..N in rank order, since a rank is unique. */
  | { shape: "map"; accept: (value: unknown) => boolean; keepStored?: (value: unknown) => boolean; ranks?: true }
  /** A list of identifiers: union. */
  | { shape: "set"; accept: (id: unknown) => boolean }
  /** One value: the imported one replaces the stored one once `normalize`d
   *  (bounded); `undefined` = not a value of this key, ignored. */
  | { shape: "value"; normalize: (value: unknown) => unknown };

/** How the import status cites a key: « 12 saved builds » (`count`),
 *  « worklist (4) » (`paren`), or the label alone (`label`). */
export type ImportSummary = "count" | "paren" | "label";

interface KeyBase {
  key: string;
  store: "local" | "session";
  /** Pruned of the references a new game-data hash no longer knows. */
  prune: boolean;
  /** Short label for the user. Keys sharing a label read as one item. */
  label: string;
  /** Module that owns the key, from `apps/renderer/src/`. */
  owner: string;
}

export type StorageKeySpec =
  | (KeyBase & { backup: true; merge: MergeRule; summary: ImportSummary })
  | (KeyBase & { backup: false });

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isRank = (v: unknown): boolean => typeof v === "number" && Number.isInteger(v) && v > 0;

/** App state, not the user's: in localStorage but never backed up. */
const appState = (key: string, label: string, owner: string): StorageKeySpec =>
  ({ key, store: "local", backup: false, prune: false, label, owner });

/** Session view state: reset at each launch, never backed up. */
const session = (key: string, label: string, owner: string): StorageKeySpec =>
  ({ key, store: "session", backup: false, prune: false, label, owner });

/** The settings' labels in the backup list: one per Settings pane (Result
 *  rows and the Presets screen's threshold named on their own). */
const SETTING_LABEL: Record<SettingName, string> = {
  workerCount: "Solver settings",
  topN: "Solver settings",
  topK: "Solver settings",
  reforgeMode: "Solver settings",
  rerollPotential: "Solver settings",
  heatmap: "Display settings",
  compactCards: "Display settings",
  resultRows: "Result rows",
  presetLossWarn: "Preset loss warning",
  debugSolver: "Developer toggles",
  debugStatLocks: "Developer toggles",
  settingsPane: "Last Settings pane",
};

/** A setting's import value: of the setting's type (as `parseSetting` reads
 *  it), then held within its bounds (`clampSetting`). */
function normalizeSetting<N extends SettingName>(name: N, value: unknown): SettingValues[N] | undefined {
  const parsed = parseSetting(name, JSON.stringify(value) ?? null);
  // `parseSetting` falls back to the default on a wrong type: a value that
  // isn't the default itself was refused.
  if (parsed === settingDefault(name) && value !== parsed) return undefined;
  return clampSetting(name, parsed);
}

function settingKeys(): StorageKeySpec[] {
  return (Object.keys(SETTINGS) as SettingName[]).map((name): StorageKeySpec => {
    const base = { key: SETTINGS[name].key, store: "local" as const, prune: false, label: SETTING_LABEL[name], owner: "lib/settings.ts" };
    // The last Settings pane visited is where this install left the modal.
    if (name === "settingsPane") return { ...base, backup: false };
    return { ...base, backup: true, merge: { shape: "value", normalize: (v) => normalizeSetting(name, v) }, summary: "label" };
  });
}

export const STORAGE_KEYS: readonly StorageKeySpec[] = [
  // ── What the user made: backed up ──────────────────────────────────────
  { key: SAVED_BUILDS_KEY, store: "local", backup: true, prune: false, label: "Saved builds", owner: "lib/storage/savedBuilds.ts", merge: { shape: "heroLists" }, summary: "count" },
  { key: FILTER_PRESETS_KEY, store: "local", backup: true, prune: true, label: "Filter sets", owner: "lib/storage/filterPresets.ts", merge: { shape: "heroLists", accept: isReadableFilterPreset }, summary: "count" },
  { key: INVENTORY_FILTER_PRESETS_KEY, store: "local", backup: true, prune: false, label: "Gear filter sets", owner: "lib/storage/inventoryFilterPresets.ts", merge: { shape: "list", id: "id", keep: "stored", uniqueName: true, accept: isReadableInventoryPreset }, summary: "count" },
  // An id this machine doesn't know falls back to the built-in when read.
  { key: SCRAP_DEFAULT_KEY, store: "local", backup: true, prune: false, label: "Scrap default", owner: "lib/storage/inventoryFilterPresets.ts", merge: { shape: "value", normalize: (id) => (typeof id === "string" && id !== "" ? id : undefined) }, summary: "label" },
  { key: LOCAL_PRESETS_KEY, store: "local", backup: true, prune: false, label: "Local presets", owner: "lib/storage/localPresets.ts", merge: { shape: "list", id: "id", keep: "stored", accept: isReadableLocalPreset }, summary: "count" },
  { key: PRESET_HEROES_KEY, store: "local", backup: true, prune: false, label: "Preset heroes", owner: "lib/storage/presetHeroes.ts", merge: { shape: "map", accept: holdsHeroes, keepStored: holdsHeroes }, summary: "paren" },
  { key: HERO_FILTERS_KEY, store: "local", backup: true, prune: true, label: "Hero filters", owner: "lib/storage/heroFilters.ts", merge: { shape: "map", accept: isRecord }, summary: "label" },
  { key: HERO_PRIORITY_KEY, store: "local", backup: true, prune: false, label: "Hero ranks", owner: "lib/storage/heroPriority.ts", merge: { shape: "map", accept: isRank, ranks: true }, summary: "label" },
  { key: PRESET_RANK_KEY, store: "local", backup: true, prune: false, label: "Preset ranks", owner: "lib/storage/presetPriority.ts", merge: { shape: "map", accept: isRank, ranks: true }, summary: "label" },
  { key: PRESET_LOCKED_KEY, store: "local", backup: true, prune: false, label: "Locked presets", owner: "lib/storage/presetPriority.ts", merge: { shape: "set", accept: (n) => typeof n === "number" && Number.isInteger(n) }, summary: "paren" },
  { key: EXCLUDED_PIECES_KEY, store: "local", backup: true, prune: false, label: "Never-use pieces", owner: "lib/storage/excludedPieces.ts", merge: { shape: "set", accept: (uid) => typeof uid === "string" }, summary: "paren" },
  { key: WORKLIST_KEY, store: "local", backup: true, prune: false, label: "Worklist", owner: "lib/storage/worklist.ts", merge: { shape: "list", id: "heroUid", keep: "imported", accept: isReadableWorklistEntry }, summary: "paren" },
  { key: "gs.builds.notes", store: "local", backup: true, prune: false, label: "Hero notes", owner: "screens/BuildsScreen.tsx", merge: { shape: "map", accept: (note) => typeof note === "string" && note !== "" }, summary: "label" },
  { key: "gs.builder.cols", store: "local", backup: true, prune: false, label: "Optimizer layout", owner: "screens/builder/ResultsTable.tsx", merge: { shape: "map", accept: (shown) => typeof shown === "boolean" }, summary: "label" },
  ...settingKeys(),
  // ── The app's own state: localStorage, never backed up ─────────────────
  // The tab the app reopens on — where this install left off, Heroes on a
  // fresh install.
  appState("gs.tab", "Open tab", "App.tsx"),
  // Setup (plugin, capture) is per machine: a new install runs it again.
  appState("gs.onboarding.done", "Onboarding done", "App.tsx"),
  // The data hash of THIS install: imported, it would skip the prune the
  // imported filters may need, or prune for nothing. Spelled out: `dataHash.ts`
  // reads this registry, it can't be imported from here.
  appState("gs.data.hash", "Data hash", "lib/storage/dataHash.ts"),
  // The keys already offered a default rank, a repair of the rank defaults
  // for this install's roster; the ranks themselves are backed up.
  appState(HERO_PRIORITY_SEEN_KEY, "Heroes offered a rank", "lib/storage/heroPriority.ts"),
  appState(PRESET_SEEN_KEY, "Presets offered a rank", "lib/storage/presetPriority.ts"),
  // ── Session view state ─────────────────────────────────────────────────
  session(FILTERS_STORAGE_KEY, "Gear filters", "screens/inventory/filters.ts"),
  session("gs.inv.tab", "Gear tab", "screens/inventory/InventoryScreen.tsx"),
  session("gs.inv.sort", "Gear sort", "screens/inventory/InventoryScreen.tsx"),
  session("gs.inv.dir", "Gear sort direction", "screens/inventory/InventoryScreen.tsx"),
  session("gs.inv.selected", "Gear piece shown", "screens/inventory/InventoryScreen.tsx"),
  session("gs.inv.selection", "Gear selection", "screens/inventory/InventoryScreen.tsx"),
  session("gs.inv.selectMode", "Gear select mode", "screens/inventory/InventoryScreen.tsx"),
  session("gs.builds.filters", "Heroes filters", "screens/BuildsScreen.tsx"),
  session("gs.gear.view", "Gear view", "screens/gear/GearScreen.tsx"),
  session("gs.gear.breakdownView", "Gear breakdown view", "screens/gear/OverviewView.tsx"),
  session("gs.gear.scrap.filters", "Scrap filters", "screens/inventory/InventoryScreen.tsx"),
  session("gs.gear.scrap.selectMode", "Scrap select mode", "screens/inventory/InventoryScreen.tsx"),
  session("gs.presets.classFilter", "Presets class filter", "screens/presets/PresetsScreen.tsx"),
  session("gs.presets.sort", "Presets sort", "screens/presets/PresetsScreen.tsx"),
  session("gs.presets.forced", "Presets expand / collapse all", "screens/presets/PresetsScreen.tsx"),
  session("gs.presets.open", "Presets cards opened", "screens/presets/PresetsScreen.tsx"),
];

/** A preset-heroes entry that names a reference or an associated hero. */
function holdsHeroes(entry: unknown): boolean {
  if (!isRecord(entry)) return false;
  return typeof entry.referenceUid === "string" || (Array.isArray(entry.associatedUids) && entry.associatedUids.length > 0);
}

/** The keys the backup carries, registry order. */
export const BACKUP_KEYS = STORAGE_KEYS.filter((s): s is Extract<StorageKeySpec, { backup: true }> => s.backup);

/** The keys a new game-data hash prunes. */
export const PRUNED_KEYS: readonly string[] = STORAGE_KEYS.filter((s) => s.prune).map((s) => s.key);

/** What the backup carries, in user words: its labels, each once, in order. */
export function backupLabels(): string[] {
  return [...new Set(BACKUP_KEYS.map((s) => s.label))];
}
