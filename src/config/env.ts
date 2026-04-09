import { z } from 'zod';

const envSchema = z
  .object({
    // ─── Core ─────────────────────────────────────────────────────────────────
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    PORT: z.coerce.number().int().positive().default(3000),
    ALLOWED_ORIGINS: z
      .string()
      .min(1, 'ALLOWED_ORIGINS is required')
      .transform((s) => s.split(',').map((o) => o.trim())),
    QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),

    // ─── OAuth ────────────────────────────────────────────────────────────────
    // Set OAUTH_ENABLED=true to require Cognito JWT on every /mcp request.
    // All COGNITO_* vars become required when enabled.
    OAUTH_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),

    // Public URL of this server — used in WWW-Authenticate response headers
    SERVER_URL: z.string().optional(),

    COGNITO_ISSUER: z.string().optional(),
    COGNITO_USER_POOL_ID: z.string().optional(),
    COGNITO_CLIENT_ID: z.string().optional(),
    COGNITO_CLIENT_SECRET: z.string().optional(),
    COGNITO_DOMAIN: z.string().optional(),
    COGNITO_TOKEN_ENDPOINT: z.string().optional(),
    COGNITO_JWKS_URL: z.string().optional(),
    COGNITO_SCOPE: z.string().optional(),
  })
  .refine(
    (data) => {
      if (!data.OAUTH_ENABLED) return true;
      return (
        !!data.SERVER_URL &&
        !!data.COGNITO_ISSUER &&
        !!data.COGNITO_USER_POOL_ID &&
        !!data.COGNITO_CLIENT_ID &&
        !!data.COGNITO_CLIENT_SECRET &&
        !!data.COGNITO_DOMAIN &&
        !!data.COGNITO_TOKEN_ENDPOINT &&
        !!data.COGNITO_JWKS_URL &&
        !!data.COGNITO_SCOPE
      );
    },
    {
      message:
        'When OAUTH_ENABLED=true, the following vars are required: ' +
        'SERVER_URL, COGNITO_ISSUER, COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID, ' +
        'COGNITO_CLIENT_SECRET, COGNITO_DOMAIN, COGNITO_TOKEN_ENDPOINT, ' +
        'COGNITO_JWKS_URL, COGNITO_SCOPE',
    },
  );

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const fields = parsed.error.flatten();
  throw new Error(
    `Invalid environment variables:\n${JSON.stringify(fields.fieldErrors, null, 2)}` +
      (fields.formErrors.length ? `\n${fields.formErrors.join('\n')}` : ''),
  );
}

export const env = parsed.data;

export type Env = z.infer<typeof envSchema>;
