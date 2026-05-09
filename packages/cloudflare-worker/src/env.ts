/**
 * Cloudflare Workers env binding shape + a small helper that mirrors the
 * env into `process.env` so the existing Node-style pipeline modules
 * (which read `process.env.X`) keep working unchanged on the Workers runtime
 * with `nodejs_compat` flag enabled.
 */

export interface CronEnv {
  // Supabase (service role key — bypass RLS, keep in wrangler secrets)
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;

  // SP-API LWA app credentials (sandbox unless SP_API_PRODUCTION=true)
  SP_API_CLIENT_ID: string;
  SP_API_CLIENT_SECRET: string;

  // App-side encryption key for refresh_token at rest (base64, 32 bytes)
  ENCRYPTION_KEY: string;

  // Optional: override the default sandbox endpoint logic. "true" to flip on.
  SP_API_PRODUCTION?: string;
}

const REQUIRED_KEYS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SP_API_CLIENT_ID',
  'SP_API_CLIENT_SECRET',
  'ENCRYPTION_KEY',
] as const satisfies readonly (keyof CronEnv)[];

export function assertEnv(env: CronEnv): void {
  const missing: string[] = [];
  for (const k of REQUIRED_KEYS) {
    if (!env[k]) missing.push(k);
  }
  if (missing.length > 0) {
    throw new Error(
      `Cloudflare Worker env is missing required secrets: ${missing.join(', ')}. ` +
        'Set via `wrangler secret put <NAME>`.',
    );
  }
}

/**
 * Copy every Cloudflare-bound env var into process.env so legacy modules
 * that read `process.env.SUPABASE_URL` etc. work transparently.
 *
 * Idempotent: subsequent calls overwrite the same keys with the same values
 * (so calling once per scheduled() invocation is fine).
 */
export function populateProcessEnv(env: CronEnv): void {
  // process is provided by the nodejs_compat polyfill on Workers.
  const target = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  if (!target || !target.env) return;
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      target.env[key] = value;
    }
  }
}
