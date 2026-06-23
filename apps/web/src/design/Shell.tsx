import type { ReactNode } from "react";
import { cx } from "./cx.js";

/** Vivid violet/cyan glow background — matches the design's PageBackground. */
export function PageBackground({ children }: { children: ReactNode }) {
  return (
    <div
      className="gs-scope relative min-h-full"
      style={{
        background: `
          radial-gradient(60% 50% at 25% 0%, oklch(0.30 0.10 290 / 0.18), transparent 70%),
          radial-gradient(50% 40% at 100% 100%, oklch(0.30 0.10 220 / 0.14), transparent 70%),
          oklch(0.135 0.012 270)`,
      }}
    >
      {children}
    </div>
  );
}

export function ReloadIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 14 14" className={className} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 7 a5 5 0 1 1-1.5-3.5 M12 1.5 V4 H9.5" />
    </svg>
  );
}

export function Spinner({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 14 14" className={cx("animate-spin", className)} fill="none" stroke="currentColor" strokeWidth={1.6}>
      <circle cx={7} cy={7} r={5} opacity={0.25} />
      <path d="M7 2 a5 5 0 0 1 5 5" strokeLinecap="round" />
    </svg>
  );
}

export type CaptureState = "armed" | "idle" | "capturing";

interface CaptureControlsProps {
  state: CaptureState;
  onCapture: () => void;
  onDisarm: () => void;
  onReload: () => void;
  busy?: boolean;
}

/** Header-right capture controls — status pill + Arm/Disarm + Reload. */
export function CaptureControls({ state, onCapture, onDisarm, onReload, busy = false }: CaptureControlsProps) {
  const armed = state === "armed";
  const capturing = state === "capturing";
  const disable = busy || capturing;
  return (
    <div className="flex items-center gap-2">
      <span className={cx(
        "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium",
        armed ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
        : capturing ? "border-cyan-400/30 bg-cyan-500/10 text-cyan-200"
        : "border-white/8 bg-white/3 text-white",
      )}>
        {capturing
          ? <Spinner className="h-3 w-3 text-cyan-300" />
          : <span className={cx("h-1.5 w-1.5 rounded-full",
              armed ? "bg-emerald-400 shadow-[0_0_6px_#34d399]" : "bg-zinc-500")} />
        }
        {capturing ? "Capturing…" : armed ? "Armed" : "Idle"}
      </span>

      <button
        onClick={armed ? onDisarm : onCapture}
        disabled={disable}
        className={cx(
          "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11.5px] font-medium transition-colors",
          disable && "cursor-not-allowed opacity-50",
          armed
            ? "border-white/8 bg-white/3 text-white hover:bg-white/6"
            : "border-cyan-400/30 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25",
        )}
      >
        {armed ? "Disarm" : "Arm capture"}
      </button>

      <button
        onClick={onReload}
        disabled={disable}
        className={cx(
          "inline-flex h-7 items-center gap-1.5 rounded-md border border-white/8 bg-white/3 px-2.5 text-[11.5px] text-white transition-colors hover:bg-white/6 active:scale-95",
          disable && "cursor-not-allowed opacity-50",
        )}
      >
        {/* Spin the reload icon while capture/disarm is running so the user
            gets unambiguous "something is happening" feedback even when the
            button itself is disabled. */}
        <ReloadIcon className={cx("h-3.5 w-3.5", capturing && "animate-spin")} /> Reload
      </button>
    </div>
  );
}

export type Tab = "Inventory" | "Builds" | "Builder";
const TABS: Tab[] = ["Inventory", "Builds", "Builder"];

/** Per-tab activity counts. Renders next to the tab label as a mini pill so
 *  the page-level "Inventory · 1450 pieces" header can disappear without
 *  the user losing the at-a-glance summary. Use `null` to hide a tab's
 *  badge (e.g. "Builder" has no natural count today). */
export interface TabCounts {
  Inventory: number | null;
  Builds: number | null;
  Builder: number | null;
}

export interface EmulatorBadgeProps {
  /** Display label like "LDPlayer", "MuMu Player" — null when nothing was
   *  detected on disk (user has no supported emulator installed). */
  label: string | null;
  /** Port the backend will target. Null when the emulator is installed but
   *  not currently running. */
  port: number | null;
}

/** Header pill that surfaces what the backend's `/api/emulators` saw. Green
 *  when an emulator is running and we have a port locked, amber when one is
 *  installed but stopped, gray when no supported emulator exists at all. */
export function EmulatorBadge({ label, port }: EmulatorBadgeProps) {
  const tone = label && port ? "ready" : label ? "stopped" : "missing";
  const text = label
    ? port ? `${label} · ${port}` : `${label} · not running`
    : "No emulator detected";
  return (
    <span
      title={
        tone === "ready" ? "Backend will target this instance on Arm capture"
        : tone === "stopped" ? "Launch your emulator, then click Reload"
        : "Install LDPlayer, MuMu, or NoxPlayer — capture needs a rooted Android emulator"
      }
      className={cx(
        "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium",
        tone === "ready" && "border-emerald-400/30 bg-emerald-500/10 text-emerald-200",
        tone === "stopped" && "border-amber-400/30 bg-amber-500/10 text-amber-200",
        tone === "missing" && "border-white/8 bg-white/3 text-white/75",
      )}
    >
      <span className={cx(
        "h-1.5 w-1.5 rounded-full",
        tone === "ready" && "bg-emerald-400 shadow-[0_0_6px_#34d399]",
        tone === "stopped" && "bg-amber-400 shadow-[0_0_6px_#fbbf24]",
        tone === "missing" && "bg-zinc-500",
      )} />
      {text}
    </span>
  );
}

interface GsHeaderProps {
  active: Tab;
  onTabChange: (tab: Tab) => void;
  capture: CaptureControlsProps;
  emulator: EmulatorBadgeProps;
  /** Opens the onboarding wizard manually. Wizard is otherwise auto-shown on
   *  first launch via App-level state. */
  onSetup: () => void;
  version: string;
  /** Live Outerplane resource version pulled from outerpedia-v2's
   *  `game-version.json`. Null while loading / on fetch failure (we just
   *  omit it from the subtitle rather than show a placeholder). */
  gameVersion: string | null;
  /** Per-tab counts rendered as a chip next to each label — replaces the
   *  page-level "Inventory · 1450 pieces" header so the screen can use the
   *  vertical space for content (3-column inventory layout). */
  counts: TabCounts;
}

export function GsHeader({ active, onTabChange, capture, emulator, onSetup, version, gameVersion, counts }: GsHeaderProps) {
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-white/6 bg-black/45 px-4 py-2.5 backdrop-blur-md">
      <div className="flex items-center gap-4">
        <div className="leading-tight">
          <div className="font-display text-[14px] font-semibold tracking-tight text-white">Gear Solver</div>
          <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/80">
            Outerpedia · v{version}{gameVersion ? <> · game {gameVersion}</> : null}
          </div>
        </div>

        <nav className="flex items-center gap-1 rounded-lg border border-white/6 bg-black/30 p-0.5 text-[12.5px]">
          {TABS.map((t) => {
            const count = counts[t];
            return (
              <button
                key={t}
                onClick={() => onTabChange(t)}
                className={cx(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1 font-medium transition-colors",
                  t === active
                    ? "bg-white/7 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
                    : "text-white hover:text-cyan-100",
                )}
              >
                {t}
                {count != null && (
                  <span className={cx(
                    "rounded-sm px-1 font-mono text-[10px] tabular-nums",
                    t === active ? "bg-cyan-500/15 text-cyan-200" : "bg-white/10 text-white",
                  )}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="flex items-center gap-2">
        <EmulatorBadge {...emulator} />
        <button
          onClick={onSetup}
          title="Open the setup checklist (emulator, ADB, root)"
          className="grid h-7 w-7 place-items-center rounded-md border border-white/8 bg-white/3 text-white transition-colors hover:bg-white/6 active:scale-95"
          aria-label="Setup"
        >
          {/* Sliders / settings icon — three horizontal lines with adjuster
              knobs. Reads as "configuration" rather than the previous gear
              SVG which looked like a sun. */}
          <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 3.5 H12 M2 7 H12 M2 10.5 H12" />
            <circle cx={5} cy={3.5} r={1.4} fill="currentColor" stroke="none" />
            <circle cx={9} cy={7} r={1.4} fill="currentColor" stroke="none" />
            <circle cx={4} cy={10.5} r={1.4} fill="currentColor" stroke="none" />
          </svg>
        </button>
        <CaptureControls {...capture} />
      </div>
    </header>
  );
}

export function CyanButton({
  children, size = "md", className, disabled, onClick, type = "button",
}: { children: ReactNode; size?: "sm" | "md" | "lg"; className?: string; disabled?: boolean; onClick?: () => void; type?: "button" | "submit" }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-semibold transition-colors",
        size === "lg" ? "h-10 px-5 text-[13px]" : size === "sm" ? "h-7 px-2.5 text-[11.5px]" : "h-8 px-3.5 text-[12px]",
        disabled
          ? "cursor-not-allowed border border-white/6 bg-white/2 text-white/40"
          : "border border-cyan-400/40 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25 shadow-[0_0_18px_-6px_rgba(34,211,238,0.6)]",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children, className, active, onClick, disabled,
}: { children: ReactNode; className?: string; active?: boolean; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "inline-flex h-7 items-center justify-center gap-1.5 rounded-md border px-2.5 text-[11.5px] transition-colors",
        disabled && "cursor-not-allowed opacity-50",
        active
          ? "border-white/12 bg-white/7 text-white"
          : "border-white/7 bg-white/3 text-white hover:bg-white/6",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function GsLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/70">{children}</span>
      {right}
    </div>
  );
}
