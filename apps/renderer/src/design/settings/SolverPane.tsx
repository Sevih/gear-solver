/**
 * Settings → Solver — worker-pool size, result count, per-worker depth, the
 * results heatmap, compact result cards and the Presets tab's loss warning.
 * Keys, defaults, bounds and texts come from `lib/settings.ts`; the settings
 * read at the next solve (`appliesNextSolve`) sit under « applies next
 * solve », the others (applied at once) in their own group.
 */
import { useState, type Dispatch, type SetStateAction } from "react";
import { cx } from "../cx.js";
import { resolveWorkerCount } from "../../lib/solver/orchestrator.js";
import {
  SETTINGS, SOLVER_PANE_SETTINGS, availableCores, clampSetting, resetSettings, settingRange,
  type SettingName, type SettingValues, type SolverPaneSetting,
} from "../../lib/settings.js";
import { SectionStrip, Divider, SegButton, Stepper, Switch } from "./SettingsControls.js";

type Setter<N extends SettingName> = Dispatch<SetStateAction<SettingValues[N]>>;

/** Solver tuning settings — owned by App (persisted), edited here. Value
 *  meanings: `SettingValues` in lib/settings.ts. */
export interface SolverSettings {
  workerCount: SettingValues["workerCount"];
  setWorkerCount: Setter<"workerCount">;
  topN: number;
  setTopN: Setter<"topN">;
  topK: number;
  setTopK: Setter<"topK">;
  heatmap: boolean;
  setHeatmap: Setter<"heatmap">;
  compactCards: boolean;
  setCompactCards: Setter<"compactCards">;
  presetLossWarn: number;
  setPresetLossWarn: Setter<"presetLossWarn">;
}

/** Each setting of the pane → its setter, for the registry-driven Reset. */
function settersOf(solver: SolverSettings): { [N in SolverPaneSetting]: Setter<N> } {
  return {
    workerCount: solver.setWorkerCount,
    topN: solver.setTopN,
    topK: solver.setTopK,
    heatmap: solver.setHeatmap,
    compactCards: solver.setCompactCards,
    presetLossWarn: solver.setPresetLossWarn,
  };
}

/** « Reset solver settings to defaults »: every setting of the pane back to
 *  its registry default (compact cards included). */
export function resetSolverSettings(solver: SolverSettings): void {
  const setters = settersOf(solver);
  resetSettings(SOLVER_PANE_SETTINGS, (name, value) => (setters[name] as (v: typeof value) => void)(value));
}

/** One step of a stepper, held in the setting's bounds. */
function stepBy(name: "topN" | "topK" | "presetLossWarn", dir: 1 | -1) {
  return (v: number) => clampSetting(name, v + dir * SETTINGS[name].step);
}

/** Help line of a setting: its text, the bold warning if any, the range. */
function HelpText({ name, range = false }: { name: SettingName; range?: boolean }) {
  const { help, helpEmphasis } = SETTINGS[name];
  const tail = range ? ` ${settingRange(name)}` : "";
  if (!helpEmphasis || !help.includes(helpEmphasis)) return <>{help}{tail}</>;
  const [before, after] = help.split(helpEmphasis);
  return <>{before}<b className="font-semibold text-amber-300">{helpEmphasis}</b>{after}{tail}</>;
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

      {/* Applied at once — no « applies next solve » here. */}
      <SectionStrip title="Display" />

      {/* Heatmap */}
      <div className="flex items-center justify-between gap-4.5">
        <div className="flex max-w-90 flex-col gap-0.5">
          <span className="text-[13px] font-medium text-white">{SETTINGS.heatmap.label}</span>
          <span className="text-[11.5px] leading-snug text-zinc-400"><HelpText name="heatmap" /></span>
        </div>
        <Switch checked={solver.heatmap} onToggle={() => solver.setHeatmap((v) => !v)} />
      </div>

      <Divider />

      {/* Compact result cards */}
      <div className="flex items-center justify-between gap-4.5">
        <div className="flex max-w-90 flex-col gap-0.5">
          <span className="text-[13px] font-medium text-white">{SETTINGS.compactCards.label}</span>
          <span className="text-[11.5px] leading-snug text-zinc-400"><HelpText name="compactCards" /></span>
        </div>
        <Switch checked={solver.compactCards} onToggle={() => solver.setCompactCards((v) => !v)} />
      </div>

      <Divider />

      {/* Presets loss warning */}
      <div className="flex items-start justify-between gap-4.5">
        <div className="flex max-w-82.5 flex-col gap-0.5">
          <span className="text-[13px] font-medium text-white">{SETTINGS.presetLossWarn.label}</span>
          <span className="text-[11.5px] leading-snug text-zinc-400">
            <HelpText name="presetLossWarn" range />
          </span>
        </div>
        <Stepper
          value={solver.presetLossWarn}
          onDec={() => solver.setPresetLossWarn(stepBy("presetLossWarn", -1))}
          onInc={() => solver.setPresetLossWarn(stepBy("presetLossWarn", 1))}
        />
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
