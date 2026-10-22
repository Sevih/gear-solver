/**
 * In-game equipment presets, read side — what the Presets tab lists: each
 * preset's pieces resolved against the inventory, the heroes currently wearing
 * it, and the pieces it shares with another preset.
 *
 * A preset is the outfit of ONE reference hero, worn as-is by the heroes
 * associated with it; the EE is never part of it (each hero keeps their own,
 * tuned by its gems). The wire list (`Preset.itemUids`, 8 entries) carries an
 * EE slot anyway — it is skipped here, like in `presetSignature`.
 *
 * Pure: no React, no storage — the screen feeds it the inventory.
 */
import type { GearPiece, GearSlot, Inventory, Preset } from "@gear-solver/core";

/** Wire order of `ItemUIDList` (see `RawPreset` in core's raw.ts). Used for
 *  the slot of a uid the inventory no longer holds. */
const PRESET_WIRE_SLOTS: readonly GearSlot[] = [
  "weapon", "accessory", "helmet", "armor", "gloves", "boots", "exclusive", "ooparts",
];

/** The 7 preset slots, in the order the card shows them. */
export const PRESET_SLOTS: readonly GearSlot[] = [
  "weapon", "accessory", "helmet", "armor", "gloves", "boots", "ooparts",
];

/** An empty preset slot comes as uid 0 on the wire. */
const isEmptyUid = (uid: string): boolean => uid === "" || uid === "0";

/** Sorted, comma-joined UID key for a set of gear pieces, EE pieces and empty
 *  slots excluded. Same routine on both sides (preset vs hero) keeps the
 *  comparison order-independent and EE-agnostic: same preset, different EE is
 *  still the same preset (the in-game editor swaps the EE independently). */
export function presetSignature(uids: Iterable<string>, slotByUid: ReadonlyMap<string, GearPiece["slot"]>): string {
  const out: string[] = [];
  for (const u of uids) {
    if (isEmptyUid(u) || slotByUid.get(u) === "exclusive") continue;
    out.push(u);
  }
  return out.sort().join(",");
}

/** A preset that holds a given piece. */
export interface PresetRef {
  num: number;
  name: string;
}

export interface PresetPiece {
  /** Engine slot — from the piece, else from the wire position; null when
   *  neither is known (a uid outside the inventory in a non-8-entry list). */
  slot: GearSlot | null;
  uid: string;
  /** The inventory piece; null when the inventory no longer holds it. */
  piece: GearPiece | null;
  missing: boolean;
  /** Other presets holding the same piece (empty when it's this one's alone). */
  sharedWith: PresetRef[];
}

export interface PresetRow {
  preset: Preset;
  /** Non-EE, non-empty slots, in `PRESET_SLOTS` order. */
  pieces: PresetPiece[];
  /** Pieces present in the inventory — what a hero would wear. */
  presentPieces: GearPiece[];
  /** Heroes whose equipped gear, EE aside, is exactly this preset. */
  wearerUids: string[];
  missingCount: number;
  sharedCount: number;
  /** No piece at all — listed collapsed. */
  empty: boolean;
}

/** One row per in-game preset, in the game's `num` order. */
export function presetRows(inventory: Inventory): PresetRow[] {
  const byUid = new Map<string, GearPiece>();
  const slotByUid = new Map<string, GearPiece["slot"]>();
  const equippedByHero = new Map<string, string[]>();
  for (const g of inventory.gear) {
    byUid.set(g.uid, g);
    slotByUid.set(g.uid, g.slot);
    if (!g.equippedBy) continue;
    const list = equippedByHero.get(g.equippedBy);
    if (list) list.push(g.uid);
    else equippedByHero.set(g.equippedBy, [g.uid]);
  }

  // Heroes indexed by their EE-excluded signature — one lookup per preset.
  const heroesBySig = new Map<string, string[]>();
  for (const c of inventory.characters) {
    const sig = presetSignature(equippedByHero.get(c.uid) ?? [], slotByUid);
    if (!sig) continue;
    const list = heroesBySig.get(sig);
    if (list) list.push(c.uid);
    else heroesBySig.set(sig, [c.uid]);
  }

  const presets = [...inventory.presets].sort((a, b) => a.num - b.num);
  // Non-EE slots of each preset, and which presets hold each uid.
  const slotsOf = presets.map((p) => presetSlots(p, byUid));
  const holders = new Map<string, PresetRef[]>();
  presets.forEach((p, i) => {
    for (const { uid } of slotsOf[i]!) {
      const list = holders.get(uid);
      const ref = { num: p.num, name: p.name };
      if (list) list.push(ref);
      else holders.set(uid, [ref]);
    }
  });

  return presets.map((preset, i) => {
    const pieces = slotsOf[i]!.map(({ uid, slot }): PresetPiece => {
      const piece = byUid.get(uid) ?? null;
      return {
        slot, uid, piece, missing: piece == null,
        sharedWith: (holders.get(uid) ?? []).filter((r) => r.num !== preset.num),
      };
    });
    const sig = presetSignature(preset.itemUids, slotByUid);
    return {
      preset,
      pieces,
      presentPieces: pieces.flatMap((p) => (p.piece ? [p.piece] : [])),
      wearerUids: sig ? heroesBySig.get(sig) ?? [] : [],
      missingCount: pieces.filter((p) => p.missing).length,
      sharedCount: pieces.filter((p) => p.sharedWith.length > 0).length,
      empty: pieces.length === 0,
    };
  });
}

/** A preset's non-EE, non-empty uids with their slot, in `PRESET_SLOTS` order
 *  (unknown slots last). A uid listed twice is kept once. */
function presetSlots(p: Preset, byUid: ReadonlyMap<string, GearPiece>): Array<{ uid: string; slot: GearSlot | null }> {
  const out: Array<{ uid: string; slot: GearSlot | null }> = [];
  const seen = new Set<string>();
  p.itemUids.forEach((uid, i) => {
    if (isEmptyUid(uid) || seen.has(uid)) return;
    const wireSlot = p.itemUids.length === PRESET_WIRE_SLOTS.length ? PRESET_WIRE_SLOTS[i]! : null;
    const slot = byUid.get(uid)?.slot ?? wireSlot;
    if (slot === "exclusive") return;
    seen.add(uid);
    out.push({ uid, slot });
  });
  const rank = (s: GearSlot | null) => (s ? PRESET_SLOTS.indexOf(s) : PRESET_SLOTS.length);
  return out.sort((a, b) => rank(a.slot) - rank(b.slot));
}
