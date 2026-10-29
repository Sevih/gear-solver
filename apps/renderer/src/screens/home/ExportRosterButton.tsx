/**
 * Home roster export — the hero-tracker export button.
 */
import { useEffect, useState } from "react";
import type { GameData, Inventory } from "@gear-solver/core";
import { cx } from "../../design/cx.js";
import { buildHeroTrackerExport } from "../../lib/heroTracker.js";
import { localDateStamp } from "../../lib/dateStamp.js";
import { IC_EXPORT } from "./HomeIcons.js";

/** "Export" affordance in the Roster header — writes the captured progression
 *  (levels, skills, affinity, transcend, EE, core fusion) as an
 *  `outerpedia:hero-tracker` JSON the planner imports. Progression only: no
 *  gear, no stats, no inventory. Flashes "Saved" so the click has feedback
 *  even though the download itself is silent. */
export function ExportRosterButton({ inventory, game }: { inventory: Inventory | null; game: GameData | null }) {
  const [flash, setFlash] = useState<"idle" | "done" | "error">("idle");
  useEffect(() => {
    if (flash === "idle") return;
    const t = setTimeout(() => setFlash("idle"), 2200);
    return () => clearTimeout(t);
  }, [flash]);

  // Both are required: the roster comes from the capture, the level/affinity
  // curves from the game data. Missing either → nothing meaningful to write.
  const count = inventory && game ? inventory.characters.length : 0;
  const onClick = () => {
    if (!inventory || !game) return;
    try {
      const doc = buildHeroTrackerExport(inventory, game);
      const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `outerpedia-roster-${localDateStamp(Date.now())}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke on the next tick so the click has consumed the URL.
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setFlash("done");
    } catch (err) {
      console.warn("roster export failed:", err);
      setFlash("error");
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={count === 0}
      title={count === 0 ? "Capture your account first" : `Export ${count} heroes as a hero-tracker JSON`}
      className={cx(
        "flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] transition-colors",
        count === 0
          ? "cursor-not-allowed border-white/7 text-zinc-600"
          : flash === "done"
            ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300"
            : flash === "error"
              ? "border-rose-400/40 bg-rose-500/10 text-rose-300"
              : "border-white/10 bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200",
      )}
    >
      <span className="[&_svg]:h-3 [&_svg]:w-3">{IC_EXPORT}</span>
      {flash === "done" ? "Saved" : flash === "error" ? "Failed" : "Export"}
    </button>
  );
}
