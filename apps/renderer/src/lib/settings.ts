/**
 * Settings registry — the ONE declaration of each persisted setting of
 * Settings › Solver, › Display and › Advanced, plus the Presets screen's loss
 * threshold and the last Settings pane visited: its localStorage key,
 * default, bounds / step, label and help text.
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
import type { ReforgeMode } from "./solver/engine.js";

/** Settings modal panes, rail order. */
export const SETTINGS_PANES = ["setup", "data", "solver", "display", "backup", "advanced"] as const;
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
  /** Reforge mode a hero opens on in the Optimizer until set on its toolbar. */
  reforgeMode: ReforgeMode;
  /** Transistone potential a hero opens on in the Optimizer, likewise. */
  rerollPotential: boolean;
  /** Results-table column heatmap on/off. */
  heatmap: boolean;
  /** Builder: compact gear cards under the results. */
  compactCards: boolean;
  /** Optimizer: height of the results table, in rows. */
  resultRows: number;
  /** Presets screen: loss (percent) past which an associated hero is flagged. */
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
 *  optional unit for the range line), or one of a fixed list (with the values
 *  an older install may have stored, each mapped to its current choice). */
type SpecKind<T> =
  [T] extends [boolean] ? { kind: "bool" }
  : [T] extends [number | null] ? { kind: "number"; min: number; max: number | (() => number); step: number; unit?: string }
  : [T] extends [string] ? { kind: "choice"; choices: readonly T[]; legacy?: Readonly<Record<string, T>> }
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
  reforgeMode: {
    key: "gs.solver.reforgeMode",
    default: "classic",
    kind: "choice",
    choices: ["disable", "classic", "ascended10", "ascended"],
    label: "Default reforge mode",
    help: "The reforge mode a hero opens on in the Optimizer until you change it on its toolbar. The mode picked for a hero stays with its filters: changing this default leaves heroes that already have filters, and the hero open, as they are.",
    appliesNextSolve: false,
  },
  rerollPotential: {
    key: "gs.solver.rerollPotential",
    default: false,
    kind: "bool",
    label: "Transistone potential by default",
    help: "Whether a hero opens in the Optimizer with Transistone potential on, until you change it on its toolbar. The choice made for a hero stays with its filters: changing this default leaves heroes that already have filters, and the hero open, as they are.",
    appliesNextSolve: false,
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
    help: "Shorter, narrower gear cards under the results: no piece icon (enhance, breakthrough, stars by the name), set names instead of piece names, icon + value stats with substats two per row, gems as icons, one-line quality and effects, details on hover. Gear and tooltips unchanged.",
    appliesNextSolve: false,
  },
  resultRows: {
    key: "gs.builder.resultRows",
    default: 12,
    kind: "number",
    min: 5,
    max: 15,
    step: 1,
    label: "Result rows",
    help: "Height of the Optimizer's results table, in rows visible before it scrolls. Also set by the height slider above the table.",
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
    help: "Presets: an associated hero losing more than this share of their own build's score is flagged.",
    appliesNextSolve: false,
  },
  debugSolver: {
    key: "gs.debug.solver",
    default: false,
    kind: "bool",
    label: "Solver fan-out logging",
    help: "Log the solver's fan-out (pool sizes, chunk count, workers) and per-solve merge/duration to the developer tools console (View › Toggle developer tools, or F12). Useful when profiling a slow solve — off by default.",
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
    // The panes Debug and Logs merged into Advanced.
    legacy: { debug: "advanced", logs: "advanced" },
    label: "Last Settings pane",
    help: "The pane Settings reopens on (Setup until onboarding is done).",
  },
};

/** The settings Settings › Solver shows — and resets with « Reset solver
 *  settings to defaults »: the solver tuning, then the hero defaults
 *  (reforge mode, Transistone potential). */
export const SOLVER_PANE_SETTINGS = ["workerCount", "topN", "topK", "reforgeMode", "rerollPotential"] as const;
export type SolverPaneSetting = (typeof SOLVER_PANE_SETTINGS)[number];

/** The settings Settings › Display shows — and resets with « Reset display
 *  settings to defaults ». */
export const DISPLAY_PANE_SETTINGS = ["heatmap", "compactCards", "resultRows"] as const;
export type DisplayPaneSetting = (typeof DISPLAY_PANE_SETTINGS)[number];

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

/** A value of a choice list: itself, else what an older install's value maps
 *  to (`legacy`), else the default. */
function choiceOf(spec: SettingSpec<string>, v: unknown): string {
  if ((spec.choices as readonly unknown[]).includes(v)) return v as string;
  if (typeof v === "string" && spec.legacy && Object.hasOwn(spec.legacy, v)) return spec.legacy[v]!;
  return spec.default;
}

/** Bring a value within a setting's bounds: a number is rounded to the step,
 *  then held in [min, max]; null stays null (workerCount = auto); a value
 *  outside a choice list maps through `legacy`, else falls back to the
 *  default. Booleans pass through. */
export function clampSetting<N extends SettingName>(name: N, value: SettingValues[N]): SettingValues[N] {
  const spec = SETTINGS[name] as AnySpec;
  if (spec.kind === "number") {
    if (value == null) return value;
    const n = value as number;
    if (!Number.isFinite(n)) return spec.default as SettingValues[N];
    const stepped = Math.round(n / spec.step) * spec.step;
    return Math.max(spec.min, Math.min(stepped, settingMax(name))) as SettingValues[N];
  }
  if (spec.kind === "choice") return choiceOf(spec, value) as SettingValues[N];
  return value;
}

/** Parse a stored (JSON) value; the default when it is not of the setting's
 *  type (an older install's pane maps through `legacy` first). The stored
 *  value is returned as is otherwise — not clamped: the readers clamp
 *  (`resolveWorkerCount`, the panes' steppers). A hand-set `"1"` counts as on
 *  for a switch, as `lib/log.ts` always allowed. */
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
      return choiceOf(spec, v) as SettingValues[N];
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
 *  « Reset solver / display settings to defaults » links. */
export function resetSettings<N extends SettingName>(
  names: readonly N[],
  set: <M extends N>(name: M, value: SettingValues[M]) => void,
): void {
  for (const name of names) set(name, settingDefault(name));
}
