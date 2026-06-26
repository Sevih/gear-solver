/**
 * Shared gear-piece detail body — the contents of the Inventory tab's
 * left-hand inspect panel, factored out so other surfaces (e.g. the Builds tab
 * hover tooltip via `RichTooltip`) render an identical breakdown without
 * duplicating the logic.
 *
 * Renders, in order: name, icon + rarity/class + equipped char, main rolls,
 * substats (or gems for talisman/EE — never both), quality score, multi-tier
 * passive (talisman/EE), unique-option passive (weapons/accessories), set
 * effect (armor 2/4-pc), and the Singularity active effect on ascended pieces.
 */
import type { Character, GameData } from "@gear-solver/core";
import type { UiPiece } from "./adapter.js";
import { CharFace, EquipmentIcon, StatIcon } from "./EquipmentIcon.js";
import { RARITY, SINGULARITY_GRADIENT_H, SLOTS, STAT } from "./tokens.js";
import { GameText } from "./GameText.js";
import { HoverHint } from "./HoverHint.js";
import { cx } from "./cx.js";
import { QUALITY_COLOR, qualityTierFromScore, type QualityTier } from "../lib/quality.js";

/** Per-tier UI tone (text class + bar color + label). `bar` pulls from the
 *  shared `QUALITY_COLOR` so the Inventory filter and the quality bar agree. */
export const QUALITY_TONE: Record<QualityTier, { text: string; bar: string; label: string }> = {
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
export function computeQuality(piece: UiPiece): { current: number; max: number; pct: number; tier: QualityTier } | null {
  if (piece.slot === "talisman" || piece.slot === "exclusive") return null;
  if (piece.subs.length === 0 || piece.stars <= 0) return null;
  const current = piece.subs.reduce((sum, s) => sum + s.lv, 0);
  const max = 14 + piece.reforge.n;
  const pct = Math.min(100, Math.round((current / max) * 100));
  const tier = qualityTierFromScore(current, max);
  return { current, max, pct, tier };
}

/** A single substat row: "LV {n} (base + reforges)  [icon]  label  value".
 *  Gold-tinted once the sub reaches its star-tier max. */
function SubstatRow({ s, stars }: { s: UiPiece["subs"][number]; stars: number }) {
  const isMax = stars > 0 && s.lv >= stars;
  const sign = s.value.startsWith("-") ? "" : "+";
  return (
    <div className={cx("flex items-center gap-2 font-mono text-[12px] tabular-nums", isMax ? "text-amber-300" : "text-white")}>
      <span className={cx("w-22 shrink-0", isMax ? "text-amber-300" : "text-white")}>
        LV {s.lv}
        {s.reforges > 0 && (
          <span className={cx("ml-1", isMax ? "text-amber-400/80" : "text-white/70")}>
            ({s.lv - s.reforges} + {s.reforges})
          </span>
        )}
      </span>
      <StatIcon stat={s.stat} size={16} className="shrink-0" />
      <span className="flex-1">{statLong(s.stat)}</span>
      <span className={cx("font-semibold", isMax ? "text-amber-200" : "text-white")}>{sign}{s.value}</span>
    </div>
  );
}

type SetLevelEntry = NonNullable<GameData["sets"][string]>["levels"][number];

/** Pick which tier of a set's effect strings to display, driven by the piece's
 *  breakthrough (bt ≥ 4 → set level 2 / 6★ wording, else level 1). */
function pickSetLevel(game: GameData, setId: string, bt: number) {
  const def = game.sets?.[setId];
  if (!def) return null;
  const wrap = (level: SetLevelEntry) => ({ name: def.name ?? null, desc: def.desc ?? null, level });
  const targetLevel = bt >= 4 ? 2 : 1;
  const exact = def.levels.find((l) => l.level === targetLevel);
  if (exact) return wrap(exact);
  const sorted = [...def.levels].sort((a, b) => b.level - a.level);
  return sorted[0] ? wrap(sorted[0]) : null;
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

/** One 2-pc / 4-pc effect row — label column always shown; value column is the
 *  curated in-game prose (em dash when the tier has no effect). */
function SetEffectRow({ tag, desc }: { tag: "2-pc" | "4-pc"; desc: string | null | undefined }) {
  return (
    <div className="flex items-start gap-2 text-[11px]">
      <span className="w-12 shrink-0 font-mono text-white/70">{tag}</span>
      {desc
        ? <span className="flex-1 text-white"><GameText text={desc} /></span>
        : <span className="flex-1 text-white/70">—</span>}
    </div>
  );
}

export interface GearDetailBodyProps {
  piece: UiPiece;
  game: GameData | null;
  /** Optional equipped-on character — shows a small portrait in the header.
   *  Omit on surfaces where the owner is already obvious (e.g. a build card). */
  equippedChar?: Character | null;
}

export function GearDetailBody({ piece, game, equippedChar = null }: GearDetailBodyProps) {
  const slot = piece.slot ? SLOTS.find((s) => s.id === piece.slot) : null;
  const rarity = RARITY[piece.rarity];
  // 2-pc / 4-pc bonuses live only on armor pieces (armorSetId); don't fall back
  // to setId (that's the weapon/accessory unique-option group, not a set).
  const setEntry = game && piece.armorSetId ? pickSetLevel(game, piece.armorSetId, piece.bt) : null;
  const classLine = piece.classLimit ? `${slot?.label ?? "Item"}    ${piece.classLimit} Exclusive` : slot?.label ?? "Item";

  return (
    <div className="space-y-4 text-left">
      {/* header — lock + name (singularity gradient if ascended) */}
      <div className="flex items-center gap-1.5">
        {piece.locked && <img src="/img/ui/inven/CT_Slot_Lock.webp" alt="Locked" title="Locked in-game" className="h-4 w-4 shrink-0" />}
        <span
          className="truncate font-display text-[15px] font-semibold"
          style={piece.singularity
            ? { background: SINGULARITY_GRADIENT_H, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }
            : { color: rarity?.fg ?? "#f4f4f5" }}
        >
          {piece.name}{piece.singularity ? " - [Singularity]" : ""}
        </span>
      </div>

      {/* icon + rarity/class line + equipped char */}
      <div className="flex items-start gap-3">
        <EquipmentIcon piece={piece.iconPiece} size={80} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-col text-[11px] leading-tight">
            <span style={{ color: rarity?.fg ?? "#e4e4e7" }} className="font-semibold">{rarity?.label ?? piece.rarity}</span>
            <span className="text-white">{classLine}</span>
          </div>
        </div>
        {equippedChar && <CharFace charId={equippedChar.charId} name={equippedChar.name ?? `#${equippedChar.charId}`} size={36} />}
      </div>

      {/* main rolls */}
      {piece.main.length > 0 && (
        <div className="space-y-1.5">
          {piece.main.map((m, i) => (
            <div key={i} className="flex items-center gap-2 font-mono text-[13px] tabular-nums">
              <StatIcon stat={m.stat} size={18} className="shrink-0" />
              <span className="flex-1 text-white">{m.name ?? statLong(m.stat)}</span>
              <span className="font-semibold text-white">{m.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* substats (gear) OR gems (talisman / EE) — never both */}
      {piece.gemSlots ? (
        <GemPanel slots={piece.gemSlots} />
      ) : piece.subs.length > 0 ? (
        <div className="space-y-1">
          {piece.subs.map((s, i) => <SubstatRow key={i} s={s} stars={piece.stars} />)}
        </div>
      ) : null}

      {/* quality score */}
      {(() => {
        const q = computeQuality(piece);
        if (!q) return null;
        const tone = QUALITY_TONE[q.tier];
        return (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <HoverHint
                className="font-semibold uppercase tracking-wider text-white"
                name="Quality"
                text="Sum of every substat tick (initial roll + reforge procs) vs the cap for the item's CURRENT investment: base 14 (4+4+3+3) plus 1 per reforge already spent. Singularity adds up to 3 extra reforges. So a pristine 6★ caps at 14; fully reforged 20; ascended + fully reforged 23."
              />
              <span className="font-mono tabular-nums">
                <span className={cx("font-bold", tone.text)}>{q.current}</span>
                <span className="text-white/60"> / {q.max}</span>
                <span className={cx("ml-2", tone.text)}>{tone.label}</span>
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
              <div className="h-full rounded-full transition-[width]" style={{ width: `${q.pct}%`, background: tone.bar }} />
            </div>
          </div>
        );
      })()}

      {/* multi-tier passive (talisman / EE) */}
      {piece.multiTierPassive && (() => {
        const tiers = piece.multiTierPassive.tiers;
        const upgrade = tiers.find((t, i) => i > 0 && !t.isAdd);
        const visible = tiers.filter((_t, i) => {
          if (!upgrade) return true;
          if (i === 0 && upgrade.active) return false;
          return true;
        });
        return (
          <div className="pt-1">
            <div className="mb-2 flex items-center gap-2">
              {piece.effectIcon && <img src={`/img/ui/effect/${piece.effectIcon}.webp`} alt="" className="h-5 w-5 shrink-0" />}
              <span className="font-mono text-[12px] font-semibold text-white">{piece.multiTierPassive!.name ?? "Passive"}</span>
            </div>
            <div className="space-y-2">
              {visible.map((t, i) => {
                const eyebrow = t.unlockLevel <= 1 ? "Base" : `+${t.unlockLevel} · ${t.isAdd ? "additional" : "upgraded"}`;
                return (
                  <div key={i} className={cx("rounded-md border border-white/6 bg-black/25 px-3 py-2 transition-opacity", !t.active && "opacity-40")}>
                    <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-white/70">{eyebrow}</div>
                    <GameText text={t.desc} className="text-[11px] leading-snug text-white" />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* unique-option passive (weapons / accessories) */}
      {piece.passive && (
        <div className="pt-1">
          <div className="mb-2 flex items-center gap-2">
            {piece.effectIcon && <img src={`/img/ui/effect/${piece.effectIcon}.webp`} alt="" className="h-5 w-5 shrink-0" />}
            <span className="font-mono text-[12px] font-semibold text-white">{piece.passive.name ?? "Passive"}</span>
            <span className="ml-auto rounded-sm border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white">T{piece.bt}</span>
          </div>
          <p className="rounded-md border border-white/6 bg-black/25 px-3 py-2 text-[11px] leading-snug text-white">
            <GameText text={piece.passive.text} />
          </p>
        </div>
      )}

      {/* set effect (armor 2/4-pc) */}
      {setEntry && (
        <div className="pt-1">
          <div className="mb-2 flex items-center gap-2">
            {piece.setIcon
              ? <img src={`/img/ui/effect/${piece.setIcon}.webp`} alt="" className="h-5 w-5 shrink-0" />
              : piece.effectIcon
                ? <img src={`/img/ui/effect/${piece.effectIcon}.webp`} alt="" className="h-5 w-5 shrink-0" />
                : null}
            <span className="font-mono text-[12px] font-semibold text-white">{setEntry.name ?? "Set"}</span>
          </div>
          <div className="space-y-1 rounded-md border border-white/6 bg-black/25 px-3 py-2">
            <SetEffectRow tag="2-pc" desc={setEntry.level.p2_desc} />
            <SetEffectRow tag="4-pc" desc={setEntry.level.p4_desc} />
          </div>
        </div>
      )}

      {/* Singularity active effect (ascended pieces) */}
      {piece.singularity && piece.effects.length > 0 && (
        <div className="pt-1">
          <div className="mb-2 text-[11px] font-semibold text-amber-200">Active Effect at +15 Enhancement</div>
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
        </div>
      )}
    </div>
  );
}
