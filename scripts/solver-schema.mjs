/**
 * Plain-node twin of the contract-schema check in apps/desktop/src/data-sync.ts
 * (`SUPPORTED_SOLVER_SCHEMA`, `solverSchemaOf`, `schemaRefusal`), for
 * `data/sync.mjs`, which can't import TypeScript. Keep both in sync
 * (apps/desktop/test/data-sync.test.ts checks they agree); the bump rule is
 * documented on the TypeScript constant.
 */

/** Highest `version.json` `schema` this build reads. */
export const SUPPORTED_SOLVER_SCHEMA = 1;

/** Contract schema of a solver `version.json` body: no `schema` field → 1; an
 *  integer ≥ 1 → itself; anything else, or unparsable JSON → null.
 *  @param {string} body @returns {number | null} */
export function solverSchemaOf(body) {
  let v;
  try { v = JSON.parse(body); } catch { return null; }
  if (v == null || typeof v !== "object" || Array.isArray(v)) return null;
  const schema = v.schema;
  if (schema === undefined) return 1;
  return typeof schema === "number" && Number.isInteger(schema) && schema >= 1 ? schema : null;
}

/** Why a `version.json` body can't be used by a build reading up to
 *  `supported`, or null when it can.
 *  @param {string} body @param {number} [supported] @returns {string | null} */
export function schemaRefusal(body, supported = SUPPORTED_SOLVER_SCHEMA) {
  const schema = solverSchemaOf(body);
  if (schema == null) return "outerpedia's game data has an unreadable format";
  if (schema > supported) {
    return `outerpedia's game data uses format ${schema}, this version of gear-solver reads up to format ${supported} — update gear-solver`;
  }
  return null;
}
