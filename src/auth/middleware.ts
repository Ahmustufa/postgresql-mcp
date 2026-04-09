import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '@/auth/cognito';
import { env } from '@/config/env';

/**
 * MCP OAuth Bearer token middleware.
 *
 * Per MCP spec (2025-03-26), every /mcp request must include:
 *   Authorization: Bearer <cognito-access-token>
 *
 * On 401, the WWW-Authenticate header points the client to the Protected
 * Resource Metadata document so it can discover where to obtain a token.
 *
 * Pass-through when OAUTH_ENABLED=false.
 */
export async function oauthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!env.OAUTH_ENABLED) {
    next();
    return;
  }

  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res
      .status(401)
      .set(
        'WWW-Authenticate',
        `Bearer realm="${env.SERVER_URL}/mcp", ` +
          `resource_metadata="${env.SERVER_URL}/.well-known/oauth-protected-resource"`,
      )
      .json({
        error: 'unauthorized',
        error_description:
          'Bearer token required. See /.well-known/oauth-protected-resource for token acquisition details.',
      });
    return;
  }

  const token = authHeader.slice('Bearer '.length);

  try {
    await verifyToken(token);
    next();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Token validation failed';
    const isScope = message.toLowerCase().includes('scope');

    res
      .status(isScope ? 403 : 401)
      .set(
        'WWW-Authenticate',
        `Bearer realm="${env.SERVER_URL}/mcp", ` +
          `error="${isScope ? 'insufficient_scope' : 'invalid_token'}", ` +
          `error_description="${message}"`,
      )
      .json({
        error: isScope ? 'insufficient_scope' : 'invalid_token',
        error_description: message,
      });
  }
}
