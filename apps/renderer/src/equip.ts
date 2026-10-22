/**
 * Equip / Unequip client — moves gear by rewriting the captured snapshot.
 *
 * The transform itself lives in `@gear-solver/core` (`equipItem`, pure +
 * tested); here we just run it against the loaded game data (needed to
 * resolve a piece's slot) and persist the result by POSTing the FULL rewritten
 * `user_item.json` back to the local server, which writes it to disk
 * (`<capture folder>/user_item.json`). The caller re-imports the inventory
 * afterwards (e.g. `refreshInventory` in App.tsx) to pick the edit up.
 *
 * Wired to the Builder via "Equip build" (applies a solved build's pieces to
 * the selected hero in one atomic snapshot rewrite — see `equipPieces`).
 */
import { equipItem, type GameData, type RawUserItem } from "@gear-solver/core";

/** Read the current captured snapshot (served live by the dev middleware /
 *  prod server). Null when no capture is present or the shape is unexpected. */
async function fetchRawUserItem(): Promise<RawUserItem | null> {
  try {
    const r = await fetch("/captured/user_item.json");
    if (!r.ok) return null;
    const j = (await r.json()) as RawUserItem | null;
    return j && Array.isArray(j.ItemList) ? j : null;
  } catch {
    return null;
  }
}

/** How an equip ended: written, no readable snapshot to edit, refused because
 *  the game is open (409 — the plugin owns the snapshot then, and in-game moves
 *  reach it by themselves), or any other write failure. */
export type EquipOutcome = "ok" | "no-snapshot" | "game-open" | "failed";

/** Persist a rewritten snapshot. */
async function writeUserItem(raw: RawUserItem): Promise<EquipOutcome> {
  try {
    const r = await fetch("/api/captured/user-item", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(raw),
    });
    return r.ok ? "ok" : r.status === 409 ? "game-open" : "failed";
  } catch {
    return "failed";
  }
}

/** Equip several pieces onto `charUid` in ONE snapshot rewrite — fetch once,
 *  fold `equipItem` over each uid, write once (atomic; no per-piece round-trip).
 *  Used by the Builder's "Equip build" to apply a whole solved build. Pieces
 *  currently on another hero are moved (stolen); same-slot duplicates within the
 *  list resolve in order. Empty/unknown uids are skipped (no-op clones).
 *  Returns "ok" once persisted (the caller should re-import the inventory),
 *  else why not. */
export async function equipPieces(game: GameData, itemUids: string[], charUid: string): Promise<EquipOutcome> {
  const raw = await fetchRawUserItem();
  if (!raw) return "no-snapshot";
  let next = raw;
  for (const uid of itemUids) if (uid) next = equipItem(next, game, uid, charUid);
  return writeUserItem(next);
}

/** Apply a heterogeneous batch of `{ uid → heroUid }` moves in ONE snapshot
 *  rewrite (fetch once, fold `equipItem` over each, write once). Unlike
 *  `equipPieces` (all onto one hero), each move can target a different hero —
 *  the Worklist's "Apply all" across queued builds. `equipItem`'s steal
 *  semantics make the FINAL state order-independent for a consistent batch —
 *  no single copy claimed by two heroes AND no hero given two pieces for one
 *  slot (otherwise the last move wins; `planWorklist` drops the older of two
 *  same-hero, same-slot changes so its batch is consistent) — so the caller is
 *  free to pass a dependency-ordered list for tidiness without depending on it
 *  for correctness.
 *  Returns true once persisted; the caller should re-import the inventory. */
export async function equipAssignments(
  game: GameData,
  moves: ReadonlyArray<{ uid: string; heroUid: string }>,
): Promise<boolean> {
  const raw = await fetchRawUserItem();
  if (!raw) return false;
  let next = raw;
  for (const m of moves) if (m.uid) next = equipItem(next, game, m.uid, m.heroUid);
  return (await writeUserItem(next)) === "ok";
}
