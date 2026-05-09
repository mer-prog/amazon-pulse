import { afterEach, describe, expect, it } from 'vitest';
import { assertEnv, populateProcessEnv, type CronEnv } from '../src/env.js';

const FULL_ENV: CronEnv = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'svc-role',
  SP_API_CLIENT_ID: 'amzn1.application-oa2-client.test',
  SP_API_CLIENT_SECRET: 'amzn1.oa2-cs.v1.test',
  ENCRYPTION_KEY: 'dGVzdF9rZXlfZm9yX2NpX29ubHlfbm90X2Zvcl9wcm8=',
  SP_API_PRODUCTION: 'false',
};

const ORIGINAL = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe('assertEnv', () => {
  it('passes for a complete env object', () => {
    expect(() => assertEnv({ ...FULL_ENV })).not.toThrow();
  });

  it('throws with the names of every missing required key', () => {
    const env = { ...FULL_ENV };
    env.SUPABASE_URL = '';
    env.ENCRYPTION_KEY = '';
    expect(() => assertEnv(env)).toThrow(/SUPABASE_URL.*ENCRYPTION_KEY|ENCRYPTION_KEY.*SUPABASE_URL/);
  });

  it('does not require SP_API_PRODUCTION (it is optional)', () => {
    const env = { ...FULL_ENV };
    delete env.SP_API_PRODUCTION;
    expect(() => assertEnv(env)).not.toThrow();
  });
});

describe('populateProcessEnv', () => {
  it('mirrors all string values into process.env', () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SP_API_CLIENT_ID;
    populateProcessEnv({ ...FULL_ENV });
    expect(process.env.SUPABASE_URL).toBe('https://test.supabase.co');
    expect(process.env.SP_API_CLIENT_ID).toBe('amzn1.application-oa2-client.test');
    expect(process.env.SP_API_PRODUCTION).toBe('false');
  });

  it('overwrites existing values rather than skipping them', () => {
    process.env.SUPABASE_URL = 'stale-value';
    populateProcessEnv({ ...FULL_ENV });
    expect(process.env.SUPABASE_URL).toBe('https://test.supabase.co');
  });

  it('is a no-op when process.env is unavailable', () => {
    // Simulate a sandbox without nodejs_compat: process.env is undefined.
    const original = (globalThis as { process?: unknown }).process;
    (globalThis as { process?: unknown }).process = { env: undefined };
    expect(() => populateProcessEnv({ ...FULL_ENV })).not.toThrow();
    (globalThis as { process?: unknown }).process = original;
  });
});
