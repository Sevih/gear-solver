/**
 * Home tab — the app's default landing surface. Two jobs in one screen
 * (ported from Claude Design's "Home Directions" → Direction A: banner + grid):
 *
 *  1. Update center — a state-driven inline card (up-to-date / checking /
 *     downloading% / downloaded→Install / offline→Retry) that replaces the two
 *     old native dialogs. Auto-download happens in the main process; this card
 *     polls `/api/update/status` and surfaces the one action that's left:
 *     "Install new version".
 *  2. Dashboard — a calm, scannable read of the captured account: identity
 *     (heroes + gear + capture health) up top, the gear-quality distribution as
 *     the hero stat, roster/gear breakdowns below, library + quick actions last.
 *
 * All numbers are derived from the already-loaded `inventory` + `game` (no new
 * fetches beyond the update poll). When nothing is captured yet, the dashboard
 * collapses to a single Capture CTA; the update card still shows.
 */
import { useEffect, useMemo, useState } from "react";
import type { GameData, Inventory } from "@gear-solver/core";
import type { CaptureStatus } from "../capture.js";
import type { EmulatorStatus } from "../emulator.js";
import { cx } from "../design/cx.js";
import { Spinner } from "../design/Shell.js";
import { SLOTS, toDesignSlot, type SlotId } from "../design/tokens.js";
import { gearPieceQualityTier, type QualityTier } from "../lib/quality.js";
import { loadSavedBuilds } from "../lib/storage/savedBuilds.js";
import { loadFilterPresets } from "../lib/storage/filterPresets.js";
import {
  checkForUpdate, getUpdateStatus, installUpdate,
  type UpdatePhase, type UpdateStatus,
} from "../lib/update.js";

// ── breakdown vocab (raw CET_/CCT_ enums we already get from game data) ─────
// Element colors match the design brief; class bars are a neutral gray.
const ELEMENTS: { id: string; label: string; color: string }[] = [
  { id: "CET_FIRE",  label: "Fire",  color: "#ff6b6b" },
  { id: "CET_WATER", label: "Water", color: "#4dabf7" },
  { id: "CET_EARTH", label: "Earth", color: "#51cf66" },
  { id: "CET_LIGHT", label: "Light", color: "#ffe066" },
  { id: "CET_DARK",  label: "Dark",  color: "#cc5de8" },
];
const CLASSES: { id: string; label: string }[] = [
  { id: "CCT_ATTACKER", label: "Striker" },
  { id: "CCT_RANGER",   label: "Ranger" },
  { id: "CCT_MAGE",     label: "Mage" },
  { id: "CCT_DEFENDER", label: "Defender" },
  { id: "CCT_PRIEST",   label: "Healer" },
];
const TIER_META: { tier: QualityTier; label: string; color: string }[] = [
  { tier: "poor",      label: "Poor",      color: "#71717a" },
  { tier: "decent",    label: "Decent",    color: "#4dabf7" },
  { tier: "good",      label: "Good",      color: "#9D51FF" },
  { tier: "excellent", label: "Excellent", color: "#fbbf24" },
  { tier: "perfect",   label: "Perfect",   color: "#22d3ee" },
];
// Distinct hues cycled across the top owned armor sets (no per-set brand color
// exists, so a tasteful rotation keeps the bars readable).
const SET_COLORS = ["#ff6b6b", "#4dabf7", "#fbbf24", "#51cf66", "#c4b5fd", "#22d3ee", "#cc5de8"];

interface HomeStats {
  heroes: number;
  gear: number;
  totalGraded: number;
  tiers: { tier: QualityTier; label: string; color: string; count: number; pct: string }[];
  elements: { label: string; color: string; count: number; w: string }[];
  classes: { label: string; count: number; w: string }[];
  stars: { star: number; count: number }[];
  slots: { id: SlotId; label: string; count: number }[];
  sets: { id: string; name: string; color: string; count: number; w: string }[];
  ascended: number;
  maxed: number;
  locked: number;
}

function computeStats(inv: Inventory, game: GameData | null): HomeStats {
  const heroes = inv.characters.length;
  const gear = inv.gear.length;

  // Quality distribution — the hero stat. Talisman/EE return null (no rolled
  // subs to grade); they're left out of the graded pool.
  const tierCount = new Map<QualityTier, number>();
  let totalGraded = 0;
  for (const p of inv.gear) {
    const t = gearPieceQualityTier(p);
    if (!t) continue;
    tierCount.set(t, (tierCount.get(t) ?? 0) + 1);
    totalGraded++;
  }
  const tiers = TIER_META.map((m) => {
    const count = tierCount.get(m.tier) ?? 0;
    return { ...m, count, pct: totalGraded > 0 ? `${((count / totalGraded) * 100).toFixed(1)}%` : "—" };
  });

  // Roster — element / class / base-rarity. Resolved from game.characters via
  // the numeric charId. Without game data we can't classify, so these stay 0.
  const elCount = new Map<string, number>();
  const clCount = new Map<string, number>();
  const starCount = new Map<number, number>();
  for (const c of inv.characters) {
    const meta = game?.characters[String(c.charId)];
    if (meta?.element) elCount.set(meta.element, (elCount.get(meta.element) ?? 0) + 1);
    if (meta?.cls) clCount.set(meta.cls, (clCount.get(meta.cls) ?? 0) + 1);
    if (meta?.star != null) starCount.set(meta.star, (starCount.get(meta.star) ?? 0) + 1);
  }
  const maxEl = Math.max(1, ...ELEMENTS.map((e) => elCount.get(e.id) ?? 0));
  const elements = ELEMENTS.map((e) => {
    const count = elCount.get(e.id) ?? 0;
    return { label: e.label, color: e.color, count, w: `${Math.round((count / maxEl) * 100)}%` };
  });
  const maxCl = Math.max(1, ...CLASSES.map((c) => clCount.get(c.id) ?? 0));
  const classes = CLASSES.map((c) => {
    const count = clCount.get(c.id) ?? 0;
    return { label: c.label, count, w: `${Math.round((count / maxCl) * 100)}%` };
  });
  const stars = [...starCount.entries()].map(([star, count]) => ({ star, count })).sort((a, b) => b.star - a.star);

  // Gear — by slot (8 design slots) + top owned armor sets + state counters.
  const slotCount = new Map<SlotId, number>();
  const setCount = new Map<string, number>();
  let ascended = 0, maxed = 0, locked = 0;
  for (const p of inv.gear) {
    const sid = toDesignSlot(p.slot);
    if (sid) slotCount.set(sid, (slotCount.get(sid) ?? 0) + 1);
    if (p.armorSetId) setCount.set(p.armorSetId, (setCount.get(p.armorSetId) ?? 0) + 1);
    if (p.ascended) ascended++;
    if (p.enhanceLevel >= 15) maxed++;
    if (p.locked) locked++;
  }
  const slots = SLOTS.map((s) => ({ id: s.id, label: s.label, count: slotCount.get(s.id) ?? 0 }));
  const sortedSets = [...setCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxSet = Math.max(1, ...sortedSets.map(([, n]) => n));
  const sets = sortedSets.map(([id, count], i) => ({
    id,
    name: game?.sets?.[id]?.name ?? `Set ${id}`,
    color: SET_COLORS[i % SET_COLORS.length]!,
    count,
    w: `${Math.round((count / maxSet) * 100)}%`,
  }));

  return { heroes, gear, totalGraded, tiers, elements, classes, stars, slots, sets, ascended, maxed, locked };
}

/** Relative "3h ago" + absolute local time for the last capture. */
function relTime(ms: number | null): { rel: string; abs: string } | null {
  if (ms == null) return null;
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  const rel = min < 1 ? "just now"
    : min < 60 ? `${min}m ago`
    : min < 1440 ? `${Math.floor(min / 60)}h ago`
    : `${Math.floor(min / 1440)}d ago`;
  const abs = new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return { rel, abs };
}

// ── small shared primitives ─────────────────────────────────────────────
function Card({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={cx("rounded-xl border border-white/8 p-4", className)}
      style={{ background: "#161618", ...style }}
    >
      {children}
    </div>
  );
}
// ── section icons (14px, lucide-style strokes) ──────────────────────────
function SIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
const IC_SNAPSHOT = <SIcon><circle cx="12" cy="8" r="3.6" /><path d="M5 20c0-3.6 3.4-5.5 7-5.5s7 1.9 7 5.5" /></SIcon>;
const IC_HEALTH = <SIcon><path d="M3 12h3.5l2 6 3.5-13 2.5 9 1.8-4H21" /></SIcon>;
const IC_QUALITY = <SIcon><path d="M6 3h12l3.5 6L12 21 2.5 9z" /><path d="M2.5 9h19" /><path d="M12 21 8 9l4-6 4 6z" /></SIcon>;
const IC_ROSTER = <SIcon><circle cx="9" cy="8" r="3.4" /><path d="M3 20c0-3.3 2.7-5 6-5s6 1.7 6 5" /><path d="M16 4.2a3.4 3.4 0 0 1 0 6.6" /><path d="M17.5 15c2 .6 3.5 2.2 3.5 5" /></SIcon>;
const IC_GEAR = <SIcon><rect x="3.5" y="3.5" width="7" height="7" rx="1.4" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.4" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.4" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.4" /></SIcon>;
const IC_LIBRARY = <SIcon><path d="M6 3h11a1 1 0 0 1 1 1v17l-6.5-3.6L5 21V4a1 1 0 0 1 1-1z" /></SIcon>;
const IC_BOLT = <SIcon><path d="M13 2 4 13h6l-1 9 9-12h-6z" /></SIcon>;

// ── micro sub-label (11px) for the "By element / class / …" headers ──────
function MIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className="h-2.75 w-2.75 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
const IC_ELEMENT = <MIcon><path d="M12 3c.6 3.2 3.5 4.4 3.5 7.5a3.5 3.5 0 0 1-7 0c0-1.3.5-2.3 1.3-3.2" /></MIcon>;
const IC_CLASS = <MIcon><path d="M12 3l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V6z" /></MIcon>;
const IC_RARITY = <MIcon><path d="M12 3.5l2.5 5.3 5.5.6-4 3.8 1 5.6-5-2.8-5 2.8 1-5.6-4-3.8 5.5-.6z" /></MIcon>;
const IC_SLOT = <MIcon><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 12h16M12 4v16" /></MIcon>;
const IC_SETS = <MIcon><path d="M12 3 3 8l9 5 9-5z" /><path d="M3 13l9 5 9-5" /></MIcon>;

function SubLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1 text-[8.5px] font-bold uppercase tracking-widest text-zinc-600">
      <span className="text-zinc-500">{icon}</span>{children}
    </span>
  );
}

function SectionLabel({ children, right, icon, tint }: {
  children: React.ReactNode; right?: React.ReactNode; icon?: React.ReactNode; tint?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.11em] text-white/50">
        {icon && <span style={tint ? { color: tint } : undefined}>{icon}</span>}
        {children}
      </span>
      {right}
    </div>
  );
}
function Num({ children, className, color }: { children: React.ReactNode; className?: string; color?: string }) {
  return <span className={cx("font-mono tabular-nums leading-none", className)} style={color ? { color } : undefined}>{children}</span>;
}
function ActBtn({ children, tone = "neutral", onClick, className }: {
  children: React.ReactNode; tone?: "neutral" | "cyan" | "violet"; onClick?: () => void; className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "rounded-lg border px-2.5 py-2 text-[11.5px] font-semibold transition-colors",
        tone === "cyan" ? "border-cyan-400/35 bg-cyan-500/8 text-cyan-200 hover:bg-cyan-500/15"
        : tone === "violet" ? "border-violet-400/35 bg-violet-500/10 text-violet-200 hover:bg-violet-500/20"
        : "border-white/10 bg-white/4 text-zinc-300 hover:bg-white/8",
        className,
      )}
    >
      {children}
    </button>
  );
}

// ── update card (banner layout, all five states) ─────────────────────────
function IconBox({ phase, bg, color }: { phase: UpdatePhase; bg: string; color: string }) {
  return (
    <div className="grid h-10.5 w-10.5 shrink-0 place-items-center rounded-xl" style={{ background: bg, color }}>
      {phase === "checking" ? (
        <Spinner className="h-4.5 w-4.5" />
      ) : phase === "error" ? (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3l9 16H3z" /><path d="M12 10v4" /><circle cx={12} cy={17} r={0.6} fill="currentColor" />
        </svg>
      ) : phase === "downloading" || phase === "downloaded" ? (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 4v10" /><path d="M8 11l4 4 4-4" /><path d="M5 19h14" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx={12} cy={12} r={9} /><path d="M8 12.5l2.6 2.6L16 9.5" />
        </svg>
      )}
    </div>
  );
}

function UpdateCard({ status, onCheck, onInstall }: {
  status: UpdateStatus; onCheck: () => void; onInstall: () => void;
}) {
  const ver = status.version ?? "update";
  const cfg = {
    uptodate:    { bg: "rgba(52,211,153,0.12)", color: "#34d399", title: "Up to date",          titleColor: "#fafafa", sub: `gear·solver v${status.appVersion} — latest release`, border: "rgba(255,255,255,0.09)", glow: "none" },
    checking:    { bg: "rgba(34,211,238,0.10)", color: "#67e8f9", title: "Checking for updates…", titleColor: "#fafafa", sub: "Contacting GitHub releases",                       border: "rgba(255,255,255,0.09)", glow: "none" },
    downloading: { bg: "rgba(34,211,238,0.10)", color: "#67e8f9", title: `Downloading v${ver}`,   titleColor: "#fafafa", sub: "Fetching in the background",                     border: "rgba(34,211,238,0.22)", glow: "none" },
    downloaded:  { bg: "rgba(34,211,238,0.16)", color: "#67e8f9", title: `v${ver} ready to install`, titleColor: "#fafafa", sub: "Downloaded — restarts and applies on install", border: "rgba(34,211,238,0.45)", glow: "0 0 0 1px rgba(34,211,238,0.18), 0 0 34px -10px rgba(34,211,238,0.5)" },
    error:       { bg: "rgba(251,113,133,0.10)", color: "#fb7185", title: "Update check failed",  titleColor: "#fda4af", sub: status.error ? "Offline? Couldn’t reach GitHub releases" : "Offline?", border: "rgba(251,113,133,0.3)", glow: "none" },
  }[status.state];
  const showNew = status.state === "downloading" || status.state === "downloaded";

  return (
    <div
      className="flex items-center gap-4.5 rounded-xl px-4.5 py-3.5"
      style={{ background: "#101012", border: `1px solid ${cfg.border}`, boxShadow: cfg.glow }}
    >
      <IconBox phase={status.state} bg={cfg.bg} color={cfg.color} />

      {/* text block */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold tracking-tight" style={{ color: cfg.titleColor }}>{cfg.title}</span>
          {showNew && (
            <span className="rounded-[5px] bg-cyan-400/15 px-1.5 py-px font-mono text-[9px] font-bold tracking-wider text-cyan-300">NEW</span>
          )}
        </div>
        <span className="text-[11.5px] text-zinc-500">{cfg.sub}</span>
        {status.state === "downloading" && (
          <div className="mt-1 flex max-w-85 items-center gap-2.5">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
              <div className="h-full rounded-full bg-linear-to-r from-cyan-400 to-cyan-500 transition-[width] duration-200" style={{ width: `${status.progress}%` }} />
            </div>
            <Num className="min-w-9 text-right text-[11px] font-semibold text-cyan-300">{status.progress}%</Num>
          </div>
        )}
      </div>

      {/* version metadata (always) */}
      <div className="flex shrink-0 flex-col items-end gap-0.5 border-r border-white/8 pr-4.5">
        <span className="text-[8px] font-bold uppercase tracking-[0.14em] text-white/40">Running</span>
        <Num className="text-[11.5px] font-semibold text-zinc-300">app v{status.appVersion}</Num>
        {status.dataSha && <Num className="text-[10px] text-zinc-600">data {status.dataSha}</Num>}
      </div>

      {/* action */}
      <div className="flex min-w-32 shrink-0 flex-col items-end gap-1">
        {status.state === "downloaded" ? (
          <>
            <button
              onClick={onInstall}
              className="w-full rounded-lg bg-linear-to-b from-cyan-400 to-cyan-500 px-4.5 py-2.5 text-[12.5px] font-bold tracking-tight text-cyan-950 shadow-[0_0_0_1px_rgba(34,211,238,0.45),0_7px_18px_-8px_rgba(34,211,238,0.7)] hover:brightness-105"
            >
              Install new version
            </button>
            <span className="text-[9.5px] text-zinc-600">app will restart</span>
          </>
        ) : status.state === "error" ? (
          <button onClick={onCheck} className="rounded-lg border border-rose-400/40 bg-rose-500/10 px-4.5 py-2 text-[12px] font-semibold text-rose-300 hover:bg-rose-500/20">Retry</button>
        ) : status.state === "uptodate" ? (
          <button onClick={onCheck} className="rounded-lg border border-white/10 bg-zinc-900 px-3.5 py-2 text-[12px] font-semibold text-zinc-400 hover:bg-zinc-800">Check again</button>
        ) : (
          <span className="font-mono text-[11px] text-zinc-600">working…</span>
        )}
      </div>
    </div>
  );
}

// ── empty state ──────────────────────────────────────────────────────────
function EmptyDashboard({ onCapture }: { onCapture: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-white/8 px-10 py-16 text-center" style={{ background: "#161618" }}>
      <div className="mb-5 grid h-16 w-16 place-items-center rounded-2xl border border-cyan-400/25 bg-cyan-400/8">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#67e8f9" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="14" rx="2.5" /><circle cx="12" cy="12" r="3.4" /><path d="M8 5l1.4-2h5.2L16 5" />
        </svg>
      </div>
      <span className="mb-2 text-[20px] font-bold tracking-tight text-white">No account captured yet</span>
      <p className="mb-6 max-w-105 text-[13px] leading-relaxed text-zinc-400">
        Capture your roster from the emulator and this home fills in — heroes, gear quality, breakdowns and your saved build library, all at a glance.
      </p>
      <button
        onClick={onCapture}
        className="rounded-[10px] bg-linear-to-b from-cyan-400 to-cyan-500 px-6.5 py-3 text-[13px] font-bold tracking-tight text-cyan-950 shadow-[0_0_0_1px_rgba(34,211,238,0.45),0_8px_22px_-8px_rgba(34,211,238,0.7)] hover:brightness-105"
      >
        Capture your account
      </button>
      <div className="mt-6 flex items-center gap-2.5 font-mono text-[11px] text-zinc-600">
        <span>launch emulator</span><span className="text-zinc-700">→</span><span>arm capture</span><span className="text-zinc-700">→</span><span>open Outerplane</span>
      </div>
    </div>
  );
}

// ── screen ───────────────────────────────────────────────────────────────
export interface HomeScreenProps {
  inventory: Inventory | null;
  game: GameData | null;
  capStatus: CaptureStatus | null;
  emulator: EmulatorStatus | null;
  appVersion: string;
  busy: boolean;
  onCapture: () => void;
  onSyncData: () => void;
  onOpenSettings: () => void;
  onOpenBuilder: () => void;
}

export function HomeScreen({
  inventory, game, capStatus, emulator, appVersion, busy,
  onCapture, onSyncData, onOpenSettings, onOpenBuilder,
}: HomeScreenProps) {
  // Poll the update status. Faster while a download is in flight so the % bar
  // animates; idle states tick slowly. Seeded with a static "up to date" using
  // the build-time app version so the card never flashes empty.
  const [update, setUpdate] = useState<UpdateStatus>({
    state: "uptodate", version: null, progress: 0, error: null, appVersion, dataSha: null,
  });
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const s = await getUpdateStatus();
      if (!alive) return;
      if (s) setUpdate(s);
      const delay = (s?.state === "downloading" || s?.state === "checking") ? 1000 : 4000;
      timer = setTimeout(tick, delay);
    };
    void tick();
    return () => { alive = false; clearTimeout(timer); };
  }, []);

  const onCheck = () => { setUpdate((u) => ({ ...u, state: "checking", error: null })); void checkForUpdate(); };
  const onInstall = () => { void installUpdate(); };

  const stats = useMemo(() => (inventory ? computeStats(inventory, game) : null), [inventory, game]);
  // Library counts (saved builds + filter presets) live in localStorage. Read
  // once on mount — they don't change while the user sits on Home.
  const library = useMemo(() => {
    const builds = Object.values(loadSavedBuilds()).reduce((n, l) => n + l.length, 0);
    const presets = Object.values(loadFilterPresets()).reduce((n, l) => n + l.length, 0);
    return { builds, presets };
  }, []);

  const armed = capStatus?.armed ?? false;
  const lastCap = relTime(capStatus?.userItemMtime ?? null);
  const emuReady = Boolean(emulator?.chosen && emulator?.chosenPort);
  const emuLine = emulator?.chosen
    ? `${emulator.chosen.label}${emulator.chosenPort ? ` · 127.0.0.1:${emulator.chosenPort}` : " · not running"}`
    : "No emulator detected";

  return (
    <div className="mx-auto flex w-full flex-col gap-3.5 px-3.5 py-3.5" style={{ maxWidth: 1480 }}>
      <UpdateCard status={update} onCheck={onCheck} onInstall={onInstall} />

      {!stats ? (
        <EmptyDashboard onCapture={onCapture} />
      ) : (
        <>
          {/* identity row — account snapshot + system health */}
          <div className="flex gap-3.5">
            <Card className="flex min-w-0 flex-[1.7] flex-col gap-3.5">
              <SectionLabel icon={IC_SNAPSHOT} tint="#22d3ee">Account snapshot</SectionLabel>
              <div className="flex items-center gap-2">
                <div className="flex flex-1 flex-col gap-1">
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">Heroes owned</span>
                  <Num className="text-[32px] font-bold" color="#fbbf24">{stats.heroes.toLocaleString()}</Num>
                </div>
                <span className="h-10.5 w-px bg-white/8" />
                <div className="flex flex-1 flex-col gap-1">
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">Gear pieces</span>
                  <Num className="text-[32px] font-bold" color="#fbbf24">{stats.gear.toLocaleString()}</Num>
                </div>
                <span className="h-10.5 w-px bg-white/8" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">Last capture</span>
                  <Num className="text-[17px] font-semibold text-zinc-200">{lastCap?.rel ?? "—"}</Num>
                  {lastCap && <Num className="text-[10px] text-zinc-600">{lastCap.abs} local</Num>}
                </div>
                <span className="h-10.5 w-px bg-white/8" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">Capture</span>
                  <span className={cx(
                    "inline-flex w-fit items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold",
                    armed ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300" : "border-white/10 bg-white/4 text-zinc-400",
                  )}>
                    <span className={cx("h-1.5 w-1.5 rounded-full", armed ? "bg-emerald-400 shadow-[0_0_7px_#34d399]" : "bg-zinc-500")} />
                    {armed ? "Armed" : "Idle"}
                  </span>
                </div>
              </div>
            </Card>

            <Card className="flex min-w-0 flex-1 flex-col gap-3">
              <SectionLabel icon={IC_HEALTH} tint={emuReady ? "#34d399" : "#fbbf24"}>System health</SectionLabel>
              <div className="flex items-center gap-2.5">
                <span className={cx("h-2.5 w-2.5 shrink-0 rounded-full", emuReady ? "bg-emerald-400 shadow-[0_0_8px_#34d399]" : "bg-amber-400 shadow-[0_0_8px_#fbbf24]")} />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[13px] font-semibold text-white">{emuReady ? "Capture pipeline ready" : "Setup incomplete"}</span>
                  <Num className="truncate text-[10.5px] text-zinc-600">{emuLine}</Num>
                </div>
              </div>
              <div className="mt-auto flex gap-2">
                <ActBtn className="flex-1" onClick={onSyncData}>Sync game data</ActBtn>
                <ActBtn tone="cyan" className="flex-1" onClick={onCapture}>{armed ? "Re-capture" : "Arm capture"}</ActBtn>
              </div>
            </Card>
          </div>

          {/* HERO: gear quality distribution */}
          <Card className="flex flex-col gap-3.5">
            <SectionLabel icon={IC_QUALITY} tint="#fbbf24" right={<Num className="text-[10px] text-zinc-600">{stats.totalGraded.toLocaleString()} pieces graded by substat roll quality</Num>}>
              Gear quality distribution
            </SectionLabel>
            <div className="flex h-8 gap-0.75 overflow-hidden rounded-lg">
              {stats.tiers.map((t) => (
                <div key={t.tier} style={{ flex: `${t.count} 1 0`, background: t.color, opacity: 0.92 }} />
              ))}
            </div>
            <div className="grid grid-cols-5 gap-3">
              {stats.tiers.map((t) => (
                <div key={t.tier} className="flex flex-col gap-1 pl-2.5" style={{ borderLeft: `2px solid ${t.color}` }}>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{t.label}</span>
                  <Num className="text-[23px] font-bold" color={t.color}>{t.count.toLocaleString()}</Num>
                  <Num className="text-[10px] text-zinc-600">{t.pct} of pool</Num>
                </div>
              ))}
            </div>
          </Card>

          {/* breakdown row — roster + gear */}
          <div className="flex items-stretch gap-3.5">
            {/* roster */}
            <Card className="flex min-w-0 flex-1 flex-col gap-3.5">
              <SectionLabel icon={IC_ROSTER} tint="#c4b5fd" right={<Num className="text-[10px] text-zinc-600">{stats.heroes.toLocaleString()} heroes</Num>}>Roster</SectionLabel>
              <div className="flex flex-col gap-2">
                <SubLabel icon={IC_ELEMENT}>By element</SubLabel>
                {stats.elements.map((e) => (
                  <BarRow key={e.label} label={e.label} labelW={40} count={e.count} w={e.w} color={e.color} />
                ))}
              </div>
              <div className="flex flex-col gap-2">
                <SubLabel icon={IC_CLASS}>By class</SubLabel>
                {stats.classes.map((c) => (
                  <BarRow key={c.label} label={c.label} labelW={54} count={c.count} w={c.w} color="#6b7280" />
                ))}
              </div>
              {stats.stars.length > 0 && (
                <div className="flex flex-col gap-2">
                  <SubLabel icon={IC_RARITY}>By rarity</SubLabel>
                  <div className="flex gap-2">
                    {stats.stars.map((r) => (
                      <div key={r.star} className="flex flex-1 flex-col items-center gap-0.5 rounded-lg border border-white/6 bg-white/3 px-1 py-2">
                        <span className="text-[11px] font-semibold text-amber-300">{r.star}★</span>
                        <Num className="text-[16px] font-bold text-zinc-200">{r.count}</Num>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>

            {/* gear breakdown */}
            <Card className="flex min-w-0 flex-[1.3] flex-col gap-3.5">
              <SectionLabel icon={IC_GEAR} tint="#38bdf8" right={<Num className="text-[10px] text-zinc-600">{stats.gear.toLocaleString()} pieces</Num>}>Gear breakdown</SectionLabel>
              <div className="flex gap-4">
                {/* by slot */}
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <SubLabel icon={IC_SLOT}>By slot</SubLabel>
                  <div className="grid grid-cols-2 gap-x-3.5 gap-y-2">
                    {stats.slots.map((s) => (
                      <div key={s.id} className="flex items-center justify-between gap-1.5 border-b border-white/5 pb-1.5">
                        <span className="text-[11px] text-zinc-400">{s.label}</span>
                        <Num className="text-[11.5px] font-semibold text-zinc-300">{s.count}</Num>
                      </div>
                    ))}
                  </div>
                </div>
                {/* top sets */}
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <SubLabel icon={IC_SETS}>Top armor sets</SubLabel>
                  {stats.sets.length > 0 ? stats.sets.map((se) => (
                    <div key={se.id} className="flex items-center gap-2">
                      <span className="h-3.5 w-3.5 shrink-0 rounded" style={{ background: se.color }} />
                      <span className="w-13 shrink-0 truncate text-[11px] text-zinc-300" title={se.name}>{se.name}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
                        <div className="h-full rounded-full" style={{ width: se.w, background: se.color, opacity: 0.65 }} />
                      </div>
                      <Num className="w-7.5 shrink-0 text-right text-[11px] font-semibold text-zinc-300">{se.count}</Num>
                    </div>
                  )) : (
                    <span className="text-[11px] text-zinc-600">No armor sets resolved.</span>
                  )}
                </div>
              </div>
              <div className="mt-auto flex gap-2">
                <Stat label="Ascended" value={stats.ascended} gradient />
                <Stat label="+15 maxed" value={stats.maxed} />
                <Stat label="Locked" value={stats.locked} />
              </div>
            </Card>
          </div>

          {/* bottom: library + quick actions */}
          <div className="flex gap-3.5">
            <Card className="flex min-w-0 flex-1 items-center justify-between gap-3.5 py-3.5">
              <div className="flex items-center gap-5.5">
                <SectionLabel icon={IC_LIBRARY} tint="#c4b5fd">Library</SectionLabel>
                <div className="flex flex-col gap-px">
                  <Num className="text-[20px] font-bold text-violet-300">{library.builds}</Num>
                  <span className="text-[9px] uppercase tracking-wider text-zinc-500">saved builds</span>
                </div>
                <div className="flex flex-col gap-px">
                  <Num className="text-[20px] font-bold text-violet-300">{library.presets}</Num>
                  <span className="text-[9px] uppercase tracking-wider text-zinc-500">filter presets</span>
                </div>
              </div>
              <ActBtn tone="violet" onClick={onOpenBuilder}>Open Builder →</ActBtn>
            </Card>
            <Card className="flex min-w-0 flex-[1.5] items-center gap-3.5 py-3.5">
              <SectionLabel icon={IC_BOLT} tint="#22d3ee">Quick actions</SectionLabel>
              <div className="flex flex-1 gap-2">
                <button
                  onClick={onCapture}
                  disabled={busy}
                  className={cx(
                    "flex-1 rounded-lg bg-linear-to-b from-cyan-400 to-cyan-500 py-2.5 text-[11.5px] font-bold text-cyan-950 shadow-[0_0_0_1px_rgba(34,211,238,0.4)] hover:brightness-105",
                    busy && "cursor-not-allowed opacity-50",
                  )}
                >
                  {busy ? "Capturing…" : "Capture"}
                </button>
                <ActBtn className="flex-1 text-center" onClick={onSyncData}>Sync data</ActBtn>
                <ActBtn className="flex-1 text-center" onClick={onOpenSettings}>Settings</ActBtn>
                <ActBtn className="flex-1 text-center" onClick={onOpenBuilder}>Open Builder</ActBtn>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

// ── breakdown bar row (element / class) ──────────────────────────────────
function BarRow({ label, labelW, count, w, color }: { label: string; labelW: number; count: number; w: string; color: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="shrink-0 text-[11px] text-zinc-400" style={{ width: labelW }}>{label}</span>
      <div className="h-1.75 flex-1 overflow-hidden rounded-full bg-white/5">
        <div className="h-full rounded-full" style={{ width: w, background: color }} />
      </div>
      <Num className="w-6 shrink-0 text-right text-[11px] font-semibold text-zinc-300">{count}</Num>
    </div>
  );
}

// ── small gear-state stat tile (ascended / +15 / locked) ─────────────────
function Stat({ label, value, gradient }: { label: string; value: number; gradient?: boolean }) {
  return (
    <div className={cx(
      "flex flex-1 flex-col gap-0.5 rounded-lg px-2.5 py-2.5",
      gradient ? "border border-cyan-400/20 bg-cyan-400/5" : "border border-white/7 bg-white/3",
    )}>
      {gradient ? (
        <span className="bg-linear-to-r from-cyan-400 via-violet-500 to-pink-500 bg-clip-text text-[9px] font-bold uppercase tracking-wider text-transparent">{label}</span>
      ) : (
        <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">{label}</span>
      )}
      <Num className={cx("text-[18px] font-bold", gradient ? "text-cyan-300" : "text-zinc-200")}>{value.toLocaleString()}</Num>
    </div>
  );
}
