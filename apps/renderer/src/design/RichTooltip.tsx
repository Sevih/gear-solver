/**
 * Hover tooltip that renders arbitrary React content (vs `title="…"` which
 * is plain-text only). Used wherever the tooltip needs in-game colored
 * effect descriptions via `GameText`.
 *
 * Portal-mounted on document.body via fixed positioning so the tooltip
 * always clears parent `overflow: hidden` containers (e.g. the Builder's
 * top panel band). Centered above the trigger, clamped to the viewport.
 */
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx.js";

interface Props {
  /** Rich tooltip body — rendered as-is inside the floating panel. */
  content: ReactNode;
  /** Trigger — wrapped in an inline-flex span so the hover area matches
   *  the child exactly. Wrap the chip / button you want the tooltip on. */
  children: ReactNode;
  /** Optional extra classes for the trigger wrapper. */
  className?: string;
}

const TOOLTIP_MAX_W = 320;
const EDGE_PADDING = 8;
const ANCHOR_GAP = 6;

export function RichTooltip({ content, children, className }: Props) {
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const recompute = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const half = TOOLTIP_MAX_W / 2;
    let left = r.left + r.width / 2;
    if (left - half < EDGE_PADDING) left = half + EDGE_PADDING;
    if (left + half > window.innerWidth - EDGE_PADDING) {
      left = window.innerWidth - half - EDGE_PADDING;
    }
    setPos({ top: r.top - ANCHOR_GAP, left });
  }, []);

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
    <>
      <span
        ref={triggerRef}
        className={cx("inline-flex", className)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        {children}
      </span>
      {open && pos && createPortal(
        <div
          role="tooltip"
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            maxWidth: TOOLTIP_MAX_W,
            transform: "translate(-50%, -100%)",
          }}
          className="pointer-events-none z-9999 whitespace-normal rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-[11px] font-normal leading-snug tracking-normal text-white normal-case shadow-lg shadow-black/40"
        >
          {content}
        </div>,
        document.body,
      )}
    </>
  );
}
