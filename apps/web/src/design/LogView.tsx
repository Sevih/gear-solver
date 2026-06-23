/**
 * Streaming log viewer for the capture / disarm pipelines.
 *
 * Parses the line prefixes emitted by capture.ps1 / disarm.ps1 (see the
 * `Info` / `Ok` / `Die` / `Warn` PowerShell helpers in tools/capture/) and
 * colors them in the renderer — ANSI sequences don't survive the spawn
 * pipe from PowerShell to Node's child stdout, so we re-do the coloring
 * client-side based on the textual prefix conventions.
 *
 * Also auto-scrolls to bottom on every new line so the user sees the
 * freshest event without manual scrolling.
 */
import { useEffect, useRef } from "react";
import { cx } from "./cx.js";

/** Per-prefix tone table — order matters only for tied prefixes; today every
 *  prefix is unique. Keep in sync with the PowerShell helpers if a new tone
 *  gets introduced. */
const TONES: Array<{ prefix: string; className: string }> = [
  { prefix: "v  ", className: "text-emerald-300" },  // Ok
  { prefix: "x  ", className: "text-rose-300" },     // Die
  { prefix: "!  ", className: "text-amber-200" },    // Warn
  { prefix: ">  ", className: "text-cyan-300" },     // Info
];

function lineTone(line: string): string {
  for (const t of TONES) if (line.startsWith(t.prefix)) return t.className;
  // streamCapture.ts surfaces transport failures as `[client] ...` lines;
  // the embedded server prefixes its synthetic error lines with `[spawn
  // error]` / `[detect error]`. Show all three in the error tone so the
  // user can spot them in the wall of normal text.
  if (line.startsWith("[client] ") || line.startsWith("[spawn error]") || line.startsWith("[detect error]")) {
    return "text-rose-300";
  }
  // `__EXIT__:N` is the sentinel streamCapture strips, but if it ever leaks
  // through (e.g. a buffered partial flush) we don't want it shouting in the
  // user's face — dim it.
  if (line.startsWith("__EXIT__")) return "text-zinc-600";
  return "text-zinc-400";
}

interface Props {
  lines: string[];
}

export function LogView({ lines }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);
  return (
    <div
      ref={ref}
      className="max-h-48 overflow-y-auto rounded-md border border-white/7 bg-black/40 p-2 font-mono text-[10.5px] leading-relaxed"
    >
      {lines.map((line, i) => (
        <div key={i} className={cx("whitespace-pre", lineTone(line))}>
          {/* Non-breaking space keeps blank lines visible (otherwise the div
              collapses to 0 height and the spacing the script intended
              disappears). */}
          {line || " "}
        </div>
      ))}
    </div>
  );
}
