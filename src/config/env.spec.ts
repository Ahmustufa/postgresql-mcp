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
    process.env['ALLOWED_ORIGINS'] = 'https://claude.ai';
    expect(() => require('@/config/env')).toThrow(/DATABASE_URL/);
  });

  it('throws when ALLOWED_ORIGINS is missing', () => {
    process.env['DATABASE_URL'] = 'postgres://localhost:5432/db';
    delete process.env['ALLOWED_ORIGINS'];
    expect(() => require('@/config/env')).toThrow(/ALLOWED_ORIGINS/);
  });

  it('applies default PORT=3000 when not set', () => {
    process.env['DATABASE_URL'] = 'postgres://localhost:5432/db';
    process.env['ALLOWED_ORIGINS'] = 'https://claude.ai';
    delete process.env['PORT'];
    const { env } = require('@/config/env');
    expect(env.PORT).toBe(3000);
  });

  it('applies default QUERY_TIMEOUT_MS=30000 when not set', () => {
    process.env['DATABASE_URL'] = 'postgres://localhost:5432/db';
    process.env['ALLOWED_ORIGINS'] = 'https://claude.ai';
    delete process.env['QUERY_TIMEOUT_MS'];
    const { env } = require('@/config/env');
    expect(env.QUERY_TIMEOUT_MS).toBe(30000);
  });

  it('parses ALLOWED_ORIGINS into an array', () => {
    process.env['DATABASE_URL'] = 'postgres://localhost:5432/db';
    process.env['ALLOWED_ORIGINS'] = 'https://claude.ai,https://example.com';
    const { env } = require('@/config/env');
    expect(env.ALLOWED_ORIGINS).toEqual(['https://claude.ai', 'https://example.com']);
  });
});
