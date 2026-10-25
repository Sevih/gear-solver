/**
 * Worklist screen — the cross-hero "to-do" queue. Builds queued from the
 * Builder land here as per-hero cards (one per hero — a new build replaces
 * the card); each changed slot is a checkable line, and so is each gem to
 * socket on the build's Talisman / EE. Work through them in-game and tick each
 * off, or "Apply locally" to rewrite the captured snapshot so the rest of the
 * app reflects the swap (we never write to the game — that API doesn't exist;
 * gems aren't applied locally either, they are socketed in-game).
 *
 * All decision state is derived LIVE from the current inventory, so the list
 * self-heals as pieces move: a change whose target piece is already on the hero
 * (with the gem socketed on it, for a gem line) reads as applied (green), a
 * target wanted by two heroes flags a conflict, and a target that vanished
 * from the inventory (eaten as fodder, sold or dissolved in-game) reads as
 * gone (amber). A line's name and main are read from the current snapshot too
 * (`worklistTarget`), the copies stored at queue time only once it's gone.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Character, GameData, GearPiece, Inventory } from "@gear-solver/core";
import { CharacterPortrait, EquipmentIcon, SlotIcon, StatIcon } from "../design/EquipmentIcon.js";
import { toUiPiece } from "../design/adapter.js";
import { cx } from "../design/cx.js";
import { SLOT_BY, toDesignSlot } from "../design/tokens.js";
import { EQUIP_FAILURE, equipAssignments, equipPieces } from "../equip.js";
import { changeKey, gemSlotsByUid, type EquippedByHero, type GemSlotsByUid, type WorklistChange, type WorklistEntry, type WorklistGem } from "../lib/storage/worklist.js";
import { worklistTarget } from "../lib/worklist/changes.js";
import { changeState, planWorklist } from "../lib/worklist/plan.js";

interface WorklistScreenProps {
  inventory: Inventory | null;
  game: GameData | null;
  /** heroUid → equipped piece uids, memoized once per inventory by the App. */
  equipped: EquippedByHero;
  worklist: WorklistEntry[];
  /** Persisted mutation — App owns the list and writes localStorage. */
  onChange: (next: WorklistEntry[]) => void;
  /** Re-import the inventory after a local apply rewrote the snapshot. */
  onAfterApply: () => void;
}

/** False once the component unmounted — an apply can outlive a tab switch,
 *  and its local state must not be set after that. */
function useMountedRef() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  return mounted;
}

export function WorklistScreen({ inventory, game, equipped, worklist, onChange, onAfterApply }: WorklistScreenProps) {
  const [applyingAll, setApplyingAll] = useState(false);
  const [applyAllError, setApplyAllError] = useState<string | null>(null);
  const mounted = useMountedRef();

  // Live oracles derived from the current snapshot — recomputed each render so
  // the cards stay truthful as the inventory changes underneath them.
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
  // Socketed gems per piece — the gem lines' "applied" oracle.
  const gemSlots = useMemo(() => gemSlotsByUid(inventory), [inventory]);
  const charByUid = useMemo(() => {
    const m = new Map<string, Character>();
    if (inventory) for (const c of inventory.characters) m.set(c.uid, c);
    return m;
  }, [inventory]);
  // The transaction plan: free-before-use order, contention, cycles, and the
  // flat assignment list for the atomic "Apply all". Single source of truth for
  // the cross-entry concerns the per-card view can't see.
  const plan = useMemo(() => planWorklist(worklist, inventory), [worklist, inventory]);
  // uid → display name, for the contention banner (the queued pieces, named
  // from the current snapshot).
  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of worklist) for (const c of e.changes) if (c.kind !== "gem") m.set(c.toUid, worklistTarget(c, pieceByUid.get(c.toUid) ?? null, game).name);
    return m;
  }, [worklist, pieceByUid, game]);

  const applyAll = async () => {
    if (!game || plan.assignments.length === 0) return;
    setApplyingAll(true);
    setApplyAllError(null);
    const outcome = await equipAssignments(game, plan.assignments);
    // The snapshot is rewritten even if the user left the tab meanwhile: the
    // App still re-imports, only this screen's own state is skipped.
    if (outcome === "ok") onAfterApply();
    if (!mounted.current) return;
    setApplyingAll(false);
    if (outcome !== "ok") setApplyAllError(EQUIP_FAILURE[outcome]);
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
    <div className="flex flex-col gap-3 px-6 py-5">
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

      {/* Two columns on a wide window, each card at its own height. */}
      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-2">
        {worklist.map((entry) => (
          <WorklistCard
            key={entry.id}
            entry={entry}
            game={game}
            equippedOnHero={equipped.get(entry.heroUid) ?? null}
            invUids={invUids}
            contended={plan.contended}
            gemSlots={gemSlots}
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
    </div>
  );
}

function WorklistCard({
  entry, game, equippedOnHero, invUids, contended, gemSlots, pieceByUid, charByUid, step, cyclic, worklist, onChange, onAfterApply,
}: {
  entry: WorklistEntry;
  game: GameData | null;
  equippedOnHero: Set<string> | null;
  invUids: Set<string>;
  /** Pieces wanted by two distinct heroes — the plan's contention map. */
  contended: Map<string, string[]>;
  /** Socketed gems per piece — read by gem lines. */
  gemSlots: GemSlotsByUid;
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
  const mounted = useMountedRef();

  // Per-change live state — applied (target already on hero, gem socketed),
  // stale (target gone from the inventory: eaten, sold or dissolved in-game),
  // or conflicting (wanted by another hero too, the plan's contention) — plus
  // the live piece (image + stats, name + main), and its current owner.
  const rows = orderLines(entry.changes).map((c) => {
    const { applied, stale, conflict } = changeState(c, { equippedOnHero, invUids, contended, gemSlots, lines: entry.changes });
    // Engine slot → player-facing design slot (ooparts → Talisman, shoes →
    // Boots) for the label + icon; the game never shows "ooparts".
    const ds = toDesignSlot(c.slot) ?? c.slot;
    const piece = pieceByUid.get(c.toUid) ?? null;
    const target = worklistTarget(c, piece, game);
    const ui = c.kind !== "gem" && piece && game ? toUiPiece(piece, game) : null;
    const owner = piece?.equippedBy ? (charByUid.get(piece.equippedBy) ?? null) : null;
    // A gem line sits under its piece's line when the entry moves that piece.
    const nested = c.kind === "gem" && entry.changes.some((x) => x.kind !== "gem" && x.toUid === c.toUid);
    return { c, applied, stale, conflict, ds, ui, target, hasPiece: !!piece, owner, nested };
  });
  const remaining = rows.filter((r) => !r.applied && !r.stale).length;
  // A gone line is nothing left to do, but nothing applied either.
  const allApplied = rows.every((r) => r.applied);
  // Apply locally moves pieces only — gems are socketed in-game.
  const pieceTodo = rows.some((r) => r.c.kind !== "gem" && !r.applied && !r.stale);
  const hasConflict = rows.some((r) => r.conflict && !r.applied);
  const hasStale = rows.some((r) => r.stale);

  const toggleDone = (key: string, done: boolean) => {
    onChange(
      worklist.map((e) =>
        e.id !== entry.id ? e : { ...e, changes: e.changes.map((c) => (changeKey(c) === key ? { ...c, done } : c)) },
      ),
    );
  };
  const remove = () => onChange(worklist.filter((e) => e.id !== entry.id));

  const applyLocally = async () => {
    if (!game) return;
    // Only equip targets that still exist; equipping a piece already on the hero
    // is a harmless no-op, so we don't filter those out.
    const uids = rows.filter((r) => r.c.kind !== "gem" && !r.stale).map((r) => r.c.toUid);
    if (uids.length === 0) return;
    setApplying(true);
    setApplyError(null);
    const outcome = await equipPieces(game, uids, entry.heroUid);
    if (outcome === "ok") onAfterApply();
    if (!mounted.current) return;
    setApplying(false);
    if (outcome !== "ok") setApplyError(EQUIP_FAILURE[outcome]);
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
            <span className="uppercase tracking-wider">{entry.mode === "cp" ? "CP" : entry.mode === "preset" ? "Preset" : "Score"}</span>
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
          <span title="A target piece is no longer in the inventory (consumed or sold in-game) — it's skipped on apply."
            className="shrink-0 rounded border border-amber-400/40 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-200">
            gone
          </span>
        )}
      </div>

      {/* Change lines — one per changed slot. Each shows the TARGET item's image,
       *  stats, and current owner, since the name alone can't identify a copy. */}
      <div className="flex flex-col divide-y divide-white/5">
        {rows.map(({ c, applied, stale, conflict, ds, ui, target, hasPiece, owner, nested }) => c.kind === "gem" ? (
          <GemLine
            key={changeKey(c)}
            c={c}
            pieceName={target.name}
            game={game}
            applied={applied}
            stale={stale}
            nested={nested}
            slotLabel={SLOT_BY[ds]?.label ?? ds}
            onToggle={(done) => toggleDone(changeKey(c), done)}
          />
        ) : (
          <label
            key={changeKey(c)}
            className={cx(
              "flex cursor-pointer items-start gap-2.5 py-2",
              stale && "opacity-45",
            )}
          >
            <input
              type="checkbox"
              checked={applied || c.done}
              disabled={applied || stale}
              onChange={(e) => toggleDone(changeKey(c), e.target.checked)}
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
                <span className={cx("min-w-0 truncate text-[12.5px] font-medium", applied ? "text-emerald-300" : "text-white")}>{target.name}</span>
                {applied ? (
                  <span className="ml-auto shrink-0 text-[9.5px] font-semibold uppercase tracking-wider text-emerald-300">applied</span>
                ) : conflict ? (
                  <span className="ml-auto shrink-0 text-[9.5px] font-semibold uppercase tracking-wider text-amber-300">contested</span>
                ) : stale ? (
                  <PieceGone />
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
              {/* No live piece to draw (gone, or no game data): its main alone. */}
              {!ui && target.main && (
                <div className="mt-1 flex items-center gap-0.5 font-mono text-[10.5px] tabular-nums text-white/90">
                  <StatIcon stat={target.main.stat} size={11} className="shrink-0" />
                  {target.main.value}{target.main.percent ? "%" : ""}
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
          disabled={applying || !pieceTodo || !game}
          className={cx(
            "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11.5px] font-medium transition-colors",
            applying || !pieceTodo || !game
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

/** Piece lines in their stored order, each followed by the gem lines of the
 *  same piece (socket order); gem lines whose piece isn't moved by the entry
 *  come last. */
function orderLines(changes: readonly WorklistChange[]): WorklistChange[] {
  const gems = changes.filter((c) => c.kind === "gem").sort((a, b) => a.gemIndex - b.gemIndex);
  const out: WorklistChange[] = [];
  for (const c of changes) {
    if (c.kind === "gem") continue;
    out.push(c, ...gems.filter((g) => g.toUid === c.toUid));
  }
  for (const g of gems) if (!out.includes(g)) out.push(g);
  return out;
}

/** The status of a line whose piece left the inventory. */
function PieceGone() {
  return (
    <span className="ml-auto shrink-0 text-[9.5px] font-semibold uppercase tracking-wider text-amber-300">
      piece gone (consumed or sold in-game)
    </span>
  );
}

/** "+12%" — a gem's stat value, signed like the gem panels. */
function gemValue(g: WorklistGem): string | null {
  if (!g.stat) return null;
  return `${g.stat.value < 0 ? "-" : "+"}${Math.abs(g.stat.value)}${g.stat.percent ? "%" : ""}`;
}

/** One gem to socket — under its piece's line (`nested`) or on its own, then
 *  naming the piece. Never applied by the app: the user sockets it in-game and
 *  the line clears itself once the snapshot shows it. */
function GemLine({ c, pieceName, game, applied, stale, nested, slotLabel, onToggle }: {
  c: Extract<WorklistChange, { kind: "gem" }>;
  /** The piece's name, read from the current snapshot (`worklistTarget`). */
  pieceName: string;
  game: GameData | null;
  applied: boolean;
  stale: boolean;
  nested: boolean;
  slotLabel: string;
  onToggle: (done: boolean) => void;
}) {
  // Gem art, as the Talisman / EE gem panels draw it.
  const def = game?.gems?.[String(c.toGem.id)] ?? null;
  const value = gemValue(c.toGem);
  return (
    <label
      title="Socket in-game — Apply locally / Apply all don't socket gems."
      className={cx("flex cursor-pointer items-start gap-2.5 py-1.5", nested && "pl-6", stale && "opacity-45")}
    >
      <input
        type="checkbox"
        checked={applied || c.done}
        disabled={applied || stale}
        onChange={(e) => onToggle(e.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-cyan-400"
      />
      {def ? (
        <img src={`/img/items/TI_GEM_${def.type}_${def.level}.webp`} alt="" className="h-5 w-5 shrink-0 object-contain" />
      ) : (
        <div className="h-5 w-5 shrink-0 rounded-sm border border-dashed border-white/10 bg-white/2" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 text-[9.5px] uppercase tracking-wider text-white/45">
            {nested ? `Gem ${c.gemIndex + 1}` : `${slotLabel} · gem ${c.gemIndex + 1}`}
          </span>
          <span className={cx("min-w-0 truncate text-[12px] font-medium", applied ? "text-emerald-300" : "text-white")}>{c.toGem.name}</span>
          {value && (
            <span className="flex shrink-0 items-center gap-0.5 font-mono text-[10.5px] tabular-nums text-white/75">
              {c.toGem.stat && <StatIcon stat={c.toGem.stat.stat} size={11} className="shrink-0" />}{value}
            </span>
          )}
          {applied ? (
            <span className="ml-auto shrink-0 text-[9.5px] font-semibold uppercase tracking-wider text-emerald-300">applied</span>
          ) : stale ? (
            <PieceGone />
          ) : (
            <span className="ml-auto shrink-0 text-[9.5px] uppercase tracking-wider text-white/40">socket in-game</span>
          )}
        </div>
        <div className="mt-0.5 text-[10.5px] text-white/35">
          {!nested && <span className="text-white/55">on {pieceName} · </span>}
          was {c.fromGem ? <span className="line-through">{c.fromGem.name}</span> : "empty"}
        </div>
      </div>
    </label>
  );
}
