/**
 * Toasts — short floating notices, stacked bottom-right, each gone after
 * ~4 s. For changes the app makes on its own (the Worklist pruning lines as
 * pieces move in-game) or whose result isn't on screen (a build queued from
 * the Builder lands on the Worklist tab).
 *
 * The queue is a tiny external store (`createToastStore`, timers included) so
 * it is testable without a DOM; `useToasts` binds it to React, `ToastStack`
 * renders it. App mounts one stack and calls `notify(text)`.
 */
import { useEffect, useState, useSyncExternalStore } from "react";

/** How long a toast stays up. */
export const TOAST_TTL_MS = 4000;

export interface Toast {
  id: number;
  text: string;
}

export interface ToastStore {
  /** Current toasts, oldest first. Same ref until the queue changes. */
  get: () => readonly Toast[];
  subscribe: (listener: () => void) => () => void;
  /** Show `text`; it dismisses itself after `ttlMs`. */
  notify: (text: string) => void;
  dismiss: (id: number) => void;
  /** Clear the queue and its timers (unmount). */
  dispose: () => void;
}

export function createToastStore(ttlMs: number = TOAST_TTL_MS): ToastStore {
  let toasts: readonly Toast[] = [];
  let nextId = 1;
  const listeners = new Set<() => void>();
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  const emit = () => { for (const l of listeners) l(); };
  const dismiss = (id: number) => {
    const t = timers.get(id);
    if (t != null) { clearTimeout(t); timers.delete(id); }
    if (!toasts.some((x) => x.id === id)) return;
    toasts = toasts.filter((x) => x.id !== id);
    emit();
  };
  return {
    get: () => toasts,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    notify: (text) => {
      const id = nextId++;
      toasts = [...toasts, { id, text }];
      timers.set(id, setTimeout(() => dismiss(id), ttlMs));
      emit();
    },
    dismiss,
    dispose: () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      if (toasts.length === 0) return;
      toasts = [];
      emit();
    },
  };
}

/** One store per component, bound to React. `notify` / `dismiss` are stable. */
export function useToasts() {
  const [store] = useState(createToastStore);
  const toasts = useSyncExternalStore(store.subscribe, store.get);
  useEffect(() => () => store.dispose(), [store]);
  return { toasts, notify: store.notify, dismiss: store.dismiss };
}

/** The stack itself — bottom-right, above the Builder's fixed footer. A click
 *  dismisses a toast early. */
export function ToastStack({ toasts, onDismiss }: { toasts: readonly Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-12 right-4 z-60 flex w-80 flex-col items-end gap-1.5" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onDismiss(t.id)}
          className="pointer-events-auto max-w-full rounded-md border border-cyan-400/30 bg-zinc-950/95 px-3 py-2 text-left text-[11.5px] leading-snug text-white/85 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.8)]"
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}
