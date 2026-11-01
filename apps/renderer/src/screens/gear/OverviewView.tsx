/**
 * Gear › Overview — the account read that was the Home tab until 2026-11-01
 * (ported from the Claude Design dashboard mockup, Direction A): a discreet snapshot
 * line up top, the gear-quality distribution as the hero stat, then the
 * roster and gear breakdowns below. Clicks on a quality tier, a slot or an
 * armor set open Gear › Pieces filtered on it.
 *
 * The capture pill and its action live in the header, the game data sync and
 * the update center in Settings › Data & updates, the saved builds and filter
 * sets in the Optimizer.
 *
 * All numbers are derived from the already-loaded `inventory` + `game` (no new
 * fetches). GearScreen shows the first-capture steps instead while nothing is
 * captured.
 */
import { useMemo } from "react";
import type { GameData, Inventory } from "@gear-solver/core";
import type { CaptureStatus } from "../../capture.js";
import { cx } from "../../design/cx.js";
import { jsonOneOf, useSessionState } from "../../hooks/usePersistedState.js";
import type { InventoryDrill } from "../inventory/InventoryScreen.js";
import { computeStats } from "../../lib/gear/overviewStats.js";
import { Card, SubLabel, SectionLabel, Num, Segmented, InfoTip, BarRow, Stat } from "./overview/OverviewPrimitives.js";
import { IC_QUALITY, IC_ROSTER, IC_GEAR, IC_ELEMENT, IC_CLASS, IC_SLOT, IC_SETS } from "./overview/OverviewIcons.js";
import { ExportRosterButton } from "./overview/ExportRosterButton.js";
import { SlotHead, ClassEffectRow, EffectChipView } from "./overview/ClassEffectRow.js";
import { OopartsTable } from "./overview/OopartsTable.js";

// Shown on the section's info tooltip — how the grade is computed.
const QUALITY_METRIC_HINT =
  "Each piece is graded by its rolled substat ticks against the max it could reach (14 + spent reforges). Talisman & Exclusive Equipment aren't graded.";

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

type BreakdownView = "overview" | "class" | "sets" | "ooparts";
const BREAKDOWN_VIEW_CODEC = jsonOneOf<BreakdownView>(["overview", "class", "sets", "ooparts"]);

// ── view ─────────────────────────────────────────────────────────────────
export interface OverviewViewProps {
  inventory: Inventory;
  game: GameData | null;
  capStatus: CaptureStatus | null;
  /** Open Gear › Pieces pre-filtered to a clicked facet (quality tier / slot
   *  / armor set). Undefined = numbers stay non-interactive. */
  onDrill?: (d: InventoryDrill) => void;
}

export function OverviewView({ inventory, game, capStatus, onDrill }: OverviewViewProps) {

  // Gear breakdown view — overview (by slot + top sets), class matrix, the
  // full owned-set list or the talismans. View state: kept across a tab switch
  // (sessionStorage), back to the overview on the next launch.
  const [breakdownView, setBreakdownView] = useSessionState<BreakdownView>("gs.gear.breakdownView", "overview", BREAKDOWN_VIEW_CODEC);

  const stats = useMemo(() => computeStats(inventory, game), [inventory, game]);
  const lastCap = relTime(capStatus?.userItemMtime ?? null);

  return (
    <div className="mx-auto flex w-full flex-col gap-3.5 px-3.5 py-3.5" style={{ maxWidth: 1480 }}>
      {/* snapshot — a discreet line, not a card: what the capture holds and
          when it was taken */}
      <div className="flex items-center gap-1.5 px-1 text-[11px] text-zinc-400">
        <Num className="text-zinc-200">{stats.heroes.toLocaleString()}</Num> heroes
        <span>·</span>
        <Num className="text-zinc-200">{stats.gear.toLocaleString()}</Num> pieces
        {lastCap && (
          <>
            <span>·</span>
            <span>captured <Num className="text-zinc-200">{lastCap.rel}</Num> ({lastCap.abs})</span>
          </>
        )}
      </div>

      {/* HERO: gear quality distribution */}
      <Card className="flex flex-col gap-3.5">
        <SectionLabel
          icon={IC_QUALITY}
          tint="#fbbf24"
          right={
            <div className="flex items-center gap-2">
              <Num className="text-[10px] text-zinc-400">{stats.totalGraded.toLocaleString()} pieces graded by substat roll quality</Num>
              <InfoTip text={QUALITY_METRIC_HINT} />
            </div>
          }
        >
          Gear quality distribution
        </SectionLabel>
        <div className="flex h-8 gap-0.75 overflow-hidden rounded-lg">
          {stats.tiers.map((t) => (
            <div key={t.tier} style={{ flex: `${t.count} 1 0`, background: t.color, opacity: 0.92 }} />
          ))}
        </div>
        <div className="grid grid-cols-5 gap-3">
          {stats.tiers.map((t) => (
            <button
              key={t.tier}
              type="button"
              disabled={!onDrill || t.count === 0}
              onClick={() => onDrill?.({ quality: t.tier })}
              title={onDrill ? `${t.hint}\n\nClick to see these ${t.label} pieces in Gear` : t.hint}
              className={cx(
                "-mx-1.5 flex flex-col gap-1 rounded-lg px-1.5 py-1 text-left transition-colors",
                onDrill && t.count > 0 ? "cursor-pointer hover:bg-white/5" : "cursor-help",
              )}
            >
              <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t.color }} />
                {t.label}
              </span>
              <Num className="text-[23px] font-bold" color={t.color}>{t.count.toLocaleString()}</Num>
              <Num className="text-[10px] text-zinc-400">{t.pct} of pool</Num>
            </button>
          ))}
        </div>
      </Card>

      {/* breakdown row — roster + gear. items-start so each card keeps its
          natural height (no forced-stretch empty space under Gear). */}
      <div className="flex items-start gap-3.5">
        {/* roster */}
        <Card className="flex min-w-0 flex-1 flex-col gap-3.5">
          <SectionLabel
            icon={IC_ROSTER}
            tint="#c4b5fd"
            right={
              <span className="flex items-center gap-2">
                <ExportRosterButton inventory={inventory} game={game} />
                <Num className="text-[10px] text-zinc-400">{stats.heroes.toLocaleString()} heroes</Num>
              </span>
            }
          >Roster</SectionLabel>
          <div className="flex flex-col gap-2">
            <SubLabel icon={IC_ELEMENT}>By element</SubLabel>
            {stats.elements.map((e) => (
              <BarRow key={e.label} label={e.label} labelW={40} count={e.count} w={e.w} color={e.color} iconSrc={`/img/ui/elem/IG_Turn_Element_${e.label}.webp`} />
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <SubLabel icon={IC_CLASS}>By class</SubLabel>
            {stats.classes.map((c) => (
              <BarRow key={c.label} label={c.label} labelW={50} count={c.count} w={c.w} color="#6b7280" iconSrc={`/img/ui/class/IG_Turn_Class_${c.label}.webp`} />
            ))}
          </div>
        </Card>

        {/* gear breakdown */}
        <Card className="flex min-w-0 flex-[1.3] flex-col gap-3.5">
          <SectionLabel
            icon={IC_GEAR}
            tint="#38bdf8"
            right={
              <Segmented
                value={breakdownView}
                onChange={setBreakdownView}
                options={[
                  { id: "overview", label: "Overview" },
                  { id: "class", label: "Class" },
                  { id: "sets", label: "All sets" },
                  { id: "ooparts", label: "Talisman" },
                ]}
              />
            }
          >
            Gear breakdown
          </SectionLabel>

          {breakdownView === "overview" && (
            <div className="flex gap-4">
              {/* by slot */}
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <SubLabel icon={IC_SLOT}>By slot</SubLabel>
                <div className="grid grid-cols-2 gap-x-3.5 gap-y-2">
                  {stats.slots.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      disabled={!onDrill || s.count === 0}
                      onClick={() => onDrill?.({ slot: s.id })}
                      title={onDrill ? `Show ${s.label} in Gear` : undefined}
                      className={cx(
                        "flex items-center justify-between gap-1.5 border-b border-white/5 pb-1.5 text-left transition-colors",
                        onDrill && s.count > 0 ? "cursor-pointer hover:border-white/20" : "",
                      )}
                    >
                      <span className="text-[11px] text-zinc-400">{s.label}</span>
                      <Num className="text-[11.5px] font-semibold text-zinc-300">{s.count}</Num>
                    </button>
                  ))}
                </div>
              </div>
              {/* top sets */}
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <SubLabel icon={IC_SETS}>Top armor sets</SubLabel>
                {stats.sets.length > 0 ? stats.sets.map((se) => (
                  <button
                    key={se.id}
                    type="button"
                    disabled={!onDrill}
                    onClick={() => onDrill?.({ armorSet: se.id })}
                    title={onDrill ? `Show ${se.name} pieces in Gear` : se.name}
                    className={cx(
                      "-mx-1 flex items-center gap-2 rounded-md px-1 py-0.5 text-left transition-colors",
                      onDrill ? "cursor-pointer hover:bg-white/5" : "",
                    )}
                  >
                    {se.icon
                      ? <img src={`/img/ui/effect/${se.icon}.webp`} alt="" className="h-4.5 w-4.5 shrink-0" />
                      : <span className="h-3.5 w-3.5 shrink-0 rounded" style={{ background: se.color }} />}
                    <span className="w-13 shrink-0 truncate text-[11px] text-zinc-300">{se.name}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
                      <div className="h-full rounded-full" style={{ width: se.w, background: se.color, opacity: 0.65 }} />
                    </div>
                    <Num className="w-7.5 shrink-0 text-right text-[11px] font-semibold text-zinc-300">{se.count}</Num>
                  </button>
                )) : (
                  <span className="text-[11px] text-zinc-400">No armor sets resolved.</span>
                )}
              </div>
            </div>
          )}

          {breakdownView === "class" && (
            <div className="flex flex-col gap-1">
              <SubLabel icon={IC_CLASS}>Owned effects by class</SubLabel>
              {/* column headers — inventory tab icons stand in for WPN / ACC */}
              <div className="grid grid-cols-[76px_1fr_1fr] items-center gap-x-4 pb-0.5">
                <span />
                <SlotHead slot="weapon" />
                <SlotHead slot="accessory" />
              </div>
              {stats.classGear.map((r) => (
                <ClassEffectRow key={r.id} row={r} />
              ))}
            </div>
          )}

          {breakdownView === "sets" && (
            <div className="flex flex-col gap-2">
              <SubLabel icon={IC_SETS}>
                All armor sets · {stats.allSets.filter((s) => s.count > 0).length}/{stats.allSets.length} owned
              </SubLabel>
              {stats.allSets.length > 0 ? (
                <div className="grid grid-cols-7 justify-items-center gap-x-2 gap-y-3">
                  {stats.allSets.map((se) => (
                    <EffectChipView
                      key={se.id}
                      forceCount
                      chip={{ key: se.id, icon: se.icon, name: se.name, desc: "", count: se.count, color: se.color }}
                    />
                  ))}
                </div>
              ) : (
                <span className="text-[11px] text-zinc-400">No armor sets resolved.</span>
              )}
            </div>
          )}

          {breakdownView === "ooparts" && (
            <div className="flex flex-col gap-2">
              <SubLabel icon={IC_SLOT}>Talisman × main stat · {stats.ooparts.total} owned</SubLabel>
              <OopartsTable ooparts={stats.ooparts} />
            </div>
          )}

          <div className="mt-auto flex gap-2">
            <Stat label="Ascended" value={stats.ascended} gradient />
            <Stat label="Singularity" value={stats.maxed} />
            <Stat label="Locked" value={stats.locked} />
          </div>
        </Card>
      </div>
    </div>
  );
}
