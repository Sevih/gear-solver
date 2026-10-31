/**
 * Settings → Logs — the app journal: plugin install lines and every status
 * message (timestamped), newest at the bottom. Copy puts it on the clipboard
 * for a bug report; Clear empties it.
 */
import { useEffect, useState } from "react";
import { LogView } from "../LogView.js";
import { SectionStrip } from "./SettingsControls.js";

export function LogsPane({ lines, onClear }: { lines: string[]; onClear: () => void }) {
  const [copied, setCopied] = useState(false);
  // "Copied" reverts after 2 s — the timer is cleared on unmount.
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(t);
  }, [copied]);
  const copy = () => {
    void navigator.clipboard.writeText(lines.join("\n")).then(() => setCopied(true), () => {});
  };
  const empty = lines.length === 0;
  return (
    <div className="flex flex-col gap-3">
      <SectionStrip title={`Logs (${lines.length} ${lines.length === 1 ? "line" : "lines"})`} />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={copy}
          disabled={empty}
          className="rounded-md border border-white/12 bg-zinc-900 px-3 py-1.5 text-[11px] font-semibold text-zinc-300 hover:bg-white/6 hover:text-white disabled:opacity-40"
        >{copied ? "Copied" : "Copy"}</button>
        <button
          type="button"
          onClick={onClear}
          disabled={empty}
          className="rounded-md border border-white/12 bg-zinc-900 px-3 py-1.5 text-[11px] font-semibold text-zinc-300 hover:bg-white/6 hover:text-white disabled:opacity-40"
        >Clear</button>
      </div>
      {empty
        ? <div className="text-[11.5px] text-zinc-400">No log lines yet.</div>
        : <LogView lines={lines} />}
    </div>
  );
}
