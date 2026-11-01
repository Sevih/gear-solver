import type { ReactNode } from "react";
import { cx } from "./cx.js";
import { captureBadge, type SteamStatus } from "../steam.js";

/** Vivid violet/cyan glow background — matches the design's PageBackground.
 *  `className` lets the app shell add its layout (a full-height flex column). */
export function PageBackground({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx("gs-scope relative min-h-full", className)}
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

/** What the Steam-source controls need: the last status poll + the two
 *  actions the header can trigger (install the plugin / launch the game). */
export interface SteamControls {
  status: SteamStatus | null;
  onInstall: () => void;
  onLaunch: () => void;
}

interface CaptureControlsProps {
  onReload: () => void;
  busy?: boolean;
  steam?: SteamControls;
}

/** Header-right capture controls — the one capture pill + primary action +
 *  Reload. The plugin captures whenever the game runs, so the single primary
 *  button is whatever unblocks the user next — install the plugin, then
 *  launch the game. That button exists here and in Settings › Setup only. */
export function CaptureControls({ steam, onReload, busy = false }: CaptureControlsProps) {
  const s = steam?.status ?? null;
  const badge = captureBadge(s);
  const action: { label: string; onClick: () => void; title: string } | null =
    !s || !s.installed ? null
    : !s.ready ? { label: busy ? "Installing…" : s.plugin.present ? "Update plugin" : "Install plugin", onClick: steam!.onInstall, title: "Copy the capture plugin (BepInEx) into the Steam game folder" }
    : !s.gameRunning ? { label: "Launch game", onClick: steam!.onLaunch, title: "Start OUTERPLANE through Steam — snapshots import as soon as you reach the lobby" }
    : null;
  return (
    <div className="flex items-center gap-2">
      <span
        title={badge.title}
        className={cx(
          "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium",
          badge.tone === "live" ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
          : badge.tone === "warn" ? "border-amber-400/30 bg-amber-500/10 text-amber-200"
          : "border-white/8 bg-white/3 text-white",
        )}
      >
        <span className={cx("h-1.5 w-1.5 rounded-full", badge.tone === "live" ? "bg-emerald-400 shadow-[0_0_6px_#34d399]" : badge.tone === "warn" ? "bg-amber-400" : "bg-zinc-500")} />
        {badge.label}
      </span>
      {action && (
        <button
          onClick={action.onClick}
          disabled={busy}
          title={action.title}
          className={cx(
            "inline-flex h-7 items-center rounded-md border px-3 text-[11px] font-semibold transition-colors",
            busy ? "cursor-not-allowed border-white/6 bg-white/2 text-white/65"
            : "border-cyan-400/40 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25",
          )}
        >
          {action.label}
        </button>
      )}
      <button
        onClick={onReload}
        disabled={busy}
        title="Re-import the latest snapshot from disk"
        className={cx(
          "grid h-7 w-7 place-items-center rounded-md border border-white/8 bg-white/3 text-white transition-colors hover:bg-white/6 active:scale-95",
          busy && "cursor-not-allowed opacity-60",
        )}
        aria-label="Reload"
      >
        {busy ? <Spinner /> : <ReloadIcon />}
      </button>
    </div>
  );
}

export type Tab = "Home" | "Heroes" | "Optimizer" | "Presets" | "Worklist" | "Gear";
const TABS: Tab[] = ["Home", "Heroes", "Optimizer", "Presets", "Worklist", "Gear"];

/** Labels `gs.tab` held before the tabs were renamed — an install updated
 *  from them reopens on the same screen. */
const LEGACY_TABS = new Map<string, Tab>([["Builds", "Heroes"], ["Builder", "Optimizer"], ["Inventory", "Gear"]]);

/** The tab a stored `gs.tab` value names: a current tab as is, a former
 *  label as its new name, anything else Home. */
export function parseTab(raw: unknown): Tab {
  if (typeof raw !== "string") return "Home";
  if ((TABS as string[]).includes(raw)) return raw as Tab;
  return LEGACY_TABS.get(raw) ?? "Home";
}

/** Per-tab activity counts. Renders next to the tab label as a mini pill so
 *  the page-level "Gear · 1450 pieces" header can disappear without
 *  the user losing the at-a-glance summary. Use `null` to hide a tab's
 *  badge (e.g. "Optimizer" has no natural count today). */
export interface TabCounts {
  Home: number | null;
  Heroes: number | null;
  Optimizer: number | null;
  Presets: number | null;
  /** Pending (not-yet-applied) gear changes queued in the worklist. */
  Worklist: number | null;
  Gear: number | null;
}

/** A pending app update, as `updateBadge()` describes it (lib/update.ts). */
export interface HeaderUpdate {
  label: string;
  tone: "ready" | "pending" | "manual";
}

interface GsHeaderProps {
  active: Tab;
  onTabChange: (tab: Tab) => void;
  capture: CaptureControlsProps;
  /** Pending app update ("vX ready" / "vX available"), null when there is
   *  nothing to install. Visible from every tab; a click opens Settings ›
   *  Data & updates, where the update card is (`onOpenUpdate`). */
  update?: HeaderUpdate | null;
  onOpenUpdate?: () => void;
  /** Opens the onboarding wizard manually. Wizard is otherwise auto-shown on
   *  first launch via App-level state. */
  onSetup: () => void;
  version: string;
  /** Live Outerplane resource version pulled from outerpedia's
   *  `data/generated/game-version.json`. Null while loading / on fetch failure (we just
   *  omit it from the subtitle rather than show a placeholder). */
  gameVersion: string | null;
  /** Per-tab counts rendered as a chip next to each label — replaces the
   *  page-level "Inventory · 1450 pieces" header so the screen can use the
   *  vertical space for content (3-column inventory layout). */
  counts: TabCounts;
}

export function GsHeader({ active, onTabChange, capture, update = null, onOpenUpdate, onSetup, version, gameVersion, counts }: GsHeaderProps) {
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
        {update && (
          <button
            onClick={onOpenUpdate}
            title="Open Settings › Data & updates"
            className={cx(
              "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11px] font-semibold transition-colors",
              update.tone === "ready" ? "border-cyan-400/40 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25"
              : update.tone === "manual" ? "border-amber-400/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"
              : "border-white/8 bg-white/3 text-white hover:bg-white/6",
            )}
          >
            <svg viewBox="0 0 14 14" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 2v7M4 6.5l3 3 3-3M2.5 12h9" />
            </svg>
            {update.label}
          </button>
        )}
        <button
          onClick={onSetup}
          title="Open Settings (setup checklist, solver, data, backup, debug, logs)"
          className="grid h-7 w-7 place-items-center rounded-md border border-white/8 bg-white/3 text-white transition-colors hover:bg-white/6 active:scale-95"
          aria-label="Settings"
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
          ? "cursor-not-allowed border border-white/6 bg-white/2 text-white/65"
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
