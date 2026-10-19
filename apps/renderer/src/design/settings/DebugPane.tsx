/**
 * Settings → Debug — developer toggles.
 */
import { SectionStrip, Switch } from "./SettingsControls.js";

export function DebugPane({
  debugStatLocks, onToggleDebugStatLocks, debugSolver, onToggleDebugSolver,
}: {
  debugStatLocks: boolean;
  onToggleDebugStatLocks: () => void;
  debugSolver: boolean;
  onToggleDebugSolver: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <SectionStrip title="Debug" />
      <ToggleAction
        label="Stat lock & drift tooling (Builds)"
        description="Reveal the per-stat lock buttons, drift indicators and copy-dump button on Builds cards. Used for stat-formula regression work — off by default."
        checked={debugStatLocks}
        onToggle={onToggleDebugStatLocks}
      />
      <ToggleAction
        label="Solver fan-out logging"
        description="Log the solver's fan-out (pool sizes, chunk count, workers) and per-solve merge/duration to the devtools console. Useful when profiling a slow solve — off by default."
        checked={debugSolver}
        onToggle={onToggleDebugSolver}
      />
    </div>
  );
}

interface ToggleActionProps {
  label: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
}

function ToggleAction({ label, description, checked, onToggle }: ToggleActionProps) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-white/7 bg-zinc-900/40 px-3 py-2.5">
      <div className="min-w-0 max-w-95">
        <div className="text-[13px] font-medium text-white">{label}</div>
        <div className="text-[11.5px] leading-snug text-zinc-400">{description}</div>
      </div>
      <Switch checked={checked} onToggle={onToggle} />
    </div>
  );
}
