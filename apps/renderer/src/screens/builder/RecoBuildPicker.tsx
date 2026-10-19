/**
 * Builder reco picker — choose one of a hero's recommended builds.
 */
import { useEffect } from "react";
import type { StructuredCharacterReco, StructuredRecoBuild } from "../../lib/reco/translateReco.js";

/** Modal shown when a reco carries more than one named build — lets the user
 *  pick which one to apply. Single-build recos skip this and apply directly. */
export function RecoBuildPicker({ reco, onPick, onClose }: {
  reco: StructuredCharacterReco;
  onPick: (name: string, build: StructuredRecoBuild) => void;
  onClose: () => void;
}) {
  const names = Object.keys(reco.builds);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const summarize = (b: StructuredRecoBuild): string => {
    const parts: string[] = [];
    if (b.Weapon?.length) parts.push("weapon");
    if (b.Amulet?.length) parts.push("amulet");
    const setN = (b.Set ?? []).length;
    if (setN) parts.push(`${setN} set alt${setN > 1 ? "s" : ""}`);
    const prioN = (b.SubstatPrio ?? []).length;
    if (prioN) parts.push(`${prioN}-tier prio`);
    return parts.join(" · ") || "empty build";
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl border border-white/10 bg-zinc-950 p-4 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1.5 flex items-center justify-between">
          <h3 className="font-display text-[13px] font-semibold text-white">Choose a build</h3>
          <button type="button" onClick={onClose} className="text-white/65 hover:text-white" aria-label="Close">✕</button>
        </div>
        <p className="mb-3 text-[11px] leading-snug text-white/70">
          This hero has multiple recommended builds. Pick one to apply its mains, sets, effects and substat priority.
        </p>
        <ul className="flex flex-col gap-1.5">
          {names.map((name) => {
            const b = reco.builds[name]!;
            return (
              <li key={name}>
                <button
                  type="button"
                  onClick={() => onPick(name, b)}
                  className="w-full rounded-md border border-white/10 bg-white/2 px-3 py-2 text-left transition-colors hover:border-cyan-400/40 hover:bg-cyan-500/10"
                >
                  <div className="text-[12.5px] font-medium text-white">{name}</div>
                  <div className="text-[10.5px] text-white/70">{summarize(b)}</div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
