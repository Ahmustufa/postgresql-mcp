import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Pool } from 'pg';
import { z } from 'zod/v4';
import { validateSchema } from '@/db/query';
import { TableInfo } from '@/types';

const inputSchema = z.object({
  schema: z.string().min(1).describe('The tenant schema name (from list_schemas)'),
});

export function registerListTables(server: McpServer, pool: Pool): void {
  server.registerTool(
    'list_tables',
    {
      description: 'Lists all tables in a given tenant schema with estimated row counts.',
      inputSchema,
    },
    async ({ schema }) => {
      await validateSchema(pool, schema);

      const result = await pool.query<TableInfo>(
        `
        SELECT
          t.table_name,
          COALESCE(s.n_live_tup, 0)::int AS row_estimate
        FROM information_schema.tables t
        LEFT JOIN pg_stat_user_tables s
          ON s.schemaname = t.table_schema AND s.relname = t.table_name
        WHERE t.table_schema = $1
          AND t.table_type = 'BASE TABLE'
        ORDER BY t.table_name
        `,
        [schema],
      );

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result.rows, null, 2) }],
      };
    },
  );
}
