/**
 * Settings › Solver — worker-pool size, result count and per-worker depth,
 * all read at the next solve (`appliesNextSolve`), then the hero defaults: the
 * reforge mode and Transistone potential a hero with no kept filters opens on
 * in the Optimizer (a hero's own choice stays with its filters). Keys,
 * defaults, bounds and texts come from `lib/settings.ts`; the settings applied
 * at once live in Settings › Display (`DisplayPane.tsx`).
 */
import { useState } from "react";
import { cx } from "../cx.js";
import { resolveWorkerCount } from "../../lib/solver/orchestrator.js";
import { REFORGE_MODES } from "../../lib/solver/reforge.js";
import {
  SETTINGS, SOLVER_PANE_SETTINGS, availableCores, clampSetting, resetSettings,
  type SettingValues, type SolverPaneSetting,
} from "../../lib/settings.js";
import { SectionStrip, Divider, SegButton, Stepper, Switch, HelpText, stepBy, type Setter } from "./SettingsControls.js";

/** Solver tuning settings — owned by App (persisted), edited here. Value
 *  meanings: `SettingValues` in lib/settings.ts. */
export interface SolverSettings {
  workerCount: SettingValues["workerCount"];
  setWorkerCount: Setter<"workerCount">;
  topN: number;
  setTopN: Setter<"topN">;
  topK: number;
  setTopK: Setter<"topK">;
  reforgeMode: SettingValues["reforgeMode"];
  setReforgeMode: Setter<"reforgeMode">;
  rerollPotential: boolean;
  setRerollPotential: Setter<"rerollPotential">;
}

/** Each setting of the pane → its setter, for the registry-driven Reset. */
function settersOf(solver: SolverSettings): { [N in SolverPaneSetting]: Setter<N> } {
  return {
    workerCount: solver.setWorkerCount,
    topN: solver.setTopN,
    topK: solver.setTopK,
    reforgeMode: solver.setReforgeMode,
    rerollPotential: solver.setRerollPotential,
  };
}

/** « Reset solver settings to defaults »: every setting of the pane back to
 *  its registry default. */
export function resetSolverSettings(solver: SolverSettings): void {
  const setters = settersOf(solver);
  resetSettings(SOLVER_PANE_SETTINGS, (name, value) => (setters[name] as (v: typeof value) => void)(value));
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
    const clamped = clampSetting("workerCount", v) ?? autoEffective;
    setManualBuf(clamped);
    solver.setWorkerCount(clamped);
  };

  return (
    <div className="flex flex-col gap-3.5">
      <SectionStrip title="Solver tuning" note="applies next solve" />

      {/* Worker threads */}
      <div className="flex items-start justify-between gap-4.5">
        <div className="flex max-w-82.5 flex-col gap-0.5">
          <span className="text-[13px] font-medium text-white">{SETTINGS.workerCount.label}</span>
          <span className="text-[11.5px] leading-snug text-zinc-400">
            <HelpText name="workerCount" />
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
          <span className="text-[13px] font-medium text-white">{SETTINGS.topN.label}</span>
          <span className="text-[11.5px] leading-snug text-zinc-400">
            <HelpText name="topN" range />
          </span>
        </div>
        <Stepper
          value={solver.topN}
          wide
          onDec={() => solver.setTopN(stepBy("topN", -1))}
          onInc={() => solver.setTopN(stepBy("topN", 1))}
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
                <span className="text-[13px] font-medium text-white">{SETTINGS.topK.label}</span>
                <span className="rounded bg-amber-500/16 px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.08em] text-amber-300">advanced</span>
              </div>
              <span className="text-[11.5px] leading-snug text-zinc-400">
                <HelpText name="topK" range />
              </span>
            </div>
            <Stepper
              value={solver.topK}
              wide
              onDec={() => solver.setTopK(stepBy("topK", -1))}
              onInc={() => solver.setTopK(stepBy("topK", 1))}
            />
          </div>
        )}
      </div>

      <SectionStrip title="Hero defaults" note="for a hero's first solve" />

      {/* Default reforge mode */}
      <div className="flex items-start justify-between gap-4.5">
        <div className="flex max-w-82.5 flex-col gap-0.5">
          <span className="text-[13px] font-medium text-white">{SETTINGS.reforgeMode.label}</span>
          <span className="text-[11.5px] leading-snug text-zinc-400">
            <HelpText name="reforgeMode" />
          </span>
        </div>
        <div className="flex shrink-0 overflow-hidden rounded-md border border-white/12">
          {REFORGE_MODES.map((m, i) => (
            <SegButton key={m.value} label={m.label} title={m.hint} on={solver.reforgeMode === m.value} onClick={() => solver.setReforgeMode(m.value)} divided={i > 0} />
          ))}
        </div>
      </div>

      <Divider />

      {/* Transistone potential by default */}
      <div className="flex items-start justify-between gap-4.5">
        <div className="flex max-w-82.5 flex-col gap-0.5">
          <span className="text-[13px] font-medium text-white">{SETTINGS.rerollPotential.label}</span>
          <span className="text-[11.5px] leading-snug text-zinc-400">
            <HelpText name="rerollPotential" />
          </span>
        </div>
        <Switch checked={solver.rerollPotential} onToggle={() => solver.setRerollPotential((v) => !v)} />
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            resetSolverSettings(solver);
            setManualBuf(autoEffective);
          }}
          className="text-[11px] text-zinc-400 underline underline-offset-2 hover:text-zinc-300"
        >Reset solver settings to defaults</button>
      </div>
    </div>
  );
}
