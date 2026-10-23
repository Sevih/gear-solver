/**
 * Settings → Solver — worker-pool size, result count, per-worker depth, the
 * results heatmap, compact result cards and the Presets tab's loss warning.
 */
import { useState, type Dispatch, type SetStateAction } from "react";
import { cx } from "../cx.js";
import { availableCores, clampWorkerCount, resolveWorkerCount } from "../../lib/solver/orchestrator.js";
import { SectionStrip, Divider, SegButton, Stepper, Switch } from "./SettingsControls.js";
import { DEFAULT_PRESET_LOSS_WARN } from "../../lib/storage/presetHeroes.js";

/** Solver tuning settings — owned by App (persisted), edited here. */
export interface SolverSettings {
  /** null = auto (hardwareConcurrency − 1); a number pins the pool size. */
  workerCount: number | null;
  setWorkerCount: Dispatch<SetStateAction<number | null>>;
  /** Ranked builds returned to the results table. */
  topN: number;
  setTopN: Dispatch<SetStateAction<number>>;
  /** Per-worker heap depth before merge (advanced — too low loses recall). */
  topK: number;
  setTopK: Dispatch<SetStateAction<number>>;
  /** Results-table column heatmap on/off. */
  heatmap: boolean;
  setHeatmap: Dispatch<SetStateAction<boolean>>;
  /** Builder: compact gear cards under the results. */
  compactCards: boolean;
  setCompactCards: Dispatch<SetStateAction<boolean>>;
  /** Presets tab: loss (percent) past which an associated hero is flagged. */
  presetLossWarn: number;
  setPresetLossWarn: Dispatch<SetStateAction<number>>;
}

export function SolverPane({
  solver, showAdvanced, onToggleAdvanced,
}: {
  solver: SolverSettings;
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
}) {
  const cores = availableCores();
  const autoEffective = resolveWorkerCount(null);
  const isAuto = solver.workerCount == null;
  // Local buffer so toggling Auto→Manual→Auto preserves the last manual count
  // within the modal session. Seeded from the persisted value or the auto count.
  const [manualBuf, setManualBuf] = useState(() => solver.workerCount ?? autoEffective);
  const manualVal = solver.workerCount ?? manualBuf;
  const setManualWorkers = (v: number) => {
    const clamped = clampWorkerCount(v, cores);
    setManualBuf(clamped);
    solver.setWorkerCount(clamped);
  };

  return (
    <div className="flex flex-col gap-3.5">
      <SectionStrip title="Solver tuning" note="applies next solve" />

      {/* Worker threads */}
      <div className="flex items-start justify-between gap-4.5">
        <div className="flex max-w-82.5 flex-col gap-0.5">
          <span className="text-[13px] font-medium text-white">Worker threads</span>
          <span className="text-[11.5px] leading-snug text-zinc-400">
            More workers = faster solve, hotter and louder CPU. Takes effect on the next solve.
          </span>
          <span className="mt-0.5 font-mono text-[11px] text-cyan-300">
            {isAuto ? `Auto · ${autoEffective} of ${cores} cores` : `Manual · ${manualVal} of ${cores} cores`}
          </span>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex overflow-hidden rounded-md border border-white/12">
            <SegButton label="Auto" on={isAuto} onClick={() => solver.setWorkerCount(null)} />
            <SegButton label="Manual" on={!isAuto} onClick={() => setManualWorkers(manualVal)} divided />
          </div>
          <Stepper
            value={manualVal}
            dim={isAuto}
            onDec={() => setManualWorkers(manualVal - 1)}
            onInc={() => setManualWorkers(manualVal + 1)}
          />
        </div>
      </div>

      <Divider />

      {/* Result count (topN) */}
      <div className="flex items-start justify-between gap-4.5">
        <div className="flex max-w-82.5 flex-col gap-0.5">
          <span className="text-[13px] font-medium text-white">Result count</span>
          <span className="text-[11.5px] leading-snug text-zinc-400">
            How many ranked builds the results table keeps. Range 10–5000.
          </span>
        </div>
        <Stepper
          value={solver.topN}
          wide
          onDec={() => solver.setTopN((v) => Math.max(10, v - 100))}
          onInc={() => solver.setTopN((v) => Math.min(5000, v + 100))}
        />
      </div>

      <Divider />

      {/* Heatmap */}
      <div className="flex items-center justify-between gap-4.5">
        <div className="flex max-w-90 flex-col gap-0.5">
          <span className="text-[13px] font-medium text-white">Results heatmap</span>
          <span className="text-[11.5px] leading-snug text-zinc-400">Emerald→rose column shading on the results table.</span>
        </div>
        <Switch checked={solver.heatmap} onToggle={() => solver.setHeatmap((v) => !v)} />
      </div>

      <Divider />

      {/* Compact result cards */}
      <div className="flex items-center justify-between gap-4.5">
        <div className="flex max-w-90 flex-col gap-0.5">
          <span className="text-[13px] font-medium text-white">Compact result cards</span>
          <span className="text-[11.5px] leading-snug text-zinc-400">Shorter gear cards under the results: set names instead of item names, icon + value stats, one-line effects. Inventory and tooltips unchanged.</span>
        </div>
        <Switch checked={solver.compactCards} onToggle={() => solver.setCompactCards((v) => !v)} />
      </div>

      <Divider />

      {/* Presets loss warning */}
      <div className="flex items-start justify-between gap-4.5">
        <div className="flex max-w-82.5 flex-col gap-0.5">
          <span className="text-[13px] font-medium text-white">Preset loss warning</span>
          <span className="text-[11.5px] leading-snug text-zinc-400">
            Presets tab: an associated hero losing more than this share of their own build's score is flagged. Range 5–50 %.
          </span>
        </div>
        <Stepper
          value={solver.presetLossWarn}
          onDec={() => solver.setPresetLossWarn((v) => Math.max(5, v - 5))}
          onInc={() => solver.setPresetLossWarn((v) => Math.min(50, v + 5))}
        />
      </div>

      {/* Advanced disclosure → per-worker depth (topK) */}
      <div className="flex flex-col gap-3 border-t border-white/6 pt-3">
        <button
          type="button"
          onClick={onToggleAdvanced}
          className="flex w-fit items-center gap-1.5 text-[11px] font-semibold text-zinc-400 hover:text-zinc-200"
        >
          <span className={cx("inline-block text-[9px] transition-transform", showAdvanced && "rotate-90")}>▸</span>
          <span className="tracking-[0.04em]">{showAdvanced ? "Hide advanced" : "Show advanced"}</span>
        </button>
        {showAdvanced && (
          <div className="flex items-start justify-between gap-4.5 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2.5">
            <div className="flex max-w-82.5 flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] font-medium text-white">Per-worker depth</span>
                <span className="rounded bg-amber-500/16 px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.08em] text-amber-300">advanced</span>
              </div>
              <span className="text-[11.5px] leading-snug text-zinc-400">
                Heap each worker keeps before the merge. <b className="font-semibold text-amber-300">Too low silently drops good builds</b> — leave at default unless you know why. Range 100–5000.
              </span>
            </div>
            <Stepper
              value={solver.topK}
              wide
              onDec={() => solver.setTopK((v) => Math.max(100, v - 100))}
              onInc={() => solver.setTopK((v) => Math.min(5000, v + 100))}
            />
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            solver.setWorkerCount(null);
            solver.setTopN(1000);
            solver.setTopK(1000);
            solver.setHeatmap(true);
            solver.setPresetLossWarn(DEFAULT_PRESET_LOSS_WARN);
            setManualBuf(autoEffective);
          }}
          className="text-[11px] text-zinc-400 underline underline-offset-2 hover:text-zinc-300"
        >Reset solver settings to defaults</button>
      </div>
    </div>
  );
}
