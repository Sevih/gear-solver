/**
 * fetchReco — pull a character's build recommendations from the local
 * `/api/reco/:id` proxy (Vite middleware in dev, embedded server in prod, both
 * relaying outerpedia.com). No parsing: the API already returns the structured
 * shape `translateRecoBuild` consumes.
 *
 * The result is a discriminated union so the UI can tell apart the three
 * outcomes the contract distinguishes: a reco exists, the hero simply has none
 * (upstream 404), or the transport failed.
 */
import type { StructuredCharacterReco } from "./translateReco.js";

export type RecoFetch =
  | { status: "ok"; reco: StructuredCharacterReco }
  | { status: "none" }
  | { status: "error"; message: string };

export async function fetchReco(charId: number): Promise<RecoFetch> {
  try {
    const r = await fetch(`/api/reco/${charId}`, { headers: { accept: "application/json" } });
    if (r.status === 404) return { status: "none" };
    if (!r.ok) return { status: "error", message: `HTTP ${r.status}` };
    const reco = (await r.json()) as StructuredCharacterReco;
    // A reco with no builds is effectively "none" for the user.
    if (!reco?.builds || Object.keys(reco.builds).length === 0) return { status: "none" };
    return { status: "ok", reco };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}
