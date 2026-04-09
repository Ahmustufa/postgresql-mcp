import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Pool } from 'pg';
import { z } from 'zod/v4';
import { validateSchema, executeInSchema } from '@/db/query';
import { env } from '@/config/env';
import { QueryResult } from '@/types';

const inputSchema = z.object({
  schema: z.string().min(1).describe('The tenant schema name (from list_schemas)'),
  sql: z.string().min(1).describe('A valid PostgreSQL SELECT statement'),
});

export function registerExecuteQuery(server: McpServer, pool: Pool): void {
  server.registerTool(
    'execute_query',
    {
      description:
        'Executes a read-only SELECT SQL statement in the specified tenant schema. Only SELECT statements are permitted.',
      inputSchema,
    },
    async ({ schema, sql }) => {
      await validateSchema(pool, schema);

      const rows = await executeInSchema(pool, schema, sql, env.QUERY_TIMEOUT_MS);

      const result: QueryResult = { rows, row_count: rows.length };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
