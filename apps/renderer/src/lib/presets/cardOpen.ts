/**
 * Open / closed state of the Presets cards under "Expand all" / "Collapse all".
 *
 * The screen holds the last global command (`forced`, numbered by generation);
 * each card holds its own last click (`local`), stamped with the generation it
 * was made under. A click made since the last command wins; a newer command
 * overrides older clicks; with neither, the card's default (an empty preset
 * starts closed). Derived on each render — no effect syncs the two.
 */

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

/** The screen's starting command: none. A function (lazy `useState`
 *  initializer) so a test can seed a command on a static render. */
export function initialCardCommand(): CardOpenCommand | null {
  return null;
}
