/**
 * Model of the Inventory's Scrap value card: which pieces it prices (the
 * player's selection, else the filtered view), the material rows it shows,
 * and the pure updates of the selection. The selection is an ephemeral
 * `Set` of piece ids owned by the screen; every update returns a new `Set`
 * (or the same one when nothing changed) so React sees the change.
 */
import type { ItemsTable } from "@gear-solver/core";
import type { ScrapValue } from "./scrapValue.js";

export interface ScrapScope<T> {
  pieces: T[];
  /** "2 selected" or "37 shown". */
  label: string;
}

/** The selection when it isn't empty — every selected piece, shown or not —
 *  else the filtered view. `byId` resolves the selected ids (the full
 *  inventory, not the view). */
export function scrapScope<T extends { id: string }>(
  selection: ReadonlySet<string>,
  filtered: readonly T[],
  byId: ReadonlyMap<string, T>,
): ScrapScope<T> {
  if (selection.size === 0) return { pieces: [...filtered], label: `${filtered.length} shown` };
  const pieces: T[] = [];
  for (const id of selection) {
    const p = byId.get(id);
    if (p) pieces.push(p);
  }
  return { pieces, label: `${pieces.length} selected` };
}

export interface MaterialRow {
  id: string;
  name: string;
  /** Icon asset name (`/img/items/<icon>.webp`), null when unknown. */
  icon: string | null;
  min: number;
  max: number;
}

/** Dissolve materials with their name and icon from `items`; an id the
 *  table doesn't know keeps the name `scrapValue` gave it (`item <id>`). */
export function materialRows(v: ScrapValue, items: ItemsTable | null | undefined): MaterialRow[] {
  return v.dissolve.items.map((m) => {
    const def = items?.[m.id];
    return { id: m.id, name: def?.name || m.name, icon: def?.icon || null, min: m.min, max: m.max };
  });
}

export function toggleSelection(selection: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selection);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

/** Adds every id; the same `Set` back when all were already in. */
export function addAll(selection: Set<string>, ids: Iterable<string>): Set<string> {
  let next: Set<string> | null = null;
  for (const id of ids) {
    if (selection.has(id) || next?.has(id)) continue;
    next ??= new Set(selection);
    next.add(id);
  }
  return next ?? selection;
}

/** Drops the ids no longer in the inventory; the same `Set` back when none. */
export function pruneSelection(selection: Set<string>, alive: { has(id: string): boolean }): Set<string> {
  let next: Set<string> | null = null;
  for (const id of selection) {
    if (alive.has(id)) continue;
    next ??= new Set(selection);
    next.delete(id);
  }
  return next ?? selection;
}
