import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { getPool } from '@/db/pool';
import { env } from '@/config/env';
import { oauthMiddleware } from '@/auth/middleware';
import {
  getProtectedResourceMetadata,
  getAuthServerMetadata,
  proxyCognitoTokenRequest,
  buildAuthorizeRedirectUrl,
} from '@/auth/cognito';
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

  app.set('trust proxy', 'loopback');
  app.use(
    cors({
      origin: env.ALLOWED_ORIGINS,
      methods: ['GET', 'POST', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id'],
      exposedHeaders: ['Mcp-Session-Id', 'WWW-Authenticate'],
    }),
  );
  app.use(express.json());

  // ─── Public endpoints (no auth) ─────────────────────────────────────────────

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  // ─── OAuth discovery + proxy endpoints ──────────────────────────────────────
  // These are intentionally unauthenticated — clients need them to acquire tokens.

  if (env.OAUTH_ENABLED) {
    /**
     * Protected Resource Metadata (RFC 9728)
     * MCP clients read this to discover which auth server issues tokens for /mcp.
     */
    app.get('/.well-known/oauth-protected-resource', (_req: Request, res: Response) => {
      res.json(getProtectedResourceMetadata());
    });

    /**
     * OAuth 2.0 Authorization Server Metadata (RFC 8414)
     * Proxied from Cognito's OpenID discovery document.
     * MCP clients use this to find token_endpoint, authorize_endpoint, etc.
     */
    app.get(
      '/.well-known/oauth-authorization-server',
      async (_req: Request, res: Response) => {
        try {
          res.json(await getAuthServerMetadata());
        } catch {
          res.status(500).json({
            error: 'server_error',
            error_description: 'Failed to fetch authorization server metadata',
          });
        }
      },
    );

    /**
     * OpenID Connect discovery — same as above, exposed at the standard OIDC path.
     */
    app.get(
      '/.well-known/openid-configuration',
      async (_req: Request, res: Response) => {
        try {
          res.json(await getAuthServerMetadata());
        } catch {
          res.status(500).json({
            error: 'server_error',
            error_description: 'Failed to fetch OpenID configuration',
          });
        }
      },
    );

    /**
     * OAuth 2.0 Authorization endpoint — redirects to Cognito's /oauth2/authorize.
     * Strips the `resource` parameter (Cognito does not support RFC 8707).
     */
    app.get('/oauth/authorize', (req: Request, res: Response) => {
      const redirectUrl = buildAuthorizeRedirectUrl(
        req.query as Record<string, string | undefined>,
      );
      res.redirect(redirectUrl);
    });

    /**
     * OAuth 2.0 Token endpoint — proxies to Cognito's /oauth2/token.
     * Injects client_id and client_secret so the MCP client doesn't need them.
     */
    app.post('/oauth/token', async (req: Request, res: Response) => {
      try {
        const tokenResponse = await proxyCognitoTokenRequest(
          req.body as Record<string, string>,
        );
        res.json(tokenResponse);
      } catch (err: unknown) {
        const axiosErr = err as {
          response?: { status?: number; data?: unknown };
          message?: string;
        };
        res.status(axiosErr.response?.status ?? 500).json(
          axiosErr.response?.data ?? {
            error: 'server_error',
            error_description: axiosErr.message ?? 'Token request failed',
          },
        );
      }
    });
  }

  // ─── MCP endpoints (Bearer auth required when OAUTH_ENABLED) ────────────────

  app.use('/mcp', oauthMiddleware);

  // Session registry: sessionId → transport
  const transports = new Map<string, StreamableHTTPServerTransport>();

  // POST /mcp — initialize new session or route existing message
  app.post('/mcp', async (req: Request, res: Response, _next: NextFunction) => {
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
  app.get('/mcp', async (req: Request, res: Response, _next: NextFunction) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    await transports.get(sessionId)!.handleRequest(req, res);
  });

  // DELETE /mcp — close a session
  app.delete('/mcp', async (req: Request, res: Response, _next: NextFunction) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (sessionId && transports.has(sessionId)) {
      await transports.get(sessionId)!.close();
      transports.delete(sessionId);
    }
    res.status(204).end();
  });

  return app;
}
