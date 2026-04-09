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
- Access to the PostgreSQL RDS instance (same VPC or VPN)

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

The server binds to `127.0.0.1:PORT` and must be fronted by nginx for external access.

## Docker

**Build:**

```bash
docker build -t postgres-mcp .
```

**Run:**

```bash
docker run -p 3000:3000 --env-file .env postgres-mcp
```

> When running in Docker, expose only to localhost and let nginx proxy external traffic.

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
nano .env   # set DATABASE_URL, ALLOWED_ORIGINS, etc.
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
pm2 status                  # check running processes
pm2 logs postgres-mcp       # tail logs
pm2 restart postgres-mcp
pm2 stop postgres-mcp
```

### 4. Configure Nginx

```bash
sudo cp nginx/postgres-mcp.conf /etc/nginx/sites-available/postgres-mcp

# Replace YOUR_DOMAIN with your actual domain or EC2 public IP
sudo nano /etc/nginx/sites-available/postgres-mcp

sudo ln -s /etc/nginx/sites-available/postgres-mcp /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
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

Open **port 443 (HTTPS)** to `0.0.0.0/0` (or restrict to Claude's IPs if known).
**Do NOT open port 3000** — only nginx proxies to it on localhost.

## Connecting to Claude

In your Claude MCP settings (`claude_desktop_config.json` or Claude.ai integrations), add:

```json
{
  "mcpServers": {
    "postgres": {
      "type": "http",
      "url": "https://YOUR_DOMAIN/mcp"
    }
  }
}
```

## Typical Claude Workflow

1. Call `list_schemas` → discover available tenant schemas
2. Call `list_tables` with a schema name → explore table structure
3. Call `describe_table` with schema + table → understand columns
4. Call `execute_query` with schema + a SELECT statement → run analytics

## Security Notes

- Only `SELECT` statements are permitted — all other SQL is rejected at the guard level
- Schema names are validated against the live schema list before use (prevents injection)
- Raw SQL is never logged — only schema name + query duration
- The Node.js process binds to `127.0.0.1` only; nginx handles TLS and external traffic
- Restrict the EC2 security group to known IPs for additional security
