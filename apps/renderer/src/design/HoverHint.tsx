/**
 * Reusable hover tooltip: renders a label followed by a small ⊙? icon that
 * reveals a popover with longer-form explanation on hover/focus.
 *
 * Usage:
 *   <HoverHint name="Quality" text="Sum of every substat tick vs the …" />
 *
 * The label inherits any text styling from the parent (case / spacing /
 * color / font); the popover RESETS those properties so explanatory copy
 * always renders as normal-cased body text — easy to slot inside an
 * uppercase eyebrow without the tooltip body inheriting the chrome.
 *
 * Positioning: portal-mounted on document.body via fixed positioning so the
 * tooltip ALWAYS clears parent `overflow: hidden` / clipping containers
 * (the ItemDetail aside being the original offender). Centered above the
 * icon, then clamped to the viewport with a small edge padding — long
 * labels near the screen edges stay fully readable.
 */
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx.js";

export interface HoverHintProps {
  /** Visible label rendered first (e.g. "Quality"). Inherits parent styling. */
  name: ReactNode;
  /** Body content shown in the popover on hover/focus. Accepts rich content
   *  (paragraphs, lists, colored spans) — prefer structured JSX over one dense
   *  block so long explanations stay readable. */
  text: ReactNode;
  /** Extra classes for the outer wrapper — mainly to pass parent text
   *  styling (e.g. `font-semibold uppercase tracking-wider text-zinc-400`)
   *  that should affect the `name` but not the tooltip body. */
  className?: string;
  /** Popover max width in px. Bump it for long explanatory copy so it doesn't
   *  wrap into a tall, narrow column. Defaults to 240. */
  maxWidth?: number;
}

const TOOLTIP_MAX_W = 240;   // px — default popover max width.
const EDGE_PADDING = 8;      // px — gap kept from the viewport edges.
const ANCHOR_GAP = 8;        // px — gap between the icon and the popover.

export function HoverHint({ name, text, className, maxWidth = TOOLTIP_MAX_W }: HoverHintProps) {
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  // `pos` is the viewport-relative anchor point: the popover is centered
  // horizontally around `left` and bottom-aligned to `top - ANCHOR_GAP`
  // via the `translate(-50%, -100%)` transform on the portal element.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const recompute = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const half = maxWidth / 2;
    let left = r.left + r.width / 2;
    if (left - half < EDGE_PADDING) left = half + EDGE_PADDING;
    if (left + half > window.innerWidth - EDGE_PADDING) {
      left = window.innerWidth - half - EDGE_PADDING;
    }
    setPos({ top: r.top - ANCHOR_GAP, left });
  }, [maxWidth]);

  useLayoutEffect(() => {
    if (!open) return;
    recompute();
    // Keep the popover anchored if the page scrolls / resizes while open.
    const handle = () => recompute();
    window.addEventListener("scroll", handle, true);
    window.addEventListener("resize", handle);
    return () => {
      window.removeEventListener("scroll", handle, true);
      window.removeEventListener("resize", handle);
    };
  }, [open, recompute]);

  return (
    <span className={cx("inline-flex items-center gap-1", className)}>
      <span>{name}</span>
      <span
        ref={triggerRef}
        tabIndex={0}
        aria-describedby={open ? "hover-hint" : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="group inline-flex cursor-help items-center outline-none"
      >
        <span
          aria-hidden
          className="grid h-3 w-3 place-items-center rounded-full border border-white/60 text-[8px] font-bold leading-none text-white transition-colors group-hover:border-white group-focus-visible:border-white"
        >
          ?
        </span>
      </span>
      {open && pos && createPortal(
        <div
          id="hover-hint"
          role="tooltip"
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            maxWidth,
            transform: "translate(-50%, -100%)",
          }}
          className="pointer-events-none z-9999 whitespace-normal rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[11px] font-normal leading-snug tracking-normal text-white normal-case shadow-lg shadow-black/40"
        >
          {text}
        </div>,
        document.body,
      )}
    </span>
  );
}
