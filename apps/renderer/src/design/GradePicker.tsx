/**
 * Minimum +15 passive grade picker — the five letters C B A S S+, bold, each
 * in the color a piece's card shows it in (`singularityGradeColor`). Shared
 * by Optimizer › +15 passives and Gear › Filter.
 */
import type { GameData } from "@gear-solver/core";
import { cx } from "./cx.js";
import { SINGULARITY_GRADES, singularityGradeColor, type SingularityGrade } from "../lib/singularityPassives.js";

export function GradePicker({ label, value, onChange, game, disabled = false, title }: {
  /** `aria-label` of the group ("Minimum grade for DS DMG+"…). */
  label: string;
  value: SingularityGrade;
  onChange: (grade: SingularityGrade) => void;
  /** Reads the letters' colors from `singularityOptions`; null → the table's
   *  usual colors. */
  game?: Pick<GameData, "singularityOptions"> | null;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <span
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      title={title}
      className={cx("inline-flex h-6 items-center gap-px", disabled && "opacity-40")}
    >
      {SINGULARITY_GRADES.map((g) => {
        const color = singularityGradeColor(g, game);
        const on = g === value;
        return (
          <button
            key={g}
            type="button"
            aria-label={`Grade ${g}`}
            aria-pressed={on}
            disabled={disabled}
            title={disabled ? undefined : `Grade ${g} or better`}
            onClick={() => onChange(g)}
            style={{ color, borderColor: on ? color : "transparent" }}
            className={cx(
              "h-6 min-w-5 rounded-md border px-0.5 text-[10.5px] font-bold transition-opacity disabled:cursor-not-allowed",
              on ? "bg-white/10" : "opacity-55 enabled:hover:opacity-100",
            )}
          >
            {g}
          </button>
        );
      })}
    </span>
  );
}
