/**
 * Path-traversal guard shared by every static mount (server.ts, img-cache.ts,
 * the Vite dev middleware). Electron-free so Vite can import it.
 *
 * A bare `file.startsWith(base)` is not enough: `<base>2/x` and `<base>-old/x`
 * start with `<base>` too, so `..%2F<base-name>2%2Fx` escaped into a sibling
 * directory. The check is on the path RELATIVE to the base instead.
 */
import { isAbsolute, join, normalize, relative, sep } from "node:path";

/** Join `rel` under `base`; null if the result would leave `base`. A leading
 *  `/` in `rel` is treated as relative (URL paths), like `path.join`. */
export function resolveInside(base: string, rel: string): string | null {
  const file = normalize(join(base, rel));
  const r = relative(base, file);
  if (r === ".." || r.startsWith(`..${sep}`) || isAbsolute(r)) return null;
  return file;
}
