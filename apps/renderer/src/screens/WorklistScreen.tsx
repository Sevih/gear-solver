/**
 * Worklist screen — the cross-hero "to-do" queue. Builds queued from the
 * Builder land here as per-hero cards; each changed slot is a checkable line.
 * Work through them in-game and tick each off, or "Apply locally" to rewrite the
 * captured snapshot so the rest of the app reflects the swap (we never write to
 * the game — that API doesn't exist).
 *
 * All decision state is derived LIVE from the current inventory, so the list
 * self-heals as pieces move: a change whose target piece is already on the hero
 * reads as applied (green), a target claimed by two entries flags a conflict,
 * and a target that vanished from the inventory (post data-sync) reads as stale.
 */
import { useMemo, useState } from "react";
import type { GameData, Inventory } from "@gear-solver/core";
import { CharacterPortrait, SlotIcon, StatIcon } from "../design/EquipmentIcon.js";
import { cx } from "../design/cx.js";
import { SLOT_BY, toDesignSlot } from "../design/tokens.js";
import { equipPieces } from "../equip.js";
import {
  equippedByHero,
  type WorklistEntry,
} from "../lib/storage/worklist.js";

interface WorklistScreenProps {
  inventory: Inventory | null;
  game: GameData | null;
  worklist: WorklistEntry[];
  /** Persisted mutation — App owns the list and writes localStorage. */
  onChange: (next: WorklistEntry[]) => void;
  /** Re-import the inventory after a local apply rewrote the snapshot. */
  onAfterApply: () => void;
}

export function WorklistScreen({ inventory, game, worklist, onChange, onAfterApply }: WorklistScreenProps) {
  // Live oracles derived from the current snapshot — recomputed each render so
  // the cards stay truthful as the inventory changes underneath them.
  const equipped = useMemo(() => equippedByHero(inventory), [inventory]);
  const invUids = useMemo(() => {
    const s = new Set<string>();
    if (inventory) for (const g of inventory.gear) s.add(g.uid);
    return s;
  }, [inventory]);
  // How many entries claim each target piece — > 1 ⇒ contention (a piece is a
  // single physical copy; two heroes can't both wear it).
  const claimCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of worklist) for (const c of e.changes) m.set(c.toUid, (m.get(c.toUid) ?? 0) + 1);
    return m;
  }, [worklist]);

  if (worklist.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-6 py-24 text-center">
        <h2 className="font-display text-[15px] font-semibold text-white/85">Worklist is empty</h2>
        <p className="max-w-md text-[12px] leading-relaxed text-white/55">
          Optimize a hero in the <span className="text-cyan-200">Builder</span>, pick a build, then
          press <span className="text-cyan-200">Add to worklist</span>. Queued gear changes land
          here as a checklist you can work through in-game.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3 px-6 py-5">
      {worklist.map((entry) => (
        <WorklistCard
          key={entry.id}
          entry={entry}
          game={game}
          equippedOnHero={equipped.get(entry.heroUid) ?? null}
          invUids={invUids}
          claimCount={claimCount}
          onChange={onChange}
          worklist={worklist}
          onAfterApply={onAfterApply}
        />
      ))}
    </div>
  );
}

function WorklistCard({
  entry, game, equippedOnHero, invUids, claimCount, worklist, onChange, onAfterApply,
}: {
  entry: WorklistEntry;
  game: GameData | null;
  equippedOnHero: Set<string> | null;
  invUids: Set<string>;
  claimCount: Map<string, number>;
  worklist: WorklistEntry[];
  onChange: (next: WorklistEntry[]) => void;
  onAfterApply: () => void;
}) {
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  // Per-change live state — applied (target already on hero), stale (target
  // gone from the inventory), or conflicting (claimed by another entry too).
  const rows = entry.changes.map((c) => {
    const applied = equippedOnHero?.has(c.toUid) ?? false;
    const stale = !invUids.has(c.toUid);
    const conflict = (claimCount.get(c.toUid) ?? 0) > 1;
    // Engine slot → player-facing design slot (ooparts → Talisman, shoes →
    // Boots) for the label + icon; the game never shows "ooparts".
    const ds = toDesignSlot(c.slot) ?? c.slot;
    return { c, applied, stale, conflict, ds };
  });
  const remaining = rows.filter((r) => !r.applied && !r.stale).length;
  const allApplied = rows.every((r) => r.applied || r.stale);
  const hasConflict = rows.some((r) => r.conflict && !r.applied);
  const hasStale = rows.some((r) => r.stale);

  const toggleDone = (slot: string, done: boolean) => {
    onChange(
      worklist.map((e) =>
        e.id !== entry.id ? e : { ...e, changes: e.changes.map((c) => (c.slot === slot ? { ...c, done } : c)) },
      ),
    );
  };
  const remove = () => onChange(worklist.filter((e) => e.id !== entry.id));

  const applyLocally = async () => {
    if (!game) return;
    // Only equip targets that still exist; equipping a piece already on the hero
    // is a harmless no-op, so we don't filter those out.
    const uids = rows.filter((r) => !r.stale).map((r) => r.c.toUid);
    if (uids.length === 0) return;
    setApplying(true);
    setApplyError(null);
    const ok = await equipPieces(game, uids, entry.heroUid);
    setApplying(false);
    if (ok) onAfterApply();
    else setApplyError("Apply failed — disarm the capture pipeline and retry.");
  };

  return (
    <div className={cx(
      "flex flex-col gap-2 rounded-lg border bg-bg-elev-1 px-4 py-3",
      allApplied ? "border-emerald-400/30" : hasConflict ? "border-amber-400/40" : "border-white/8",
    )}>
      {/* Header — hero identity + at-a-glance status. */}
      <div className="flex items-center gap-2.5">
        <CharacterPortrait charId={entry.charId} name={entry.heroName} size={32} className="rounded-md" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-[13.5px] font-semibold text-white">{entry.heroName}</div>
          <div className="flex items-center gap-1.5 font-mono text-[10px] tabular-nums text-white/50">
            <span className="uppercase tracking-wider">{entry.mode === "cp" ? "CP" : "Score"}</span>
            <span>·</span>
            <span>{allApplied ? "all applied" : `${remaining} of ${entry.changes.length} to do`}</span>
            {entry.cp != null && <><span>·</span><span>CP {entry.cp.toLocaleString()}</span></>}
          </div>
        </div>
        {hasConflict && (
          <span title="Another queued build wants one of these pieces too — a piece is a single copy, so only one hero can wear it."
            className="shrink-0 rounded border border-amber-400/40 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-200">
            conflict
          </span>
        )}
        {hasStale && (
          <span title="A target piece is no longer in the inventory (data re-synced) — it's skipped on apply."
            className="shrink-0 rounded border border-white/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white/50">
            stale
          </span>
        )}
      </div>

      {/* Change lines — one per changed slot. */}
      <div className="flex flex-col divide-y divide-white/5">
        {rows.map(({ c, applied, stale, conflict, ds }) => (
          <label
            key={c.slot}
            className={cx(
              "flex cursor-pointer items-center gap-2.5 py-1.5 text-[12px]",
              stale && "opacity-45",
            )}
          >
            <input
              type="checkbox"
              checked={applied || c.done}
              disabled={applied || stale}
              onChange={(e) => toggleDone(c.slot, e.target.checked)}
              className="h-3.5 w-3.5 shrink-0 accent-cyan-400"
            />
            <SlotIcon slot={ds} size={16} className="shrink-0 opacity-80" />
            <span className="w-14 shrink-0 text-[10px] uppercase tracking-wider text-white/45">
              {SLOT_BY[ds]?.label ?? ds}
            </span>
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              {c.fromName ? (
                <span className="min-w-0 truncate text-white/45 line-through">{c.fromName}</span>
              ) : (
                <span className="text-white/35 italic">(empty)</span>
              )}
              <span className="shrink-0 text-cyan-300/70">→</span>
              <span className={cx("min-w-0 truncate", applied ? "text-emerald-300" : "text-white")}>{c.toName}</span>
              {/* Talisman main is variable and names can collide — show it so the
               *  right talisman is identifiable in-game. */}
              {ds === "talisman" && c.toMain && (
                <span className="flex shrink-0 items-center gap-0.5 text-[10.5px] text-white/55" title="Main stat">
                  <StatIcon stat={c.toMain.stat} size={11} />
                  {c.toMain.value}{c.toMain.percent ? "%" : ""}
                </span>
              )}
            </span>
            {applied ? (
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">applied</span>
            ) : conflict ? (
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-amber-300">contested</span>
            ) : null}
          </label>
        ))}
      </div>

      {/* Actions. */}
      <div className="flex items-center gap-2 pt-0.5">
        <button
          type="button"
          onClick={() => void applyLocally()}
          disabled={applying || allApplied || !game}
          className={cx(
            "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11.5px] font-medium transition-colors",
            applying || allApplied || !game
              ? "cursor-not-allowed border-white/6 bg-white/2 text-white/45"
              : "border-cyan-400/40 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25",
          )}
          title="Rewrite the captured snapshot so the app reflects these swaps (does NOT touch the game)."
        >
          {applying ? "Applying…" : allApplied ? "Applied" : "Apply locally"}
        </button>
        <button
          type="button"
          onClick={remove}
          className="inline-flex h-7 items-center rounded-md border border-white/8 bg-white/3 px-2.5 text-[11.5px] text-white/70 transition-colors hover:bg-white/6 hover:text-white"
        >
          Remove
        </button>
        {applyError && <span className="text-[11px] text-rose-300">{applyError}</span>}
      </div>
    </div>
  );
}
