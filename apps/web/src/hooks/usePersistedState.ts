/**
 * usePersistedState — useState that mirrors its value into localStorage so the
 * setting survives a page reload. Optional `codec` lets callers override the
 * default JSON (de)serialization for shapes containing Maps/Sets/Dates.
 *
 * The initial value is only used when nothing's stored under `key` (first
 * visit) or when deserialization throws (storage poisoned by a stale schema —
 * we fall back to defaults rather than crash the screen).
 */
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

export interface PersistedCodec<T> {
  serialize?: (v: T) => string;
  deserialize?: (raw: string) => T;
}

export function usePersistedState<T>(
  key: string,
  initial: T | (() => T),
  codec?: PersistedCodec<T>,
): [T, Dispatch<SetStateAction<T>>] {
  // Hold the codec in a ref so callers can inline `{serialize, deserialize}`
  // each render without triggering the persist effect on every render.
  const codecRef = useRef(codec);
  codecRef.current = codec;

  const [value, setValue] = useState<T>(() => {
    try {
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
      if (raw != null) {
        const des = codecRef.current?.deserialize ?? (JSON.parse as (s: string) => T);
        return des(raw);
      }
    } catch {
      // fall through to defaults — keeps the screen mounting on stale schemas
    }
    return typeof initial === "function" ? (initial as () => T)() : initial;
  });

  useEffect(() => {
    try {
      const ser = codecRef.current?.serialize ?? (JSON.stringify as (v: T) => string);
      if (typeof localStorage !== "undefined") localStorage.setItem(key, ser(value));
    } catch {
      // localStorage full / disabled — silently skip persistence
    }
  }, [key, value]);

  return [value, setValue];
}

/** Codec factory for shapes mixing JSON-safe fields with Set<string>-typed
 *  fields. Pass the list of Set-keyed fields; everything else round-trips
 *  through JSON.stringify/parse as-is. We don't constrain `T extends Record<…>`
 *  because TS interfaces lack the implicit index signature that constraint
 *  would require — accepting any `T` keeps call sites ergonomic. */
export function jsonWithSets<T>(setFields: (keyof T & string)[]): PersistedCodec<T> {
  return {
    serialize: (v: T) => {
      const src = v as Record<string, unknown>;
      const out: Record<string, unknown> = { ...src };
      for (const k of setFields) {
        const s = src[k];
        if (s instanceof Set) out[k] = [...s];
      }
      return JSON.stringify(out);
    },
    deserialize: (raw: string) => {
      const o = JSON.parse(raw) as Record<string, unknown>;
      // Always materialize the declared Set fields, even when missing from
      // storage — older sessions saved before a field was added would
      // otherwise leave it `undefined`, blowing up downstream `.size`/`.has`
      // accesses with `Cannot read properties of undefined`.
      for (const k of setFields) {
        const arr = o[k];
        o[k] = Array.isArray(arr) ? new Set(arr) : new Set();
      }
      return o as T;
    },
  };
}
