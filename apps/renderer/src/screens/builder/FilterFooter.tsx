/**
 * Builder footer — per-slot pool sizes, solve counts and debug info.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { SlotIcon } from "../../design/EquipmentIcon.js";
import { HoverHint } from "../../design/HoverHint.js";
import type { SlotId } from "../../design/tokens.js";
import type { SolveDebugInfo } from "../../lib/solver/orchestrator.js";
import type { PoolSizes } from "../../lib/solver/types.js";
import type { SolveCountsStore } from "./solveCounts.js";

/* ─────────────────────────────────────────────────────────────────────────
 * Filter / Search details footer — horizontal stat strip pinned at the
 * bottom of the screen. Same data the right-sidebar block used to carry,
 * just laid out left-to-right with `|` separators so it fits on one line.
 * ───────────────────────────────────────────────────────────────────────── */
export function FilterFooter({
  progress, poolSizes, resultCount, solving, workerCount, durationMs, debugInfo,
}: {
  /** Live P / S counts — subscribed here, not passed down, so a tick doesn't
   *  re-render the Builder screen. */
  progress: SolveCountsStore;
  poolSizes: PoolSizes | null;
  resultCount: number;
  solving: boolean;
  /** Resolved solver worker-pool size — pinned at the far right so the user
   *  can confirm the search parallelism at a glance. */
  workerCount: number;
  /** Wall-clock of the last completed solve (ms), or null while solving / before
   *  the first solve. Shown so the user can gauge solver speed at a glance. */
  durationMs: number | null;
  /** Last solve's diagnostic snapshot — non-null only when `gs.debug.solver`
   *  is on; drives the "Copy Debug Info" button. */
  debugInfo: SolveDebugInfo | null;
}) {
  const { permutations, searched } = useSyncExternalStore(progress.subscribe, progress.get);
  // Slots rendered in the same order the inventory tab uses so the user's
  // eye-flow is identical across tabs.
  const slots: SlotId[] = ["weapon", "helmet", "armor", "gloves", "boots", "accessory", "exclusive", "talisman"];
  return (
    <footer className="fixed bottom-0 left-0 right-0 z-30 flex flex-nowrap items-center gap-x-3 overflow-x-auto whitespace-nowrap border-t border-white/8 bg-bg-elev-2/95 px-3 py-1.5 font-mono text-[10.5px] tabular-nums backdrop-blur-sm">
      <HoverHint
        className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/70"
        name="Filter"
        text="Live counts of how many pieces survive each filter, plus total permutations explored."
      />
      {slots.map((slot) => {
        const ps = poolSizes?.[slot];
        return <FilterChip key={slot} slot={slot} hit={ps?.hit ?? 0} of={ps?.of ?? 0} />;
      })}
      <span className="text-white/20">|</span>
      <FilterBig label="P" value={permutations} title="Total permutations explored across the worker pool." />
      <span className="text-white/55">/</span>
      <FilterBig label="S" value={searched} title="Permutations that survived stat + rating filters and got scored." />
      <span className="text-white/20">|</span>
      <FilterBig label="Results" value={resultCount} title="Builds returned to the table (top-N by Score or CP)." />
      <span className="ml-auto inline-flex items-center gap-3">
        {debugInfo && !solving && <CopyDebugButton info={debugInfo} />}
        {solving && (
          <span className="text-[10px] uppercase tracking-wider text-cyan-300/80 animate-pulse">solving…</span>
        )}
        {!solving && durationMs != null && (
          <span
            className="inline-flex items-center gap-1 text-white/70"
            title="Full wall-clock of the last solve — main-thread precompute + worker search. Enable gs.debug.solver for the precompute/search split via Copy Debug Info."
          >
            <span aria-hidden>⏱</span>
            <span className="text-white/80">{durationMs < 1000 ? `${durationMs} ms` : `${(durationMs / 1000).toFixed(2)} s`}</span>
          </span>
        )}
        <span
          className="inline-flex items-center gap-1 text-white/70"
          title={`Solver worker pool — parallel search threads (hardwareConcurrency − 1, override via gs.solver.workerCount). ${workerCount} worker${workerCount === 1 ? "" : "s"}.`}
        >
          <span aria-hidden>⚙</span>
          <span className="text-white/80">{workerCount}</span>
          <span className="text-white/65">{workerCount === 1 ? "worker" : "workers"}</span>
        </span>
      </span>
    </footer>
  );
}

/** "Copy Debug Info" — copies the last solve's diagnostic snapshot as pretty
 *  JSON to the clipboard. Rendered only when `gs.debug.solver` is on (parent
 *  passes a non-null snapshot), so it's the in-app alternative to digging the
 *  console: one click, paste into a bug report. Splits precompute vs search so
 *  a slow solve is attributable without re-running. */
function CopyDebugButton({ info }: { info: SolveDebugInfo }) {
  const [copied, setCopied] = useState(false);
  // "Copied" reverts after 1.5 s — the timer is cleared on unmount (the button
  // unmounts as soon as a new solve starts).
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);
  const copy = () => {
    const text = JSON.stringify(info, null, 2);
    const done = () => setCopied(true);
    const fallback = () => {
      // Clipboard API blocked (insecure context / no permission) — hidden
      // textarea + execCommand so the button still works in the Electron shell.
      try {
        const ta = document.createElement("textarea");
        ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select(); document.execCommand("copy");
        document.body.removeChild(ta); done();
      } catch { /* give up silently — nothing else to try */ }
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  };
  return (
    <button
      type="button"
      onClick={copy}
      title="Copy this solve's diagnostic snapshot (timings: precompute vs search, pool sizes, P/S, top vs current CP) as JSON."
      className="inline-flex items-center gap-1 rounded border border-cyan-400/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-cyan-100 hover:bg-cyan-500/20"
    >
      <span aria-hidden>⧉</span>
      <span>{copied ? "Copied!" : "Copy Debug Info"}</span>
    </button>
  );
}

/** Single per-slot chip — slot icon + hit/total + percent in dim parens.
 *  Uses the same `SlotIcon` as the Inventory tab so the icon language stays
 *  consistent across the app. */
function FilterChip({ slot, hit, of }: { slot: SlotId; hit: number; of: number }) {
  const pct = of > 0 ? Math.round((hit / of) * 100) : 0;
  return (
    <span className="inline-flex items-center gap-1">
      <SlotIcon slot={slot} size={14} />
      <span className="text-white">{hit}/{of}</span>
      <span className="text-white/65">({pct}%)</span>
    </span>
  );
}

function FilterBig({ label, value, title }: { label: string; value: number; title?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1" title={title}>
      <span className="text-white/70">{label}</span>
      <span className="text-white">{value.toLocaleString()}</span>
    </span>
  );
}
