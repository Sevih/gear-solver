/**
 * Builder right sidebar — save / preset actions and the per-hero library.
 */
import type { ReactNode } from "react";
import { cx } from "../../design/cx.js";
import type { SavedBuild } from "../../lib/storage/savedBuilds.js";
import type { FilterPreset } from "../../lib/storage/filterPresets.js";
import { Panel } from "./Panel.js";

function ActionButton({
  children, tone = "neutral", onClick, disabled,
}: { children: ReactNode; tone?: "primary" | "neutral"; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
        tone === "primary"
          ? "border-cyan-400/40 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25"
          : "border-white/8 bg-white/4 text-white hover:bg-white/8",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
      )}
    >
      {children}
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Right sidebar — Save build / save preset actions + per-hero library
 * ───────────────────────────────────────────────────────────────────────── */
export function RightSidebar({
  canSave,
  onSaveBuild,
  canGetPreset, onGetPreset, recoBusy, recoStatus, presetStatus = null,
  savedBuilds, onRestoreBuild, onRemoveBuild,
  presets, onLoadPreset, onRemovePreset,
}: {
  canSave: boolean;
  onSaveBuild: () => void;
  canGetPreset: boolean;
  onGetPreset: () => void;
  recoBusy: boolean;
  /** Inline result of the last Get-preset attempt (error / none / warnings). */
  recoStatus: { tone: "ok" | "warn" | "error"; text: string } | null;
  /** The in-game preset being optimized and what it keeps out of the pool
   *  ("Optimize preset →"), null otherwise. */
  presetStatus?: string | null;
  savedBuilds: ReadonlyArray<SavedBuild>;
  onRestoreBuild: (b: SavedBuild) => void;
  onRemoveBuild: (id: string) => void;
  presets: ReadonlyArray<FilterPreset>;
  onLoadPreset: (p: FilterPreset) => void;
  onRemovePreset: (id: string) => void;
}) {
  return (
    <aside className="flex w-full shrink-0 flex-col gap-2">
      <Panel title="Library" hint="Get preset pulls the outerpedia build reco for this hero (mains / sets / effects / substat priority). Save build also saves its filter preset under the same name. Per-hero, persisted in localStorage." width="w-full">
        <div className="grid grid-cols-1 gap-1">
          <ActionButton tone="primary" disabled={!canGetPreset || recoBusy} onClick={onGetPreset}>
            {recoBusy ? "Fetching…" : "Get preset"}
          </ActionButton>
          <ActionButton disabled={!canSave} onClick={onSaveBuild}>Save build + filter preset</ActionButton>
        </div>
        {recoStatus && (
          <div className={cx(
            "mt-1.5 text-[10px] leading-snug",
            recoStatus.tone === "ok" && "text-emerald-300/80",
            recoStatus.tone === "warn" && "text-amber-300/80",
            recoStatus.tone === "error" && "text-rose-300/80",
          )}>
            {recoStatus.text}
          </div>
        )}
        {presetStatus && (
          <div className="mt-1.5 text-[10px] leading-snug text-cyan-200/80">{presetStatus}</div>
        )}
      </Panel>

      <Panel title="Saved builds" hint="Click a build to load it into the table + bottom band. The trash icon removes it permanently." width="w-full">
        {savedBuilds.length === 0 ? (
          <div className="text-[10.5px] italic text-white/65">No saved builds for this hero.</div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {savedBuilds.map((b) => (
              <LibraryRow
                key={b.id}
                title={b.name}
                subtitle={`${b.mode === "cp" ? "CP" : "Score"} ${b.mode === "cp" ? (b.build.cp ?? "—") : Math.round(b.build.score)} · ${formatTimeAgo(b.createdAt)}`}
                onClick={() => onRestoreBuild(b)}
                onDelete={() => onRemoveBuild(b.id)}
              />
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Filter presets" hint="Load a saved filter set into the panels. Useful to switch between e.g. 'CHC build' and 'tank build' without re-clicking every chip." width="w-full">
        {presets.length === 0 ? (
          <div className="text-[10.5px] italic text-white/65">No presets for this hero.</div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {presets.map((p) => (
              <LibraryRow
                key={p.id}
                title={p.name}
                subtitle={formatTimeAgo(p.createdAt)}
                onClick={() => onLoadPreset(p)}
                onDelete={() => onRemovePreset(p.id)}
              />
            ))}
          </ul>
        )}
      </Panel>
    </aside>
  );
}

/** Compact row for the Library panels — title (clickable) + small subtitle
 *  + delete affordance on hover. Same shape for builds and presets. */
function LibraryRow({
  title, subtitle, onClick, onDelete,
}: { title: string; subtitle: string; onClick: () => void; onDelete: () => void }) {
  return (
    <li className="group flex items-center justify-between gap-1 rounded px-1 py-0.5 hover:bg-white/4">
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 flex-col items-start text-left"
        title={title}
      >
        <span className="truncate text-[11px] text-white">{title}</span>
        <span className="truncate text-[10px] text-white/65">{subtitle}</span>
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="shrink-0 px-1 text-[12px] text-white/55 opacity-0 transition-opacity hover:text-rose-300 group-hover:opacity-100"
        title="Delete"
      >
        ✕
      </button>
    </li>
  );
}

/** Quick relative-time stamp — "3m ago", "2h ago", "5d ago", else absolute
 *  date. No deps; good enough for a sidebar timestamp. */
function formatTimeAgo(ts: number): string {
  const delta = Math.max(0, Date.now() - ts);
  const min = Math.floor(delta / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}
