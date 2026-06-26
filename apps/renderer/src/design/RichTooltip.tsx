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
  /** Where the popover sits relative to the trigger. `"top"` (default) centers
   *  it above; `"right"` puts it to the right (flipping to the left if it would
   *  overflow). Use `"right"` inside dense vertical lists where an above/below
   *  popover would cover the neighbouring rows. */
  placement?: "top" | "right";
}

const TOOLTIP_MAX_W = 320;
const EDGE_PADDING = 8;
const ANCHOR_GAP = 6;

export function RichTooltip({ content, children, className, placement = "top" }: Props) {
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; transform: string } | null>(null);

  const recompute = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();

    if (placement === "right") {
      // Measured once the popover has mounted (0 on the first pass — the rAF
      // below re-runs with real dimensions so the vertical clamp kicks in).
      const popW = popRef.current?.offsetWidth ?? TOOLTIP_MAX_W;
      const popH = popRef.current?.offsetHeight ?? 0;
      let left = r.right + ANCHOR_GAP;
      let transform = "translate(0, -50%)";
      // Flip to the left side when there isn't room on the right.
      if (left + popW > window.innerWidth - EDGE_PADDING) {
        left = r.left - ANCHOR_GAP;
        transform = "translate(-100%, -50%)";
      }
      let top = r.top + r.height / 2;
      const half = popH / 2;
      if (half > 0) {
        if (top - half < EDGE_PADDING) top = EDGE_PADDING + half;
        if (top + half > window.innerHeight - EDGE_PADDING) top = window.innerHeight - EDGE_PADDING - half;
      }
      setPos({ top, left, transform });
      return;
    }

    // default: centered above the trigger
    const half = TOOLTIP_MAX_W / 2;
    let left = r.left + r.width / 2;
    if (left - half < EDGE_PADDING) left = half + EDGE_PADDING;
    if (left + half > window.innerWidth - EDGE_PADDING) {
      left = window.innerWidth - half - EDGE_PADDING;
    }
    setPos({ top: r.top - ANCHOR_GAP, left, transform: "translate(-50%, -100%)" });
  }, [placement]);

  useLayoutEffect(() => {
    if (!open) return;
    recompute();
    // Second pass after the popover paints so right-placement can read its real
    // height and clamp vertically (first pass runs with popH = 0).
    const raf = requestAnimationFrame(recompute);
    const handle = () => recompute();
    window.addEventListener("scroll", handle, true);
    window.addEventListener("resize", handle);
    return () => {
      cancelAnimationFrame(raf);
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
          ref={popRef}
          role="tooltip"
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            maxWidth: TOOLTIP_MAX_W,
            transform: pos.transform,
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
