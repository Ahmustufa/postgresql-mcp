# Postgres MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone TypeScript HTTP MCP server exposing read-only PostgreSQL analytics tools (list schemas, list tables, describe table, execute SELECT) to Claude via Streamable HTTP + SSE transport.

**Architecture:** Express + `@modelcontextprotocol/sdk` handle HTTP/MCP protocol; `pg` Pool connects to a private RDS instance; each tool is a focused module that registers itself with the MCP server. Schema switching is done per-query via `SET LOCAL search_path` inside a transaction.

**Tech Stack:** Node.js 22, TypeScript 5.7, `@modelcontextprotocol/sdk` ^1.9, Express 4, `pg` 8, Zod 3, `tsc-alias`, Jest + ts-jest, Docker (node:22-alpine), Nginx, pm2.

---

## File Map

| File | Responsibility |
|------|---------------|
| `src/types/index.ts` | Shared TypeScript interfaces (TableInfo, ColumnInfo, QueryResult) |
| `src/config/env.ts` | Zod-validated env loader — reads `process.env`, throws on invalid |
| `src/db/pool.ts` | `pg.Pool` singleton |
| `src/db/query.ts` | `isSelectQuery` guard + `validateSchema` + `executeInSchema` |
| `src/tools/list-schemas.ts` | Registers `list_schemas` MCP tool |
| `src/tools/list-tables.ts` | Registers `list_tables` MCP tool |
| `src/tools/describe-table.ts` | Registers `describe_table` MCP tool |
| `src/tools/execute-query.ts` | Registers `execute_query` MCP tool |
| `src/server.ts` | `createMcpServer()` + `createApp()` — Express routes + session map |
| `src/index.ts` | Entry point: dotenv → env → DB ping → HTTP listen |
| `src/db/query.spec.ts` | Unit tests: SELECT guard |
| `src/config/env.spec.ts` | Unit tests: env validation |
| `nginx/postgres-mcp.conf` | Nginx reverse proxy template for EC2 |
| `Dockerfile` | Multi-stage build image |
| `.env.example` | Env template (committed) |
| `README.md` | Setup, run, deploy, nginx instructions |

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "postgres-mcp",
  "version": "1.0.0",
  "description": "Read-only PostgreSQL MCP server for Claude analytics",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc && tsc-alias",
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts",
    "test": "jest",
    "test:watch": "jest --watch",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.9.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.7",
    "express": "^4.21.2",
    "pg": "^8.13.3",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/jest": "^29.5.14",
    "@types/node": "^22.13.10",
    "@types/pg": "^8.11.11",
    "jest": "^29.7.0",
    "ts-jest": "^29.2.6",
    "tsc-alias": "^1.8.10",
    "tsx": "^4.19.2",
    "typescript": "^5.7.3"
  },
  "jest": {
    "preset": "ts-jest",
    "testEnvironment": "node",
    "moduleNameMapper": {
      "^@/(.*)$": "<rootDir>/src/$1"
    },
    "testMatch": ["**/*.spec.ts"]
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.spec.ts"]
}
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
dist/
.env
coverage/
*.tsbuildinfo
```

- [ ] **Step 4: Create `.env.example`**

```
DATABASE_URL=postgres://username:password@rds-hostname.internal:5432/dbname
PORT=3000
ALLOWED_ORIGINS=https://claude.ai
MCP_API_KEY=your-secret-api-key-here
QUERY_TIMEOUT_MS=30000
```

- [ ] **Step 5: Install dependencies**

```bash
cd postgres-mcp
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json .gitignore .env.example
git commit -m "chore: project scaffolding — package.json, tsconfig, gitignore"
```

---

## Task 2: Shared types

**Files:**
- Create: `src/types/index.ts`

- [ ] **Step 1: Create `src/types/index.ts`**

```typescript
export interface TableInfo {
  table_name: string;
  row_estimate: number;
}

export interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_nullable: boolean;
  column_default: string | null;
  is_primary_key: boolean;
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  row_count: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add shared TypeScript interfaces"
```

---

## Task 3: Env config with tests

**Files:**
- Create: `src/config/env.ts`
- Create: `src/config/env.spec.ts`

- [ ] **Step 1: Write the failing test** — create `src/config/env.spec.ts`

```typescript
describe('env validation', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('throws when DATABASE_URL is missing', () => {
    delete process.env['DATABASE_URL'];
    process.env['MCP_API_KEY'] = 'test-key';
    process.env['ALLOWED_ORIGINS'] = 'https://claude.ai';
    expect(() => require('@/config/env')).toThrow(/DATABASE_URL/);
  });

  it('throws when MCP_API_KEY is missing', () => {
    process.env['DATABASE_URL'] = 'postgres://localhost:5432/db';
    delete process.env['MCP_API_KEY'];
    process.env['ALLOWED_ORIGINS'] = 'https://claude.ai';
    expect(() => require('@/config/env')).toThrow(/MCP_API_KEY/);
  });

  it('applies default PORT=3000 when not set', () => {
    process.env['DATABASE_URL'] = 'postgres://localhost:5432/db';
    process.env['MCP_API_KEY'] = 'test-key';
    process.env['ALLOWED_ORIGINS'] = 'https://claude.ai';
    delete process.env['PORT'];
    const { env } = require('@/config/env');
    expect(env.PORT).toBe(3000);
  });

  it('applies default QUERY_TIMEOUT_MS=30000 when not set', () => {
    process.env['DATABASE_URL'] = 'postgres://localhost:5432/db';
    process.env['MCP_API_KEY'] = 'test-key';
    process.env['ALLOWED_ORIGINS'] = 'https://claude.ai';
    delete process.env['QUERY_TIMEOUT_MS'];
    const { env } = require('@/config/env');
    expect(env.QUERY_TIMEOUT_MS).toBe(30000);
  });

  it('parses ALLOWED_ORIGINS into an array', () => {
    process.env['DATABASE_URL'] = 'postgres://localhost:5432/db';
    process.env['MCP_API_KEY'] = 'test-key';
    process.env['ALLOWED_ORIGINS'] = 'https://claude.ai,https://example.com';
    const { env } = require('@/config/env');
    expect(env.ALLOWED_ORIGINS).toEqual(['https://claude.ai', 'https://example.com']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/config/env.spec.ts
```

Expected: FAIL — `Cannot find module '@/config/env'`

- [ ] **Step 3: Create `src/config/env.ts`**

```typescript
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  PORT: z.coerce.number().int().positive().default(3000),
  ALLOWED_ORIGINS: z
    .string()
    .min(1, 'ALLOWED_ORIGINS is required')
    .transform((s) => s.split(',').map((o) => o.trim())),
  MCP_API_KEY: z.string().min(1, 'MCP_API_KEY is required'),
  QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const fields = parsed.error.flatten().fieldErrors;
  throw new Error(
    `Invalid environment variables:\n${JSON.stringify(fields, null, 2)}`,
  );
}

export const env = parsed.data;

export type Env = z.infer<typeof envSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/config/env.spec.ts
```

Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/config/env.ts src/config/env.spec.ts
git commit -m "feat: add Zod-validated env config with tests"
```

---

## Task 4: Database pool

**Files:**
- Create: `src/db/pool.ts`

- [ ] **Step 1: Create `src/db/pool.ts`**

```typescript
import { Pool } from 'pg';
import { env } from '@/config/env';

let _pool: Pool | null = null;

export function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return _pool;
}

export async function pingDb(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/db/pool.ts
git commit -m "feat: add pg Pool singleton with ping utility"
```

---

## Task 5: Query executor with SELECT guard — with tests

**Files:**
- Create: `src/db/query.ts`
- Create: `src/db/query.spec.ts`

- [ ] **Step 1: Write the failing tests** — create `src/db/query.spec.ts`

```typescript
import { isSelectQuery } from '@/db/query';

describe('isSelectQuery', () => {
  it('accepts a basic SELECT', () => {
    expect(isSelectQuery('SELECT * FROM users')).toBe(true);
  });

  it('accepts SELECT with leading whitespace', () => {
    expect(isSelectQuery('   SELECT id FROM users')).toBe(true);
  });

  it('accepts lowercase select', () => {
    expect(isSelectQuery('select * from users')).toBe(true);
  });

  it('accepts SELECT after a line comment', () => {
    expect(isSelectQuery('-- get users\nSELECT * FROM users')).toBe(true);
  });

  it('accepts SELECT after a block comment', () => {
    expect(isSelectQuery('/* analytics */ SELECT * FROM users')).toBe(true);
  });

  it('rejects INSERT', () => {
    expect(isSelectQuery('INSERT INTO users VALUES (1)')).toBe(false);
  });

  it('rejects UPDATE', () => {
    expect(isSelectQuery('UPDATE users SET name = $1')).toBe(false);
  });

  it('rejects DELETE', () => {
    expect(isSelectQuery('DELETE FROM users')).toBe(false);
  });

  it('rejects DROP', () => {
    expect(isSelectQuery('DROP TABLE users')).toBe(false);
  });

  it('rejects TRUNCATE', () => {
    expect(isSelectQuery('TRUNCATE users')).toBe(false);
  });

  it('rejects a non-SELECT statement that contains SELECT', () => {
    expect(isSelectQuery('INSERT INTO t SELECT * FROM users')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isSelectQuery('')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/db/query.spec.ts
```

Expected: FAIL — `Cannot find module '@/db/query'`

- [ ] **Step 3: Create `src/db/query.ts`**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/db/query.spec.ts
```

Expected: PASS — all 12 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/db/query.ts src/db/query.spec.ts
git commit -m "feat: add SELECT guard and schema-switching query executor with tests"
```

---

## Task 6: list_schemas tool

**Files:**
- Create: `src/tools/list-schemas.ts`

- [ ] **Step 1: Create `src/tools/list-schemas.ts`**

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Pool } from 'pg';
import { listSchemaNames } from '@/db/query';

export function registerListSchemas(server: McpServer, pool: Pool): void {
  server.tool(
    'list_schemas',
    'Lists all tenant schemas in the PostgreSQL database. Excludes system schemas (pg_*, information_schema, public). Call this first to discover available tenant schemas.',
    {},
    async () => {
      const schemas = await listSchemaNames(pool);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(schemas, null, 2) }],
      };
    },
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/tools/list-schemas.ts
git commit -m "feat: add list_schemas MCP tool"
```

---

## Task 7: list_tables tool

**Files:**
- Create: `src/tools/list-tables.ts`

- [ ] **Step 1: Create `src/tools/list-tables.ts`**

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Pool } from 'pg';
import { z } from 'zod';
import { validateSchema } from '@/db/query';
import { TableInfo } from '@/types';

export function registerListTables(server: McpServer, pool: Pool): void {
  server.tool(
    'list_tables',
    'Lists all tables in a given tenant schema with estimated row counts.',
    {
      schema: z.string().min(1).describe('The tenant schema name (from list_schemas)'),
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
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/tools/list-tables.ts
git commit -m "feat: add list_tables MCP tool"
```

---

## Task 8: describe_table tool

**Files:**
- Create: `src/tools/describe-table.ts`

- [ ] **Step 1: Create `src/tools/describe-table.ts`**

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Pool } from 'pg';
import { z } from 'zod';
import { validateSchema } from '@/db/query';
import { ColumnInfo } from '@/types';

export function registerDescribeTable(server: McpServer, pool: Pool): void {
  server.tool(
    'describe_table',
    'Returns column definitions for a table: name, data type, nullable, default value, and whether it is a primary key.',
    {
      schema: z.string().min(1).describe('The tenant schema name (from list_schemas)'),
      table: z.string().min(1).describe('The table name (from list_tables)'),
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
             AND tc.table_schema  = kcu.table_schema
            WHERE tc.constraint_type = 'PRIMARY KEY'
              AND tc.table_schema  = c.table_schema
              AND tc.table_name   = c.table_name
              AND kcu.column_name = c.column_name
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
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/tools/describe-table.ts
git commit -m "feat: add describe_table MCP tool"
```

---

## Task 9: execute_query tool

**Files:**
- Create: `src/tools/execute-query.ts`

- [ ] **Step 1: Create `src/tools/execute-query.ts`**

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Pool } from 'pg';
import { z } from 'zod';
import { validateSchema, executeInSchema } from '@/db/query';
import { env } from '@/config/env';
import { QueryResult } from '@/types';

export function registerExecuteQuery(server: McpServer, pool: Pool): void {
  server.tool(
    'execute_query',
    'Executes a read-only SELECT SQL statement in the specified tenant schema. Only SELECT statements are permitted.',
    {
      schema: z.string().min(1).describe('The tenant schema name (from list_schemas)'),
      sql: z.string().min(1).describe('A valid PostgreSQL SELECT statement'),
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
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/tools/execute-query.ts
git commit -m "feat: add execute_query MCP tool with SELECT guard"
```

---

## Task 10: MCP server + Express app

**Files:**
- Create: `src/server.ts`

- [ ] **Step 1: Create `src/server.ts`**

```typescript
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { getPool } from '@/db/pool';
import { env } from '@/config/env';
import { registerListSchemas } from '@/tools/list-schemas';
import { registerListTables } from '@/tools/list-tables';
import { registerDescribeTable } from '@/tools/describe-table';
import { registerExecuteQuery } from '@/tools/execute-query';

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'postgres-mcp', version: '1.0.0' });
  const pool = getPool();

  registerListSchemas(server, pool);
  registerListTables(server, pool);
  registerDescribeTable(server, pool);
  registerExecuteQuery(server, pool);

  return server;
}

export function createApp(mcpServer: McpServer): express.Application {
  const app = express();

  app.use(cors({ origin: env.ALLOWED_ORIGINS }));
  app.use(express.json());

  // Health check — no auth required
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Bearer token auth for all /mcp routes
  app.use('/mcp', (req: Request, res: Response, next: NextFunction) => {
    const auth = req.headers['authorization'];
    if (!auth || auth !== `Bearer ${env.MCP_API_KEY}`) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  });

  // Session registry: sessionId → transport
  const transports = new Map<string, StreamableHTTPServerTransport>();

  // POST /mcp — initialize new session or route existing message
  app.post('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports.has(sessionId)) {
      transport = transports.get(sessionId)!;
    } else {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, transport);
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) {
          transports.delete(transport.sessionId);
        }
      };
      await mcpServer.connect(transport);
    }

    await transport.handleRequest(req, res, req.body);
  });

  // GET /mcp — SSE stream for an existing session
  app.get('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    await transports.get(sessionId)!.handleRequest(req, res);
  });

  // DELETE /mcp — close a session
  app.delete('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (sessionId && transports.has(sessionId)) {
      await transports.get(sessionId)!.close();
      transports.delete(sessionId);
    }
    res.status(204).end();
  });

  return app;
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/server.ts
git commit -m "feat: add MCP server registration and Express app with session management"
```

---

## Task 11: Entry point

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Create `src/index.ts`**

```typescript
import 'dotenv/config';
import { env } from '@/config/env';
import { getPool, pingDb } from '@/db/pool';
import { createMcpServer, createApp } from '@/server';

async function main(): Promise<void> {
  // Verify DB connectivity before accepting traffic
  const pool = getPool();
  try {
    await pingDb(pool);
    console.log('Database connection verified');
  } catch (err) {
    console.error('Failed to connect to database:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const mcpServer = createMcpServer();
  const app = createApp(mcpServer);

  app.listen(env.PORT, '127.0.0.1', () => {
    console.log(`Postgres MCP server listening on 127.0.0.1:${env.PORT}`);
  });
}

main().catch((err) => {
  console.error('Startup error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 3: Test build end-to-end**

```bash
npm run build
```

Expected: `dist/` directory created with `index.js` and all compiled files. No TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: add entry point with DB ping and graceful startup"
```

---

## Task 12: Dockerfile and Nginx config

**Files:**
- Create: `Dockerfile`
- Create: `nginx/postgres-mcp.conf`
- Create: `.dockerignore`

- [ ] **Step 1: Create `Dockerfile`**

```dockerfile
# Build stage
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Production stage
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Create `.dockerignore`**

```
node_modules/
dist/
.env
coverage/
docs/
*.md
*.spec.ts
.git/
```

- [ ] **Step 3: Create `nginx/postgres-mcp.conf`**

```nginx
# Postgres MCP Server — Nginx reverse proxy template
# Replace YOUR_DOMAIN with your EC2 public domain or IP
# Copy to: /etc/nginx/sites-available/postgres-mcp
# Enable with: ln -s /etc/nginx/sites-available/postgres-mcp /etc/nginx/sites-enabled/
# Then: nginx -t && systemctl reload nginx

server {
    listen 80;
    server_name YOUR_DOMAIN;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name YOUR_DOMAIN;

    ssl_certificate     /etc/letsencrypt/live/YOUR_DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/YOUR_DOMAIN/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # Required for SSE streaming — disable all buffering
    proxy_buffering    off;
    proxy_cache        off;

    location /mcp {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Connection "keep-alive";
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        # Keep SSE connections alive — MCP sessions can be long-lived
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location /health {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
    }
}
```

- [ ] **Step 4: Commit**

```bash
git add Dockerfile .dockerignore nginx/postgres-mcp.conf
git commit -m "feat: add Dockerfile and nginx reverse proxy config"
```

---

## Task 13: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

```markdown
# postgres-mcp

A read-only PostgreSQL MCP server for Claude analytics. Exposes all tenant schemas via the [Model Context Protocol](https://modelcontextprotocol.io) over HTTP/SSE.

## Available Tools

| Tool | Description |
|------|-------------|
| `list_schemas` | Lists all tenant schemas (excludes system schemas) |
| `list_tables` | Lists tables in a schema with estimated row counts |
| `describe_table` | Returns column definitions for a table |
| `execute_query` | Executes a read-only SELECT query in a schema |

## Prerequisites

- Node.js 22+
- Access to the PostgreSQL RDS instance (VPN/bastion or direct VPC access)

## Local Setup

**1. Clone and install**

```bash
git clone https://github.com/Ahmustufa/postgresql-mcp.git
cd postgresql-mcp
npm install
```

**2. Configure environment**

```bash
cp .env.example .env
```

Edit `.env`:

```env
DATABASE_URL=postgres://username:password@rds-hostname.internal:5432/dbname
PORT=3000
ALLOWED_ORIGINS=https://claude.ai
MCP_API_KEY=your-secret-api-key
QUERY_TIMEOUT_MS=30000
```

**3. Run in development**

```bash
npm run dev
```

**4. Run tests**

```bash
npm test
```

## Build & Run (Production)

```bash
npm run build
npm start
```

The server binds to `127.0.0.1:PORT` — it must be fronted by nginx for external access.

## Docker

**Build:**

```bash
docker build -t postgres-mcp .
```

**Run:**

```bash
docker run -p 3000:3000 --env-file .env postgres-mcp
```

> Note: When running in Docker, the server binds to `0.0.0.0` inside the container. Ensure the container is not exposed directly — use the nginx setup below.

## EC2 Deployment

### 1. Install dependencies on EC2

```bash
sudo apt update && sudo apt install -y nginx nodejs npm
sudo npm install -g pm2
```

### 2. Clone and build

```bash
git clone https://github.com/Ahmustufa/postgresql-mcp.git /opt/postgres-mcp
cd /opt/postgres-mcp
npm ci --omit=dev
cp .env.example .env
# Edit .env with production values
nano .env
npm run build
```

### 3. Start with pm2

```bash
pm2 start dist/index.js --name postgres-mcp
pm2 save
pm2 startup   # follow the printed command to enable auto-start on reboot
```

**Useful pm2 commands:**

```bash
pm2 status          # check running processes
pm2 logs postgres-mcp   # tail logs
pm2 restart postgres-mcp
pm2 stop postgres-mcp
```

### 4. Configure Nginx

```bash
# Replace YOUR_DOMAIN in the config
sudo cp nginx/postgres-mcp.conf /etc/nginx/sites-available/postgres-mcp
sudo nano /etc/nginx/sites-available/postgres-mcp  # set YOUR_DOMAIN

sudo ln -s /etc/nginx/sites-available/postgres-mcp /etc/nginx/sites-enabled/
sudo nginx -t        # verify config
sudo systemctl reload nginx
```

### 5. TLS Certificate (Let's Encrypt)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d YOUR_DOMAIN
```

Certbot auto-renews. After first issue, reload nginx:

```bash
sudo systemctl reload nginx
```

### 6. EC2 Security Group

Ensure port 443 (HTTPS) is open to Claude/internet. Port 3000 must NOT be open — only nginx proxies to it on localhost.

## Connecting Claude

In your Claude MCP settings, add:

```json
{
  "mcpServers": {
    "postgres": {
      "type": "http",
      "url": "https://YOUR_DOMAIN/mcp",
      "headers": {
        "Authorization": "Bearer your-secret-api-key"
      }
    }
  }
}
```

## Security Notes

- Only `SELECT` statements are permitted — all other SQL is rejected
- Schema names are validated against the live schema list before use (prevents injection)
- Raw SQL is never logged — only schema name + query duration
- The Node.js process binds to `127.0.0.1` only; nginx handles TLS and external traffic
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with local dev, Docker, EC2 + nginx deployment instructions"
```

---

## Task 14: Final verification and push

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 3: Run full build**

```bash
npm run build
```

Expected: `dist/` compiled cleanly.

- [ ] **Step 4: Verify dist structure**

```bash
ls dist/
```

Expected output includes: `index.js`, `server.js`, `config/env.js`, `db/pool.js`, `db/query.js`, `tools/list-schemas.js`, `tools/list-tables.js`, `tools/describe-table.js`, `tools/execute-query.js`, `types/index.js`

- [ ] **Step 5: Push to remote**

```bash
git push -u origin master
```

Expected: All commits pushed to `https://github.com/Ahmustufa/postgresql-mcp.git`
