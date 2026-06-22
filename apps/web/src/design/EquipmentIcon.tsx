import { memo } from "react";
import { cx } from "./cx.js";
import { SLOT_BY, STAT, type DesignRarity, type SlotId } from "./tokens.js";

/** Renders the in-game stat icon (CM_Stat_Icon_*). Falls back to the textual
 *  label when no icon is registered for the key. Use `aria-label` (tooltip) so
 *  the icon-only display still announces the stat to screen readers. */
export function StatIcon({
  stat, size = 14, className,
}: { stat: string; size?: number; className?: string }) {
  const meta = STAT[stat];
  if (!meta?.icon) {
    return (
      <span className={cx("font-mono uppercase tracking-wider text-zinc-500", className)} style={{ fontSize: Math.max(9, Math.round(size * 0.7)) }}>
        {meta?.label ?? stat.toUpperCase()}
      </span>
    );
  }
  return (
    <img
      src={`/img/ui/effect/${meta.icon}.webp`}
      alt={meta.label}
      title={meta.label}
      className={cx("shrink-0 object-contain", className)}
      style={{ width: size, height: size }}
      loading="lazy"
      draggable={false}
      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
    />
  );
}

/** In-game inventory tab icon for a slot (Weapon / Helmet / Armor / Gloves /
 *  Shoes / Accessory / Oopart / Exclusive). Used for filter pills, slot chips,
 *  and the empty-slot placeholder. Sharper and on-brand vs the SVG fallback. */
export function SlotIcon({
  slot, size = 14, className,
}: { slot: SlotId | string; size?: number; className?: string }) {
  const meta = SLOT_BY[slot];
  if (!meta) return null;
  return (
    <img
      src={`/img/ui/inven/${meta.icon}.png`}
      alt=""
      className={cx("shrink-0 object-contain", className)}
      style={{ width: size, height: size }}
      loading="lazy"
      draggable={false}
      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
    />
  );
}

/**
 * EquipmentIcon — composite item tile mirroring outerpedia-v2's
 * `EquipmentIcon.tsx`. Layered top-to-bottom:
 *   1. rarity slot background (TI_Slot_<Normal|Magic|Rare|Unique|Singularity>)
 *   2. item art (TI_Equipment_*), centered with small padding
 *   3. effect icon — top-right (only unique pieces with a curated UO)
 *   4. class icon — just under the effect icon (only class-locked pieces)
 *   5. T<N> breakthrough badge — bottom-left, white italic bold + stroke
 *   6. +N enhancement badge — bottom-right on a semi-transparent black plate
 *      (Singularity gradient text when ascended)
 *   7. star row — overlapping star images, centered at the bottom edge
 * The badges sit at the SAME vertical baseline, just above the star row.
 */

// Map design rarity → slot background filename. Ascended pieces always use the
// Singularity plate regardless of underlying rarity.
const RARITY_SLOT_BG: Record<DesignRarity, string> = {
  normal: "TI_Slot_Normal",
  superior: "TI_Slot_Magic",
  epic: "TI_Slot_Rare",
  legendary: "TI_Slot_Unique",
};

// Overlay typography (APK CUIItemThumbnail prefab).
const ENH_TEXT_SHADOW = "1px -1px 0 rgba(30,30,30,.4), 1px 1px 0 rgba(0,0,0,.2)";
const TIER_TEXT_SHADOW = "1px -1px 0 rgba(30,30,30,.78), 1px 1px 0 rgba(0,0,0,.5)";
// Vertical Singularity gradient — cyan top → magenta bottom (matches in-game name treatment).
const ENH_ASCENDED_GRADIENT = "linear-gradient(180deg, #16EBF1 0%, #9D51FF 50%, #E02BCD 100%)";

/** Stroke glyph fallback for each slot, used when the item art is missing. */
export function SlotGlyph({ slot, className = "h-3 w-3" }: { slot: SlotId | string; className?: string }) {
  const paths: Record<string, React.ReactNode> = {
    weapon:    <path d="M3 11 L9 5 M8 2 L11 5 L9 7 L6 4 Z M3 9 L5 11 L3 11 Z" />,
    helmet:    <path d="M3 6 a3 3 0 0 1 6 0 V9 H8 V7 H4 V9 H3 Z" />,
    armor:     <path d="M6 1.5 L10 3 V7 C10 9 8 10.4 6 11 C4 10.4 2 9 2 7 V3 Z" />,
    gloves:    <path d="M3.5 5 V3.2 a0.7 0.7 0 0 1 1.4 0 V5 M4.9 5 V2.6 a0.7 0.7 0 0 1 1.4 0 V5 M6.3 5 V2.8 a0.7 0.7 0 0 1 1.4 0 V5 V8.5 a2 2 0 0 1-4 0 V5.4 a0.7 0.7 0 0 1 1.4 0" />,
    boots:     <path d="M4 1.5 V7 H9 a1.5 1.5 0 0 1 0 3 H3 V1.5 Z" />,
    accessory: <path d="M6 2 L8.5 5 L6 10 L3.5 5 Z M3.5 5 H8.5" />,
    talisman:  <path d="M6 1.5 L7.4 4.4 L10.5 4.8 L8.2 7 L8.8 10 L6 8.5 L3.2 10 L3.8 7 L1.5 4.8 L4.6 4.4 Z" />,
    exclusive: <path d="M6 1.5 L10 4 V8 L6 10.5 L2 8 V4 Z M6 4.5 L8 6 L6 7.5 L4 6 Z" />,
  };
  return (
    <svg viewBox="0 0 12 12" className={className} fill="none" stroke="currentColor" strokeWidth={1.1} strokeLinejoin="round" strokeLinecap="round">
      {paths[slot] ?? <circle cx="6" cy="6" r="3" />}
    </svg>
  );
}

/** Striped fallback when the item art file is missing. */
function ArtFallback({ slot, k }: { slot: string; k: number }) {
  return (
    <div
      className="grid h-full w-full place-items-center font-mono uppercase tracking-wider text-zinc-500"
      style={{
        fontSize: Math.max(7, Math.round(8 * k)),
        background: "repeating-linear-gradient(135deg, rgba(255,255,255,0.025) 0 4px, transparent 4px 8px)",
      }}
    >
      {slot.slice(0, 3).toUpperCase()}
    </div>
  );
}

export interface IconPiece {
  slot: SlotId | string;
  rarity: DesignRarity;
  stars: number;
  enhance: number;
  bt: number;             // 0..4
  singularity: boolean;
  /** Reforge attempts spent on this piece. Drives the star row coloring:
   *  each reforge ≤ `stars` swaps one yellow → orange; each reforge above
   *  `stars` swaps two orange → two Singularity. Visualises both the base
   *  reforge progress (1..N) and the ascended extra reforges in one row. */
  reforge?: number;
  /** ItemTemplet.IconName — served at /img/equipment/<image>.webp */
  image?: string | null;
  /** Curated unique-option icon — served at /img/ui/effect/<effectIcon>.webp */
  effectIcon?: string | null;
  /** Armor 4-piece set icon (helmet/armor/gloves/boots) — served at
   *  /img/ui/effect/<setIcon>.webp. Renders in the same top-right slot as
   *  `effectIcon`; armor pieces never carry both, so a single slot suffices. */
  setIcon?: string | null;
  /** Class restriction display name — served at /img/ui/class/CM_Class_<class>.webp */
  class?: string | null;
}

const STAR_YELLOW = "/img/ui/star/CM_icon_star_y.webp";
const STAR_ORANGE = "/img/ui/star/CM_icon_star_o.webp";
const STAR_SINGULARITY = "/img/ui/star/CM_Star_Singularity.webp";

/** Split a star row of length `total` into singularity/orange/yellow buckets
 *  based on reforge count. Mirrors the in-game inventory readout. */
function splitStars(total: number, reforge: number): { sing: number; orange: number; yellow: number } {
  if (total <= 0) return { sing: 0, orange: 0, yellow: 0 };
  const r = Math.max(0, reforge);
  const excess = Math.max(0, r - total);
  const sing = Math.min(total, excess * 2);
  const orange = Math.max(0, Math.min(total - sing, r - sing));
  const yellow = Math.max(0, total - sing - orange);
  return { sing, orange, yellow };
}

/** Build the row of star image sources, singularity first → orange → yellow. */
function starRowSrcs(total: number, reforge: number): string[] {
  const { sing, orange, yellow } = splitStars(total, reforge);
  return [
    ...Array<string>(sing).fill(STAR_SINGULARITY),
    ...Array<string>(orange).fill(STAR_ORANGE),
    ...Array<string>(yellow).fill(STAR_YELLOW),
  ];
}

export interface EquipmentIconProps {
  piece: IconPiece;
  size?: number;
  detail?: "full" | "compact" | "mini";
  className?: string;
}

/** Memo'd — `piece` should be a stable reference (memoize `toIconPiece`
 *  upstream or hoist it). Shallow-compare lets the icon skip re-render when
 *  the surrounding row re-renders for unrelated reasons. */
export const EquipmentIcon = memo(EquipmentIconImpl);
function EquipmentIconImpl({ piece, size = 50, detail = "full", className }: EquipmentIconProps) {
  const k = size / 50;
  const showOverlays = detail === "full";
  const showEnhance = detail !== "mini";

  const starCount = detail === "mini" ? 0 : piece.stars;
  const starSize = Math.round(size / 5);
  const starOverlap = Math.round(starSize * 0.3);
  const starsWidth = starCount > 0 ? starSize + (starCount - 1) * (starSize - starOverlap) : 0;
  const starSrcs = starRowSrcs(starCount, piece.reforge ?? 0);

  // Both bottom-edge badges sit at the same baseline. When stars are present
  // they sit just above the star row; otherwise they hug the bottom edge.
  const badgeBottom = starCount > 0 ? starSize + Math.round(size * 0.08) : Math.max(2, Math.round(size * 0.04));
  const badgeFontSize = Math.max(9, Math.round(size * 0.14));
  const overlaySize = Math.max(10, Math.round(size * 0.25));

  const bgKey = piece.singularity ? "TI_Slot_Singularity" : RARITY_SLOT_BG[piece.rarity];

  return (
    <div
      className={cx("relative shrink-0 overflow-visible rounded", className)}
      style={{ width: size, height: size }}
    >
      <div className="relative h-full w-full overflow-hidden rounded">
        {/* rarity slot bg */}
        <img
          src={`/img/ui/bg/${bgKey}.webp`}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
          draggable={false}
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
        />
        {/* item art (centered, small padding) — EEs use the per-character art
             from /img/characters/ee/<charId>.webp instead of the generic
             TI_Equipment_EX_<charId> that doesn't ship with the asset set. */}
        {piece.image ? (
          <img
            src={(() => {
              const ee = /^TI_Equipment_EX_(\d+)$/.exec(piece.image);
              return ee ? `/img/characters/ee/${ee[1]}.webp` : `/img/equipment/${piece.image}.webp`;
            })()}
            alt=""
            className="absolute inset-0 h-full w-full object-contain p-0.5"
            loading="lazy"
            draggable={false}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="absolute inset-0">
            <ArtFallback slot={String(piece.slot)} k={k} />
          </div>
        )}
      </div>

      {/* effect / set icon — top-right. `effectIcon` (curated unique-option
           badge) wins when present; otherwise the armor 4-piece set icon
           takes the slot. A piece never carries both in practice (weapons /
           accessories carry effectIcon, armor pieces carry setIcon). */}
      {showOverlays && (piece.effectIcon || piece.setIcon) && (
        <div
          className="absolute right-0.5 top-0.5"
          style={{ width: overlaySize, height: overlaySize }}
        >
          <img
            src={`/img/ui/effect/${piece.effectIcon ?? piece.setIcon}.webp`}
            alt=""
            className="h-full w-full object-contain"
            loading="lazy"
            draggable={false}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        </div>
      )}

      {/* class icon — just below the effect/set icon */}
      {showOverlays && piece.class && (
        <div
          className="absolute right-0.5"
          style={{ width: overlaySize, height: overlaySize, top: (piece.effectIcon || piece.setIcon) ? overlaySize + 4 : 2 }}
        >
          <img
            src={`/img/ui/class/CM_Class_${piece.class}.webp`}
            alt=""
            className="h-full w-full object-contain"
            loading="lazy"
            draggable={false}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        </div>
      )}

      {/* breakthrough T<N> — bottom-left, italic bold with same-color stroke */}
      {showOverlays && piece.bt > 0 && (
        <span
          className="pointer-events-none absolute leading-none"
          style={{
            bottom: badgeBottom,
            left: Math.max(2, Math.round(size * 0.06)),
            fontSize: badgeFontSize,
            color: "#FFFFFF",
            fontWeight: 800,
            fontStyle: "italic",
            WebkitTextStroke: "0.6px #FFFFFF",
            textShadow: TIER_TEXT_SHADOW,
          }}
        >
          T{piece.bt}
        </span>
      )}

      {/* enhancement +N — bottom-right on a semi-transparent black plate */}
      {showEnhance && piece.enhance > 0 && (
        <span
          className="pointer-events-none absolute inline-flex items-center leading-none"
          style={{
            bottom: badgeBottom,
            right: Math.max(2, Math.round(size * 0.04)),
            fontSize: badgeFontSize,
            fontWeight: 600,
            padding: "1px 4px",
            borderRadius: 3,
            background: "rgba(0,0,0,0.78)",
          }}
        >
          <span
            style={piece.singularity
              ? { background: ENH_ASCENDED_GRADIENT, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }
              : { color: "#FEFEFE", textShadow: ENH_TEXT_SHADOW }}
          >
            +{piece.enhance}
          </span>
        </span>
      )}

      {/* stars — overlapping images centered at the bottom of the image */}
      {starCount > 0 && (
        <div
          className="absolute bottom-1 left-1/2 flex"
          style={{ width: starsWidth, marginLeft: -starsWidth / 2 }}
        >
          {starSrcs.map((src, i) => (
            <img
              key={i}
              src={src}
              alt=""
              className="shrink-0 object-contain drop-shadow-sm"
              loading="lazy"
              draggable={false}
              style={{
                width: starSize,
                height: starSize,
                marginLeft: i === 0 ? 0 : -starOverlap,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** 32px equipped-slot tile used on character cards & build cards.
 *  Filled → small EquipmentIcon; empty → dashed silhouette with the inven icon.
 *  At size ≥ 50 we surface the full overlays (effect / class / T<N>); smaller
 *  tiles drop them to stay legible — compare against the per-overlay size
 *  formula `max(10, size * 0.25)` in EquipmentIcon. */
export const SlotMini = memo(SlotMiniImpl);
function SlotMiniImpl({ slot, piece, size = 32 }: { slot: SlotId | string; piece?: IconPiece | null; size?: number }) {
  if (piece) {
    const detail = size >= 50 ? "full" : size >= 30 ? "compact" : "mini";
    return <EquipmentIcon piece={piece} size={size} detail={detail} />;
  }
  return (
    <div
      className="relative grid shrink-0 place-items-center"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.16),
        border: "1px dashed rgba(255,255,255,0.10)",
        background: "repeating-linear-gradient(135deg, rgba(255,255,255,0.018) 0 4px, transparent 4px 8px), rgba(0,0,0,0.25)",
      }}
    >
      <SlotIcon slot={slot} size={Math.round(size * 0.55)} className="opacity-35" />
    </div>
  );
}

/** Standalone row of star images. Yellow base, orange for each reforge spent,
 *  Singularity for reforges above `count` (×2 per — mirrors the icon row). */
export function StarRow({ count = 6, reforge = 0, size = 12 }: { count?: number; reforge?: number; size?: number }) {
  const srcs = starRowSrcs(count, reforge);
  const overlap = Math.round(size * 0.3);
  const width = count > 0 ? size + (count - 1) * (size - overlap) : 0;
  return (
    <span className="inline-flex" style={{ width, height: size }}>
      {srcs.map((src, i) => (
        <img
          key={i}
          src={src}
          alt=""
          className="shrink-0 object-contain drop-shadow-sm"
          loading="lazy"
          draggable={false}
          style={{ width: size, height: size, marginLeft: i === 0 ? 0 : -overlap }}
        />
      ))}
    </span>
  );
}

/** Character face icon — small portrait pulled from /img/characters/faceicon/. */
export const CharFace = memo(CharFaceImpl);
function CharFaceImpl({
  charId, name, size = 28, className,
}: { charId: number | string; name?: string; size?: number; className?: string }) {
  return (
    <img
      src={`/img/characters/faceicon/FI_${charId}.webp`}
      alt={name ?? ""}
      title={name ?? ""}
      className={cx("shrink-0 rounded-md object-cover", className)}
      style={{ width: size, height: size, border: "1px solid rgba(255,255,255,0.08)" }}
      loading="lazy"
      draggable={false}
      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
    />
  );
}

// Raw CharacterTemplet codes → image file basename. Names are the in-game
// asset names — Attacker is "Striker", Priest is "Healer", which differ from
// CharacterCard's CCT_*/CET_* strings.
const CLASS_FILE: Record<string, string> = {
  CCT_ATTACKER: "Striker",
  CCT_DEFENDER: "Defender",
  CCT_RANGER: "Ranger",
  CCT_MAGE: "Mage",
  CCT_PRIEST: "Healer",
};
const ELEMENT_FILE: Record<string, string> = {
  CET_FIRE: "Fire",
  CET_WATER: "Water",
  CET_EARTH: "Earth",
  CET_LIGHT: "Light",
  CET_DARK: "Dark",
};
/** Below this frame size overlays are suppressed — they'd be unreadable. */
const PORTRAIT_OVERLAY_MIN = 40;

// Transcend star colors (ports outerpedia-v2's src/lib/stars.ts).
// g = empty (gray/white), y = yellow, o = orange (+1 above base 4), r = red
// (+1 above 5), p = violet (+2 above 5 → max trans for 3★).
type StarColor = "g" | "y" | "o" | "r" | "p";
const STAR_ICONS: Record<StarColor, string> = {
  g: "/img/ui/star/CM_icon_star_w.webp",
  y: "/img/ui/star/CM_icon_star_y.webp",
  o: "/img/ui/star/CM_icon_star_o.webp",
  r: "/img/ui/star/CM_icon_star_r.webp",
  p: "/img/ui/star/CM_icon_star_v.webp",
};

/** Captured `TransStar` (numeric) → outerpedia-v2 LevelId. The mapping depends
 *  on BasicStar because 3★ chars have extra "split" stars (4_1/4_2, 5_1/5_2/5_3)
 *  while 1★/2★ chars walk a simpler 1→6 ladder. */
function transcendLevelKey(basicStar: number, transStar: number): string {
  if (basicStar >= 3) {
    // 3★ path: 3→4→5→6→7→8→9 mapped to 3 / 4_1 / 4_2 / 5_1 / 5_2 / 5_3 / 6.
    return ({
      3: "3", 4: "4_1", 5: "4_2",
      6: "5_1", 7: "5_2", 8: "5_3",
      9: "6",
    } as Record<number, string>)[transStar] ?? "3";
  }
  // 1★ / 2★ path: 1→2→3→4→6→9 maps to 1 / 2 / 3 / 4 / 5 / 6 (the "6" only
  // unlocks at TransStar 9 — same convention as outerpedia-v2's slider).
  return ({
    1: "1", 2: "2", 3: "3", 4: "4",
    5: "5", 6: "5", 7: "5", 8: "5",
    9: "6",
  } as Record<number, string>)[transStar] ?? String(Math.min(transStar, 6));
}

/** Full 6-slot star row for a transcend level key. Mirrors `starRowForLevel`
 *  in outerpedia-v2/src/lib/stars.ts so the visual matches the site. */
function starRowForLevel(lv: string): StarColor[] {
  switch (lv) {
    case "1":             return ["y", "g", "g", "g", "g", "g"];
    case "2":             return ["y", "y", "g", "g", "g", "g"];
    case "3":             return ["y", "y", "y", "g", "g", "g"];
    case "4": case "4_1": return ["y", "y", "y", "y", "g", "g"];
    case "4_2":           return ["y", "y", "y", "o", "g", "g"];
    case "5": case "5_1": return ["y", "y", "y", "y", "y", "g"];
    case "5_2":           return ["y", "y", "y", "y", "r", "g"];
    case "5_3":           return ["y", "y", "y", "y", "p", "g"];
    case "6":             return ["y", "y", "y", "y", "y", "y"];
    default:              return ["g", "g", "g", "g", "g", "g"];
  }
}

/** Character portrait with the same overlays as outerpedia-v2: element icon
 *  top-right, class icon middle-right (with optional level chip just below
 *  it), and an overlapping transcend-colored star row at the bottom matching
 *  the in-game character sheet. Percentages reference the UICharacterThumbnail
 *  prefab (128 px baseline) so overlays auto-scale with the frame. */
export const CharacterPortrait = memo(CharacterPortraitImpl);
function CharacterPortraitImpl({
  charId, name, cls, element, level, transStar, basicStar, size = 64, className,
}: {
  charId: number | string;
  name?: string;
  cls?: string | null;
  element?: string | null;
  /** Display level chip under the class icon (e.g. captured Lv 120). */
  level?: number | null;
  /** Captured TransStar (0..9). Drives the star row coloring. */
  transStar?: number | null;
  /** Character's BasicStar (1..3). Needed to map TransStar to a LevelId. */
  basicStar?: number | null;
  size?: number;
  className?: string;
}) {
  const showOverlays = size >= PORTRAIT_OVERLAY_MIN;
  const elementFile = element ? ELEMENT_FILE[element] : null;
  const classFile = cls ? CLASS_FILE[cls] : null;
  const showStars = showOverlays && transStar != null && transStar > 0 && basicStar != null;
  const starColors = showStars ? starRowForLevel(transcendLevelKey(basicStar, transStar)) : null;
  return (
    <div className={cx("relative shrink-0", className)} style={{ width: size, height: size }}>
      <img
        src={`/img/characters/faceicon/FI_${charId}.webp`}
        alt={name ?? ""}
        title={name ?? ""}
        className="h-full w-full rounded-lg border border-zinc-700 bg-zinc-900 object-cover"
        loading="lazy"
        draggable={false}
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
      />
      {showOverlays && elementFile && (
        <img
          src={`/img/ui/elem/CM_Element_${elementFile}.webp`}
          alt={elementFile}
          className="pointer-events-none absolute -right-1 -top-1 z-10 object-contain drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
          style={{ width: "39%", height: "39%" }}
        />
      )}
      {showOverlays && classFile && (
        <img
          src={`/img/ui/class/CM_Class_${classFile}.webp`}
          alt={classFile}
          className="pointer-events-none absolute right-0 z-10 object-contain drop-shadow-md"
          style={{ top: "40%", width: "27%", height: "27%" }}
        />
      )}
      {/* Lv chip — under the class icon (class sits at top 40%, height 27% →
           level starts a hair below at top ~70%). White mono with a subtle
           shadow so it reads on any face icon. */}
      {showOverlays && level != null && level > 0 && (
        <span
          className="pointer-events-none absolute z-10 font-mono font-semibold leading-none text-white"
          style={{
            top: "70%",
            right: "2%",
            fontSize: Math.max(8, Math.round(size * 0.13)),
            textShadow: "1px 1px 0 rgba(0,0,0,0.85), -1px -1px 0 rgba(0,0,0,0.65)",
          }}
        >
          Lv{level}
        </span>
      )}
      {/* Transcend-colored star row — overlapping like the equipment icon's
           rarity stars, colored y/o/r/p/g per starRowForLevel. */}
      {showStars && starColors && (() => {
        const starSize = Math.max(6, Math.round(size / 6.5));
        const overlap = Math.round(starSize * 0.3);
        const rowWidth = starSize + (starColors.length - 1) * (starSize - overlap);
        return (
          <div
            className="pointer-events-none absolute z-10 flex"
            style={{ bottom: "3%", left: "50%", width: rowWidth, marginLeft: -rowWidth / 2 }}
          >
            {starColors.map((color, i) => (
              <img
                key={i}
                src={STAR_ICONS[color]}
                alt=""
                className="shrink-0 object-contain drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]"
                style={{ width: starSize, height: starSize, marginLeft: i === 0 ? 0 : -overlap }}
                loading="lazy"
                draggable={false}
              />
            ))}
          </div>
        );
      })()}
    </div>
  );
}
