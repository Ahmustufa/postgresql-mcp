# Postgres MCP Server — Design Spec

**Date:** 2026-04-09
**Status:** Approved

---

## Overview

A standalone TypeScript HTTP MCP server that gives Claude read-only SQL access to all tenant schemas in the FertiAI PostgreSQL database for analytics purposes. Deployed on an EC2 bastion host with access to a private RDS instance via VPC.

---

## Goals

- Expose PostgreSQL data to Claude via the Model Context Protocol (MCP)
- Support all tenant schemas with runtime schema selection via user/Claude input
- Read-only: only `SELECT` statements are permitted
- Secrets stored in `.env` file, never hardcoded
- Fully typed TypeScript with strict mode, `@/*` alias for `src/`
- HTTP transport (Streamable HTTP + SSE) for EC2 deployment

---

## Non-Goals

- Write operations (INSERT, UPDATE, DELETE, DDL)
- Query result caching
- Per-tenant authentication or row-level security
- stdio transport

---

## Architecture

Standalone Node.js project inside `postgres-mcp/`, independent from the NestJS monorepo. Uses `@modelcontextprotocol/sdk` for protocol compliance, Express for HTTP transport, and `pg` (node-postgres) for database access.

### Project Structure

```
postgres-mcp/
├── src/
│   ├── index.ts                  # Entry point — starts HTTP server
│   ├── server.ts                 # MCP server registration, tool binding
│   ├── config/
│   │   └── env.ts                # Zod-validated env loader
│   ├── db/
│   │   ├── pool.ts               # pg Pool singleton
│   │   └── query.ts              # Query executor: schema switching + SELECT guard
│   ├── tools/
│   │   ├── list-schemas.ts       # Tool: list all tenant schemas
│   │   ├── list-tables.ts        # Tool: list tables in a schema
│   │   ├── describe-table.ts     # Tool: describe columns of a table
│   │   └── execute-query.ts      # Tool: execute a SELECT query in a schema
│   └── types/
│       └── index.ts              # Shared TypeScript interfaces
├── .env                          # Secrets (not committed)
├── .env.example                  # Template (committed)
├── package.json
├── tsconfig.json
└── Dockerfile
```

### TypeScript Path Alias

`@/*` maps to `src/*` via `tsconfig.json` `paths` + `tsc-alias` for compilation.

---

## MCP Tools

### `list_schemas`
Lists all non-system tenant schemas.
- **Input:** none
- **Output:** `string[]` — excludes `pg_*`, `information_schema`, `public`

### `list_tables`
Lists tables in a given schema.
- **Input:** `{ schema: string }`
- **Output:** `Array<{ table_name: string, row_estimate: number }>`

### `describe_table`
Returns column definitions for a table.
- **Input:** `{ schema: string, table: string }`
- **Output:** `Array<{ column_name: string, data_type: string, is_nullable: boolean, column_default: string | null, is_primary_key: boolean }>`

### `execute_query`
Executes a raw SELECT statement in a specified tenant schema.
- **Input:** `{ schema: string, sql: string }`
- **Output:** `{ rows: Record<string, unknown>[], row_count: number }`
- **Guard:** Strips SQL comments, rejects any statement whose first keyword is not `SELECT`

All tool inputs are validated with Zod before execution.

---

## Configuration

Environment variables loaded and validated at startup via Zod. Server refuses to start if any required var is missing.

```env
DATABASE_URL=postgres://user:pass@rds-host.internal:5432/dbname
PORT=3000
ALLOWED_ORIGINS=https://claude.ai
MCP_API_KEY=<secret>
QUERY_TIMEOUT_MS=30000
```

`.env.example` is committed with placeholder values.

---

## Database

### Connection Pool (`src/db/pool.ts`)
Single `pg.Pool` instance shared across all requests. SSL set to `{ rejectUnauthorized: false }` for RDS private VPC connections.

### Schema Switching (`src/db/query.ts`)
Uses `SET LOCAL search_path TO <schema>` inside a transaction per query. Schema name is validated against the live schema list before use to prevent injection.

### SELECT Guard
1. Strip `--` line comments and `/* */` block comments
2. Trim whitespace
3. Check first keyword is `SELECT` (case-insensitive)
4. Reject with descriptive error if not

---

## HTTP Transport

### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/mcp` | Bearer | MCP JSON-RPC messages |
| GET | `/mcp` | Bearer | SSE stream |
| DELETE | `/mcp` | Bearer | Session teardown |
| GET | `/health` | None | Health check |

### Security
- Bearer token (`MCP_API_KEY`) required on all `/mcp` routes
- CORS restricted to `ALLOWED_ORIGINS`
- Raw SQL not logged to stdout — only schema name + query duration

### Startup Sequence (`src/index.ts`)
1. Load and validate env (fail fast on missing vars)
2. Test DB connectivity (fail fast if RDS unreachable)
3. Start Express on `PORT`
4. Log `Postgres MCP server listening on :<PORT>`

---

## Deployment

- **Base image:** `node:22-alpine`
- **Build:** `tsc` → `dist/`
- **Run:** `node dist/index.js`
- **EC2:** Exposed on `PORT` (default 3000, bound to `localhost` only), protected by security group
- **RDS:** Private, same VPC — accessed via internal DNS hostname in `DATABASE_URL`

### Nginx Reverse Proxy

Nginx sits in front of the Node process, terminates TLS, and proxies `/mcp` and `/health` to `localhost:3000`. The Node process binds to `127.0.0.1` only — never exposed directly to the internet.

**`/etc/nginx/sites-available/postgres-mcp`**

```nginx
server {
    listen 80;
    server_name your-ec2-domain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name your-ec2-domain.com;

    ssl_certificate     /etc/letsencrypt/live/your-ec2-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-ec2-domain.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;

    # SSE: disable buffering so chunks stream to the client immediately
    proxy_buffering off;
    proxy_cache off;

    location /mcp {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "keep-alive";
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_read_timeout 3600s;   # keep SSE connections alive
    }

    location /health {
        proxy_pass http://127.0.0.1:3000;
    }
}
```

Key nginx settings:
- `proxy_buffering off` — required for SSE streaming to work correctly
- `proxy_read_timeout 3600s` — prevents nginx from killing long-lived SSE connections
- HTTP → HTTPS redirect enforced
- Node process only reachable via `127.0.0.1`, not directly from the internet

### Process Management

Run the Node process with `pm2` on EC2 for auto-restart and log management:

```bash
pm2 start dist/index.js --name postgres-mcp
pm2 save
pm2 startup   # auto-start on reboot
```

### Project Structure (with deployment files)

```
postgres-mcp/
├── nginx/
│   └── postgres-mcp.conf    # Nginx site config (template)
├── README.md                # Setup, run, and deployment instructions
└── ...
```

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Non-SELECT SQL | Rejected with `"Only SELECT statements are allowed"` |
| Invalid schema name | Rejected with `"Schema not found"` |
| DB connection failure at startup | Process exits with non-zero code |
| Query timeout | Returns error with `"Query exceeded timeout"` |
| Missing/invalid Bearer token | HTTP 401 |
| Zod validation failure | HTTP 400 with field-level error details |

---

## Testing

- Unit tests for SELECT guard (valid/invalid SQL variants)
- Unit tests for schema name validation
- Unit tests for Zod env config (missing vars, wrong types)
- Integration test: `list_schemas` against a real test DB
- Integration test: `execute_query` with valid and invalid SQL
