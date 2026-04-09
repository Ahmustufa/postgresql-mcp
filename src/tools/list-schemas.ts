import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Pool } from 'pg';
import { listSchemaNames } from '@/db/query';

export function registerListSchemas(server: McpServer, pool: Pool): void {
  server.registerTool(
    'list_schemas',
    {
      description:
        'Lists all tenant schemas in the PostgreSQL database. Excludes system schemas (pg_*, information_schema, public). Call this first to discover available tenant schemas.',
    },
    async () => {
      const schemas = await listSchemaNames(pool);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(schemas, null, 2) }],
      };
    },
  );
}
