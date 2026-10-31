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
 *
 * `compact` (Settings › Solver › Compact result cards) shortens the card for
 * an eight-card comparison: no equipment icon (enhance / breakthrough / stars
 * move to the header), set names instead of item names, icon + value stats
 * (subs on a 2 × 2 grid, details in the `title`), gems as five icons, one-line
 * effects and quality, an icon action row instead of the exclude button, a
 * narrower card.
 */
import type { ReactNode } from "react";
import type { Character, GameData } from "@gear-solver/core";
import type { UiEffect, UiPiece } from "./adapter.js";
import { CharFace, EquipmentIcon, StatIcon } from "./EquipmentIcon.js";
import { RARITY, SINGULARITY_GRADIENT_V, STAT } from "./tokens.js";
import { GameText } from "./GameText.js";
import { RichTooltip } from "./RichTooltip.js";
import { cx } from "./cx.js";
import { QUALITY_COLOR, QUALITY_REACHABLE_HELP, qualityShortLabel, type QualityTier } from "../lib/quality.js";

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

/** Header name on a compact card: "EE" for the exclusive, the set name for an
 *  armor piece (its own name when the set is unknown), the item name
 *  otherwise. Never carries the "- [Singularity]" suffix — the gradient alone
 *  marks an ascended piece. */
export function compactName(piece: Pick<UiPiece, "name" | "slot" | "armorSetId">, game: GameData | null): string {
  if (piece.slot === "exclusive") return "EE";
  if (piece.slot === "helmet" || piece.slot === "armor" || piece.slot === "gloves" || piece.slot === "boots") {
    const setName = piece.armorSetId ? game?.sets?.[piece.armorSetId]?.name : null;
    return setName ?? piece.name;
  }
  return piece.name;
}

/** In-game text on one line (line breaks → spaces), for a truncated row. */
function oneLine(text: string): string {
  return text.replace(/\\n|\r\n|\n/g, " ");
}

/** The same text without its color tags — the row's `title`. */
function plainLine(text: string): string {
  return oneLine(text).replace(/<\/?color[^>]*>/g, "");
}

/** Short label of a Singularity option (the +15 bonus), from its name — the
 *  only place the condition lives: "DS DMG+", "vs Fire DMG-", "DMG+"… Null
 *  for any name outside the known patterns. */
const SINGULARITY_LABELS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^DMG Increase to target$/i, () => "DMG+"],
  [/^Reduced DMG Taken from targets$/i, () => "DMG-"],
  [/^DMG Increase vs (Fire|Water|Earth|Light|Dark)$/i, (m) => `vs ${m[1]} DMG+`],
  [/^Reduced DMG Taken vs (Fire|Water|Earth|Light|Dark)$/i, (m) => `vs ${m[1]} DMG-`],
  [/^Increased DMG within Dimensional Singularity$/i, () => "DS DMG+"],
  [/^Reduced DMG taken within Dimensional Singularity$/i, () => "DS DMG-"],
  [/^Ultimate Skill DMG increases within Dimensional Singularity$/i, () => "DS Ult DMG+"],
];

export function singularityShortLabel(name: string | null): string | null {
  const n = name?.trim();
  if (!n) return null;
  for (const [re, label] of SINGULARITY_LABELS) {
    const m = n.match(re);
    if (m) return label(m);
  }
  return null;
}

/** Grade letter a Singularity option's `desc` opens with (`C` … `S+`) and the
 *  color of its `<color=#…>` tag; null when the desc doesn't start that way. */
export function singularityGrade(desc: string | null): { grade: string; color: string | null } | null {
  const m = desc?.trimStart().match(/^<color=(#[0-9a-f]{3,8})>\s*(S\+|S|A|B|C)\s*<\/color>/i);
  return m ? { grade: m[2]!, color: m[1]! } : null;
}

/** A Singularity effect on a compact card: a stat + value effect becomes its
 *  icon + signed value, a known +15 bonus its grade + icon + short label +
 *  signed value, any other description-only one its name (or the first 24
 *  characters of the untagged text). `title` keeps the full wording. */
export type CompactEffect =
  | { kind: "stat"; stat: string; value: string; title: string }
  | { kind: "short"; grade: { grade: string; color: string | null } | null; label: string; stat: string; value: string; title: string }
  | { kind: "text"; text: string; title: string };

export function compactEffect(e: Pick<UiEffect, "stat" | "value" | "name" | "desc">): CompactEffect {
  const label = singularityShortLabel(e.name);
  if (label) {
    const value = `${e.value.startsWith("-") ? "" : "+"}${e.value}`;
    const title = e.desc ? plainLine(e.desc).trim() : `${label} ${value}`;
    return { kind: "short", grade: singularityGrade(e.desc), label, stat: e.stat, value, title };
  }
  if (e.desc) {
    const plain = plainLine(e.desc).trim();
    const text = e.name ?? (plain.length > 24 ? `${plain.slice(0, 24).trimEnd()}…` : plain);
    return { kind: "text", text, title: plain };
  }
  const value = `${e.value.startsWith("-") ? "" : "+"}${e.value}`;
  return { kind: "stat", stat: e.stat, value, title: `${e.name ?? statLong(e.stat)} ${value}` };
}

/** Value tone of a compact substat cell: cyan when projected reforge ticks
 *  enter the line, violet when Transistone ticks do (cyan wins if both),
 *  amber at the 6-tick cap, white otherwise. */
export function compactSubTone(lv: number, added: number, transistone: number): "cyan" | "violet" | "amber" | "white" {
  if (added > 0) return "cyan";
  if (transistone > 0) return "violet";
  return lv >= 6 ? "amber" : "white";
}

/** `title` of a compact substat cell — everything the cell no longer shows:
 *  "LV 5 (4 + 1) · Attack% · T+1" (base + reforges [+ projected], Transistone). */
export function compactSubTitle(s: Pick<UiPiece["subs"][number], "lv" | "reforges" | "stat">, added = 0, transistone = 0): string {
  const base = s.lv - s.reforges;
  const extrapole = Math.max(0, added);
  const actuelle = s.reforges - extrapole;
  const split = s.reforges > 0 ? ` (${base} + ${actuelle}${extrapole > 0 ? ` + ${extrapole}` : ""})` : "";
  return `LV ${s.lv}${split} · ${statLong(s.stat)}${transistone > 0 ? ` · T+${transistone}` : ""}`;
}

const QUALITY_HELP = "Sum of every substat tick (initial roll + reforge procs) vs the cap for the item's CURRENT investment: base 14 (4+4+3+3) plus 1 per reforge already spent. Singularity adds up to 3 extra reforges. So a pristine 6★ caps at 14; fully reforged 20; ascended + fully reforged 23.";

/** A single substat row: "LV {n} (base + reforges)  [icon]  label  value".
 *  Gold-tinted once the sub hits its cap of 6 total ticks (base + reforges) —
 *  fixed at 6 regardless of the item's star tier. A 6★ socle is 4/4/3/3, so a
 *  sub only reaches 6 after reforges, never at socle. */
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
    <span className="shrink-0 text-[10px] text-violet-300" title={`Transistone: base LV ${base - transistone} → ${base}`}>T+{transistone}</span>
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

/** One quick action of a compact card's footer. */
export interface CardAction {
  key: string;
  icon: ReactNode;
  /** Hover text (and accessible name) of the icon button. */
  label: string;
  /** Toggled-on state — rose tint (e.g. the piece is excluded). */
  active?: boolean;
  onClick: () => void;
}

/** Compact card footer: a right-aligned row of 24 px icon buttons. */
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

interface ResultGearDetailBodyProps {
  piece: UiPiece;
  game: GameData | null;
  /** Optional equipped-on character — shows a small portrait in the header.
   *  Omit on surfaces where the owner is already obvious (e.g. a build card). */
  equippedChar?: Character | null;
  /** In-game presets holding the piece, other than the one being optimized
   *  (names, best-ranked first) — "from preset ‹name›" under the header, as
   *  the portrait says which hero the piece comes from. */
  fromPresets?: string[];
  /** Per-sub reforge ticks the projection ADDED (aligned to `piece.subs`) — used
   *  to split each sub's LV into Base + Actuelle + Extrapolé. */
  addedTicks?: number[];
  /** Per-sub ticks the Transistone potential ADDED (aligned to `piece.subs`) —
   *  a distinct marker on the line. */
  transistoneTicks?: number[];
  /** Compact card (Settings › Solver › Compact result cards). */
  compact?: boolean;
}

export function ResultGearDetailBody({ piece, game, equippedChar = null, fromPresets, addedTicks, transistoneTicks, compact = false }: ResultGearDetailBodyProps) {
  const rarity = RARITY[piece.rarity];
  // EE (exclusive) shows just its image + gems — no main stats, no effects.
  const isEE = piece.slot === "exclusive";
  const fullName = `${piece.name}${piece.singularity ? " - [Singularity]" : ""}`;

  return (
    <div className={cx(compact ? "space-y-2" : "space-y-3", "text-left")}>
      {/* header — lock + name. Item name on line 1, "- [Singularity]" on line 2
       *  for ascended pieces; the blue→purple gradient runs VERTICALLY. */}
      <div className="flex items-start gap-1.5">
        {piece.locked && <img src="/img/ui/inven/CT_Slot_Lock.webp" alt="Locked" title="Locked in-game" className="mt-0.5 h-4 w-4 shrink-0" />}
        <span
          className="block min-w-0 flex-1 font-display text-[15px] font-semibold leading-tight"
          style={piece.singularity
            ? { background: SINGULARITY_GRADIENT_V, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }
            : { color: rarity?.fg ?? "#f4f4f5" }}
          title={compact ? fullName : undefined}
        >
          {compact ? compactName(piece, game) : <>{piece.name}{piece.singularity && <><br />- [Singularity]</>}</>}
        </span>
        {/* Compact: what the dropped equipment icon carried — enhance (always),
         *  breakthrough (when any) and the star count. */}
        {compact && (
          <span className="mt-0.5 flex shrink-0 items-center gap-1 font-mono text-[11px] leading-4 tabular-nums text-white/75">
            <span title="Enhance level">+{piece.enhance}</span>
            {piece.bt > 0 && <span title="Breakthrough">T{piece.bt}</span>}
            <span title="Stars">{piece.stars}★</span>
          </span>
        )}
        {/* Equipped-on hero — top-right corner of the card, round. */}
        {equippedChar && <CharFace charId={equippedChar.charId} name={equippedChar.name ?? `#${equippedChar.charId}`} size={32} className="rounded-full" />}
      </div>
      {fromPresets && fromPresets.length > 0 && (
        <div
          className={cx("truncate text-amber-200/85", compact ? "-mt-1 text-[10px]" : "-mt-2 text-[11px]")}
          title={`Held by the in-game preset${fromPresets.length === 1 ? "" : "s"} ${fromPresets.join(", ")} — taking it changes ${fromPresets.length === 1 ? "that preset" : "those presets"}`}
        >
          from preset {fromPresets.join(", ")}
        </div>
      )}

      {/* icon + main stat(s) to its right (no rarity/slot line). EE shows just
       *  its image — no main. Compact: no icon, the main(s) on one full-width
       *  line. */}
      {compact ? (
        !isEE && piece.main.length > 0 && (
          <div className="flex items-center gap-3">
            {piece.main.map((m, i) => (
              <div key={i} className="flex min-w-0 flex-1 items-center gap-2 font-mono text-[13px] tabular-nums" title={m.name ?? statLong(m.stat)}>
                <StatIcon stat={m.stat} size={18} className="shrink-0" />
                <span className="ml-auto font-semibold text-white">{m.value}</span>
              </div>
            ))}
          </div>
        )
      ) : (
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
      )}

      {/* substats (gear) OR gems (talisman / EE) — never both. EE: gems only.
       *  Compact: gems as one icon row, subs on a 2 × 2 grid (row by row). */}
      {piece.gemSlots ? (
        compact ? <CompactGemRow slots={piece.gemSlots} /> : <GemPanel slots={piece.gemSlots} />
      ) : !isEE && piece.subs.length > 0 ? (
        compact ? (
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {piece.subs.map((s, i) => <CompactSubCell key={i} s={s} added={addedTicks?.[i] ?? 0} transistone={transistoneTicks?.[i] ?? 0} />)}
          </div>
        ) : (
        <div className="space-y-1">
          {piece.subs.map((s, i) => <SubstatRow key={i} s={s} added={addedTicks?.[i] ?? 0} transistone={transistoneTicks?.[i] ?? 0} />)}
        </div>
        )
      ) : null}

      {/* quality — just the rating + label, in the label's color. No bar/header. */}
      {(() => {
        const q = piece.quality;
        if (!q) return null;
        const tone = QUALITY_TONE[q.tier];
        if (compact) {
          // "14/20 →17 Exc." — the full label and both help texts in the title.
          const title = `${tone.label} — ${QUALITY_HELP}${q.reachable != null ? `\n\n${QUALITY_REACHABLE_HELP}` : ""}`;
          return (
            <div className="font-mono text-[12px] tabular-nums" title={title}>
              <span className={cx("font-bold", tone.text)}>{q.current}/{q.max}</span>
              {q.reachable != null && <span className="ml-1.5 text-violet-300">→{q.reachable}</span>}
              <span className={cx("ml-1.5 font-semibold", tone.text)}>{qualityShortLabel(q.tier)}</span>
            </div>
          );
        }
        return (
          <div className="font-mono text-[12px] tabular-nums">
            <span className={cx("font-bold", tone.text)}>{q.current}</span>
            <span className="text-white/60">/{q.max}</span>
            {q.reachable != null && <span className="text-violet-300" title={QUALITY_REACHABLE_HELP}> → {q.reachable} reachable</span>}
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
                {visible.map((t, i) => compact ? (
                  <div key={i} className={cx("truncate text-[11px] leading-snug text-white", !t.active && "opacity-40")} title={plainLine(t.desc)}>
                    <GameText text={oneLine(t.desc)} />
                  </div>
                ) : (
                  <GameText key={i} text={t.desc} className={cx("block text-[11px] leading-snug text-white", !t.active && "opacity-40")} />
                ))}
              </div>
            );
          })()}

          {/* Singularity active effect (ascended) — same format, label removed.
           *  Compact: every effect on one line (icon + signed value, the +15
           *  bonus as grade + icon + short label + value, or a short name), the
           *  full wording in each title. */}
          {piece.singularity && piece.effects.length > 0 && compact && (
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
          {piece.singularity && piece.effects.length > 0 && !compact && (
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
  piece, equippedChar, fromPresets, game, excluded, onToggleExclude, addedTicks, transistoneTicks, compact = false,
}: { piece: UiPiece | null; equippedChar: Character | null; fromPresets?: string[]; game: GameData | null; excluded?: boolean; onToggleExclude?: (uid: string) => void; addedTicks?: number[]; transistoneTicks?: number[]; compact?: boolean }) {
  const width = compact ? "w-56" : "w-80";
  if (!piece) {
    return (
      <aside className={cx("flex h-full shrink-0 flex-col items-center justify-center rounded-xl border border-dashed border-white/6 bg-white/[0.012] px-6 py-8 text-center", width)}>
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
    <aside className={cx("flex h-full shrink-0 flex-col overflow-hidden rounded-xl border border-white/8 bg-bg-elev-1", width)}>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <ResultGearDetailBody piece={piece} game={game} equippedChar={equippedChar} fromPresets={fromPresets} addedTicks={addedTicks} transistoneTicks={transistoneTicks} compact={compact} />
      </div>
      {onToggleExclude && compact && (
        <div className="shrink-0 border-t border-white/8 px-4 py-1.5">
          <CardActions actions={[{
            key: "exclude",
            icon: EXCLUDE_ICON,
            label: excluded ? "Excluded from solver — click to include" : "Exclude from solver",
            active: excluded,
            onClick: () => onToggleExclude(piece.id),
          }]} />
        </div>
      )}
      {onToggleExclude && !compact && (
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
