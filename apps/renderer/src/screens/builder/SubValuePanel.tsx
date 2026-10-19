/**
 * Builder sub tick panel — flat vs % rentability for ATK / DEF / HP.
 */
import { Fragment } from "react";
import type { GameData } from "@gear-solver/core";
import { StatIcon } from "../../design/EquipmentIcon.js";
import { cx } from "../../design/cx.js";
import { flatVsPctTick } from "../../lib/subValue.js";
import { Panel } from "./Panel.js";

/* ─────────────────────────────────────────────────────────────────────────
 * Sub tick value — flat vs % rentability for ATK / DEF / HP
 * ───────────────────────────────────────────────────────────────────────── */
const SUB_VALUE_STATS = [
  { key: "atk", pctKey: "atkPct", label: "ATK" },
  { key: "def", pctKey: "defPct", label: "DEF" },
  { key: "hp", pctKey: "hpPct", label: "HP" },
] as const;

/** Per-tick flat-vs-% sub value for the picked hero. A %-tick scales with the
 *  hero's no-gear base (base+evo+awak), a flat tick is constant — so which is
 *  worth more depends only on the hero. Reference = 6★ substats. Hidden until a
 *  hero is picked and the sub-tick table is present. */
export function SubValuePanel({ baseFlat, subTicks, width = "w-full" }: {
  baseFlat: { atk: number; def: number; hp: number } | null;
  subTicks: GameData["subTicks"] | undefined;
  width?: string;
}) {
  const tier = subTicks?.["6"];
  if (!baseFlat || !tier) return null;
  const rows = SUB_VALUE_STATS.map((s) => {
    const flat = tier[s.key];
    const pct = tier[s.pctKey];
    if (!flat || !pct) return null;
    const base = baseFlat[s.key];
    return { key: s.key, label: s.label, cmp: flatVsPctTick(base, flat.step, pct.step) };
  }).filter((r): r is NonNullable<typeof r> => r != null);
  if (rows.length === 0) return null;
  return (
    <Panel
      title="Sub tick value"
      hintWidth={340}
      hint={
        <div className="space-y-1.5">
          <p>Per <b className="text-white">6★ substat tick</b> — flat vs %.</p>
          <p className="text-white/70">A <b className="text-white/90">%</b> tick scales with the hero&apos;s base (base + evo + awak); <b className="text-white/90">flat</b> is fixed.</p>
          <p><span className="text-cyan-300">Cyan</span> = the more valuable sub to roll. % overtakes flat above the breakeven base shown.</p>
        </div>
      }
      width={width}
    >
      <div className="grid grid-cols-[auto_1fr_1.4fr] items-center gap-x-2 gap-y-1 font-mono text-[10.5px] tabular-nums">
        <span />
        <span className="text-right text-[8.5px] uppercase tracking-wider text-white/65">flat</span>
        <span className="text-right text-[8.5px] uppercase tracking-wider text-white/65">% (≈ flat)</span>
        {rows.map((r) => (
          <Fragment key={r.key}>
            <StatIcon stat={r.key} size={12} />
            <span className={cx("text-right", r.cmp.winner === "flat" ? "text-cyan-300" : "text-white/65")}>
              +{r.cmp.flatTick}
            </span>
            <span className={cx("text-right", r.cmp.winner === "pct" ? "text-cyan-300" : "text-white/65")}>
              +{r.cmp.pctTick}% <span className="text-white/55">≈{Math.round(r.cmp.pctFlatEquiv)}</span>
            </span>
          </Fragment>
        ))}
      </div>
    </Panel>
  );
}
