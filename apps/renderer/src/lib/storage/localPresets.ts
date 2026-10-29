/**
 * Local presets — equipment presets kept in GS only, never sent to the game:
 * a name and the 8 wire slots of an in-game preset, made from a Builder result
 * ("Save as local preset…") or copied from an in-game preset on the Presets
 * tab, and listed there under the in-game ones.
 *
 * They hold nothing: `presetHolds` reads the inventory's presets only, so a
 * local preset never keeps a piece out of a solve. The EE is never part of
 * one (stored as "0", like an empty slot), and the name follows the game's
 * 12-character limit so the preset can carry the same name in-game one day.
 *
 * Backed by `localStorage` under one list (`gs.presets.local`) — same shape
 * rationale as `inventoryFilterPresets.ts`. Read tolerantly: a malformed entry
 * is skipped, the rest loads.
 */
import type { GearSlot, Preset } from "@gear-solver/core";

export interface LocalPreset {
  id: string;
  /** 1–12 characters, trimmed (`validLocalPresetName`). */
  name: string;
  /** 8 uids in the wire order (`LOCAL_PRESET_WIRE_SLOTS`), "0" when empty —
   *  the EE (index 6) always "0". */
  itemUids: string[];
  /** The hero the outfit is for — its line on the card; null = none. */
  heroUid: string | null;
  /** Wall-clock ms — the list shows the most recent first. */
  createdAt: number;
}

export const LOCAL_PRESETS_KEY = "gs.presets.local";
const KEY = LOCAL_PRESETS_KEY;

/** The in-game limit on a preset name. */
export const LOCAL_PRESET_NAME_MAX = 12;

/** Wire order of an in-game preset's `ItemUIDList` (see `RawPreset` in core's
 *  raw.ts) — the order `itemUids` is stored in. */
export const LOCAL_PRESET_WIRE_SLOTS: readonly GearSlot[] = [
  "weapon", "accessory", "helmet", "armor", "gloves", "boots", "exclusive", "ooparts",
];

/** Engine order of `SolveBuild.pieceUids` (`lib/solver/types.ts`). */
const ENGINE_SLOTS: readonly GearSlot[] = [
  "weapon", "helmet", "armor", "gloves", "boots", "accessory", "exclusive", "ooparts",
];

const EMPTY_UID = "0";
const EE_INDEX = LOCAL_PRESET_WIRE_SLOTS.indexOf("exclusive");

/** Trimmed name when it is 1–12 characters, else null. */
export function validLocalPresetName(name: string): string | null {
  const n = name.trim();
  return n.length > 0 && n.length <= LOCAL_PRESET_NAME_MAX ? n : null;
}

/** A Builder result's pieces (engine order) as a preset's wire list, the EE
 *  left out. */
export function wireUidsFromBuild(pieceUids: readonly string[]): string[] {
  const out = LOCAL_PRESET_WIRE_SLOTS.map(() => EMPTY_UID);
  ENGINE_SLOTS.forEach((slot, i) => {
    const uid = pieceUids[i];
    if (slot === "exclusive" || !uid) return;
    out[LOCAL_PRESET_WIRE_SLOTS.indexOf(slot)] = uid;
  });
  return out;
}

/** What "Copy as local preset" saves from an in-game preset: its pieces in the
 *  wire order, the EE left out, and its name cut to 12 characters ("Preset
 *  #num" for an unnamed one). A piece goes to its inventory slot (`slotOf`),
 *  else to its wire position; one of neither is dropped. */
export function localCopyOf(preset: Preset, slotOf: (uid: string) => GearSlot | null | undefined): { name: string; itemUids: string[] } {
  const itemUids = LOCAL_PRESET_WIRE_SLOTS.map(() => EMPTY_UID);
  const wire = preset.itemUids.length === LOCAL_PRESET_WIRE_SLOTS.length;
  preset.itemUids.forEach((uid, i) => {
    if (uid === "" || uid === EMPTY_UID) return;
    const slot = slotOf(uid) ?? (wire ? LOCAL_PRESET_WIRE_SLOTS[i] : undefined);
    if (!slot || slot === "exclusive") return;
    itemUids[LOCAL_PRESET_WIRE_SLOTS.indexOf(slot)] = uid;
  });
  const name = validLocalPresetName(preset.name.trim().slice(0, LOCAL_PRESET_NAME_MAX)) ?? `Preset #${preset.num}`.slice(0, LOCAL_PRESET_NAME_MAX);
  return { name, itemUids };
}

// ── storage ─────────────────────────────────────────────────────────────
/** The stored entry as it loads, or null when the loader skips it. The EE
 *  slot is cleared on read. */
function readEntry(e: unknown): LocalPreset | null {
  if (!e || typeof e !== "object") return null;
  const s = e as Partial<LocalPreset>;
  if (typeof s.id !== "string" || typeof s.name !== "string" || validLocalPresetName(s.name) !== s.name) return null;
  if (!Array.isArray(s.itemUids) || s.itemUids.length !== LOCAL_PRESET_WIRE_SLOTS.length) return null;
  if (!s.itemUids.every((u) => typeof u === "string")) return null;
  if (s.heroUid != null && typeof s.heroUid !== "string") return null;
  if (typeof s.createdAt !== "number") return null;
  const itemUids = s.itemUids.map((u, i) => (i === EE_INDEX || u === "" ? EMPTY_UID : u));
  return { id: s.id, name: s.name, itemUids, heroUid: s.heroUid ?? null, createdAt: s.createdAt };
}

/** Whether `loadLocalPresets` would load this stored entry — `applyBackup`
 *  merges and counts only those. */
export function isReadableLocalPreset(entry: unknown): boolean {
  return readEntry(entry) !== null;
}

function readStored(): LocalPreset[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((e) => {
      const p = readEntry(e);
      return p ? [p] : [];
    });
  } catch {
    // Poisoned storage — start fresh rather than crash the tab on mount.
    return [];
  }
}

function persist(list: LocalPreset[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Quota — silently skip. The next edit retries.
  }
}

/** The local presets, most recent first. A malformed entry is skipped. */
export function loadLocalPresets(): LocalPreset[] {
  return readStored().sort((a, b) => b.createdAt - a.createdAt);
}

/** Save a new local preset; an invalid name or a list that isn't 8 slots
 *  saves nothing. Returns the saved preset (null if nothing was saved). */
export function addLocalPreset(input: { name: string; itemUids: readonly string[]; heroUid: string | null }, createdAt = Date.now()): LocalPreset | null {
  const name = validLocalPresetName(input.name);
  if (!name || input.itemUids.length !== LOCAL_PRESET_WIRE_SLOTS.length) return null;
  const entry = readEntry({ id: crypto.randomUUID(), name, itemUids: [...input.itemUids], heroUid: input.heroUid, createdAt });
  if (!entry) return null;
  persist([...readStored(), entry]);
  return entry;
}

/** Rename a local preset; an invalid name or an unknown id changes nothing.
 *  Returns whether it was renamed. */
export function renameLocalPreset(id: string, name: string): boolean {
  const n = validLocalPresetName(name);
  const list = readStored();
  if (!n || !list.some((p) => p.id === id)) return false;
  persist(list.map((p) => (p.id === id ? { ...p, name: n } : p)));
  return true;
}

export function removeLocalPreset(id: string): void {
  const list = readStored();
  const next = list.filter((p) => p.id !== id);
  if (next.length !== list.length) persist(next);
}
