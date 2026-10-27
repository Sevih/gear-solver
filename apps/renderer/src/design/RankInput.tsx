/**
 * Priority-rank editor shared by the Builds cards (hero ranks) and the Presets
 * cards (preset ranks): the positional field and the ⠿ drag handle.
 */
import { useEffect, useState } from "react";

/** Priority-position editor. Positional & contiguous (rank 1 = highest
 *  priority); typing N moves the item to position N (others shift), empty =
 *  unranked = lowest. Same effect as dragging it there. Local draft so typing
 *  doesn't fight the store; commits on blur / Enter. */
export function RankInput({ uid, rank, onSetRank, title }: { uid: string; rank: number | null; onSetRank: (uid: string, pos: number | null) => void; title: string }) {
  const [draft, setDraft] = useState(rank == null ? "" : String(rank));
  // Re-sync when the stored rank changes out from under us (e.g. a shift caused
  // by ranking another item to this one's number).
  useEffect(() => { setDraft(rank == null ? "" : String(rank)); }, [rank]);
  const commit = () => {
    const t = draft.trim();
    if (t === "") { onSetRank(uid, null); return; }
    const n = parseInt(t, 10);
    onSetRank(uid, Number.isFinite(n) ? n : null);
  };
  return (
    <label className="flex flex-col items-center gap-0.5" title={title}>
      <span className="text-[8.5px] uppercase tracking-wider text-white/45">Rank</span>
      <input
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        placeholder="—"
        className="w-11 rounded border border-white/10 bg-black/30 px-1 py-0.5 text-center font-mono text-[10.5px] text-white placeholder:text-white/30 focus:border-cyan-400/40 focus:outline-none"
      />
    </label>
  );
}

/** The ⠿ handle that starts a drag-to-reorder (shown only in the rank sort). */
export function RankDragHandle({ uid, onDragStartRank }: { uid: string; onDragStartRank: (uid: string) => void }) {
  return (
    <span
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStartRank(uid); }}
      title="Drag to reorder priority (rank 1 = highest)"
      className="cursor-grab select-none text-[13px] leading-none text-white/35 hover:text-white/70 active:cursor-grabbing"
    >
      ⠿
    </span>
  );
}
