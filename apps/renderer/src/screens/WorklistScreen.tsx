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
import type { Character, GameData, GearPiece, Inventory } from "@gear-solver/core";
import { CharacterPortrait, EquipmentIcon, SlotIcon, StatIcon } from "../design/EquipmentIcon.js";
import { toUiPiece } from "../design/adapter.js";
import { cx } from "../design/cx.js";
import { SLOT_BY, toDesignSlot } from "../design/tokens.js";
import { equipAssignments, equipPieces } from "../equip.js";
import {
  equippedByHero,
  type WorklistEntry,
} from "../lib/storage/worklist.js";
import { planWorklist } from "../lib/worklist/plan.js";

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
  const [applyingAll, setApplyingAll] = useState(false);
  const [applyAllError, setApplyAllError] = useState<string | null>(null);

  // Live oracles derived from the current snapshot — recomputed each render so
  // the cards stay truthful as the inventory changes underneath them.
  const equipped = useMemo(() => equippedByHero(inventory), [inventory]);
  const invUids = useMemo(() => {
    const s = new Set<string>();
    if (inventory) for (const g of inventory.gear) s.add(g.uid);
    return s;
  }, [inventory]);
  // Live piece + roster lookups so each change row can show the target item's
  // image, stats, and CURRENT owner (the name alone isn't enough to identify a
  // physical copy in-game).
  const pieceByUid = useMemo(() => {
    const m = new Map<string, GearPiece>();
    if (inventory) for (const g of inventory.gear) m.set(g.uid, g);
    return m;
  }, [inventory]);
  const charByUid = useMemo(() => {
    const m = new Map<string, Character>();
    if (inventory) for (const c of inventory.characters) m.set(c.uid, c);
    return m;
  }, [inventory]);
  // The transaction plan: free-before-use order, contention, cycles, and the
  // flat assignment list for the atomic "Apply all". Single source of truth for
  // the cross-entry concerns the per-card view can't see.
  const plan = useMemo(() => planWorklist(worklist, inventory), [worklist, inventory]);
  // How many entries claim each target piece — > 1 ⇒ contention (a piece is a
  // single physical copy; two heroes can't both wear it).
  const claimCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of worklist) for (const c of e.changes) m.set(c.toUid, (m.get(c.toUid) ?? 0) + 1);
    return m;
  }, [worklist]);
  // uid → display name, for the contention banner (drawn from the queued diffs).
  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of worklist) for (const c of e.changes) m.set(c.toUid, c.toName);
    return m;
  }, [worklist]);

  const applyAll = async () => {
    if (!game || plan.assignments.length === 0) return;
    setApplyingAll(true);
    setApplyAllError(null);
    const ok = await equipAssignments(game, plan.assignments);
    setApplyingAll(false);
    if (ok) onAfterApply();
    else setApplyAllError("Apply failed — disarm the capture pipeline and retry.");
  };

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

  const contendedNames = [...plan.contended.keys()].map((uid) => nameOf.get(uid) ?? uid);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3 px-6 py-5">
      {/* Transaction header — apply the whole queue across heroes in one go. */}
      {plan.assignments.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-white/8 bg-bg-elev-1 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="font-display text-[13px] font-semibold text-white">
                {plan.assignments.length} change{plan.assignments.length === 1 ? "" : "s"} across{" "}
                {plan.heroes} hero{plan.heroes === 1 ? "" : "es"}
              </div>
              <div className="font-mono text-[10.5px] text-white/50">
                {plan.applicable
                  ? plan.hasDeps
                    ? "Applied in free-before-use order — a piece is freed before the build that reuses it."
                    : "No cross-build dependencies — order doesn't matter."
                  : "Resolve the contested piece below before applying everything."}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void applyAll()}
              disabled={applyingAll || !game || !plan.applicable}
              className={cx(
                "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-3 text-[11.5px] font-medium transition-colors",
                applyingAll || !game || !plan.applicable
                  ? "cursor-not-allowed border-white/6 bg-white/2 text-white/45"
                  : "border-cyan-400/40 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25",
              )}
              title="Apply every queued change across all heroes in one snapshot rewrite (does NOT touch the game)."
            >
              {applyingAll ? "Applying…" : "Apply all"}
            </button>
          </div>
          {/* Contention — unsolvable by ordering, the user must drop/retarget. */}
          {!plan.applicable && (
            <div className="rounded-md border border-amber-400/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-100/90">
              <span className="font-semibold">Contested:</span>{" "}
              {contendedNames.join(", ")} — two builds want the same single copy. Remove or
              re-optimize one entry, then Apply all.
            </div>
          )}
          {applyAllError && <span className="text-[11px] text-rose-300">{applyAllError}</span>}
        </div>
      )}

      {worklist.map((entry) => (
        <WorklistCard
          key={entry.id}
          entry={entry}
          game={game}
          equippedOnHero={equipped.get(entry.heroUid) ?? null}
          invUids={invUids}
          claimCount={claimCount}
          pieceByUid={pieceByUid}
          charByUid={charByUid}
          step={plan.position.get(entry.id) ?? null}
          cyclic={plan.cyclic.has(entry.id)}
          onChange={onChange}
          worklist={worklist}
          onAfterApply={onAfterApply}
        />
      ))}
    </div>
  );
}

function WorklistCard({
  entry, game, equippedOnHero, invUids, claimCount, pieceByUid, charByUid, step, cyclic, worklist, onChange, onAfterApply,
}: {
  entry: WorklistEntry;
  game: GameData | null;
  equippedOnHero: Set<string> | null;
  invUids: Set<string>;
  claimCount: Map<string, number>;
  /** Live inventory lookups — target piece (image + stats) and its current owner. */
  pieceByUid: Map<string, GearPiece>;
  charByUid: Map<string, Character>;
  /** 1-based apply position in the free-before-use plan, or null when ordering
   *  is trivial (no cross-build dependency). */
  step: number | null;
  /** Caught in a dependency cycle — no human order, apply atomically. */
  cyclic: boolean;
  worklist: WorklistEntry[];
  onChange: (next: WorklistEntry[]) => void;
  onAfterApply: () => void;
}) {
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  // Per-change live state — applied (target already on hero), stale (target
  // gone from the inventory), or conflicting (claimed by another entry too) —
  // plus the live piece (image + stats) and its current owner.
  const rows = entry.changes.map((c) => {
    const applied = equippedOnHero?.has(c.toUid) ?? false;
    const stale = !invUids.has(c.toUid);
    const conflict = (claimCount.get(c.toUid) ?? 0) > 1;
    // Engine slot → player-facing design slot (ooparts → Talisman, shoes →
    // Boots) for the label + icon; the game never shows "ooparts".
    const ds = toDesignSlot(c.slot) ?? c.slot;
    const piece = pieceByUid.get(c.toUid) ?? null;
    const ui = piece && game ? toUiPiece(piece, game) : null;
    const owner = piece?.equippedBy ? (charByUid.get(piece.equippedBy) ?? null) : null;
    return { c, applied, stale, conflict, ds, ui, hasPiece: !!piece, owner };
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
        {/* Suggested apply order — only shown when builds depend on each other. */}
        {cyclic ? (
          <span title="This build and another each free a piece the other needs — no sequential order works. Use Apply all (resolved atomically)."
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-amber-400/40 bg-amber-500/10 text-[11px] text-amber-200">
            ↻
          </span>
        ) : step != null ? (
          <span title={`Apply step ${step} — frees a piece a later build reuses, so do it first.`}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-cyan-400/30 bg-cyan-500/10 font-mono text-[11px] font-semibold tabular-nums text-cyan-200">
            {step}
          </span>
        ) : null}
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

      {/* Change lines — one per changed slot. Each shows the TARGET item's image,
       *  stats, and current owner, since the name alone can't identify a copy. */}
      <div className="flex flex-col divide-y divide-white/5">
        {rows.map(({ c, applied, stale, conflict, ds, ui, hasPiece, owner }) => (
          <label
            key={c.slot}
            className={cx(
              "flex cursor-pointer items-start gap-2.5 py-2",
              stale && "opacity-45",
            )}
          >
            <input
              type="checkbox"
              checked={applied || c.done}
              disabled={applied || stale}
              onChange={(e) => toggleDone(c.slot, e.target.checked)}
              className="mt-1 h-3.5 w-3.5 shrink-0 accent-cyan-400"
            />
            {/* Item image (or slot-type fallback when the piece is gone). */}
            {ui ? (
              <EquipmentIcon piece={ui.iconPiece} size={40} className="shrink-0" />
            ) : (
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-white/8 bg-black/20">
                <SlotIcon slot={ds} size={20} className="opacity-50" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              {/* Slot · item name · status. */}
              <div className="flex items-center gap-1.5">
                <span className="shrink-0 text-[9.5px] uppercase tracking-wider text-white/45">{SLOT_BY[ds]?.label ?? ds}</span>
                <span className={cx("min-w-0 truncate text-[12.5px] font-medium", applied ? "text-emerald-300" : "text-white")}>{c.toName}</span>
                {applied ? (
                  <span className="ml-auto shrink-0 text-[9.5px] font-semibold uppercase tracking-wider text-emerald-300">applied</span>
                ) : conflict ? (
                  <span className="ml-auto shrink-0 text-[9.5px] font-semibold uppercase tracking-wider text-amber-300">contested</span>
                ) : stale ? (
                  <span className="ml-auto shrink-0 text-[9.5px] font-semibold uppercase tracking-wider text-white/40">gone</span>
                ) : null}
              </div>
              {/* Stats — main(s) then substats (the deterministic identifier). */}
              {ui && (ui.main.length > 0 || ui.subs.length > 0) && (
                <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-mono text-[10.5px] tabular-nums">
                  {ui.main.map((m, i) => (
                    <span key={`m${i}`} className="flex items-center gap-0.5 text-white/90">
                      <StatIcon stat={m.stat} size={11} className="shrink-0" />{m.value}
                    </span>
                  ))}
                  {ui.subs.map((s, i) => (
                    <span key={`s${i}`} className="flex items-center gap-0.5 text-white/55">
                      <StatIcon stat={s.stat} size={11} className="shrink-0" />{s.value}
                    </span>
                  ))}
                </div>
              )}
              {/* Where the item currently lives + what it replaces on the hero. */}
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-white/55">
                {owner ? (
                  <span className="flex items-center gap-1">
                    <CharacterPortrait charId={owner.charId} name={owner.name ?? undefined} size={14} className="rounded-sm" />
                    <span className="text-white/70">on {owner.name ?? `#${owner.charId}`}</span>
                  </span>
                ) : hasPiece ? (
                  <span className="text-white/50">in Inventory</span>
                ) : null}
                {c.fromName && (
                  <span className="text-white/35">· replaces <span className="line-through">{c.fromName}</span></span>
                )}
              </div>
            </div>
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
