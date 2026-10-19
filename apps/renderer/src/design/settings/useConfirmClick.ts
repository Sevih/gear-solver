/**
 * Settings hooks — the mounted-ref guard for async handlers and the
 * click-twice-to-confirm pattern of the destructive actions.
 */
import { useEffect, useRef, useState } from "react";

/** Second-click window of a destructive button ("Click again to confirm"). */
const CONFIRM_WINDOW_MS = 4000;

/** False once the component unmounted — guards local state set after an
 *  `await` (the action can outlive a tab switch or the modal). */
export function useMountedRef() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  return mounted;
}

/** In-modal confirmation for a destructive button: the first click arms it
 *  (the caller relabels it "Click again to confirm"), a second click within
 *  `CONFIRM_WINDOW_MS` runs the action, otherwise it disarms itself. */
export function useConfirmClick(): readonly [boolean, (run: () => void) => void] {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current != null) clearTimeout(timer.current); }, []);
  const click = (run: () => void) => {
    if (timer.current != null) { clearTimeout(timer.current); timer.current = null; }
    if (armed) { setArmed(false); run(); return; }
    setArmed(true);
    timer.current = setTimeout(() => { timer.current = null; setArmed(false); }, CONFIRM_WINDOW_MS);
  };
  return [armed, click] as const;
}
