import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Pool } from 'pg';
import { z } from 'zod/v4';
import { validateSchema } from '@/db/query';
import { ColumnInfo } from '@/types';

const inputSchema = z.object({
  schema: z.string().min(1).describe('The tenant schema name (from list_schemas)'),
  table: z.string().min(1).describe('The table name (from list_tables)'),
});

export function registerDescribeTable(server: McpServer, pool: Pool): void {
  server.registerTool(
    'describe_table',
    {
      description:
        'Returns column definitions for a table: name, data type, nullable, default value, and whether it is a primary key.',
      inputSchema,
    },
    async ({ schema, table }) => {
      await validateSchema(pool, schema);

      const result = await pool.query<ColumnInfo>(
        `
        SELECT
          c.column_name,
          c.data_type,
          (c.is_nullable = 'YES') AS is_nullable,
          c.column_default,
          EXISTS (
            SELECT 1
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema    = kcu.table_schema
            WHERE tc.constraint_type = 'PRIMARY KEY'
              AND tc.table_schema    = c.table_schema
              AND tc.table_name      = c.table_name
              AND kcu.column_name    = c.column_name
          ) AS is_primary_key
        FROM information_schema.columns c
        WHERE c.table_schema = $1
          AND c.table_name   = $2
        ORDER BY c.ordinal_position
        `,
        [schema, table],
      );

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result.rows, null, 2) }],
      };
    },
  );
}
