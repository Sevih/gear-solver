/**
 * Builder equip button — applies the selected build, with its confirmation.
 */
import { useCallback, useEffect, useState } from "react";
import { cx } from "../../design/cx.js";
import type { EquipOutcome } from "../../equip.js";

/** Inline error per failed outcome. The 409 one mirrors the server's refusal
 *  (api-handler.ts): in-game moves already reach the app on their own. */
const FAILURE: Record<Exclude<EquipOutcome, "ok">, string> = {
  "game-open": "The game is open: the app now follows in-game moves by itself — close it to apply a local-only edit.",
  "no-snapshot": "Couldn't read the captured snapshot. Capture again (reach the lobby) or re-import it, then retry.",
  failed: "Couldn't write the snapshot. Retry in a moment.",
};

/** "Equip build" action — applies the selected build's pieces to the hero
 *  (rewrites the captured snapshot via `equipPieces`). The trigger opens a
 *  confirmation popup (the act mutates the captured account + may take pieces
 *  off other heroes), which owns the busy/failed state. `onEquip` resolves to
 *  why it failed (unreadable snapshot, 409 while the game is open, write error)
 *  → shown inline in the popup so the user can act and retry. Disabled when
 *  nothing moves. */
export function EquipBuildButton({ disabled, moving, steal, heroName, onEquip }: {
  disabled: boolean; moving: number; steal: number; heroName: string | null; onEquip: () => Promise<EquipOutcome>;
}) {
  const [open, setOpen] = useState(false);
  // Stable — the popup's Escape listener is keyed on `onClose`.
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        title="Apply this build to the captured account"
        className={cx(
          "rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors",
          disabled
            ? "cursor-not-allowed border-white/10 bg-white/4 text-zinc-600"
            : "border-cyan-400/35 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20",
        )}
      >
        Equip build{heroName ? ` → ${heroName}` : ""}
      </button>
      {open && (
        <EquipConfirm moving={moving} steal={steal} heroName={heroName} onEquip={onEquip} onClose={close} />
      )}
    </>
  );
}

/** Confirmation popup for "Equip build". Spells out how many pieces move and how
 *  many are taken off other heroes, then commits on confirm. Stays open on
 *  failure (e.g. game open) with an inline error + retry. */
function EquipConfirm({ moving, steal, heroName, onEquip, onClose }: {
  moving: number; steal: number; heroName: string | null; onEquip: () => Promise<EquipOutcome>; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<Exclude<EquipOutcome, "ok"> | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);
  const confirm = async () => {
    setBusy(true); setFailed(null);
    const outcome = await onEquip();
    setBusy(false);
    if (outcome === "ok") onClose(); else setFailed(outcome);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => { if (!busy) onClose(); }}>
      <div className="w-full max-w-sm rounded-xl border border-white/10 bg-zinc-950 p-4 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1.5 flex items-center justify-between">
          <h3 className="font-display text-[13px] font-semibold text-white">Equip this build?</h3>
          <button type="button" onClick={onClose} disabled={busy} className="text-white/65 hover:text-white disabled:opacity-40" aria-label="Close">✕</button>
        </div>
        <p className="text-[11.5px] leading-snug text-white/80">
          Moves <span className="font-semibold text-white">{moving}</span> piece{moving > 1 ? "s" : ""} onto{" "}
          <span className="font-semibold text-white">{heroName ?? "this hero"}</span> and rewrites your captured account.
        </p>
        {steal > 0 && (
          <p className="mt-1.5 text-[11px] leading-snug text-amber-300/90">
            ⚠ {steal} piece{steal > 1 ? "s" : ""} {steal > 1 ? "are" : "is"} currently on another hero and will be taken off {steal > 1 ? "them" : "it"}.
          </p>
        )}
        {failed && (
          <p className="mt-2 rounded-md border border-rose-400/40 bg-rose-500/10 px-2 py-1.5 text-[10.5px] leading-snug text-rose-300">
            {FAILURE[failed]}
          </p>
        )}
        <div className="mt-3.5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="rounded-md border border-white/10 bg-white/4 px-3 py-1.5 text-[11.5px] font-semibold text-zinc-300 hover:bg-white/8 disabled:opacity-40">
            Cancel
          </button>
          <button type="button" onClick={() => void confirm()} disabled={busy}
            className="rounded-md border border-cyan-400/40 bg-cyan-500/15 px-3 py-1.5 text-[11.5px] font-semibold text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50">
            {busy ? "Equipping…" : failed ? "Retry" : "Equip"}
          </button>
        </div>
      </div>
    </div>
  );
}
