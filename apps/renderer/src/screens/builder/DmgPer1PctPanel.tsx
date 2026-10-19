/**
 * Builder damage panel — expected-damage gain from +1% of each relevant stat.
 */
import { Fragment, useMemo } from "react";
import { StatIcon } from "../../design/EquipmentIcon.js";
import { cx } from "../../design/cx.js";
import { dmgTickGains, type DmgTickCandidate } from "../../lib/dmgValue.js";
import type { FinalStats } from "../../lib/composeBuild.js";
import type { SelectedComposition } from "./composition.js";
import { Panel } from "./Panel.js";

/* ─────────────────────────────────────────────────────────────────────────
 * Damage / +1% — expected-damage gain from +1% of each relevant stat
 * ───────────────────────────────────────────────────────────────────────── */
const DMG_STAT_ICON: Record<string, { iconKey: string; label: string }> = {
  atk: { iconKey: "atk", label: "ATK" },
  def: { iconKey: "def", label: "DEF" },
  hp: { iconKey: "hp", label: "HP" },
  spd: { iconKey: "spd", label: "SPD" },
  eff: { iconKey: "eff", label: "EFF" },
  crc: { iconKey: "critRate", label: "CHC" },
  chd: { iconKey: "critDmg", label: "CHD" },
  dmgUp: { iconKey: "dmgUp", label: "DMG UP%" },
};

/** The panel's ranked gains — pure in `comp`, memoized by the panel. */
function dmgPer1PctGains(comp: SelectedComposition): ReturnType<typeof dmgTickGains> {
  const { current, baseFlat, dmgStat, dmgSec, dmgAmp, noCrit } = comp;
  // Crit baseline: 100% (the crit cap you build toward, so CHD is valued at full
  // weight) — except for no-crit heroes, evaluated at 0% so CHD reads as dead.
  const atCap: FinalStats = { ...current, critRate: noCrit ? 0 : 100 };
  // Scaling stats = main dmg stat + any additive secondary stats (deduped).
  // `crc` here is the DATA-sourced scaling key (dmgStat/dmgSec); it maps to the
  // `critRate` FinalStats field for the per-tick perturbation below.
  const scalingStats = Array.from(new Set<"atk" | "def" | "hp" | "spd" | "eff" | "crc">([dmgStat, ...(dmgSec?.map((s) => s.stat) ?? [])]));
  const candidates: DmgTickCandidate[] = scalingStats.map((s) => ({
    key: s, label: DMG_STAT_ICON[s]!.label, field: (s === "crc" ? "critRate" : s) as keyof FinalStats,
    // ATK/DEF/HP: a 1% sub = base × 1% × (1+buffRate). SPD is flat (so it's per
    // +1 SPD point), EFF/CHC are additive % → also +1 point.
    delta: s === "spd" || s === "eff" || s === "crc" ? 1 : (baseFlat[s] * dmgAmp[s]) / 100,
  }));
  // CHD is dead for no-crit heroes — drop it (it would just read +0.00%).
  if (!noCrit) candidates.push({ key: "chd", label: "CHD", field: "critDmg", delta: 1 });
  candidates.push({ key: "dmgUp", label: "DMG UP%", field: "dmgUp", delta: 1 });
  return dmgTickGains(atCap, dmgStat, dmgSec, candidates);
}

/** Expected-damage gain from **+1%** of each relevant stat for the picked hero,
 *  computed at the **crit cap (100% CHC)** — the endgame theorycraft baseline you
 *  build toward (otherwise CHD is undervalued). Compares the hero's scaling
 *  stat(s) (ATK / DEF / HP per `dmgStat` + `dmgSec`) vs CHD vs DMG inc, ranked,
 *  best in cyan. A "1%" of a scaling stat = a 1% sub → `base × 1% × (1+buffRate)`
 *  added to the final; CHD / DMG-UP are additive (+1). Reuses the validated
 *  `computeCheapRatings` model (crit folded into the hit rate per the binary). */
export function DmgPer1PctPanel({ comp, width = "w-full" }: {
  comp: SelectedComposition | null;
  width?: string;
}) {
  // Memoized on `comp` (hero / account changes only) — the screen re-renders on
  // every filter edit and selection.
  const gains = useMemo(() => (comp ? dmgPer1PctGains(comp) : []), [comp]);
  if (!comp || gains.length === 0) return null;
  const { noCrit } = comp;
  // Highlight EVERY stat tied for the highest gain (same displayed +X.XX%), not
  // just the single top one — equal-weight stats are all colored. `gains` is
  // sorted, so the max is gains[0]; we compare on the displayed precision.
  const bestStr = gains[0]!.gainPct > 0 ? gains[0]!.gainPct.toFixed(2) : null;
  return (
    <Panel
      title={`Damage / +1% · ${noCrit ? "no crit" : "100% crit"}`}
      hintWidth={360}
      hint={
        <div className="space-y-1.5">
          <p>
            Expected-damage gain from <b className="text-white">+1%</b> of each stat,{" "}
            {noCrit
              ? <>evaluated at <span className="text-amber-300">0% crit</span> — this hero can never crit (<b className="text-white/90">CHD</b> is dead, so it&apos;s omitted).</>
              : <>at the <span className="text-cyan-300">crit cap</span> (100% CHC) — the endgame baseline you build toward.</>}
          </p>
          <div>
            <div className="mb-0.5 text-[9px] uppercase tracking-wider text-white/40">+1% means, per row</div>
            <div className="space-y-0.5 text-white/75">
              <div><b className="text-white/90">ATK / DEF / HP</b> — a 1% sub (base × 1%, via the hero&apos;s mults)</div>
              <div><b className="text-white/90">CHD · DMG inc · EFF · CHC</b> — +1 point</div>
              <div><b className="text-white/90">SPD</b> — +1 SPD point (flat)</div>
            </div>
          </div>
          <p><span className="text-cyan-300">Cyan</span> = where the most damage is bought. In-game crit / DMG± / PEN model.</p>
        </div>
      }
      width={width}
    >
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1 font-mono text-[10.5px] tabular-nums">
        {gains.map((g) => {
          const icon = DMG_STAT_ICON[g.key]!;
          const best = bestStr != null && g.gainPct.toFixed(2) === bestStr;
          return (
            <Fragment key={g.key}>
              <StatIcon stat={icon.iconKey} size={12} />
              <span className={best ? "text-cyan-300" : "text-white/70"}>{icon.label}</span>
              <span className={cx("text-right", best ? "text-cyan-300" : "text-white/65")}>+{g.gainPct.toFixed(2)}%</span>
            </Fragment>
          );
        })}
      </div>
    </Panel>
  );
}
