/**
 * Builder equip button — applies the selected build, with its confirmation.
 */
import { useCallback, useEffect, useState } from "react";
import { cx } from "../../design/cx.js";

/** "Equip build" action — applies the selected build's pieces to the hero
 *  (rewrites the captured snapshot via `equipPieces`). The trigger opens a
 *  confirmation popup (the act mutates the captured account + may take pieces
 *  off other heroes), which owns the busy/failed state. `onEquip` resolves false
 *  on a network error or a 409 (Steam plugin live) → shown inline in the
 *  popup so the user can close the game and retry. Disabled when nothing moves. */
export function EquipBuildButton({ disabled, moving, steal, heroName, onEquip }: {
  disabled: boolean; moving: number; steal: number; heroName: string | null; onEquip: () => Promise<boolean>;
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
 *  failure (e.g. Steam plugin live) with an inline error + retry. */
function EquipConfirm({ moving, steal, heroName, onEquip, onClose }: {
  moving: number; steal: number; heroName: string | null; onEquip: () => Promise<boolean>; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);
  const confirm = async () => {
    setBusy(true); setFailed(false);
    const ok = await onEquip();
    setBusy(false);
    if (ok) onClose(); else setFailed(true);
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
            Couldn't write the snapshot. Close the game while the Steam plugin is live, then retry.
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
