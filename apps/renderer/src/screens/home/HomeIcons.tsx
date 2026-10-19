/**
 * Home icons — section and sub-label icons (inline SVG, currentColor).
 */


// ── section icons (14px, lucide-style strokes) ──────────────────────────
function SIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
export const IC_SNAPSHOT = <SIcon><circle cx="12" cy="8" r="3.6" /><path d="M5 20c0-3.6 3.4-5.5 7-5.5s7 1.9 7 5.5" /></SIcon>;
export const IC_HEALTH = <SIcon><path d="M3 12h3.5l2 6 3.5-13 2.5 9 1.8-4H21" /></SIcon>;
export const IC_QUALITY = <SIcon><path d="M6 3h12l3.5 6L12 21 2.5 9z" /><path d="M2.5 9h19" /><path d="M12 21 8 9l4-6 4 6z" /></SIcon>;
export const IC_ROSTER = <SIcon><circle cx="9" cy="8" r="3.4" /><path d="M3 20c0-3.3 2.7-5 6-5s6 1.7 6 5" /><path d="M16 4.2a3.4 3.4 0 0 1 0 6.6" /><path d="M17.5 15c2 .6 3.5 2.2 3.5 5" /></SIcon>;
export const IC_GEAR = <SIcon><rect x="3.5" y="3.5" width="7" height="7" rx="1.4" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.4" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.4" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.4" /></SIcon>;
export const IC_LIBRARY = <SIcon><path d="M6 3h11a1 1 0 0 1 1 1v17l-6.5-3.6L5 21V4a1 1 0 0 1 1-1z" /></SIcon>;
export const IC_UPDATE = <SIcon><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /></SIcon>;
export const IC_EXPORT = <SIcon><path d="M12 3v12" /><path d="M8 11l4 4 4-4" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></SIcon>;

// ── micro sub-label (11px) for the "By element / class / …" headers ──────
function MIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className="h-2.75 w-2.75 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
export const IC_ELEMENT = <MIcon><path d="M12 3c.6 3.2 3.5 4.4 3.5 7.5a3.5 3.5 0 0 1-7 0c0-1.3.5-2.3 1.3-3.2" /></MIcon>;
export const IC_CLASS = <MIcon><path d="M12 3l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V6z" /></MIcon>;
export const IC_SLOT = <MIcon><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 12h16M12 4v16" /></MIcon>;
export const IC_SETS = <MIcon><path d="M12 3 3 8l9 5 9-5z" /><path d="M3 13l9 5 9-5" /></MIcon>;
