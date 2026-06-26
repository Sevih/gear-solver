/**
 * Compact gear-piece tooltip body — name + meta line + main rolls + substats
 * (or gems for talisman/EE). Designed to drop inside `RichTooltip` so any small
 * piece tile (e.g. the Builds tab's `SlotMini`) becomes inspectable on hover,
 * mirroring the inventory detail panel without the full chrome.
 */
import type { UiPiece } from "./adapter.js";
import { RARITY, SINGULARITY_GRADIENT_H, SLOT_BY, STAT } from "./tokens.js";
import { StatIcon } from "./EquipmentIcon.js";
import { cx } from "./cx.js";

/** Long stat label, disambiguating percent variants (atk vs atkPct). */
function statLong(key: string): string {
  const meta = STAT[key];
  if (!meta) return key.toUpperCase();
  return key.endsWith("Pct") ? `${meta.longLabel}%` : meta.longLabel;
}

function sign(value: string): string {
  return value.startsWith("-") ? "" : "+";
}

export function GearTooltipContent({ piece }: { piece: UiPiece }) {
  const rarity = RARITY[piece.rarity];
  const slotLabel = piece.slot ? SLOT_BY[piece.slot]?.label ?? piece.slot : "Item";
  const nameStyle = piece.singularity
    ? { background: SINGULARITY_GRADIENT_H, WebkitBackgroundClip: "text" as const, backgroundClip: "text" as const, color: "transparent" }
    : { color: rarity?.fg ?? "#f4f4f5" };
  const dot = <span className="text-white/35">·</span>;

  return (
    <div className="flex w-full flex-col gap-2 text-left">
      {/* header — name */}
      <div className="flex items-center gap-1.5">
        {piece.locked && <img src="/img/ui/inven/CT_Slot_Lock.webp" alt="" className="h-3.5 w-3.5 shrink-0" />}
        <span className="truncate text-[12.5px] font-semibold" style={nameStyle}>
          {piece.name}{piece.singularity ? " · [Singularity]" : ""}
        </span>
      </div>

      {/* meta line — slot · rarity · +enhance · stars · class */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-zinc-400">
        <span>{slotLabel}</span>
        {rarity && <>{dot}<span style={{ color: rarity.fg }}>{rarity.label}</span></>}
        {dot}<span className="font-mono text-zinc-300">+{piece.enhance}</span>
        {piece.stars > 0 && <>{dot}<span className="font-mono text-amber-300">{piece.stars}★</span></>}
        {piece.classLimit && <>{dot}<span>{piece.classLimit}</span></>}
      </div>

      {/* main rolls */}
      {piece.main.length > 0 && (
        <div className="flex flex-col gap-1">
          {piece.main.map((m, i) => (
            <div key={i} className="flex items-center gap-1.5 font-mono text-[11px]">
              <StatIcon stat={m.stat} size={13} title={null} />
              <span className="flex-1 text-zinc-300">{statLong(m.stat)}</span>
              <span className="font-semibold text-white">{sign(m.value)}{m.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* substats */}
      {piece.subs.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-white/8 pt-1.5">
          {piece.subs.map((s, i) => {
            const maxed = piece.stars > 0 && s.lv >= piece.stars;
            return (
              <div key={i} className={cx("flex items-center gap-1.5 font-mono text-[11px]", maxed ? "text-amber-300" : "text-zinc-300")}>
                <span className={cx("w-7 shrink-0 text-[9.5px]", maxed ? "text-amber-400/80" : "text-zinc-500")}>Lv{s.lv}</span>
                <StatIcon stat={s.stat} size={13} title={null} />
                <span className="flex-1">{statLong(s.stat)}</span>
                <span className={cx("font-semibold", maxed ? "text-amber-200" : "text-white")}>{sign(s.value)}{s.value}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* gems (talisman / EE) */}
      {piece.gemSlots && piece.gemSlots.some((g) => g.gem) && (
        <div className="flex flex-col gap-1 border-t border-white/8 pt-1.5">
          {piece.gemSlots.map((g, i) => g.gem ? (
            <div key={i} className="flex items-center gap-1.5 font-mono text-[11px] text-zinc-300">
              <StatIcon stat={g.gem.stat} size={13} title={null} />
              <span className="flex-1">{statLong(g.gem.stat)}</span>
              <span className="font-semibold text-white">{g.gem.value < 0 ? "-" : "+"}{Math.abs(g.gem.value)}{g.gem.percent ? "%" : ""}</span>
            </div>
          ) : null)}
        </div>
      )}
    </div>
  );
}
