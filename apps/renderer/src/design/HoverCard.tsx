/**
 * Hover popover whose TRIGGER is its own children (unlike `HoverHint`, where the
 * trigger is a trailing `?` icon). Hover/focus anywhere on the wrapped content
 * reveals a portal-mounted popover with `content` — used for the Builder's
 * Effects card, where the effect icon + name itself should surface the
 * description on hover.
 *
 * Portal-mounted on document.body (fixed positioning) so the popover clears the
 * sidebar's `overflow-y-auto` clipping; centered above the trigger and clamped
 * to the viewport. Positioning logic mirrors `HoverHint`.
 */
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx.js";

const DEFAULT_MAX_W = 260;
const EDGE_PADDING = 8;
const ANCHOR_GAP = 8;

export function HoverCard({
  children, content, maxWidth = DEFAULT_MAX_W, className,
}: {
  /** The visible trigger (e.g. an effect icon + name row). */
  children: ReactNode;
  /** Popover body shown on hover/focus. */
  content: ReactNode;
  maxWidth?: number;
  className?: string;
}) {
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const recompute = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const half = maxWidth / 2;
    let left = r.left + r.width / 2;
    if (left - half < EDGE_PADDING) left = half + EDGE_PADDING;
    if (left + half > window.innerWidth - EDGE_PADDING) left = window.innerWidth - half - EDGE_PADDING;
    setPos({ top: r.top - ANCHOR_GAP, left });
  }, [maxWidth]);

  useLayoutEffect(() => {
    if (!open) return;
    recompute();
    const handle = () => recompute();
    window.addEventListener("scroll", handle, true);
    window.addEventListener("resize", handle);
    return () => {
      window.removeEventListener("scroll", handle, true);
      window.removeEventListener("resize", handle);
    };
  }, [open, recompute]);

  return (
    <span
      ref={triggerRef}
      tabIndex={0}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      className={cx("block cursor-help outline-none", className)}
    >
      {children}
      {open && pos && createPortal(
        <div
          role="tooltip"
          style={{ position: "fixed", top: pos.top, left: pos.left, maxWidth, transform: "translate(-50%, -100%)" }}
          className="pointer-events-none z-9999 whitespace-normal rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[11px] font-normal leading-snug tracking-normal text-white normal-case shadow-lg shadow-black/40"
        >
          {content}
        </div>,
        document.body,
      )}
    </span>
  );
}
