/**
 * Worklist lines of a build — what "+ Worklist" queues for the selected build:
 * one line per changed slot (`buildDiff`, the same "changed" rule as Equip and
 * `upg`), then one line per gem the build wants in a socket of its Talisman /
 * EE that differs from what that piece holds today, with the copies of that
 * gem the piece must end up holding (`toCount`).
 *
 * The gem side reads `SolveBuild.gemAllocation` (OptionIDs in socket order,
 * 0 = empty) against the build piece's own `gemSlots`. A 0 in the allocation is
 * ignored: removing a gem isn't something the game does on its own, and an
 * empty socket costs nothing to leave as is.
 */
import { resolveOption, type GameData, type GearPiece } from "@gear-solver/core";
import { STAT } from "../../design/tokens.js";
import type { SlotDiff } from "../buildDiff.js";
import type { SolveBuild } from "../solver/types.js";
import type { WorklistChange, WorklistGem, WorklistPieceChange } from "../storage/worklist.js";

/** Gem-bearing engine slot → its key in `gemAllocation`. */
const GEM_ALLOCATION_KEY = { ooparts: "talisman", exclusive: "ee" } as const;

/** Display name of a piece — the game's item name, as the cards show it. */
export function pieceName(p: GearPiece, game: GameData | null): string {
  return game?.equipment[String(p.itemId)]?.name ?? p.name ?? `Item ${p.itemId}`;
}

/** A piece's main stat as a worklist line stores it — the first non-combat
 *  main, null when none resolves. */
function pieceMain(p: GearPiece): WorklistPieceChange["toMain"] {
  const main = p.main.find((m) => !m.combatOnly) ?? null;
  return main ? { stat: main.stat, value: main.value, percent: main.percent } : null;
}

/** What a line shows of its target piece: its name and main read from the
 *  CURRENT snapshot (an enchant followed live changes a talisman's main, the
 *  stored copy doesn't follow), the values stored at queue time only when
 *  the piece is gone from it. */
export function worklistTarget(
  c: WorklistChange,
  piece: GearPiece | null,
  game: GameData | null,
): { name: string; main: WorklistPieceChange["toMain"] } {
  if (piece) return { name: pieceName(piece, game), main: pieceMain(piece) };
  return { name: c.toName, main: c.kind === "gem" ? null : (c.toMain ?? null) };
}

/** Snapshot of a gem for a worklist line — "Lv 3 Attack%" + its stat. */
export function worklistGem(id: number, game: GameData | null): WorklistGem {
  const def = game?.gems?.[String(id)];
  const stat = def ? resolveOption(def, 1) : null;
  const label = stat ? `${STAT[stat.stat]?.longLabel ?? stat.stat.toUpperCase()}${stat.stat.endsWith("Pct") ? "%" : ""}` : `Gem ${id}`;
  return { id, name: def ? `Lv ${def.level} ${label}` : label, stat };
}

/** Lines to queue for a build (pieces first, in slot order, then gems). */
export function worklistChangesFor(
  diff: readonly SlotDiff[],
  gemAllocation: SolveBuild["gemAllocation"] | undefined,
  game: GameData | null,
): WorklistChange[] {
  const changes: WorklistChange[] = [];
  for (const { slot, proposed: p, worn: current, changed } of diff) {
    if (!changed) continue; // unchanged slot — not actionable
    changes.push({
      slot,
      toUid: p.uid,
      toName: pieceName(p, game),
      toMain: pieceMain(p),
      fromUid: current?.uid ?? null,
      fromName: current ? pieceName(current, game) : null,
      done: false,
    });
  }
  for (const { slot, proposed: p } of diff) {
    const key = slot === "ooparts" || slot === "exclusive" ? GEM_ALLOCATION_KEY[slot] : null;
    const wanted = key ? gemAllocation?.[key] : undefined;
    if (!wanted) continue;
    const socketedAt = (i: number) => p.gemSlots?.[i] ?? 0;
    const lineAt = (i: number) => !!wanted[i] && wanted[i] !== socketedAt(i);
    // `need` starts at the copies of each gem the build keeps on the piece
    // (sockets no line touches) and grows by one per line for that gem: a
    // line is applied once the piece holds that many (`toCount`), wherever
    // the game put them.
    const need = new Map<number, number>();
    const sockets = Math.max(wanted.length, p.gemSlots?.length ?? 0);
    for (let i = 0; i < sockets; i++) {
      const s = socketedAt(i);
      if (s && !lineAt(i)) need.set(s, (need.get(s) ?? 0) + 1);
    }
    wanted.forEach((id, gemIndex) => {
      const socketed = socketedAt(gemIndex);
      if (!lineAt(gemIndex)) return;
      const toCount = (need.get(id) ?? 0) + 1;
      need.set(id, toCount);
      changes.push({
        kind: "gem",
        slot,
        gemIndex,
        toUid: p.uid,
        toName: pieceName(p, game),
        toGem: worklistGem(id, game),
        fromGem: socketed ? worklistGem(socketed, game) : null,
        toCount,
        done: false,
      });
    });
  }
  return changes;
}
