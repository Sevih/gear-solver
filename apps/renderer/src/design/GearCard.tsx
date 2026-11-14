/**
 * The piece card — one body (`GearCardBody`) for the Inventory's inspect
 * panel, the Builds / Presets hover tooltips and the Builder's result cards,
 * one panel (`GearCardPanel`: container, scroll, empty state, actions) for the
 * Inventory and the Builder, and the compact EE + talisman pair
 * (`ResultPairDetail`). Its pure helpers live in `gearCardText.ts`.
 *
 * Renders, in order: name (and the panel's "Never use" at the top right),
 * icon + a column of rarity/slot line and main rolls + wearer, substats (or gems for talisman/EE — never both), quality, multi-tier
 * passive (talisman/EE), unique-option passive (weapons/accessories), set
 * effect (armor 2/4-pc), and the Singularity active effect on ascended pieces.
 *
 * Options: `effects` — "card" puts the weapon/accessory passive and the armor
 * set bonuses on the card (Inventory, tooltips); "none" leaves them to the
 * Builder's `BuildEffectsPanel`, shows the talisman's passive as plain lines
 * and the EE as its image + gems only. `projection` marks the reforge ticks a
 * projection added (cyan) and the Transistone ones (`T+n`). `compact`
 * (Settings › Display › Compact result cards) shortens the card for an
 * eight-card comparison: no equipment icon (enhance / breakthrough / stars
 * move to the header), set names instead of item names, icon + value stats
 * (subs on a 2 × 2 grid, details in the `title`), gems as five icons, one-line
 * effects and quality, an icon exclude action at the top right instead of the
 * button, a narrower card, the talisman's multi-tier passive in the name's `title`, and
 * the EE + talisman sharing one card (`ResultPairDetail`).
 */
import type { ReactNode } from "react";
import type { Character, GameData, SetCombatEffect } from "@gear-solver/core";
import type { UiPiece } from "./adapter.js";
import { CharFace, EquipmentIcon, StatIcon } from "./EquipmentIcon.js";
import { RARITY, SINGULARITY_GRADIENT_H, SINGULARITY_GRADIENT_V, SLOTS } from "./tokens.js";
import { GameText } from "./GameText.js";
import { HoverHint } from "./HoverHint.js";
import { RichTooltip } from "./RichTooltip.js";
import { SetCombatBadge } from "./SetCombatBadge.js";
import { cx } from "./cx.js";
import { QUALITY_REACHABLE_HELP, qualityShortLabel } from "../lib/quality.js";
import {
  QUALITY_HELP, QUALITY_TONE, compactEffect, compactName, compactPassiveTitle, compactSubTitle, compactSubTone,
  pickSetLevel, statLong, visiblePassiveTiers,
} from "./gearCardText.js";

/** Per-sub ticks a reforge projection added, and those the Transistone
 *  potential added (both aligned to `piece.subs`). */
export interface GearCardProjection {
  addedTicks: number[];
  transistoneTicks: number[];
}

/** A single substat row: "LV {n} (base + reforges)  [icon]  label  value".
 *  Gold-tinted once the sub hits its cap of 6 total ticks (base + reforges) —
 *  fixed at 6 regardless of the item's star tier. A 6★ socle is 4/4/3/3, so a
 *  sub only reaches 6 after reforges, never at socle. Under a projection the
 *  reforges split into the captured ones + the projected ones (cyan), and the
 *  Transistone ticks get their own `T+n` mark. */
function SubstatRow({ s, added = 0, transistone = 0 }: { s: UiPiece["subs"][number]; added?: number; transistone?: number }) {
  const isMax = s.lv >= 6;
  const sign = s.value.startsWith("-") ? "" : "+";
  // Split the tick count into Base (initial roll) + Actuelle (reforges actually
  // done on the captured piece) + Extrapolé (reforges the projection added).
  const base = s.lv - s.reforges;
  const extrapole = Math.max(0, added);
  const actuelle = s.reforges - extrapole;
  // Ticks the Transistone potential added to the line's base (its own marker,
  // apart from the reforge split: the base above already includes them).
  const transistoneMark = transistone > 0 && (
    <span className="shrink-0 text-[10px] text-violet-300" title={`Transistone: base tier ${base - transistone} → ${base}`}>T+{transistone}</span>
  );
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
      {transistoneMark}
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

/** One 2-pc / 4-pc effect row — label column always shown; value column is the
 *  curated in-game prose (em dash when the tier has no effect), then the
 *  "combat" pill when the tier carries combat effects (display only). */
function SetEffectRow({ tag, desc, combat, inTooltip = false }: {
  tag: "2-pc" | "4-pc";
  desc: string | null | undefined;
  combat?: SetCombatEffect[] | null;
  /** The row sits in a hover popover: the pill writes its body inline. */
  inTooltip?: boolean;
}) {
  return (
    <div className="flex items-start gap-2 text-[11px]">
      <span className="w-12 shrink-0 font-mono text-white/70">{tag}</span>
      {desc
        ? <span className="flex-1 text-white"><GameText text={desc} /><SetCombatBadge effects={combat} expanded={inTooltip} /></span>
        : combat?.length
          ? <span className="flex-1 text-white"><SetCombatBadge effects={combat} expanded={inTooltip} /></span>
          : <span className="flex-1 text-white/70">—</span>}
    </div>
  );
}

const SUB_TONE_CLASS = { cyan: "text-cyan-300", violet: "text-violet-300", amber: "text-amber-200", white: "text-white" } as const;

/** Compact substat cell: icon + value only; LV, the reforge split and the
 *  Transistone mark move to the `title`, the value's tone keeps the cue. */
function CompactSubCell({ s, added = 0, transistone = 0 }: { s: UiPiece["subs"][number]; added?: number; transistone?: number }) {
  const sign = s.value.startsWith("-") ? "" : "+";
  return (
    <div className="flex items-center gap-1.5 font-mono text-[12px] tabular-nums" title={compactSubTitle(s, added, transistone)}>
      <StatIcon stat={s.stat} size={16} className="shrink-0" title={null} />
      <span className={cx("font-semibold", SUB_TONE_CLASS[compactSubTone(s.lv, added, transistone)])}>{sign}{s.value}</span>
    </div>
  );
}

/** Compact gem row: the five sockets as 20 px icons, details in each `title`. */
function CompactGemRow({ slots }: { slots: NonNullable<UiPiece["gemSlots"]> }) {
  return (
    <div className="flex items-center gap-1.5">
      {slots.map((s, i) => {
        if (s.gem) {
          const sign = s.gem.value < 0 ? "-" : "+";
          const valueLabel = `${sign}${Math.abs(s.gem.value)}${s.gem.percent ? "%" : ""}`;
          return (
            <img
              key={i}
              src={`/img/items/TI_GEM_${s.gem.type}_${s.gem.level}.webp`}
              alt=""
              title={`Lv ${s.gem.level} · ${statLong(s.gem.stat)} ${valueLabel}`}
              className="h-5 w-5 shrink-0 object-contain"
            />
          );
        }
        return (
          <div
            key={i}
            title={s.unlocked ? "Empty gem slot" : "Locked — unlocks at enhance +5"}
            className="grid h-5 w-5 shrink-0 place-items-center rounded-sm border border-dashed border-white/10 bg-white/2 text-white/65"
          >
            {!s.unlocked && (
              <svg viewBox="0 0 14 14" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={1.4}>
                <rect x="3" y="6" width="8" height="6" rx="1" />
                <path d="M5 6 V4.5 a2 2 0 0 1 4 0 V6" />
              </svg>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** "from preset ‹name›" under the header — the in-game presets holding the
 *  piece, other than the one being optimized. */
function FromPresetsLine({ fromPresets, compact }: { fromPresets: string[]; compact: boolean }) {
  return (
    <div
      className={cx("truncate text-amber-200/85", compact ? "-mt-1 text-[10px]" : "-mt-2 text-[11px]")}
      title={`Held by the in-game preset${fromPresets.length === 1 ? "" : "s"} ${fromPresets.join(", ")} — taking it changes ${fromPresets.length === 1 ? "that preset" : "those presets"}`}
    >
      from preset {fromPresets.join(", ")}
    </div>
  );
}

export interface GearCardBodyProps {
  piece: UiPiece;
  game: GameData | null;
  /** Optional equipped-on character — a small portrait on the card. Omit on
   *  surfaces where the owner is already obvious (e.g. a build card). */
  equippedChar?: Character | null;
  /** Open the Builder on the wearer — the portrait becomes an "Optimize
   *  ‹hero› →" button (never inside a tooltip, which can't be clicked). */
  onOptimizeWearer?: (heroUid: string) => void;
  /** In-game presets holding the piece, other than the one being optimized
   *  (names, best-ranked first) — "from preset ‹name›" under the header, as
   *  the portrait says which hero the piece comes from. */
  fromPresets?: string[];
  /** Reforge / Transistone ticks a projection added — cyan ticks and `T+n`. */
  projection?: GearCardProjection;
  /** "card": passive and set bonuses on the card; "none": left to the
   *  Builder's `BuildEffectsPanel` (see the file header). */
  effects: "card" | "none";
  /** Compact card (Settings › Display › Compact result cards). */
  compact?: boolean;
  /** Rendered inside a hover popover (`RichTooltip`, `HoverCard`), which can't
   *  host a hoverable nested tooltip — the set rows' "combat" pill expands
   *  inline instead (`SetCombatBadge` `expanded`). */
  inTooltip?: boolean;
  /** A control at the card's top right, in the header row (the panel's
   *  "Never use" — `GearCardPanel`, `PairCell`). */
  headerAction?: ReactNode;
}

export function GearCardBody(props: GearCardBodyProps) {
  return props.compact ? <CompactBody {...props} /> : <FullBody {...props} />;
}

function FullBody({ piece, game, equippedChar = null, onOptimizeWearer, fromPresets, projection, effects, inTooltip = false, headerAction }: GearCardBodyProps) {
  const slot = piece.slot ? SLOTS.find((s) => s.id === piece.slot) : null;
  const rarity = RARITY[piece.rarity];
  const onCard = effects === "card";
  // Without the card's effects (Builder), the EE shows just its image + gems.
  const bareEE = !onCard && piece.slot === "exclusive";
  // 2-pc / 4-pc bonuses live only on armor pieces (armorSetId); don't fall back
  // to setId (that's the weapon/accessory unique-option group, not a set).
  const setEntry = onCard && game && piece.armorSetId ? pickSetLevel(game, piece.armorSetId, piece.bt) : null;

  return (
    <div className="space-y-4 text-left">
      {/* header — lock + name (singularity gradient if ascended) */}
      <div className="flex items-center gap-1.5">
        {piece.locked && <img src="/img/ui/inven/CT_Slot_Lock.webp" alt="Locked" title="Locked in-game" className="h-4 w-4 shrink-0" />}
        <span
          className="line-clamp-2 min-w-0 font-display text-[15px] font-semibold wrap-break-word"
          style={piece.singularity
            ? { background: SINGULARITY_GRADIENT_H, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }
            : { color: rarity?.fg ?? "#f4f4f5" }}
        >
          {piece.name}{piece.singularity ? " - [Singularity]" : ""}
        </span>
        {headerAction && <div className="ml-auto shrink-0 self-start">{headerAction}</div>}
      </div>
      {fromPresets && fromPresets.length > 0 && <FromPresetsLine fromPresets={fromPresets} compact={false} />}

      {/* icon + column (rarity/class line, main rolls) + equipped char */}
      <div className="flex items-start gap-3">
        <EquipmentIcon piece={piece.iconPiece} size={80} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-col text-[11px] leading-tight">
            <span style={{ color: rarity?.fg ?? "#e4e4e7" }} className="font-semibold">{rarity?.label ?? piece.rarity}</span>
            {/* slot and class on two spans: they wrap under each other
             *  rather than run into the wearer's portrait */}
            <span className="flex flex-wrap gap-x-2 text-white">
              <span>{slot?.label ?? "Item"}</span>
              {piece.classLimit && <span>{piece.classLimit} Exclusive</span>}
            </span>
          </div>
          {/* main rolls — beside the icon, at 12 px so a weapon's two mains
           *  fit its height; a long name is cut, in full in its title */}
          {!bareEE && piece.main.length > 0 && (
            <div className="mt-1.5 space-y-1">
              {piece.main.map((m, i) => {
                const label = m.name ?? statLong(m.stat);
                return (
                  <div key={i} className="flex items-center gap-1.5 font-mono text-[12px] tabular-nums">
                    <StatIcon stat={m.stat} size={16} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-white" title={label}>{label}</span>
                    <span className="shrink-0 font-semibold text-white">{m.value}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {equippedChar && (onOptimizeWearer && !inTooltip ? (
          <button
            type="button"
            onClick={() => onOptimizeWearer(equippedChar.uid)}
            aria-label={`Optimize ${equippedChar.name ?? `#${equippedChar.charId}`} →`}
            title={`Optimize ${equippedChar.name ?? `#${equippedChar.charId}`} → — open the Optimizer on the hero wearing this piece`}
            className="shrink-0 rounded-md ring-cyan-400/60 transition-shadow hover:ring-2"
          >
            <CharFace charId={equippedChar.charId} name={equippedChar.name ?? `#${equippedChar.charId}`} size={36} />
          </button>
        ) : (
          <CharFace charId={equippedChar.charId} name={equippedChar.name ?? `#${equippedChar.charId}`} size={36} />
        ))}
      </div>

      {/* substats (gear) OR gems (talisman / EE) — never both */}
      {piece.gemSlots ? (
        <GemPanel slots={piece.gemSlots} />
      ) : !bareEE && piece.subs.length > 0 ? (
        <div className="space-y-1">
          {piece.subs.map((s, i) => <SubstatRow key={i} s={s} added={projection?.addedTicks[i] ?? 0} transistone={projection?.transistoneTicks[i] ?? 0} />)}
        </div>
      ) : null}

      {/* quality score */}
      {(() => {
        const q = piece.quality;
        if (!q) return null;
        const tone = QUALITY_TONE[q.tier];
        return (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <HoverHint className="font-semibold uppercase tracking-wider text-white" name="Quality" text={QUALITY_HELP} />
              <span className="font-mono tabular-nums">
                <span className={cx("font-bold", tone.text)}>{q.current}</span>
                <span className="text-white/60"> / {q.max}</span>
                {q.reachable != null && <span className="text-violet-300" title={QUALITY_REACHABLE_HELP}> → {q.reachable} reachable</span>}
                <span className={cx("ml-2", tone.text)}>{tone.label}</span>
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
              <div className="h-full rounded-full transition-[width]" style={{ width: `${q.pct}%`, background: tone.bar }} />
            </div>
          </div>
        );
      })()}

      {/* multi-tier passive (talisman / EE) — titled tier boxes on the card,
       *  the plain active descriptions without the card's effects */}
      {!bareEE && piece.multiTierPassive && (onCard ? (
        <div className="pt-1">
          <div className="mb-2 flex items-center gap-2">
            {piece.effectIcon && <img src={`/img/ui/effect/${piece.effectIcon}.webp`} alt="" className="h-5 w-5 shrink-0" />}
            <span className="font-mono text-[12px] font-semibold text-white">{piece.multiTierPassive.name ?? "Passive"}</span>
          </div>
          <div className="space-y-2">
            {visiblePassiveTiers(piece.multiTierPassive.tiers).map((t, i) => {
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
      ) : (
        <div className="space-y-1.5">
          {visiblePassiveTiers(piece.multiTierPassive.tiers).map((t, i) => (
            <GameText key={i} text={t.desc} className={cx("block text-[11px] leading-snug text-white", !t.active && "opacity-40")} />
          ))}
        </div>
      ))}

      {/* unique-option passive (weapons / accessories) */}
      {onCard && piece.passive && (
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
            <SetEffectRow tag="2-pc" desc={setEntry.level.p2_desc} combat={setEntry.level.combatEffects?.p2} inTooltip={inTooltip} />
            <SetEffectRow tag="4-pc" desc={setEntry.level.p4_desc} combat={setEntry.level.combatEffects?.p4} inTooltip={inTooltip} />
          </div>
        </div>
      )}

      {/* Singularity active effect (ascended pieces) */}
      {!bareEE && piece.singularity && piece.effects.length > 0 && (
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

/** The compact card (Builder only): see the file header. The EE shows just
 *  its gems, the card's effects stay in `BuildEffectsPanel`. */
function CompactBody({ piece, game, equippedChar = null, fromPresets, projection, headerAction }: GearCardBodyProps) {
  const rarity = RARITY[piece.rarity];
  const isEE = piece.slot === "exclusive";
  const fullName = `${piece.name}${piece.singularity ? " - [Singularity]" : ""}`;
  // The talisman's multi-tier passive is not rendered — its text joins the
  // name's title (hover), as the EE's effects stay hidden.
  const passiveTitle = !isEE && piece.multiTierPassive ? compactPassiveTitle(piece.multiTierPassive.tiers) : "";

  return (
    <div className="space-y-2 text-left">
      {/* header — lock + set / item name (vertical gradient when ascended) */}
      <div className="flex items-start gap-1.5">
        {piece.locked && <img src="/img/ui/inven/CT_Slot_Lock.webp" alt="Locked" title="Locked in-game" className="mt-0.5 h-4 w-4 shrink-0" />}
        <span
          className="block min-w-0 flex-1 font-display text-[15px] font-semibold leading-tight wrap-break-word"
          style={piece.singularity
            ? { background: SINGULARITY_GRADIENT_V, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }
            : { color: rarity?.fg ?? "#f4f4f5" }}
          title={passiveTitle ? `${fullName}\n${passiveTitle}` : fullName}
        >
          {compactName(piece, game)}
        </span>
        {/* What the dropped equipment icon carried, on two right-aligned
         *  lines: the star count and the breakthrough (when any), then the
         *  enhance level (always). */}
        <span className="mt-0.5 flex shrink-0 flex-col items-end font-mono text-[11px] leading-4 tabular-nums text-white/75">
          <span className="flex items-center gap-1">
            <span title="Stars">{piece.stars}★</span>
            {piece.bt > 0 && (
              <>
                <span className="text-white/30">|</span>
                <span title="Breakthrough">T{piece.bt}</span>
              </>
            )}
          </span>
          <span title="Enhance level">+{piece.enhance}</span>
        </span>
        {/* Equipped-on hero — top-right corner of the card, round. */}
        {equippedChar && <CharFace charId={equippedChar.charId} name={equippedChar.name ?? `#${equippedChar.charId}`} size={32} className="rounded-full" />}
        {/* The panel's exclude action, at the very top right. */}
        {headerAction && <div className="shrink-0">{headerAction}</div>}
      </div>
      {fromPresets && fromPresets.length > 0 && <FromPresetsLine fromPresets={fromPresets} compact />}

      {/* the main(s) on one full-width line; none for the EE */}
      {!isEE && piece.main.length > 0 && (
        <div className="flex items-center gap-3">
          {piece.main.map((m, i) => (
            <div key={i} className="flex min-w-0 flex-1 items-center gap-2 font-mono text-[13px] tabular-nums" title={m.name ?? statLong(m.stat)}>
              <StatIcon stat={m.stat} size={18} className="shrink-0" />
              <span className="ml-auto font-semibold text-white">{m.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* gems as one icon row, or subs on a 2 × 2 grid (row by row) */}
      {piece.gemSlots ? (
        <CompactGemRow slots={piece.gemSlots} />
      ) : !isEE && piece.subs.length > 0 ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {piece.subs.map((s, i) => <CompactSubCell key={i} s={s} added={projection?.addedTicks[i] ?? 0} transistone={projection?.transistoneTicks[i] ?? 0} />)}
        </div>
      ) : null}

      {/* quality: "14/20 →17 Exc." — the full label and both help texts in the title */}
      {(() => {
        const q = piece.quality;
        if (!q) return null;
        const tone = QUALITY_TONE[q.tier];
        const title = `${tone.label} — ${QUALITY_HELP}${q.reachable != null ? `\n\n${QUALITY_REACHABLE_HELP}` : ""}`;
        return (
          <div className="font-mono text-[12px] tabular-nums" title={title}>
            <span className={cx("font-bold", tone.text)}>{q.current}/{q.max}</span>
            {q.reachable != null && <span className="ml-1.5 text-violet-300">→{q.reachable}</span>}
            <span className={cx("ml-1.5 font-semibold", tone.text)}>{qualityShortLabel(q.tier)}</span>
          </div>
        );
      })()}

      {/* Singularity active effect: every effect on one line (icon + signed
       *  value, the +15 bonus as grade + icon + short label + value, or a short
       *  name), the full wording in each title. Hidden for the EE. */}
      {!isEE && piece.singularity && piece.effects.length > 0 && (
        <div className="flex items-center gap-2 overflow-hidden whitespace-nowrap font-mono text-[11px] leading-snug tabular-nums text-white">
          {piece.effects.map((e, i) => {
            const c = compactEffect(e);
            if (c.kind === "short") return (
              <span key={i} className="flex min-w-0 items-center gap-1" title={c.title}>
                {c.grade && <span className="shrink-0 font-sans font-bold" style={c.grade.color ? { color: c.grade.color } : undefined}>{c.grade.grade}</span>}
                <StatIcon stat={c.stat} size={14} className="shrink-0" title={null} />
                <span className="min-w-0 truncate font-sans">{c.label}</span>
                <span className="shrink-0">{c.value}</span>
              </span>
            );
            return c.kind === "stat" ? (
              <span key={i} className="flex shrink-0 items-center gap-1" title={c.title}>
                <StatIcon stat={c.stat} size={14} className="shrink-0" title={null} />
                {c.value}
              </span>
            ) : (
              <span key={i} className="min-w-0 truncate font-sans" title={c.title}>{c.text}</span>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** One quick icon action of a compact card (its top-right exclude). */
export interface CardAction {
  key: string;
  icon: ReactNode;
  /** Hover text (and accessible name) of the icon button. */
  label: string;
  /** Toggled-on state — rose tint (e.g. the piece is excluded). */
  active?: boolean;
  onClick: () => void;
}

/** A right-aligned row of 24 px icon buttons (the compact card's actions). */
export function CardActions({ actions }: { actions: CardAction[] }) {
  return (
    <div className="flex items-center justify-end gap-1.5">
      {actions.map((a) => (
        <RichTooltip key={a.key} content={a.label}>
          <button
            type="button"
            onClick={a.onClick}
            aria-label={a.label}
            aria-pressed={a.active ?? false}
            className={cx(
              "grid h-6 w-6 place-items-center rounded-md border transition-colors",
              a.active
                ? "border-rose-400/50 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25"
                : "border-white/10 bg-white/3 text-white/70 hover:bg-white/6",
            )}
          >
            {a.icon}
          </button>
        </RichTooltip>
      ))}
    </div>
  );
}

/** ⊘ — the exclude-from-solver action icon. */
const EXCLUDE_ICON = (
  <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.4}>
    <circle cx="7" cy="7" r="5" />
    <path d="M3.5 10.5 L10.5 3.5" strokeLinecap="round" />
  </svg>
);

/** The piece panel of the Inventory (left-hand inspect card) and of each
 *  Builder result slot: container, scroll wrapper, body with "Never use" at
 *  its top right (in the name's row), the "Optimize wearer →" footer with
 *  `onOptimizeWearer`, and the empty placeholder — whose texts, like the
 *  exclude help, are the caller's. */
export function GearCardPanel({
  piece, equippedChar, game, fromPresets, excluded, onToggleExclude, onOptimizeWearer, projection, effects, compact = false, fluid = false,
  emptyLabel = "No piece in this build", emptyHint,
  excludeHint = "Never use this piece in any solve (e.g. trash rolls) — the same as a right-click on its tile in Gear.",
}: {
  piece: UiPiece | null;
  equippedChar: Character | null;
  game: GameData | null;
  fromPresets?: string[];
  excluded?: boolean;
  onToggleExclude?: (uid: string) => void;
  /** Open the Builder on the piece's wearer — the portrait in the card and
   *  the "Optimize wearer →" footer (greyed out on a free piece). */
  onOptimizeWearer?: (heroUid: string) => void;
  projection?: GearCardProjection;
  effects: "card" | "none";
  compact?: boolean;
  /** Take the width of its grid column (the Optimizer's band) instead of
   *  the fixed `w-56` / `w-80` of Gear › Pieces and the tooltips. */
  fluid?: boolean;
  /** The empty state's label and hint. */
  emptyLabel?: string;
  emptyHint?: string;
  /** Hover text of the full-size "Never use" button. */
  excludeHint?: string;
}) {
  const width = fluid ? "w-full" : compact ? "w-56" : "w-80";
  if (!piece) {
    return (
      <aside className={cx("flex shrink-0 flex-col items-center justify-center rounded-xl border border-dashed border-white/6 bg-white/[0.012] px-6 py-8 text-center", !compact && "h-full", width)}>
        <div className="grid h-10 w-10 place-items-center rounded-md border border-white/6 bg-black/30 text-white/70">
          <svg viewBox="0 0 14 14" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.4}>
            <rect x="2" y="2" width="10" height="10" rx="1.5" />
            <path d="M5 7 H9 M7 5 V9" strokeLinecap="round" />
          </svg>
        </div>
        <div className="mt-3 text-[12px] font-medium text-white">{emptyLabel}</div>
        {emptyHint && <div className="mt-1 text-[11px] leading-snug text-white/70">{emptyHint}</div>}
      </aside>
    );
  }

  // "Never use" at the card's top right: the icon action on the compact
  // card, a small labelled button on the full one.
  const toggle = onToggleExclude ? () => onToggleExclude(piece.id) : null;
  const excludeAction = !toggle ? undefined : compact ? (
    <CompactExcludeAction excluded={excluded} onClick={toggle} />
  ) : (
    <button
      type="button"
      onClick={toggle}
      title={excludeHint}
      aria-pressed={excluded ?? false}
      className={cx(
        "flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
        excluded
          ? "border-rose-400/50 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25"
          : "border-white/10 bg-white/3 text-white/80 hover:bg-white/6",
      )}
    >
      {EXCLUDE_ICON}
      {excluded ? "Never used — click to allow" : "Never use"}
    </button>
  );

  return (
    <CardShell width={width} fill={!compact}>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <GearCardBody piece={piece} game={game} equippedChar={equippedChar} onOptimizeWearer={onOptimizeWearer} fromPresets={fromPresets} projection={projection} effects={effects} compact={compact} headerAction={excludeAction} />
      </div>
      {!compact && onOptimizeWearer && (
        <div className="flex shrink-0 gap-2 border-t border-white/8 px-4 py-2.5">
          <button
            type="button"
            onClick={() => equippedChar && onOptimizeWearer(equippedChar.uid)}
            disabled={!equippedChar}
            aria-label={equippedChar ? `Optimize wearer → (${equippedChar.name ?? `#${equippedChar.charId}`})` : "Optimize wearer →"}
            title={equippedChar
              ? `Open the Optimizer on ${equippedChar.name ?? `#${equippedChar.charId}`}, who wears this piece.`
              : "Nobody wears this piece."}
            className={cx(
              "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11.5px] font-medium transition-colors",
              equippedChar
                ? "border-cyan-400/40 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25"
                : "cursor-not-allowed border-white/6 bg-white/2 text-white/45",
            )}
          >
            Optimize wearer →
          </button>
        </div>
      )}
    </CardShell>
  );
}

/** The card's container (border, background, rounded, column) — shared by the
 *  single card and the compact EE + talisman pair. `fill` stretches it to its
 *  grid row (non-compact); compact cards keep their content height. */
function CardShell({ width, fill, children }: { width: string; fill: boolean; children: ReactNode }) {
  return (
    <aside className={cx("flex shrink-0 flex-col overflow-hidden rounded-xl border border-white/8 bg-bg-elev-1", fill && "h-full", width)}>
      {children}
    </aside>
  );
}

/** The compact card's "never use" icon action, at its top right. `what`
 *  names the piece in the label when two pieces share the card ("Never use
 *  EE"). */
function CompactExcludeAction({ excluded = false, onClick, what }: { excluded?: boolean; onClick: () => void; what?: string }) {
  const label = what
    ? (excluded ? `${what} never used — click to allow` : `Never use ${what}`)
    : (excluded ? "Never used — click to allow" : "Never use");
  return <CardActions actions={[{ key: "exclude", icon: EXCLUDE_ICON, label, active: excluded, onClick }]} />;
}

/** One half of a compact pair card: a piece (or the empty label) and the data
 *  its single card would get. */
export interface ResultPairCell {
  piece: UiPiece | null;
  equippedChar: Character | null;
  fromPresets?: string[];
  excluded?: boolean;
  onToggleExclude?: (uid: string) => void;
  addedTicks?: number[];
  transistoneTicks?: number[];
  /** Shown in place of the body when the build has no piece there. */
  emptyLabel: string;
}

/** Compact EE + talisman card: two pieces stacked in ONE `w-56` container (the
 *  EE has no main and no effects, the compact talisman is short), split by a
 *  rule, each with its own exclude action at the top right of its half. `fluid`: the width of its grid
 *  column, as `GearCardPanel`'s. */
export function ResultPairDetail({ top, bottom, game, fluid = false }: { top: ResultPairCell; bottom: ResultPairCell; game: GameData | null; compact: true; fluid?: boolean }) {
  return (
    <CardShell width={fluid ? "w-full" : "w-56"} fill={false}>
      <PairCell cell={top} game={game} />
      <div className="border-t border-white/8" />
      <PairCell cell={bottom} game={game} grow />
    </CardShell>
  );
}

function PairCell({ cell, game, grow = false }: { cell: ResultPairCell; game: GameData | null; grow?: boolean }) {
  const { piece, onToggleExclude } = cell;
  if (!piece) {
    return <div className={cx("px-4 py-4 text-[12px] italic text-white/65", grow && "flex-1")}>{cell.emptyLabel}</div>;
  }
  const projection = { addedTicks: cell.addedTicks ?? [], transistoneTicks: cell.transistoneTicks ?? [] };
  const excludeAction = onToggleExclude
    ? <CompactExcludeAction excluded={cell.excluded} onClick={() => onToggleExclude(piece.id)} what={piece.slot === "exclusive" ? "EE" : (piece.slot ?? "piece")} />
    : undefined;
  return (
    <div className={cx("px-4 py-4", grow && "flex-1")}>
      <GearCardBody piece={piece} game={game} equippedChar={cell.equippedChar} fromPresets={cell.fromPresets} projection={projection} effects="none" compact headerAction={excludeAction} />
    </div>
  );
}
