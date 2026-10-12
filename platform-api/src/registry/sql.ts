import { badRequest } from "../http/errors";

/**
 * Builds a parameterized UPDATE from a camelCase body using an explicit
 * camelCase -> column allowlist. jsonb columns must receive stringified JSON.
 */
export function buildPatch(
  table: string,
  id: string,
  body: Record<string, unknown>,
  columnMap: Record<string, string>,
  jsonColumns: readonly string[] = [],
): { text: string; values: unknown[] } {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of Object.entries(columnMap)) {
    if (!(key in body) || body[key] === undefined) continue;
    values.push(jsonColumns.includes(column) ? JSON.stringify(body[key]) : body[key]);
    sets.push(`${column} = $${values.length}`);
  }
  if (sets.length === 0) throw badRequest("no updatable fields in request body");
  values.push(id);
  return {
    text: `UPDATE ${table} SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`,
    values,
  };
}
