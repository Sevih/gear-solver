/**
 * Builder popover helper — closes a popover on an outside click.
 */
import { useEffect, useRef } from "react";

/** Close-on-outside-click for a popup. Returns a ref to attach to the wrapper;
 *  while `active`, a `mousedown` outside the wrapper fires `onOutside`. The
 *  callback is held in a ref so the effect only re-subscribes when `active`
 *  flips (not on every render when the caller passes an inline closure). */
export function useClickOutside<T extends HTMLElement>(active: boolean, onOutside: () => void) {
  const ref = useRef<T | null>(null);
  const cb = useRef(onOutside);
  cb.current = onOutside;
  useEffect(() => {
    if (!active) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cb.current();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [active]);
  return ref;
}
