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

export function GearGlyph({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth={1.5}>
      <circle cx={8} cy={8} r={2.3} />
      <path
        d="M8 1.6 V3.4 M8 12.6 V14.4 M1.6 8 H3.4 M12.6 8 H14.4 M3.4 3.4 L4.7 4.7 M11.3 11.3 L12.6 12.6 M3.4 12.6 L4.7 11.3 M11.3 4.7 L12.6 3.4"
        strokeLinecap="round"
      />
    </svg>
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
        : "border-white/[0.08] bg-white/[0.03] text-zinc-400",
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
            ? "border-white/[0.08] bg-white/[0.03] text-zinc-300 hover:bg-white/[0.06]"
            : "border-cyan-400/30 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25",
        )}
      >
        {armed ? "Disarm" : "Arm capture"}
      </button>

      <button
        onClick={onReload}
        disabled={disable}
        className={cx(
          "inline-flex h-7 items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.03] px-2.5 text-[11.5px] text-zinc-300 hover:bg-white/[0.06] transition-colors",
          disable && "cursor-not-allowed opacity-50",
        )}
      >
        <ReloadIcon className="h-3.5 w-3.5" /> Reload
      </button>
    </div>
  );
}

export type Tab = "Inventory" | "Builds" | "Builder";
const TABS: Tab[] = ["Inventory", "Builds", "Builder"];

interface GsHeaderProps {
  active: Tab;
  onTabChange: (tab: Tab) => void;
  capture: CaptureControlsProps;
  version: string;
}

export function GsHeader({ active, onTabChange, capture, version }: GsHeaderProps) {
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-white/[0.06] bg-black/45 px-4 py-2.5 backdrop-blur-md">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2.5">
          <div
            className="grid h-7 w-7 place-items-center rounded-md"
            style={{
              background: "linear-gradient(135deg, #16EBF1, #9D51FF 60%, #E02BCD)",
              boxShadow: "0 0 16px rgba(157,81,255,0.45)",
            }}
          >
            <GearGlyph className="h-4 w-4 text-white" />
          </div>
          <div className="leading-tight">
            <div className="font-display text-[13.5px] font-semibold tracking-tight text-zinc-100">gear-solver</div>
            <div className="font-mono text-[8.5px] uppercase tracking-[0.18em] text-zinc-500">Outerpedia · v{version}</div>
          </div>
        </div>

        <nav className="flex items-center gap-1 rounded-lg border border-white/[0.06] bg-black/30 p-0.5 text-[12.5px]">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => onTabChange(t)}
              className={cx(
                "rounded-md px-3 py-1 font-medium transition-colors",
                t === active
                  ? "bg-white/[0.07] text-zinc-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
                  : "text-zinc-400 hover:text-zinc-200",
              )}
            >
              {t}
            </button>
          ))}
        </nav>
      </div>

      <CaptureControls {...capture} />
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
          ? "cursor-not-allowed border border-white/[0.06] bg-white/[0.02] text-zinc-600"
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
          ? "border-white/[0.12] bg-white/[0.07] text-zinc-100"
          : "border-white/[0.07] bg-white/[0.03] text-zinc-300 hover:bg-white/[0.06]",
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
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">{children}</span>
      {right}
    </div>
  );
}
