/**
 * Home class gear rows — owned weapon / accessory effects per class.
 */
import { cx } from "../../design/cx.js";
import { SLOT_BY, type SlotId } from "../../design/tokens.js";
import type { EffectChip, ClassGearRow } from "../../lib/homeStats.js";

// ── class effect row (owned weapon / accessory effects per class) ────────
// Weapons and accessories sit in two columns; the inventory tab icon heads
// each column (see SlotHead) so no WPN / ACC text label is needed.
export function SlotHead({ slot }: { slot: SlotId }) {
  const meta = SLOT_BY[slot]!;
  return <img src={`/img/ui/inven/${meta.icon}.webp`} alt={meta.label} title={meta.label} className="h-4.5 w-4.5 opacity-75" />;
}
export function ClassEffectRow({ row }: { row: ClassGearRow }) {
  return (
    <div className="grid grid-cols-[76px_1fr_1fr] items-start gap-x-4 border-b border-white/5 py-2 last:border-0">
      <span className="flex items-center gap-1.5 pt-0.5 text-[11px] text-zinc-300">
        <img src={`/img/ui/class/IG_Turn_Class_${row.label}.webp`} alt="" className="h-4 w-4 shrink-0" />
        {row.label}
      </span>
      <ChipWrap chips={row.weapons} />
      <ChipWrap chips={row.accessories} />
    </div>
  );
}
function ChipWrap({ chips }: { chips: EffectChip[] }) {
  if (chips.length === 0) return <span className="pt-0.5 text-[10px] text-zinc-600">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((c) => <EffectChipView key={c.key} chip={c} forceCount />)}
    </div>
  );
}
export function EffectChipView({ chip, forceCount }: { chip: EffectChip; forceCount?: boolean }) {
  const owned = chip.count > 0;
  return (
    <span
      title={chip.desc ? `${chip.name} — ${chip.desc}` : chip.name}
      className="relative inline-flex cursor-help"
    >
      {chip.icon
        ? <img src={`/img/ui/effect/${chip.icon}.webp`} alt={chip.name} className={cx("h-5.5 w-5.5 rounded", !owned && "opacity-30 grayscale")} />
        : chip.color
          ? <span className={cx("h-5.5 w-5.5 rounded", !owned && "opacity-30")} style={{ background: chip.color }} />
          : <span className="grid h-5.5 w-5.5 place-items-center rounded bg-white/8 text-[8px] text-zinc-400">?</span>}
      {(forceCount || chip.count > 1) && (
        <span className={cx(
          "absolute -bottom-1 -right-1 grid min-w-3.5 place-items-center rounded-full px-0.5 text-[8px] font-bold leading-none ring-1",
          owned ? "bg-zinc-900 text-zinc-200 ring-white/15" : "bg-zinc-950 text-rose-400 ring-rose-500/30",
        )}>
          {chip.count}
        </span>
      )}
    </span>
  );
}
