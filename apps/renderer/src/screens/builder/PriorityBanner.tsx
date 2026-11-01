/**
 * Builder priority banner — under the toolbar's hero row, says where the
 * Score's weights come from when the hero has none of their own (or has the
 * outerpedia reco's, set by SOLVE), with the actions that fix it.
 */
import type { SolveMode } from "../../lib/solver/types.js";

/** `none`: no weight, SOLVE will take the reco's · `no-reco`: no weight and
 *  the hero has no reco weights, SOLVE goes by Combat Power · `from-reco`: the
 *  weights are the reco's, set by SOLVE and not edited since. */
export type PriorityBannerState = "none" | "no-reco" | "from-reco";

export function PriorityBanner({
  state, mode, onLoadReco, onSetPriority, onUseCp, onClear,
}: {
  state: PriorityBannerState;
  mode: SolveMode;
  /** Load the whole reco (as the Library's Load reco). */
  onLoadReco: () => void;
  /** Open the Priority popover (also the Edit of `from-reco`). */
  onSetPriority: () => void;
  /** Switch to CP mode and solve. */
  onUseCp: () => void;
  /** Reset every weight to 0. */
  onClear: () => void;
}) {
  if (state === "from-reco") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-violet-400/25 bg-violet-400/8 px-2.5 py-1 text-[11px] leading-snug text-violet-200">
        <span>Priority from outerpedia reco</span>
        <span aria-hidden className="text-white/30">·</span>
        <BannerAction label="Edit" onClick={onSetPriority} />
        <BannerAction label="Clear" onClick={onClear} />
      </div>
    );
  }
  const cp = mode === "cp";
  const text = state === "none"
    ? (cp ? "No priority set — CP mode needs none; Score will use the outerpedia reco's weights" : "No priority set — Solve will use the outerpedia reco's weights")
    : (cp ? "No priority set and no outerpedia reco for this hero — CP mode needs none" : "No priority set and no outerpedia reco for this hero — Solve will use Combat Power");
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[11px] leading-snug text-amber-200">
      <span aria-hidden>⚠</span>
      <span>{text}</span>
      {state === "none" && <BannerAction label="Load reco" onClick={onLoadReco} />}
      <BannerAction label="Set priority" onClick={onSetPriority} />
      {!cp && <BannerAction label="Use CP" onClick={onUseCp} />}
    </div>
  );
}

function BannerAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded border border-white/15 bg-white/6 px-1.5 py-px text-[10.5px] font-semibold text-white/85 hover:bg-white/12 hover:text-white"
    >
      {label}
    </button>
  );
}
