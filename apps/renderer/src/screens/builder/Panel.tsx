/**
 * Builder panel frame — the titled card every Builder panel renders in.
 */
import type { ReactNode } from "react";
import { cx } from "../../design/cx.js";
import { HoverHint } from "../../design/HoverHint.js";

export function Panel({ title, hint, hintWidth, action, children, width }: {
  title: string;
  hint?: ReactNode;
  /** Popover max width for the hint — bump for long explanatory copy. */
  hintWidth?: number;
  /** Optional small trailing element rendered next to the title (e.g. a
   *  "clear" link for the Substat priority panel). */
  action?: ReactNode;
  children: ReactNode;
  /** Tailwind width class — most panels are 36 or 44, the Stat/Rating
   *  filters need more headroom. */
  width: string;
}) {
  return (
    <section className={cx("shrink-0 rounded-lg border border-white/8 bg-bg-elev-2 p-2", width)}>
      <header className="flex items-center justify-between gap-1">
        {hint ? (
          <HoverHint
            className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/70"
            name={title}
            text={hint}
            maxWidth={hintWidth}
          />
        ) : (
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/70">{title}</span>
        )}
        {action}
      </header>
      <div className="mt-1.5">{children}</div>
    </section>
  );
}
