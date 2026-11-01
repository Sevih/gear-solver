/**
 * Settings registry — the ONE declaration of each persisted setting of
 * Settings › Solver and › Debug (plus the last Settings pane visited): its
 * localStorage key, default, bounds / step, label and help text.
 *
 * Two kinds of readers go through it:
 *  - React state (`useSetting`, `hooks/useSetting.ts`) for App and the panes;
 *  - plain reads outside React (`readSetting`) for the solver orchestrator and
 *    `lib/log.ts`, which run without access to App's state.
 * Both parse the stored value with `parseSetting`, so a hand-edited or stale
 * value falls back to the same default on both sides.
 *
 * All but the last pane visited are part of the backup (`lib/storage/keys.ts`).
 * Pure module: no React, no DOM beyond a guarded `localStorage` /
 * `navigator` read.
 */

/** Settings modal panes, rail order. */
export const SETTINGS_PANES = ["setup", "solver", "data", "backup", "debug", "logs"] as const;
export type SettingsPane = (typeof SETTINGS_PANES)[number];

/** Hard ceiling so a pathological override or an absurd core count can't spawn
 *  thousands of workers. */
export const WORKER_COUNT_CEILING = 64;

/** Logical core count, 4 when the browser does not say. */
export function availableCores(): number {
  return (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4;
}

/** Value type of each setting. */
export interface SettingValues {
  /** null = auto (hardwareConcurrency − 1); a number pins the pool size. */
  workerCount: number | null;
  /** Ranked builds returned to the results table. */
  topN: number;
  /** Per-worker heap depth before merge (advanced — too low loses recall). */
  topK: number;
  /** Results-table column heatmap on/off. */
  heatmap: boolean;
  /** Builder: compact gear cards under the results. */
  compactCards: boolean;
  /** Presets tab: loss (percent) past which an associated hero is flagged. */
  presetLossWarn: number;
  /** Solver fan-out logging to the devtools console. */
  debugSolver: boolean;
  /** Stat lock & drift tooling on Builds cards. */
  debugStatLocks: boolean;
  /** The Settings pane reopened on the next open. */
  settingsPane: SettingsPane;
}
export type SettingName = keyof SettingValues;

interface SpecBase<T> {
  key: string;
  default: T;
  label: string;
  help: string;
  /** Part of `help` shown in bold (a warning). */
  helpEmphasis?: string;
  /** Read at the start of a solve — the pane groups these under
   *  « applies next solve »; the others apply at once. */
  appliesNextSolve?: boolean;
}

/** Shape of the spec by value type: a switch, a stepper (bounds, step, an
 *  optional unit for the range line), or one of a fixed list. */
type SpecKind<T> =
  [T] extends [boolean] ? { kind: "bool" }
  : [T] extends [number | null] ? { kind: "number"; min: number; max: number | (() => number); step: number; unit?: string }
  : [T] extends [string] ? { kind: "choice"; choices: readonly T[] }
  : never;

export type SettingSpec<T> = SpecBase<T> & SpecKind<T>;
/** Any spec, discriminated on `kind` — for the generic helpers below. */
type AnySpec = SettingSpec<boolean> | SettingSpec<number | null> | SettingSpec<string>;

export const SETTINGS: { readonly [N in SettingName]: SettingSpec<SettingValues[N]> } = {
  workerCount: {
    key: "gs.solver.workerCount",
    default: null,
    kind: "number",
    min: 1,
    max: () => Math.min(availableCores(), WORKER_COUNT_CEILING),
    step: 1,
    label: "Worker threads",
    help: "More workers = faster solve, hotter and louder CPU. Takes effect on the next solve.",
    appliesNextSolve: true,
  },
  topN: {
    key: "gs.solver.topN",
    default: 1000,
    kind: "number",
    min: 10,
    max: 5000,
    step: 100,
    label: "Result count",
    help: "How many ranked builds the results table keeps.",
    appliesNextSolve: true,
  },
  topK: {
    key: "gs.solver.topK",
    default: 1000,
    kind: "number",
    min: 100,
    max: 5000,
    step: 100,
    label: "Per-worker depth",
    help: "Heap each worker keeps before the merge. Too low silently drops good builds — leave at default unless you know why.",
    helpEmphasis: "Too low silently drops good builds",
    appliesNextSolve: true,
  },
  heatmap: {
    key: "gs.builder.heatmap",
    default: true,
    kind: "bool",
    label: "Results heatmap",
    help: "Emerald→rose column shading on the results table.",
    appliesNextSolve: false,
  },
  compactCards: {
    key: "gs.builder.compactCards",
    default: false,
    kind: "bool",
    label: "Compact result cards",
    help: "Shorter, narrower gear cards under the results: no item icon (enhance, breakthrough, stars by the name), set names instead of item names, icon + value stats with substats two per row, gems as icons, one-line quality and effects, details on hover. Gear and tooltips unchanged.",
    appliesNextSolve: false,
  },
  presetLossWarn: {
    key: "gs.solver.presetLossWarn",
    default: 15,
    kind: "number",
    min: 5,
    max: 50,
    step: 5,
    unit: "%",
    label: "Preset loss warning",
    help: "Presets tab: an associated hero losing more than this share of their own build's score is flagged.",
    appliesNextSolve: false,
  },
  debugSolver: {
    key: "gs.debug.solver",
    default: false,
    kind: "bool",
    label: "Solver fan-out logging",
    help: "Log the solver's fan-out (pool sizes, chunk count, workers) and per-solve merge/duration to the devtools console. Useful when profiling a slow solve — off by default.",
  },
  debugStatLocks: {
    key: "gs.debug.statLocks",
    default: false,
    kind: "bool",
    label: "Stat lock & drift tooling (Heroes)",
    help: "Reveal the per-stat lock buttons, drift indicators and copy-dump button on Heroes cards. Used for stat-formula regression work — off by default.",
  },
  settingsPane: {
    key: "gs.settings.pane",
    default: "setup",
    kind: "choice",
    choices: SETTINGS_PANES,
    label: "Last Settings pane",
    help: "The pane Settings reopens on (Setup until onboarding is done).",
  },
};

/** The settings Settings › Solver shows — and resets with « Reset solver
 *  settings to defaults ». */
export const SOLVER_PANE_SETTINGS = ["workerCount", "topN", "topK", "heatmap", "compactCards", "presetLossWarn"] as const;
export type SolverPaneSetting = (typeof SOLVER_PANE_SETTINGS)[number];

export function settingDefault<N extends SettingName>(name: N): SettingValues[N] {
  return SETTINGS[name].default;
}

/** Upper bound of a number setting (workerCount's depends on the cores). */
export function settingMax(name: SettingName): number {
  const spec = SETTINGS[name] as SettingSpec<number | null>;
  return typeof spec.max === "function" ? spec.max() : spec.max;
}

/** « Range 10–5000. » — the bounds line of a stepper's help. */
export function settingRange(name: SettingName): string {
  const spec = SETTINGS[name] as SettingSpec<number | null>;
  return `Range ${spec.min}–${settingMax(name)}${spec.unit ? ` ${spec.unit}` : ""}.`;
}

/** Bring a value within a setting's bounds: a number is rounded to the step,
 *  then held in [min, max]; null stays null (workerCount = auto); a value
 *  outside a choice list falls back to the default. Booleans pass through. */
export function clampSetting<N extends SettingName>(name: N, value: SettingValues[N]): SettingValues[N] {
  const spec = SETTINGS[name] as AnySpec;
  if (spec.kind === "number") {
    if (value == null) return value;
    const n = value as number;
    if (!Number.isFinite(n)) return spec.default as SettingValues[N];
    const stepped = Math.round(n / spec.step) * spec.step;
    return Math.max(spec.min, Math.min(stepped, settingMax(name))) as SettingValues[N];
  }
  if (spec.kind === "choice") {
    return ((spec.choices as readonly unknown[]).includes(value) ? value : spec.default) as SettingValues[N];
  }
  return value;
}

/** Parse a stored (JSON) value; the default when it is not of the setting's
 *  type. The stored value is returned as is otherwise — not clamped: the
 *  readers clamp (`resolveWorkerCount`, the panes' steppers). A hand-set
 *  `"1"` counts as on for a switch, as `lib/log.ts` always allowed. */
export function parseSetting<N extends SettingName>(name: N, raw: string | null): SettingValues[N] {
  const spec = SETTINGS[name] as AnySpec;
  const fallback = spec.default as SettingValues[N];
  if (raw == null) return fallback;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return fallback;
  }
  switch (spec.kind) {
    case "bool":
      if (typeof v === "boolean") return v as SettingValues[N];
      return (v === 1 ? true : fallback) as SettingValues[N];
    case "number":
      if (v === null && spec.default === null) return v as SettingValues[N];
      return (typeof v === "number" && Number.isFinite(v) ? v : fallback) as SettingValues[N];
    case "choice":
      return ((spec.choices as readonly unknown[]).includes(v) ? v : fallback) as SettingValues[N];
  }
}

/** Read a setting from localStorage outside React — the default when absent,
 *  invalid, or when localStorage is unavailable (worker, locked-down context). */
export function readSetting<N extends SettingName>(name: N): SettingValues[N] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(SETTINGS[name].key);
  } catch {
    return SETTINGS[name].default;
  }
  return parseSetting(name, raw);
}

/** Put every listed setting back to its default through `set` — the
 *  « Reset solver settings to defaults » link. */
export function resetSettings<N extends SettingName>(
  names: readonly N[],
  set: <M extends N>(name: M, value: SettingValues[M]) => void,
): void {
  for (const name of names) set(name, settingDefault(name));
}
