/**
 * Builder-results gear-card body — a DELIBERATE DUPLICATE of `GearDetail.tsx`'s
 * `GearDetailBody`, forked so the SOLVE results cards can be "pimped"
 * (Builder-specific chrome: equip state, per-slot diff, reforge-projection
 * badges, recommended gems…) WITHOUT touching the Inventory tab's inspect panel.
 *
 * Step 1 intentionally keeps it byte-for-byte identical to the inventory card;
 * the Builder-specific additions land in follow-up passes. Until then, edits
 * here must NOT be assumed to mirror GearDetail and vice-versa.
 *
 * Renders, in order: name, icon + rarity/class + equipped char, main rolls,
 * substats (or gems for talisman/EE — never both), quality score, multi-tier
 * passive (talisman/EE), unique-option passive (weapons/accessories), set
 * effect (armor 2/4-pc), and the Singularity active effect on ascended pieces.
 */
import type { Character, GameData } from "@gear-solver/core";
import type { UiPiece } from "./adapter.js";
import { CharFace, EquipmentIcon, StatIcon } from "./EquipmentIcon.js";
import { RARITY, SINGULARITY_GRADIENT_V, STAT } from "./tokens.js";
import { GameText } from "./GameText.js";
import { cx } from "./cx.js";
import { QUALITY_COLOR, qualityTierFromScore, type QualityTier } from "../lib/quality.js";

/** Per-tier UI tone (text class + bar color + label). `bar` pulls from the
 *  shared `QUALITY_COLOR` so the Inventory filter and the quality bar agree. */
const QUALITY_TONE: Record<QualityTier, { text: string; bar: string; label: string }> = {
  poor:      { text: "text-white",      bar: QUALITY_COLOR.poor,      label: "Poor" },
  decent:    { text: "text-sky-300",    bar: QUALITY_COLOR.decent,    label: "Decent" },
  good:      { text: "text-emerald-300",bar: QUALITY_COLOR.good,      label: "Good" },
  excellent: { text: "text-violet-300", bar: QUALITY_COLOR.excellent, label: "Excellent" },
  perfect:   { text: "text-amber-300",  bar: QUALITY_COLOR.perfect,   label: "Perfect" },
};

/** Long stat label, disambiguating percent variants (atk vs atkPct), with a
 *  readable placeholder when STAT doesn't know the key (talisman/EE mains). */
function statLong(key: string): string {
  const meta = STAT[key];
  if (!meta) return key.toUpperCase();
  if (key.endsWith("Pct")) return `${meta.longLabel}%`;
  return meta.longLabel;
}

/** "Quality" score — sum of every substat tick vs the cap for the piece's
 *  CURRENT investment (base 14 + 1 per spent reforge). Null for talisman/EE
 *  (gem-bearing, no rollable subs) and un-rolled pieces. Thresholds shared with
 *  the Builder's quality filter (lib/quality.ts). */
function computeQuality(piece: UiPiece): { current: number; max: number; pct: number; tier: QualityTier } | null {
  if (piece.slot === "talisman" || piece.slot === "exclusive") return null;
  if (piece.subs.length === 0 || piece.stars <= 0) return null;
  const current = piece.subs.reduce((sum, s) => sum + s.lv, 0);
  const max = 14 + piece.reforge.n;
  const pct = Math.min(100, Math.round((current / max) * 100));
  const tier = qualityTierFromScore(current, max);
  return { current, max, pct, tier };
}

/** A single substat row: "LV {n} (base + reforges)  [icon]  label  value".
 *  Gold-tinted once the sub hits its cap of 6 total ticks (base + reforges) —
 *  fixed at 6 regardless of the item's star tier. A 6★ socle is 4/4/3/3, so a
 *  sub only reaches 6 after reforges, never at socle. */
function SubstatRow({ s, added = 0 }: { s: UiPiece["subs"][number]; added?: number }) {
  const isMax = s.lv >= 6;
  const sign = s.value.startsWith("-") ? "" : "+";
  // Split the tick count into Base (initial roll) + Actuelle (reforges actually
  // done on the captured piece) + Extrapolé (reforges the projection added).
  const base = s.lv - s.reforges;
  const extrapole = Math.max(0, added);
  const actuelle = s.reforges - extrapole;
  return (
    <div className={cx("flex items-center gap-2 font-mono text-[12px] tabular-nums", isMax ? "text-amber-300" : "text-white")}>
      <span className={cx("w-30 shrink-0", isMax ? "text-amber-300" : "text-white")}>
        LV {s.lv}
        {s.reforges > 0 && (
          <span className={cx("ml-1", isMax ? "text-amber-400/80" : "text-white/70")}>
            ({base} + {actuelle}
            {extrapole > 0 && <span className="text-cyan-300"> + {extrapole}</span>}
            )
          </span>
        )}
      </span>
      <StatIcon stat={s.stat} size={16} className="shrink-0" />
      <span className="flex-1">{statLong(s.stat)}</span>
      <span className={cx("font-semibold", isMax ? "text-amber-200" : "text-white")}>{sign}{s.value}</span>
    </div>
  );
}

/** Talisman / EE gem panel — the 5 slot positions, filled (icon + Lv + stat +
 *  value) or empty/locked. */
function GemPanel({ slots }: { slots: NonNullable<UiPiece["gemSlots"]> }) {
  return (
    <div className="space-y-1">
      {slots.map((s, i) => {
        if (s.gem) {
          const sign = s.gem.value < 0 ? "-" : "+";
          const valueLabel = `${sign}${Math.abs(s.gem.value)}${s.gem.percent ? "%" : ""}`;
          return (
            <div key={i} className="flex items-center gap-2 font-mono text-[12px] tabular-nums" title={`Gem Lv ${s.gem.level} · ${statLong(s.gem.stat)} ${valueLabel}`}>
              <img src={`/img/items/TI_GEM_${s.gem.type}_${s.gem.level}.webp`} alt="" className="h-5 w-5 shrink-0 object-contain" />
              <span className="shrink-0 text-white/75">Lv {s.gem.level}</span>
              <span className="flex-1 text-white">{statLong(s.gem.stat)}</span>
              <span className="shrink-0 text-white">{valueLabel}</span>
            </div>
          );
        }
        return (
          <div key={i} className="flex items-center gap-2 text-[12px] text-white/65" title={s.unlocked ? "Empty gem slot" : "Locked — unlocks at enhance +5"}>
            <div className="grid h-5 w-5 shrink-0 place-items-center rounded-sm border border-dashed border-white/10 bg-white/2">
              {!s.unlocked && (
                <svg viewBox="0 0 14 14" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={1.4}>
                  <rect x="3" y="6" width="8" height="6" rx="1" />
                  <path d="M5 6 V4.5 a2 2 0 0 1 4 0 V6" />
                </svg>
              )}
            </div>
            <span className="flex-1 italic">{s.unlocked ? "Empty" : "Locked"}</span>
          </div>
        );
      })}
    </div>
  );
}

interface ResultGearDetailBodyProps {
  piece: UiPiece;
  game: GameData | null;
  /** Optional equipped-on character — shows a small portrait in the header.
   *  Omit on surfaces where the owner is already obvious (e.g. a build card). */
  equippedChar?: Character | null;
  /** Per-sub reforge ticks the projection ADDED (aligned to `piece.subs`) — used
   *  to split each sub's LV into Base + Actuelle + Extrapolé. */
  addedTicks?: number[];
}

export function ResultGearDetailBody({ piece, equippedChar = null, addedTicks }: ResultGearDetailBodyProps) {
  const rarity = RARITY[piece.rarity];
  // EE (exclusive) shows just its image + gems — no main stats, no effects.
  const isEE = piece.slot === "exclusive";

  return (
    <div className="space-y-3 text-left">
      {/* header — lock + name. Item name on line 1, "- [Singularity]" on line 2
       *  for ascended pieces; the blue→purple gradient runs VERTICALLY. */}
      <div className="flex items-start gap-1.5">
        {piece.locked && <img src="/img/ui/inven/CT_Slot_Lock.webp" alt="Locked" title="Locked in-game" className="mt-0.5 h-4 w-4 shrink-0" />}
        <span
          className="block min-w-0 flex-1 font-display text-[15px] font-semibold leading-tight"
          style={piece.singularity
            ? { background: SINGULARITY_GRADIENT_V, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }
            : { color: rarity?.fg ?? "#f4f4f5" }}
        >
          {piece.name}{piece.singularity && <><br />- [Singularity]</>}
        </span>
        {/* Equipped-on hero — top-right corner of the card, round. */}
        {equippedChar && <CharFace charId={equippedChar.charId} name={equippedChar.name ?? `#${equippedChar.charId}`} size={32} className="rounded-full" />}
      </div>

      {/* icon + main stat(s) to its right (no rarity/slot line). EE shows just
       *  its image — no main. */}
      <div className="flex items-start gap-3">
        <EquipmentIcon piece={piece.iconPiece} size={56} />
        <div className="min-w-0 flex-1 space-y-1.5">
          {!isEE && piece.main.map((m, i) => (
            <div key={i} className="flex items-center gap-2 font-mono text-[13px] tabular-nums">
              <StatIcon stat={m.stat} size={18} className="shrink-0" />
              <span className="flex-1 text-white">{m.name ?? statLong(m.stat)}</span>
              <span className="font-semibold text-white">{m.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* substats (gear) OR gems (talisman / EE) — never both. EE: gems only. */}
      {piece.gemSlots ? (
        <GemPanel slots={piece.gemSlots} />
      ) : !isEE && piece.subs.length > 0 ? (
        <div className="space-y-1">
          {piece.subs.map((s, i) => <SubstatRow key={i} s={s} added={addedTicks?.[i] ?? 0} />)}
        </div>
      ) : null}

      {/* quality — just the rating + label, in the label's color. No bar/header. */}
      {(() => {
        const q = computeQuality(piece);
        if (!q) return null;
        const tone = QUALITY_TONE[q.tier];
        return (
          <div className="font-mono text-[12px] tabular-nums">
            <span className={cx("font-bold", tone.text)}>{q.current}</span>
            <span className="text-white/60">/{q.max}</span>
            <span className={cx("ml-2 font-semibold", tone.text)}>{tone.label}</span>
          </div>
        );
      })()}

      {/* Effects on the card. The weapon/accessory unique-option passive and the
       *  armor set effects now live in the build-level "Effects" card under the
       *  stats panel — NOT here. The card keeps the talisman's multi-tier passive
       *  and (always) the Singularity passive. Hidden entirely for EE. */}
      {!isEE && (
        <>
          {/* multi-tier passive (talisman) — just the active descriptions */}
          {piece.multiTierPassive && (() => {
            const tiers = piece.multiTierPassive!.tiers;
            const upgrade = tiers.find((t, i) => i > 0 && !t.isAdd);
            const visible = tiers.filter((_t, i) => {
              if (!upgrade) return true;
              if (i === 0 && upgrade.active) return false;
              return true;
            });
            return (
              <div className="space-y-1.5">
                {visible.map((t, i) => (
                  <GameText key={i} text={t.desc} className={cx("block text-[11px] leading-snug text-white", !t.active && "opacity-40")} />
                ))}
              </div>
            );
          })()}

          {/* Singularity active effect (ascended) — same format, label removed */}
          {piece.singularity && piece.effects.length > 0 && (
            <div className="space-y-1.5 text-[11px] leading-snug text-white">
              {piece.effects.map((e, i) => {
                if (e.desc) return <GameText key={i} text={e.desc} className="block wrap-break-word" />;
                const sign = e.value.startsWith("-") ? "" : "+";
                const label = e.name ?? statLong(e.stat);
                return (
                  <div key={i} className="flex items-start gap-2 wrap-break-word">
                    <span className="min-w-0 flex-1">{label}</span>
                    <span className="shrink-0 text-white">{sign}{e.value}</span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Full duplicate of the Inventory tab's `ItemDetail` panel (the left-hand
 *  inspect card): the exact `aside` container, scroll wrapper, equipped-char
 *  portrait (via the body), exclude footer, and empty placeholder — forked so
 *  the SOLVE-results cards look pixel-identical to the inventory card while
 *  staying independently editable. */
export function ResultItemDetail({
  piece, equippedChar, game, excluded, onToggleExclude, addedTicks,
}: { piece: UiPiece | null; equippedChar: Character | null; game: GameData | null; excluded?: boolean; onToggleExclude?: (uid: string) => void; addedTicks?: number[] }) {
  if (!piece) {
    return (
      <aside className="flex h-full w-80 shrink-0 flex-col items-center justify-center rounded-xl border border-dashed border-white/6 bg-white/[0.012] px-6 py-8 text-center">
        <div className="grid h-10 w-10 place-items-center rounded-md border border-white/6 bg-black/30 text-white/70">
          <svg viewBox="0 0 14 14" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.4}>
            <rect x="2" y="2" width="10" height="10" rx="1.5" />
            <path d="M5 7 H9 M7 5 V9" strokeLinecap="round" />
          </svg>
        </div>
        <div className="mt-3 text-[12px] font-medium text-white">No item selected</div>
        <div className="mt-1 text-[11px] leading-snug text-white/70">Click a tile in the grid to inspect its main / substats / equipped character.</div>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col overflow-hidden rounded-xl border border-white/8 bg-bg-elev-1">
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <ResultGearDetailBody piece={piece} game={game} equippedChar={equippedChar} addedTicks={addedTicks} />
      </div>
      {onToggleExclude && (
        <div className="shrink-0 border-t border-white/8 px-4 py-2.5">
          <button
            type="button"
            onClick={() => onToggleExclude(piece.id)}
            title="Globally exclude this piece from every solve (e.g. trash rolls). Also via right-click on the tile."
            className={cx(
              "flex w-full items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11.5px] font-medium transition-colors",
              excluded
                ? "border-rose-400/50 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25"
                : "border-white/10 bg-white/3 text-white/80 hover:bg-white/6",
            )}
          >
            {excluded ? "⊘ Excluded from solver — include" : "Exclude from solver"}
          </button>
        </div>
      )}
    </aside>
  );
}
