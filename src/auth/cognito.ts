import jwksRsa from 'jwks-rsa';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import { env } from '@/config/env';

// ─── JWKS Client ──────────────────────────────────────────────────────────────

let _jwksClient: jwksRsa.JwksClient | null = null;

function getJwksClient(): jwksRsa.JwksClient {
  if (!_jwksClient) {
    _jwksClient = jwksRsa({
      jwksUri: env.COGNITO_JWKS_URL!,
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: 600_000, // 10 minutes
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    });
  }
  return _jwksClient;
}

// ─── Token Verification ───────────────────────────────────────────────────────

export interface TokenPayload extends jwt.JwtPayload {
  scope?: string;
  client_id?: string;
}

/**
 * Verifies a Cognito JWT:
 *  1. Decodes the token header to extract `kid`
 *  2. Fetches the matching RS256 public key from Cognito JWKS
 *  3. Verifies signature, issuer, and algorithm
 *  4. Confirms the required scope is present
 */
export async function verifyToken(token: string): Promise<TokenPayload> {
  const decoded = jwt.decode(token, { complete: true });

  if (!decoded || typeof decoded.payload === 'string' || !decoded.header.kid) {
    throw new Error('Invalid token format');
  }

  const client = getJwksClient();
  const signingKey = await client.getSigningKey(decoded.header.kid);
  const publicKey = signingKey.getPublicKey();

  const payload = jwt.verify(token, publicKey, {
    issuer: env.COGNITO_ISSUER!,
    algorithms: ['RS256'],
  }) as TokenPayload;

  // Cognito M2M tokens carry scopes as a space-delimited string in the `scope` claim
  const tokenScopes = (payload.scope ?? '').split(' ').filter(Boolean);
  if (!tokenScopes.includes(env.COGNITO_SCOPE!)) {
    throw new Error(
      `Insufficient scope. Required: '${env.COGNITO_SCOPE}', received: '${payload.scope ?? ''}'`,
    );
  }

  return payload;
}

// ─── OAuth Metadata Endpoints ─────────────────────────────────────────────────

/**
 * Protected Resource Metadata (RFC 9728 / MCP spec).
 * Tells clients which authorization servers can issue tokens for this resource.
 */
export function getProtectedResourceMetadata(): Record<string, unknown> {
  return {
    resource: `${env.SERVER_URL}/mcp`,
    authorization_servers: [env.COGNITO_ISSUER!],
    scopes_supported: [env.COGNITO_SCOPE!],
    bearer_methods_supported: ['header'],
  };
}

/**
 * Fetches Cognito's OpenID Connect discovery document and merges it into the
 * OAuth 2.0 Authorization Server Metadata format expected by MCP clients.
 * Points token_endpoint at our proxy so we can inject client credentials.
 */
export async function getAuthServerMetadata(): Promise<Record<string, unknown>> {
  const cognitoDiscovery = await axios.get<Record<string, unknown>>(
    `${env.COGNITO_ISSUER!}/.well-known/openid-configuration`,
  );

  return {
    ...cognitoDiscovery.data,
    // Override token endpoint to proxy through this server
    // so the MCP client doesn't need to know the client secret
    token_endpoint: `${env.SERVER_URL}/oauth/token`,
    authorization_endpoint: `${env.SERVER_URL}/oauth/authorize`,
    scopes_supported: [env.COGNITO_SCOPE!],
    // Required by MCP spec (PKCE)
    code_challenge_methods_supported:
      (cognitoDiscovery.data['code_challenge_methods_supported'] as string[]) ?? ['S256'],
  };
}

// ─── Token Proxy ──────────────────────────────────────────────────────────────

/**
 * Proxies a token request to Cognito's token endpoint, injecting client credentials.
 * Used by the /oauth/token Express route.
 */
export async function proxyCognitoTokenRequest(
  body: Record<string, string>,
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams(body);

  // Inject client credentials if not already provided by the caller
  if (!params.get('client_id')) params.set('client_id', env.COGNITO_CLIENT_ID!);
  if (!params.get('client_secret')) params.set('client_secret', env.COGNITO_CLIENT_SECRET!);

  const response = await axios.post<Record<string, unknown>>(
    `${env.COGNITO_TOKEN_ENDPOINT}/oauth2/token`,
    params.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );

  return response.data;
}

// ─── Authorize Redirect ───────────────────────────────────────────────────────

/**
 * Builds the Cognito authorize redirect URL from the incoming query parameters.
 * Strips the `resource` param — Cognito does not support RFC 8707.
 */
export function buildAuthorizeRedirectUrl(
  query: Record<string, string | string[] | undefined>,
): string {
  const params = new URLSearchParams();

  const pick = (key: string, fallback?: string) => {
    const val = Array.isArray(query[key]) ? query[key][0] : (query[key] as string | undefined);
    if (val) params.set(key, val);
    else if (fallback) params.set(key, fallback);
  };

  pick('response_type', 'code');
  pick('client_id', env.COGNITO_CLIENT_ID!);
  pick('redirect_uri');
  pick('scope', env.COGNITO_SCOPE!);
  pick('state');
  pick('code_challenge');
  pick('code_challenge_method');
  // Intentionally omit `resource` — Cognito does not support RFC 8707

  return `${env.COGNITO_DOMAIN}/oauth2/authorize?${params.toString()}`;
}
