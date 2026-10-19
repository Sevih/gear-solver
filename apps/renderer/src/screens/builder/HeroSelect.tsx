/**
 * Builder hero picker — searchable hero dropdown of the toolbar.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Character, GameData, Inventory } from "@gear-solver/core";
import { effectiveCharacter } from "@gear-solver/core";
import { CharacterPortrait } from "../../design/EquipmentIcon.js";
import { cx } from "../../design/cx.js";
import { useClickOutside } from "./useClickOutside.js";
import { displayNameOf, heroSearchHaystack } from "./heroName.js";

/** Searchable hero combobox (kept compact for the Hero panel — input fits
 *  inside w-44 with room for the portrait below). Escape closes the popup. */
export function HeroSelect({
  heroes, game, value, onChange,
}: {
  heroes: Inventory["characters"];
  game: GameData | null;
  value: string | null;
  onChange: (uid: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Keyboard-highlighted option index (distinct from the currently-selected
  // `value`). Reset to the top whenever the list changes or the popup opens.
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useClickOutside<HTMLDivElement>(open, () => setOpen(false));
  const selected = value ? heroes.find((c) => c.uid === value) ?? null : null;
  const selectedName = selected ? displayNameOf(selected, effectiveCharacter(selected, game?.characters).def) : "";
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return heroes;
    return heroes.filter((c) => heroSearchHaystack(c, game).includes(q));
  }, [heroes, game, query]);
  useEffect(() => { setActiveIdx(0); }, [query, open]);
  const display = open ? query : selectedName;
  const pick = (c: Character | undefined) => {
    if (!c) return;
    onChange(c.uid); setOpen(false); setQuery("");
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { setOpen(false); return; }
    if (!open) { if (e.key === "ArrowDown") setOpen(true); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); pick(filtered[activeIdx]); }
  };
  const activeId = open && filtered[activeIdx] ? `hero-opt-${filtered[activeIdx]!.uid}` : undefined;
  return (
    <div ref={wrapRef} className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls="hero-listbox"
        aria-activedescendant={activeId}
        value={display}
        onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true); }}
        onFocus={() => { setOpen(true); setQuery(""); }}
        onKeyDown={onKeyDown}
        placeholder={selectedName || "Search hero…"}
        className="w-full rounded-md border border-white/8 bg-black/30 px-2 py-1 text-[11.5px] text-white placeholder:text-white/55 focus:border-cyan-400/40 focus:outline-none"
      />
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-md border border-white/10 bg-zinc-900 shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-2 py-2 text-[11px] italic text-white/65">No hero matches</div>
          ) : (
            <ul id="hero-listbox" role="listbox" className="flex flex-col py-1">
              {filtered.map((c, i) => (
                <HeroOption
                  key={c.uid}
                  id={`hero-opt-${c.uid}`}
                  hero={c}
                  game={game}
                  active={c.uid === value}
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

function HeroOption({
  id, hero, game, active, highlighted, onPick,
}: { id: string; hero: Character; game: GameData | null; active: boolean; highlighted: boolean; onPick: () => void }) {
  const { charId: displayCharId, def: meta } = effectiveCharacter(hero, game?.characters);
  const name = displayNameOf(hero, meta);
  const ref = useRef<HTMLLIElement>(null);
  // Keep the keyboard-highlighted option in view as the user arrows through.
  useEffect(() => { if (highlighted) ref.current?.scrollIntoView({ block: "nearest" }); }, [highlighted]);
  return (
    <li ref={ref} id={id} role="option" aria-selected={active}>
      <button
        type="button"
        onClick={onPick}
        className={cx(
          "flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-white/6",
          highlighted && "bg-white/8",
          active && "bg-cyan-500/10",
        )}
      >
        <CharacterPortrait
          charId={displayCharId}
          name={name}
          cls={meta?.cls}
          element={meta?.element}
          size={26}
        />
        <span className="truncate text-[11.5px] text-white">{name}</span>
      </button>
    </li>
  );
}
