/**
 * Settings › Advanced — developer toggles (texts in lib/settings.ts), the
 * onboarding reset, then the app journal (`LogsPane`).
 */
import { SETTINGS } from "../../lib/settings.js";
import { SectionStrip, Switch, DataAction } from "./SettingsControls.js";
import { LogsPane } from "./LogsPane.js";

export function AdvancedPane({
  debugStatLocks, onToggleDebugStatLocks, debugSolver, onToggleDebugSolver, onResetOnboarding, log, onClearLog,
}: {
  debugStatLocks: boolean;
  onToggleDebugStatLocks: () => void;
  debugSolver: boolean;
  onToggleDebugSolver: () => void;
  onResetOnboarding: () => void;
  log: string[];
  onClearLog: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <SectionStrip title="Developer" />
      <ToggleAction
        label={SETTINGS.debugStatLocks.label}
        description={SETTINGS.debugStatLocks.help}
        checked={debugStatLocks}
        onToggle={onToggleDebugStatLocks}
      />
      <ToggleAction
        label={SETTINGS.debugSolver.label}
        description={SETTINGS.debugSolver.help}
        checked={debugSolver}
        onToggle={onToggleDebugSolver}
      />
      <DataAction
        label="Reset onboarding prompt"
        description="Show this Settings modal automatically on next launch as the setup wizard."
        onClick={onResetOnboarding}
      />
      <LogsPane lines={log} onClear={onClearLog} />
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
