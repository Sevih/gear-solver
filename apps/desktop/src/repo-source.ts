/**
 * Outerpedia repo source — single source of truth for fetching game data and
 * image assets from the public GitHub repo `Sevih/outerpediaV2`, so the app
 * stays current with game patches WITHOUT shipping a new build.
 *
 * Electron-free on purpose (no `electron` / path constants imported) so the
 * Vite dev middleware (apps/renderer/vite.config.ts) can import it without
 * pulling in Electron — same constraint as reco-proxy.ts. All disk paths are
 * passed in by the caller.
 *
 * Asset delivery is pinned to an immutable commit SHA (resolved once per
 * launch via the GitHub API) so jsDelivr URLs are infinitely cacheable and the
 * data build + image fetches always agree on the same repo snapshot.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const REPO_OWNER = "Sevih";
const REPO_NAME = "outerpediaV2";

/** Branch used to resolve the latest commit SHA. Override for a staging branch. */
const REPO_REF = process.env.OUTERPEDIA_REF ?? "main";
/** jsDelivr `gh` base. Override to point at a mirror / self-hosted CDN. */
const CDN_BASE = process.env.OUTERPEDIA_CDN_BASE ?? "https://cdn.jsdelivr.net/gh";
/** raw.githubusercontent base — transport fallback when jsDelivr 5xx/429s. */
const RAW_BASE = process.env.OUTERPEDIA_RAW_BASE ?? "https://raw.githubusercontent.com";

/** jsDelivr URL for a repo file pinned to `ref` (a commit SHA, tag or branch). */
export function cdnUrl(ref: string, relPath: string): string {
  return `${CDN_BASE}/${REPO_OWNER}/${REPO_NAME}@${ref}/${relPath}`;
}

/** raw.githubusercontent URL — used as a fallback when jsDelivr is unavailable. */
export function rawUrl(ref: string, relPath: string): string {
  return `${RAW_BASE}/${REPO_OWNER}/${REPO_NAME}/${ref}/${relPath}`;
}

export interface RepoFetch {
  /** HTTP status of the winning attempt, or 0 on total transport failure. */
  status: number;
  /** Body bytes on a 200, else null. */
  buf: Buffer | null;
}

/**
 * Fetch a single repo file. Tries jsDelivr first (proper CDN, best caching),
 * then falls back to raw.githubusercontent on a 5xx/429/transport failure.
 *  - 200      → { status: 200, buf }
 *  - 404      → { status: 404, buf: null }   (meaningful: file absent in repo)
 *  - anything → { status, buf: null }         (caller decides fallback)
 */
export async function fetchRepoFile(ref: string, relPath: string, timeoutMs = 10_000): Promise<RepoFetch> {
  const attempt = async (url: string): Promise<RepoFetch | "retry"> => {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (r.ok) return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) };
      // 404 is a definitive "not in repo" — don't bother with the other host.
      if (r.status === 404) return { status: 404, buf: null };
      return "retry"; // 5xx / 429 / etc. → try the other host
    } catch {
      return "retry"; // transport error / timeout → try the other host
    }
  };

  const first = await attempt(cdnUrl(ref, relPath));
  if (first !== "retry") return first;
  const second = await attempt(rawUrl(ref, relPath));
  if (second !== "retry") return second;
  return { status: 0, buf: null };
}

/**
 * Resolve the latest commit SHA on the configured branch via the GitHub API
 * (one request; unauth limit is 60/hr per IP). Returns null on any failure —
 * network error, non-200, or 403 rate-limit — so callers degrade gracefully to
 * the last cached SHA / cached assets. `accept: application/vnd.github.sha`
 * makes the API return the bare 40-char SHA as text (cheapest response).
 */
export async function resolveLatestSha(timeoutMs = 5_000): Promise<string | null> {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits/${REPO_REF}`, {
      headers: { accept: "application/vnd.github.sha", "user-agent": "gear-solver" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return null;
    const sha = (await r.text()).trim();
    return /^[0-9a-f]{40}$/i.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

/**
 * List every blob path in the repo at `ref` via the GitHub trees API (one
 * request). Returns null on failure. The tree may be flagged `truncated` for
 * very large repos — we return whatever came back (best-effort; used only to
 * warm the image cache, which also works on demand). Used sparingly (once per
 * repo update), so it stays well under the 60/hr unauth API budget.
 */
export async function listRepoTree(ref: string, timeoutMs = 15_000): Promise<string[] | null> {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/${ref}?recursive=1`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "gear-solver" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { tree?: Array<{ path?: string; type?: string }> };
    if (!Array.isArray(j.tree)) return null;
    return j.tree.filter((e) => e.type === "blob" && typeof e.path === "string").map((e) => e.path!);
  } catch {
    return null;
  }
}

export interface ShaState {
  sha: string;
  resolvedAt: number;
}

/** Read the persisted SHA state. Best-effort — returns null on any error. */
export function readShaState(file: string): ShaState | null {
  try {
    if (!existsSync(file)) return null;
    const s = JSON.parse(readFileSync(file, "utf-8")) as Partial<ShaState>;
    return typeof s.sha === "string" ? { sha: s.sha, resolvedAt: s.resolvedAt ?? 0 } : null;
  } catch {
    return null;
  }
}

/** Persist the SHA state. Best-effort — swallows write errors. */
export function writeShaState(file: string, sha: string): void {
  try {
    writeFileSync(file, JSON.stringify({ sha, resolvedAt: Date.now() } satisfies ShaState));
  } catch {
    /* best-effort */
  }
}

// Process-wide "ref" pin shared by the image handler and the data sync so both
// hit the SAME repo snapshot (an icon referenced by freshly-synced
// equipment.json always resolves against the matching commit). Defaults to the
// branch name, which jsDelivr resolves server-side — correct but less cacheable
// than a pinned SHA, so startup overwrites it with the resolved/cached SHA.
let currentRef = REPO_REF;
export function setCurrentRef(ref: string): void {
  currentRef = ref;
}
export function getCurrentRef(): string {
  return currentRef;
}
