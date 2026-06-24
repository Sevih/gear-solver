/**
 * Renders an in-game text snippet, parsing the Unity-style rich tags the
 * game embeds in its locale tables:
 *   - `<color=#hex>…</color>`   → `<span style="color: #hex">…</span>`
 *   - literal `\n` / `\r\n` / `\n`  → `<br />`
 *
 * Ported (slimmed) from outerpedia-v2's EquipmentDetailInteractive `GameText`
 * helper. Source strings come from TextSkill / TextItem etc. via the data
 * pipeline — both the original game wraps (e.g. Singularity grade colors,
 * dynamic value highlights) and the build-time substitutions
 * (`<color=#28d9ed>…</color>` around resolved `[Value]/[Rate]/[Turn]`
 * placeholders) flow through the same parser.
 *
 * Hex tolerates 6 or 8 hex chars (game sometimes encodes alpha) and we slice
 * to the first 6 — the alpha byte is rarely meaningful for plain text.
 */
import { memo } from "react";

const COLOR_RE = /<color=#([0-9a-fA-F]{6,8})>([\s\S]*?)<\/color>/g;
const LINE_BREAK_RE = /\\n|\r\n|\n/;

function pushPlain(out: React.ReactNode[], s: string, keyBase: number): number {
  let k = keyBase;
  const segs = s.split(LINE_BREAK_RE);
  for (let i = 0; i < segs.length; i++) {
    if (i > 0) out.push(<br key={`b${k++}`} />);
    if (segs[i]) out.push(<span key={`t${k++}`}>{segs[i]}</span>);
  }
  return k;
}

export const GameText = memo(function GameText({
  text, className,
}: { text: string; className?: string }) {
  const out: React.ReactNode[] = [];
  let last = 0;
  let k = 0;
  COLOR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = COLOR_RE.exec(text)) !== null) {
    if (m.index > last) k = pushPlain(out, text.slice(last, m.index), k);
    out.push(
      <span key={`c${k++}`} style={{ color: `#${(m[1] ?? "").slice(0, 6)}`, fontWeight: 700 }}>
        {m[2]}
      </span>
    );
    last = COLOR_RE.lastIndex;
  }
  if (last < text.length) k = pushPlain(out, text.slice(last), k);
  return <span className={className}>{out}</span>;
});
