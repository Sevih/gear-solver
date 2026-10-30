/**
 * Scrap value card — under the piece panel in the Inventory's left column.
 * Prices the selected pieces, or the filtered view when nothing is selected,
 * and carries the selection controls. Information only: nothing here acts
 * on the game.
 */
import { cx } from "../../design/cx.js";
import { formatGold, formatRange, type ScrapValue } from "../../lib/inventory/scrapValue.js";
import type { MaterialRow } from "../../lib/inventory/scrapCard.js";

/** Material tiles shown before the rest folds into "+n more". */
const MATERIALS_SHOWN = 6;

const GOLD_ICON = "/img/items/CM_Goods_Gold.webp";

export interface ScrapCardProps {
  scrap: ScrapValue;
  /** "2 selected" or "37 shown". */
  label: string;
  materials: MaterialRow[];
  selectMode: boolean;
  selectedCount: number;
  onToggleMode: () => void;
  onSelectShown: () => void;
  /** Absent when the screen has no solver exclusions to offer. */
  onSelectExcluded?: () => void;
  onClear: () => void;
}

export function ScrapCard({
  scrap, label, materials, selectMode, selectedCount, onToggleMode, onSelectShown, onSelectExcluded, onClear,
}: ScrapCardProps) {
  const { sell, dissolve, unknown } = scrap;
  const shown = materials.slice(0, MATERIALS_SHOWN);
  const rest = materials.slice(MATERIALS_SHOWN);
  const hasGold = dissolve.gold.max > 0;
  const notes = [`${dissolve.count} dissolvable`];
  if (dissolve.enhancedCount > 0) notes.push(`${dissolve.enhancedCount} enhanced: refund not counted`);
  if (unknown > 0) notes.push(`${unknown} not in the game data`);

  return (
    <section className="shrink-0 rounded-xl border border-white/6 bg-white/[0.012] px-4 py-3">
      <header className="flex items-baseline justify-between">
        <h3 className="text-[12px] font-semibold text-white">Scrap value</h3>
        <span className="text-[11px] text-white/70">{label}</span>
      </header>

      <div className="mt-2.5 flex items-center gap-2 text-[11.5px]">
        <span className="w-14 shrink-0 text-white/70">Sell</span>
        <img src={GOLD_ICON} alt="Gold" className="h-4 w-4 shrink-0 object-contain" />
        <span className="font-mono text-white">{formatGold(sell.gold)}</span>
        <span className="ml-auto text-[10.5px] text-white/60">{sell.count} sellable</span>
      </div>

      <div className="mt-2 flex items-start gap-2 text-[11.5px]">
        <span className="w-14 shrink-0 pt-0.5 text-white/70">Dissolve</span>
        <div className="min-w-0 flex-1">
          {hasGold && (
            <div className="flex items-center gap-2">
              <img src={GOLD_ICON} alt="Gold" className="h-4 w-4 shrink-0 object-contain" />
              <span className="font-mono text-white">{formatRange(dissolve.gold)}</span>
            </div>
          )}
          {materials.length > 0 && (
            <div className={cx("flex flex-wrap items-center gap-1.5", hasGold && "mt-1.5")}>
              {shown.map((m) => <MaterialTile key={m.id} m={m} />)}
              {rest.length > 0 && (
                <span
                  title={rest.map((m) => `${formatRange(m)} × ${m.name}`).join("\n")}
                  className="text-[10.5px] text-white/70 underline decoration-dotted"
                >
                  +{rest.length} more
                </span>
              )}
            </div>
          )}
          {!hasGold && materials.length === 0 && <span className="text-white/60">nothing</span>}
        </div>
      </div>

      <p className="mt-2 text-[10.5px] leading-snug text-white/60">{notes.join(" · ")}</p>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-white/6 pt-2.5">
        <CardButton
          onClick={onToggleMode}
          active={selectMode}
          title={selectMode
            ? "Selection mode on: a click on a tile selects or unselects it. Click to leave (the selection is kept)."
            : "Turn on selection mode: a click on a tile then selects or unselects it. Ctrl+click always does."}
        >
          {selectMode ? "Selecting…" : "Select pieces"}
        </CardButton>
        <CardButton onClick={onSelectShown} title="Add every piece of the current view to the selection">Select all shown</CardButton>
        {onSelectExcluded && (
          <CardButton onClick={onSelectExcluded} title="Add every piece excluded from the solver to the selection">Select excluded</CardButton>
        )}
        <CardButton onClick={onClear} disabled={selectedCount === 0} title="Empty the selection">Clear</CardButton>
        <span className="ml-auto text-[10.5px] text-white/70">{selectedCount} selected</span>
      </div>
    </section>
  );
}

/** One material: 24 px icon (or a neutral square with its first two
 *  letters), the quantity as a badge, the name on hover. */
function MaterialTile({ m }: { m: MaterialRow }) {
  return (
    <span
      title={`${formatRange(m)} × ${m.name}`}
      className="relative grid h-8 w-8 place-items-center rounded-md border border-white/6 bg-black/30"
    >
      {m.icon ? (
        <img src={`/img/items/${m.icon}.webp`} alt="" className="h-6 w-6 object-contain" />
      ) : (
        <span className="grid h-6 w-6 place-items-center rounded bg-white/6 text-[9.5px] font-semibold text-white/70">
          {m.name.slice(0, 2)}
        </span>
      )}
      <span className="absolute -bottom-1 -right-1 rounded bg-black/85 px-0.5 font-mono text-[8.5px] leading-tight text-white">
        {formatRange(m)}
      </span>
    </span>
  );
}

function CardButton({ onClick, title, active, disabled, children }: {
  onClick: () => void; title: string; active?: boolean; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={cx(
        "rounded-md border px-2 py-1 text-[10.5px] font-medium transition-colors disabled:opacity-40",
        active
          ? "border-amber-300/60 bg-amber-400/15 text-amber-100 hover:bg-amber-400/25"
          : "border-white/10 bg-white/3 text-white/80 hover:bg-white/6",
      )}
    >
      {children}
    </button>
  );
}
