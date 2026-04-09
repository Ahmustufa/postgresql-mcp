import 'dotenv/config';
import { env } from '@/config/env';
import { getPool, pingDb } from '@/db/pool';
import { createMcpServer, createApp } from '@/server';

async function main(): Promise<void> {
  const pool = getPool();

  try {
    await pingDb(pool);
    console.log('Database connection verified');
  } catch (err) {
    console.error(
      'Failed to connect to database:',
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  }

  const mcpServer = createMcpServer();
  const app = createApp(mcpServer);

  // Bind to all interfaces — ALB forwards traffic to EC2's private IP directly.
  // EC2 security group restricts inbound to ALB SG only.
  app.listen(env.PORT, '0.0.0.0', () => {
    console.log(`Postgres MCP server listening on 0.0.0.0:${env.PORT}`);
  });
}

main().catch((err) => {
  console.error('Startup error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
