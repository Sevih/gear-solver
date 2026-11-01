/**
 * Settings › Display — the results heatmap, compact result cards and the
 * results table's height in rows, all applied at once. Keys, defaults, bounds
 * and texts come from `lib/settings.ts`.
 */
import {
  DISPLAY_PANE_SETTINGS, SETTINGS, resetSettings,
  type DisplayPaneSetting,
} from "../../lib/settings.js";
import { SectionStrip, Divider, Stepper, Switch, HelpText, stepBy, type Setter } from "./SettingsControls.js";

/** Display settings — owned by App (persisted), edited here. Value meanings:
 *  `SettingValues` in lib/settings.ts. */
export interface DisplaySettings {
  heatmap: boolean;
  setHeatmap: Setter<"heatmap">;
  compactCards: boolean;
  setCompactCards: Setter<"compactCards">;
  resultRows: number;
  setResultRows: Setter<"resultRows">;
}

/** Each setting of the pane → its setter, for the registry-driven Reset. */
function settersOf(display: DisplaySettings): { [N in DisplayPaneSetting]: Setter<N> } {
  return {
    heatmap: display.setHeatmap,
    compactCards: display.setCompactCards,
    resultRows: display.setResultRows,
  };
}

/** « Reset display settings to defaults »: every setting of the pane back to
 *  its registry default. */
export function resetDisplaySettings(display: DisplaySettings): void {
  const setters = settersOf(display);
  resetSettings(DISPLAY_PANE_SETTINGS, (name, value) => (setters[name] as (v: typeof value) => void)(value));
}

export function DisplayPane({ display }: { display: DisplaySettings }) {
  return (
    <div className="flex flex-col gap-3.5">
      <SectionStrip title="Display" note="applied at once" />

      {/* Heatmap */}
      <div className="flex items-center justify-between gap-4.5">
        <div className="flex max-w-90 flex-col gap-0.5">
          <span className="text-[13px] font-medium text-white">{SETTINGS.heatmap.label}</span>
          <span className="text-[11.5px] leading-snug text-zinc-400"><HelpText name="heatmap" /></span>
        </div>
        <Switch checked={display.heatmap} onToggle={() => display.setHeatmap((v) => !v)} />
      </div>

      <Divider />

      {/* Compact result cards */}
      <div className="flex items-center justify-between gap-4.5">
        <div className="flex max-w-90 flex-col gap-0.5">
          <span className="text-[13px] font-medium text-white">{SETTINGS.compactCards.label}</span>
          <span className="text-[11.5px] leading-snug text-zinc-400"><HelpText name="compactCards" /></span>
        </div>
        <Switch checked={display.compactCards} onToggle={() => display.setCompactCards((v) => !v)} />
      </div>

      <Divider />

      {/* Result rows */}
      <div className="flex items-start justify-between gap-4.5">
        <div className="flex max-w-82.5 flex-col gap-0.5">
          <span className="text-[13px] font-medium text-white">{SETTINGS.resultRows.label}</span>
          <span className="text-[11.5px] leading-snug text-zinc-400">
            <HelpText name="resultRows" range />
          </span>
        </div>
        <Stepper
          value={display.resultRows}
          onDec={() => display.setResultRows(stepBy("resultRows", -1))}
          onInc={() => display.setResultRows(stepBy("resultRows", 1))}
        />
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => resetDisplaySettings(display)}
          className="text-[11px] text-zinc-400 underline underline-offset-2 hover:text-zinc-300"
        >Reset display settings to defaults</button>
      </div>
    </div>
  );
}
