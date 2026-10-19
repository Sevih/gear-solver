/**
 * Builder name prompt — in-app replacement for `window.prompt`.
 */
import { useEffect, useState } from "react";

/** Minimal modal prompt replacing `window.prompt`. Esc cancels, Enter
 *  submits, click outside cancels. Single text field; submits the trimmed
 *  value (or the placeholder when blank). Stays in DOM and renders nothing
 *  when `prompt` is null — no Portal needed (parent screen is full-bleed
 *  inside the app shell). */
export function PromptDialog({
  prompt, onClose,
}: {
  prompt: { title: string; placeholder: string; onConfirm: (name: string) => void } | null;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  useEffect(() => {
    if (prompt) setValue("");
  }, [prompt]);
  if (!prompt) return null;
  const submit = () => {
    prompt.onConfirm(value.trim() || prompt.placeholder);
    onClose();
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60" onClick={onClose}>
      <div
        className="w-80 rounded-lg border border-white/10 bg-zinc-900 p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-white/70">{prompt.title}</div>
        <input
          type="text"
          value={value}
          autoFocus
          placeholder={prompt.placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            else if (e.key === "Escape") onClose();
          }}
          className="w-full rounded border border-white/10 bg-black/30 px-2 py-1 text-[12px] text-white placeholder:text-white/55 focus:border-cyan-400/40 focus:outline-none"
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-white/8 px-3 py-1 text-[11px] text-white/70 hover:bg-white/6"
          >Cancel</button>
          <button
            type="button"
            onClick={submit}
            className="rounded border border-cyan-400/40 bg-cyan-500/15 px-3 py-1 text-[11px] text-cyan-100 hover:bg-cyan-500/25"
          >Save</button>
        </div>
      </div>
    </div>
  );
}
