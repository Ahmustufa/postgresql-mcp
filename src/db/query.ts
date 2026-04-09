import { Pool } from 'pg';

/**
 * Returns true only if the SQL statement is a SELECT query.
 * Strips -- line comments and block comments before checking.
 */
export function isSelectQuery(sql: string): boolean {
  const noLineComments = sql.replace(/--[^\n]*/g, '');
  const noBlockComments = noLineComments.replace(/\/\*[\s\S]*?\*\//g, '');
  const firstWord = noBlockComments.trim().split(/\s+/)[0];
  return firstWord?.toUpperCase() === 'SELECT';
}

/**
 * Fetches the list of non-system schema names from the database.
 */
export async function listSchemaNames(pool: Pool): Promise<string[]> {
  const result = await pool.query<{ schema_name: string }>(`
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name NOT IN ('public', 'information_schema')
      AND schema_name NOT LIKE 'pg_%'
    ORDER BY schema_name
  `);
  return result.rows.map((r) => r.schema_name);
}

/**
 * Validates that the given schema exists. Throws if not found.
 */
export async function validateSchema(pool: Pool, schema: string): Promise<void> {
  const schemas = await listSchemaNames(pool);
  if (!schemas.includes(schema)) {
    throw new Error(`Schema not found: ${schema}`);
  }
}

/**
 * Executes a SELECT query inside the specified schema using SET LOCAL search_path.
 * Throws if the SQL is not a SELECT statement.
 */
export async function executeInSchema(
  pool: Pool,
  schema: string,
  sql: string,
  timeoutMs: number,
): Promise<Record<string, unknown>[]> {
  if (!isSelectQuery(sql)) {
    throw new Error('Only SELECT statements are allowed');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL search_path TO "${schema}", public`);
    await client.query(`SET LOCAL statement_timeout = ${timeoutMs}`);
    const result = await client.query(sql);
    await client.query('COMMIT');
    return result.rows as Record<string, unknown>[];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
