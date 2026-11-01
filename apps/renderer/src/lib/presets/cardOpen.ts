/**
 * Open / closed state of the Presets cards under "Expand all" / "Collapse all".
 *
 * The screen holds the last global command (`forced`, numbered by generation);
 * each card holds its own last click (`local`), stamped with the generation it
 * was made under. A click made since the last command wins; a newer command
 * overrides older clicks; with neither, the card's default (an empty preset
 * starts closed). Derived on each render — no effect syncs the two.
 *
 * Both survive a tab switch (sessionStorage, the screen's `useSessionState`):
 * the command under `gs.presets.forced`, the clicks under `gs.presets.open`
 * (card key → open). A new command clears the clicks, so every kept click was
 * made under the kept command (`cardChoice` stamps it with its generation).
 */
import type { PersistedCodec } from "../../hooks/usePersistedState.js";

/** A global command or a card's own click, stamped with a command generation. */
export interface CardOpenCommand {
  open: boolean;
  gen: number;
}

/** Whether a card is open: its own click if made under the latest command
 *  (generation 0 = no command yet), else the command, else `defaultOpen`. */
export function cardOpen(forced: CardOpenCommand | null, local: CardOpenCommand | null, defaultOpen: boolean): boolean {
  const gen = forced?.gen ?? 0;
  if (local && local.gen === gen) return local.open;
  return forced ? forced.open : defaultOpen;
}

/** The command "Expand all" (`open`) / "Collapse all" (`!open`) sets after `prev`. */
export function forceCards(prev: CardOpenCommand | null, open: boolean): CardOpenCommand {
  return { open, gen: (prev?.gen ?? 0) + 1 };
}

/** A card's key in `gs.presets.open`: an in-game preset's num, a local
 *  preset's id. */
export type CardChoices = Record<string, boolean>;

/** A card's kept click as `cardOpen` reads it: made under the current command
 *  (a new command clears the map), null when the card wasn't toggled. */
export function cardChoice(choices: CardChoices, key: string, forced: CardOpenCommand | null): CardOpenCommand | null {
  const open = choices[key];
  return typeof open === "boolean" ? { open, gen: forced?.gen ?? 0 } : null;
}

/** `gs.presets.forced`: a command with a boolean `open` and a whole `gen` of
 *  at least 1, else none. */
export const FORCED_CODEC: PersistedCodec<CardOpenCommand | null> = {
  deserialize: (raw) => {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object") return null;
    const { open, gen } = v as Partial<CardOpenCommand>;
    return typeof open === "boolean" && Number.isInteger(gen) && gen! >= 1 ? { open, gen: gen! } : null;
  },
};

/** `gs.presets.open`: an object read entry by entry — a non-boolean value is
 *  dropped, anything but an object reads as no click. */
export const CHOICES_CODEC: PersistedCodec<CardChoices> = {
  deserialize: (raw) => {
    const v: unknown = JSON.parse(raw);
    const out: CardChoices = {};
    if (!v || typeof v !== "object" || Array.isArray(v)) return out;
    for (const [k, open] of Object.entries(v)) if (typeof open === "boolean") out[k] = open;
    return out;
  },
};

/** The screen's starting command when none is kept for the session: none. A
 *  function (lazy initializer) so a test can seed a command on a static
 *  render. */
export function initialCardCommand(): CardOpenCommand | null {
  return null;
}
