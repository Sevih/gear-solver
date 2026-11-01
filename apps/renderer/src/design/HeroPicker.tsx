/**
 * Hero picker — the one way to pick heroes: `mode="single"` (searchable
 * combobox, the Builder toolbar and Presets' Reference / Associated) and
 * `mode="multi"` (checkbox list, the Builder's "Don't take from…"). Same
 * search (`heroSearchHaystack`), same rows (portrait + displayed name), same
 * keys: ↓ opens, ↑/↓ move, Enter picks (single) or ticks (multi), Escape
 * closes. Callers pass the heroes already sorted (`heroListOrder`).
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Character, GameData } from "@gear-solver/core";
import { effectiveCharacter } from "@gear-solver/core";
import { CharacterPortrait } from "./EquipmentIcon.js";
import { cx } from "./cx.js";
import { displayNameOf, heroMatches } from "../lib/heroes/heroName.js";
import { useClickOutside } from "../screens/builder/useClickOutside.js";

interface CommonProps {
  /** Heroes in display order — already sorted by the caller. */
  heroes: readonly Character[];
  game: GameData | null;
  /** Open on mount (static renders). */
  defaultOpen?: boolean;
}

export type HeroPickerProps = CommonProps & (
  | {
      mode: "single";
      value: string | null;
      onChange: (uid: string | null) => void;
    }
  | {
      mode: "multi";
      values: ReadonlySet<string>;
      onToggle: (uid: string) => void;
      /** Clears every selection — shows a ✕ next to the trigger when set. */
      onClear?: () => void;
      /** Trigger text (closed state). */
      label: string;
      /** Hover text of the trigger. */
      title?: string;
      /** Show « N selected » on the trigger once something is ticked. */
      showCount?: boolean;
    }
);

export function HeroPicker(props: HeroPickerProps) {
  return props.mode === "single" ? <SinglePicker {...props} /> : <MultiPicker {...props} />;
}

/** Search + keyboard highlight shared by both modes. The highlight goes back
 *  to the top whenever the query changes or the popup opens / closes. */
function usePickerList(heroes: readonly Character[], game: GameData | null, defaultOpen: boolean) {
  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const filtered = useMemo(() => heroes.filter((c) => heroMatches(c, game, query)), [heroes, game, query]);
  const [seenList, setSeenList] = useState({ query, open });
  if (seenList.query !== query || seenList.open !== open) { setSeenList({ query, open }); setActiveIdx(0); }
  const wrapRef = useClickOutside<HTMLDivElement>(open, () => setOpen(false));
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optId = (uid: string) => `${baseId}-opt-${uid}`;
  /** ↑/↓ move, Enter fires `onEnter` on the highlighted hero, Escape closes;
   *  ↓ opens a closed popup. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, onEnter: (c: Character) => void) => {
    if (e.key === "Escape") { setOpen(false); return; }
    if (!open) { if (e.key === "ArrowDown") setOpen(true); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); const c = filtered[activeIdx]; if (c) onEnter(c); }
  };
  const activeId = open && filtered[activeIdx] ? optId(filtered[activeIdx]!.uid) : undefined;
  return { open, setOpen, query, setQuery, activeIdx, filtered, wrapRef, listId, optId, onKeyDown, activeId };
}

function SinglePicker({ heroes, game, value, onChange, defaultOpen = false }: CommonProps & { value: string | null; onChange: (uid: string | null) => void }) {
  const { open, setOpen, query, setQuery, activeIdx, filtered, wrapRef, listId, optId, onKeyDown, activeId } = usePickerList(heroes, game, defaultOpen);
  const selected = value ? heroes.find((c) => c.uid === value) ?? null : null;
  const selectedName = selected ? displayNameOf(selected, effectiveCharacter(selected, game?.characters).def) : "";
  const display = open ? query : selectedName;
  const pick = (c: Character) => { onChange(c.uid); setOpen(false); setQuery(""); };
  return (
    <div ref={wrapRef} className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={activeId}
        value={display}
        onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true); }}
        onFocus={() => { setOpen(true); setQuery(""); }}
        onKeyDown={(e) => onKeyDown(e, pick)}
        placeholder={selectedName || "Search hero…"}
        className="w-full rounded-md border border-white/8 bg-black/30 px-2 py-1 text-[11.5px] text-white placeholder:text-white/55 focus:border-cyan-400/40 focus:outline-none"
      />
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-md border border-white/10 bg-zinc-900 shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-2 py-2 text-[11px] italic text-white/65">No hero matches</div>
          ) : (
            <ul id={listId} role="listbox" className="flex flex-col py-1">
              {filtered.map((c, i) => (
                <HeroRow
                  key={c.uid}
                  id={optId(c.uid)}
                  hero={c}
                  game={game}
                  selected={c.uid === value}
                  highlighted={i === activeIdx}
                  onPick={() => pick(c)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function MultiPicker({
  heroes, game, values, onToggle, onClear, label, title, showCount = false, defaultOpen = false,
}: CommonProps & { values: ReadonlySet<string>; onToggle: (uid: string) => void; onClear?: () => void; label: string; title?: string; showCount?: boolean }) {
  const { open, setOpen, query, setQuery, activeIdx, filtered, wrapRef, listId, optId, onKeyDown, activeId } = usePickerList(heroes, game, defaultOpen);
  return (
    // Two sibling buttons inside a flex wrapper instead of a nested
    // <span role="button"> inside the toggle <button> — keeps the clear
    // action valid HTML and keyboard-reachable.
    <div
      ref={wrapRef}
      className="relative flex w-full items-center gap-0 rounded-md border border-white/8 bg-black/30 text-[11px] text-white/70 hover:bg-white/6"
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex min-w-0 flex-1 items-center justify-between gap-1.5 px-2 py-1 text-left focus:outline-none"
        title={title}
      >
        <span className="truncate">{label}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          {showCount && values.size > 0 && <span className="text-cyan-200">{values.size} selected</span>}
          <span className="text-white/55">▾</span>
        </span>
      </button>
      {onClear && values.size > 0 && (
        <button
          type="button"
          onClick={() => onClear()}
          className="px-1.5 py-1 text-white/65 hover:text-rose-300 focus:outline-none"
          title="Clear all"
          aria-label={`Clear: ${label}`}
        >✕</button>
      )}
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 flex max-h-72 flex-col overflow-hidden rounded-md border border-white/10 bg-zinc-900 shadow-lg">
          <input
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-activedescendant={activeId}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => onKeyDown(e, (c) => onToggle(c.uid))}
            autoFocus
            placeholder="Search hero…"
            className="shrink-0 border-b border-white/8 bg-black/30 px-2 py-1 text-[11px] text-white placeholder:text-white/55 focus:outline-none"
          />
          {filtered.length === 0 ? (
            <div className="px-2 py-2 text-[11px] italic text-white/65">No hero matches</div>
          ) : (
            <ul id={listId} role="listbox" aria-multiselectable className="min-h-0 flex-1 overflow-y-auto py-1">
              {filtered.map((c, i) => (
                <HeroRow
                  key={c.uid}
                  id={optId(c.uid)}
                  hero={c}
                  game={game}
                  selected={values.has(c.uid)}
                  highlighted={i === activeIdx}
                  onPick={() => onToggle(c.uid)}
                  checkbox
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** One hero row: portrait (the fused one for a Core Fusion hero) and the
 *  displayed name; a checkbox ahead of them in multi mode. */
function HeroRow({
  id, hero, game, selected, highlighted, onPick, checkbox = false,
}: { id: string; hero: Character; game: GameData | null; selected: boolean; highlighted: boolean; onPick: () => void; checkbox?: boolean }) {
  const { charId: displayCharId, def: meta } = effectiveCharacter(hero, game?.characters);
  const name = displayNameOf(hero, meta);
  const ref = useRef<HTMLLIElement>(null);
  // Keep the keyboard-highlighted option in view as the user arrows through.
  useEffect(() => { if (highlighted) ref.current?.scrollIntoView({ block: "nearest" }); }, [highlighted]);
  const rowClass = cx(
    "flex w-full cursor-pointer items-center gap-2 px-2 py-1 text-left hover:bg-white/6",
    highlighted && "bg-white/8",
    selected && !checkbox && "bg-cyan-500/10",
  );
  const body = (
    <>
      <CharacterPortrait charId={displayCharId} name={name} cls={meta?.cls} element={meta?.element} size={26} />
      <span className="truncate text-[11.5px] text-white">{name}</span>
    </>
  );
  return (
    <li ref={ref} id={id} role="option" aria-selected={selected}>
      {checkbox ? (
        <label className={rowClass}>
          <input
            type="checkbox"
            checked={selected}
            onChange={onPick}
            className="h-3.5 w-3.5 shrink-0 accent-cyan-400"
          />
          {body}
        </label>
      ) : (
        <button type="button" onClick={onPick} className={rowClass}>{body}</button>
      )}
    </li>
  );
}
